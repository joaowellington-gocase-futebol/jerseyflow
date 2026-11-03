// Ponte com o Radar de Uniformes (outro app do GoDeploy).
// Todo dia, depois da varredura do radar, o cron chama /tasks/radar: buscamos os kits que
// viraram LANÇADO (só clubes licenciados), baixamos as fotos das matérias, a IA separa
// frente / costas / escudo e o kit fica na aba "Novos uniformes" esperando o clique.
// A geração em si continua no navegador, como qualquer conversão.

const RADAR = 'https://radar-uniformes.devgogroup.com';
const AI = 'https://ai-proxy.gogroupbr.com';
const MODELO_IA = 'gpt-6-astra';
const ESTAGIOS = ['LANCADO', 'EM_CAMPO'];
const JANELA_DIAS = 45; // na primeira sincronização, não puxa o histórico inteiro
const KITS_POR_RODADA = 8;
const FOTOS_POR_KIT = 10;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export async function schemaRadar(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS radar_kits (id TEXT PRIMARY KEY, kit_id TEXT, nome TEXT, status TEXT, recebido_em TEXT, atualizado_em TEXT, json TEXT NOT NULL)`, []);
}

export const idDoKit = (kitId) => String(kitId).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const TIPOS = { TITULAR: 'camisa I', RESERVA: 'camisa II', TERCEIRA: 'camisa III', RETRO: 'retrô', COMEMORATIVA: 'comemorativa', GOLEIRO: 'goleiro', TREINO: 'treino', OUTRO: 'camisa' };
const nomeDoKit = (k) => `${k.clube_nome} — ${TIPOS[k.tipo] || String(k.tipo || 'camisa').toLowerCase()} ${k.temporada && k.temporada !== 'sd' ? k.temporada : ''}`.trim();

async function config(db, chave, valor) {
  if (valor === undefined) return (await db.query(`SELECT valor FROM config WHERE chave = ?`, [chave])).rows[0]?.valor ?? null;
  await db.exec(`INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)`, [chave, valor]);
}

export async function estadoRadar(env) {
  const ultima = await config(env.DB, 'radar_ultima');
  return { temChave: Boolean(env.RADAR_API_KEY), radar: env.RADAR_URL || RADAR, ultima: ultima ? JSON.parse(ultima) : null };
}

// ---------- fotos das matérias ----------
const RUIM = /logo|icon|avatar|sprite|banner|badge|emoji|gravatar|placeholder|blank|pixel|[/_.-]ads?[_/-]|share|facebook|twitter|whatsapp|\.svg|\.gif/i;
const decodificar = (s) => s.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').replace(/&quot;/g, '"').trim();

/** Pede a maior versão das imagens do Blogger (Footy Headlines) e do WordPress. */
function maior(u) {
  if (/googleusercontent\.com|blogspot\.com/.test(u)) {
    return u.replace(/\/(s\d+(-[a-z0-9-]+)?|w\d+-h\d+(-[a-z0-9-]+)?)\//, '/s1600/').replace(/=(s|w)\d+[^/?#]*$/, '=s1600');
  }
  if (/footyheadlines\.com\/static\/img\/post\//.test(u)) return u.replace(/\?s=\d+$/, '');
  return u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))(\?|$)/i, '$1$3');
}

function imagensDaPagina(html, pagina) {
  const achadas = [];
  // as fotos da própria matéria costumam levar o slug dela no nome do arquivo
  const slug = new URL(pagina).pathname.split('/').pop().replace(/\.html?$/, '');
  const add = (src, peso) => {
    if (!src) return;
    let u;
    try { u = new URL(decodificar(src), pagina).href; } catch { return; }
    if (!/^https?:/.test(u) || RUIM.test(u)) return;
    achadas.push({ url: maior(u), peso });
  };
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    if (/(property|name)=["'](og:image(:secure_url)?|twitter:image(:src)?)["']/i.test(tag)) {
      const src = tag.match(/content=["']([^"']+)["']/i)?.[1];
      add(src, /\/social\//.test(src || '') ? 1 : 2); // card social com marca do site vale menos que a foto
    }
  }
  // só o corpo da matéria: corta cabeçalho, menus e rodapé quando dá
  const corpo = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/class=["'][^"']*(post-body|entry-content|post-content|article-body)[^"']*["'][\s\S]*/i)?.[0] || html;
  for (const m of corpo.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const cls = tag.match(/\sclass=["']([^"']*)["']/i)?.[1] || '';
    if (/feed|inpost|related|thumb|avatar|author|widget|sidebar|logo/i.test(cls)) continue; // outras matérias e enfeites
    const src = tag.match(/\sdata-(?:lazy-)?src=["']([^"']+)["']/i)?.[1] || tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    const w = Number(tag.match(/\s(?:data-)?width=["']?(\d+)/i)?.[1] || 0);
    if (w && w < 300) continue;
    add(src, slug.length > 8 && src?.includes(slug) ? 4 : /googleusercontent|blogspot|wp-content\/uploads/.test(src || '') ? 2 : 1);
  }
  const vistas = new Set();
  return achadas.filter((x) => (vistas.has(x.url) ? false : vistas.add(x.url))).sort((a, b) => b.peso - a.peso);
}

async function baixar(url, opcoes = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: opcoes.accept || '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(opcoes.timeout || 15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// O link do Google Notícias é um redirecionamento em JS; o endereço real sai do mesmo endpoint que a página dele usa.
let googleBloqueado = false;
export async function linkReal(url) {
  if (!/news\.google\./.test(url)) return url;
  if (googleBloqueado) throw new Error('Google Notícias bloqueou esta rodada');
  const id = new URL(url).pathname.split('/').pop();
  let html = '';
  for (const pagina of [`https://news.google.com/rss/articles/${id}`, `https://news.google.com/articles/${id}?hl=pt-BR&gl=BR&ceid=BR:pt-419`]) {
    const r = await fetch(pagina, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) { html = await r.text(); break; }
    if (r.status === 429 || r.status === 503) { googleBloqueado = true; throw new Error(`Google Notícias bloqueou (HTTP ${r.status})`); }
  }
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error('Google Notícias sem assinatura');
  const pedido = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', pedido, null, 'generic']]])),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Google Notícias HTTP ${r.status}`);
  const real = JSON.parse(JSON.parse((await r.text()).split('\n\n')[1])[0][2])[1];
  if (!/^https?:\/\//.test(real)) throw new Error('Google Notícias não devolveu o link');
  return real;
}

const SEM_FOTO_UTIL = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|twitter\.com|\/\/x\.com)/;
const peso = (l) => (/footyheadlines/.test(l.link + l.fonte) ? 4 : 0) + (/mantosdofutebol/.test(l.link + l.fonte) ? 2 : 0) + (l.estagio === 'LANCADO' ? 1 : 0);

async function materiasDoKit(kit) {
  // diretas primeiro; as do Google Notícias são decodificadas até completar 4 matérias
  const todos = (kit.links || []).filter((l) => l?.link).sort((a, b) => (/news\.google\./.test(a.link) - /news\.google\./.test(b.link)) || (peso(b) - peso(a)));
  const abertas = [];
  const vistas = new Set();
  let decodificadas = 0;
  for (const l of todos) {
    if (abertas.length >= 4) break;
    let link = l.link;
    if (/news\.google\./.test(link)) {
      if (decodificadas++ >= 8) continue;
      if (googleBloqueado) continue;
      try { link = await linkReal(link); } catch (e) { console.log('radar: link do Google Notícias não abriu:', e.message); continue; }
    }
    if (SEM_FOTO_UTIL.test(link) || vistas.has(link)) continue;
    vistas.add(link);
    abertas.push({ ...l, link });
  }
  return abertas;
}

async function fotosDoKit(kit, materias) {
  const candidatas = [];
  for (const l of materias) {
    try {
      const html = await (await baixar(l.link, { accept: 'text/html' })).text();
      for (const img of imagensDaPagina(html, l.link).slice(0, 8)) candidatas.push({ ...img, origem: l.link, fonte: l.fonte || new URL(l.link).hostname });
    } catch (e) { console.log('radar: matéria não abriu', l.link, e.message); }
  }
  const vistas = new Set();
  const fotos = [];
  for (const c of candidatas) {
    if (fotos.length >= FOTOS_POR_KIT) break;
    if (vistas.has(c.url)) continue;
    vistas.add(c.url);
    try {
      const r = await baixar(c.url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' });
      const tipo = (r.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|avif)$/.test(tipo)) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 25_000 || buf.byteLength > 8_000_000) continue; // miniatura ou arquivo gigante
      fotos.push({ ...c, tipo, buf });
    } catch { /* imagem que não abre fica de fora */ }
  }
  return fotos;
}

// ---------- IA: qual foto é frente, costas, escudo ----------
const SISTEMA = `Você separa fotos de notícias de lançamento de camisa de futebol para virarem referência de uma arte de capinha.
Para cada imagem, na ordem, classifique:
- "frente": a camisa DESTE kit vista de frente, inteira (foto de produto, flat lay, manequim ou jogador de frente com a camisa bem visível);
- "costas": a camisa deste kit vista de trás;
- "escudo": close do escudo bordado/aplicado desta camisa;
- "detalhe": close de gola, manga, tecido ou etiqueta desta camisa;
- "outra": outro kit, outro clube, logo, banner, texto, pessoa sem a camisa visível, montagem com várias camisas.
"nitida" (0-10): quanto a foto serve de referência (nitidez, camisa inteira, pouca distorção, sem marca d'água grande).
Responda SOMENTE JSON: {"imagens":[{"i":1,"papel":"frente|costas|escudo|detalhe|outra","nitida":0-10,"motivo":"até 8 palavras"}]}`;

async function classificar(env, kit, fotos) {
  if (!env.AI_PROXY_KEY || !fotos.length) return null;
  const usadas = fotos.filter((f) => f.buf.byteLength <= 3_500_000);
  const dica = kit.fornecedor ? ` Fornecedor segundo o radar: ${kit.fornecedor} (pode estar desatualizado — não descarte foto só por a marca ser outra).` : '';
  const conteudo = [{ type: 'text', text: `Kit: ${nomeDoKit(kit)}.${dica} ${usadas.length} imagens.` }];
  for (const f of usadas) conteudo.push({ type: 'image_url', image_url: { url: `data:${f.tipo};base64,${base64(f.buf)}` } });
  try {
    const r = await fetch(`${AI}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_PROXY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO_IA, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: conteudo }] }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const txt = (await r.json()).choices?.[0]?.message?.content || '{}';
    const lista = JSON.parse(txt.replace(/^```(json)?|```$/g, '')).imagens || [];
    const porFoto = new Map();
    lista.forEach((x, k) => { const f = usadas[(Number(x.i) || k + 1) - 1]; if (f) porFoto.set(f, x); });
    return porFoto;
  } catch (e) {
    console.log('radar: classificação falhou', e.message);
    return null;
  }
}

/** Escolhe o que entra como referência (o designer pode mudar na tela). */
function escolherPapeis(imagens) {
  const MAX = { frente: 3, escudo: 2, costas: 2 };
  const conta = { frente: 0, escudo: 0, costas: 0 };
  const ordem = [...imagens].sort((a, b) => (b.nitida ?? 5) - (a.nitida ?? 5));
  for (const im of ordem) {
    const p = im.papelIA;
    im.papel = MAX[p] && conta[p] < MAX[p] && (im.nitida ?? 5) >= 5 ? (conta[p]++, p) : '';
  }
  // sem classificação: a primeira foto (og:image) vira a frente
  if (!conta.frente && imagens.length && imagens.every((im) => !im.papelIA)) imagens[0].papel = 'frente';
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- sincronização ----------
async function kitsDoRadar(env) {
  const base = env.RADAR_URL || RADAR;
  const todos = [];
  for (const estagio of ESTAGIOS) {
    const r = await fetch(`${base}/api/kits?estagio=${estagio}&limit=100`, { headers: { Authorization: `Bearer ${env.RADAR_API_KEY}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (r.status === 401 || r.status === 403) throw new Error(`o radar recusou a chave (HTTP ${r.status}) — confira RADAR_API_KEY`);
    if (!r.ok) throw new Error(`o radar respondeu HTTP ${r.status}`);
    const lista = await r.json();
    if (!Array.isArray(lista)) throw new Error('resposta inesperada do radar');
    todos.push(...lista);
  }
  return todos.filter((k) => k.licenciado !== 0);
}

/** salvarBlob vem do worker principal (mesmo formato dos outros blobs). */
export async function sincronizarRadar(env, salvarBlob, { dias = JANELA_DIAS, origem = 'cron' } = {}) {
  const db = env.DB;
  await schemaRadar(db);
  const resumo = { quando: new Date().toISOString(), origem, ok: false, novos: 0, semFotos: 0, vistos: 0, pendentes: 0 };
  try {
    if (!env.RADAR_API_KEY) throw new Error('falta o segredo RADAR_API_KEY (chave de API do GoDeploy com acesso ao Radar de Uniformes)');
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
    const kits = (await kitsDoRadar(env)).filter((k) => (k.lancado_em || k.mudou_em || '') >= desde);
    resumo.vistos = kits.length;
    googleBloqueado = false;
    // kit que ficou sem nenhuma foto volta a ser tentado (o radar pode ter achado matérias novas)
    const ja = new Map((await db.query(`SELECT id, status, recebido_em, json FROM radar_kits`, [])).rows.map((r) => [r.id, r]));
    const novos = kits.filter((k) => !ja.has(idDoKit(k.kit_id)));
    const semNada = (r) => r?.status === 'sem_fotos' && !(JSON.parse(r.json).imagens || []).length;
    const retentar = kits.filter((k) => semNada(ja.get(idDoKit(k.kit_id))));
    const fila = [...novos, ...retentar];
    resumo.pendentes = Math.max(0, fila.length - KITS_POR_RODADA);
    for (const kit of fila.slice(0, KITS_POR_RODADA)) {
      const id = idDoKit(kit.kit_id);
      const materias = await materiasDoKit(kit);
      const fotos = await fotosDoKit(kit, materias);
      const ia = await classificar(env, kit, fotos);
      const imagens = [];
      for (const [i, f] of fotos.entries()) {
        const chave = `r:${id}:${i + 1}`;
        await salvarBlob(db, chave, f.tipo, f.buf);
        const c = ia?.get(f);
        imagens.push({ chave, url: f.url, origem: f.origem, fonte: f.fonte, papelIA: c?.papel || null, nitida: c ? Number(c.nitida) : null, motivo: c?.motivo || '' });
      }
      escolherPapeis(imagens);
      const status = imagens.some((im) => im.papel) ? 'novo' : 'sem_fotos';
      const agora = new Date().toISOString();
      const recebidoEm = ja.get(id)?.recebido_em || agora;
      const estado = {
        id, kitId: kit.kit_id, nome: nomeDoKit(kit), status, recebidoEm, atualizadoEm: agora,
        kit: { clube: kit.clube_nome, tipo: kit.tipo, temporada: kit.temporada, fornecedor: kit.fornecedor, estagio: kit.estagio, lancadoEm: kit.lancado_em, veredito: kit.veredito, rota: kit.rota, janela: kit.janela, score: kit.score, links: (materias.length ? materias : kit.links || []).slice(0, 6) },
        imagens, tarefas: [], classificadoPorIA: Boolean(ia),
      };
      await db.exec(`INSERT OR REPLACE INTO radar_kits (id, kit_id, nome, status, recebido_em, atualizado_em, json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, kit.kit_id, estado.nome, status, recebidoEm, agora, JSON.stringify(estado)]);
      console.log('radar kit', id, `${materias.length} matérias, ${fotos.length} fotos`, status);
      if (status === 'novo') resumo.novos++; else resumo.semFotos++;
    }
    resumo.ok = true;
  } catch (e) {
    resumo.erro = e.message;
  }
  await config(db, 'radar_ultima', JSON.stringify(resumo));
  console.log('radar', JSON.stringify(resumo));
  return resumo;
}

/** Confere a assinatura do cron da plataforma (X-Godeploy-Cron). */
export async function cronValido(req, env) {
  const h = req.headers.get('x-godeploy-cron');
  const ts = Number(h?.match(/(?:^|;)\s*t=(\d+)/)?.[1]);
  const sig = h?.match(/(?:^|;)\s*sig=([0-9a-f]+)/)?.[1];
  if (!ts || !sig || !env.GODEPLOY_CRON_KEY || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const url = new URL(req.url);
  const canonico = JSON.stringify(['v1', url.hostname.split('.')[0], req.method.toUpperCase(), url.pathname, ts]);
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey('raw', enc.encode(env.GODEPLOY_CRON_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', chave, new Uint8Array(sig.match(/.{1,2}/g).map((b) => parseInt(b, 16))), enc.encode(canonico));
}

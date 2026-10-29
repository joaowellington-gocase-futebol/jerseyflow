// Aba "Gerar escudo": foto do escudo na camisa → escudo recriado igual (mesma textura) em PNG 1000×1000.
// Fluxo no navegador: análise (acha o escudo e descreve material/textura) → recorte → recriação em fundo
// chroma → recorte do fundo → PNG quadrado → 2 agentes revisam; reprovou → a IA corrige pelo parecer.
// Estado em /api/escudos (env.DB), imagens em /api/blob/e:<id>:*.
import * as I from './imagem.js';
import { chatJSON, editarImagem, enviarBlob, baixarBlob, MODELOS } from './motor.js';

const LADO = 1000;
const OCUPACAO = 0.92; // o escudo ocupa 92% do lado maior: 40px de respiro em volta
const NOTA_MIN = 7;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };
const slug = (s) => (s || 'escudo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
const CREST = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M32 6l20 7v17c0 13-9 22-20 28C21 52 12 43 12 30V13z"/><path d="M32 18l3 7h7l-5.5 4.5 2 7.5L32 32.5 25.5 37l2-7.5L22 25h7z"/></svg>';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const SISTEMA_ANALISE = `Você é o diretor de arte da Gocase especializado em escudos de clubes de futebol.
Recebe a foto de um escudo aplicado numa camisa (pode ser a camisa inteira ou um close). Devolva SOMENTE um JSON:
{
  "identificacao": "clube + tipo de aplicação, ex.: 'Flamengo — escudo bordado'",
  "encontrado": true,
  "caixa": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0},
  "material": "bordado" | "emborrachado" | "termocolante" | "silk" | "jacquard" | "metalizado" | "outro",
  "descricao_en": "descrição EM INGLÊS, detalhada, do DESENHO do escudo: contorno, divisões internas, símbolos, monograma, letras (texto exato), estrelas e elementos que fazem parte dele, proporções e posições",
  "textura_en": "descrição EM INGLÊS do material e do acabamento físico: tipo de ponto do bordado e direção dos fios, bordas em relevo, brilho do emborrachado, película do transfer, laminado metálico, trama do tecido, etc.",
  "textos": ["textos exatos que aparecem no escudo"],
  "cores": [{"hex": "#000000", "nome": "preto"}],
  "problemas_foto": ["o que precisa ser corrigido na foto, em português: perspectiva, dobra do tecido, reflexo, sombra, baixa resolução…"],
  "alertas": ["avisos úteis em português"]
}
"caixa" é o retângulo que contém o escudo inteiro (incluindo estrelas e elementos que pertencem a ele, sem o tecido em volta), em frações da largura (x) e da altura (y) da imagem, de 0 a 1.
Se não houver escudo na foto, "encontrado": false.`;

function textoAnalise(notas) {
  return `Imagem 1: foto enviada pelo designer.\n${notas ? `Observações do designer: ${notas}\n` : ''}Encontre o escudo, delimite a caixa e descreva desenho, material e textura.`;
}

function blocoFiel(a) {
  return `- Identical design: same outline shape, proportions, internal divisions, symbols, stars and letters${a.textos?.length ? ` with the exact spelling ${a.textos.map((t) => `"${t}"`).join(', ')}` : ''}. Same colors${a.cores?.length ? ` (${a.cores.map((c) => c.hex).join(', ')})` : ''}. Do NOT redesign, simplify, modernize, flatten into a vector or "improve" it. Do not add or remove any element.
- Same material and texture as in the photo${a.material ? ` (${a.material})` : ''}: ${a.textura_en || 'keep the real physical finish'}. Keep the real physical finish — embroidery thread stitches and their direction, raised satin borders, rubber/silicone gloss, heat-transfer sheen, metallic foil — with crisp high-resolution detail.`;
}

function blocoFundo(chave) {
  return `- Remove everything that is not the crest: no jersey fabric, no shirt seams, no background, no sponsor or other logos. Keep only the crest and the elements that belong to it (e.g. stars directly above it).
- Put the crest perfectly centered on a perfectly flat, uniform ${chave.nome} background — no texture, gradient, shadow, glow or outline on it. The crest occupies about 85% of the square canvas and is fully inside the frame, with margin on all sides. The ${chave.hex} color must not appear inside the crest.`;
}

function promptEscudo({ a, chave, notas }) {
  return `Image 1 is a close-up of a football club crest applied on a jersey (a photo). Image 2 is the full original photo, for context only.
Recreate THIS EXACT CREST as a standalone, isolated, print-ready product image.

CREST: ${a.descricao_en || 'the crest shown in image 1'}

${blocoFiel(a)}
- Fix the photo problems: perfectly front-facing and flat (correct any perspective, tilt, curvature or fabric folds), symmetric where the original design is symmetric, even soft studio lighting, no glare, no cast shadows from the shirt.
${blocoFundo(chave)}
${notas ? `Designer notes: ${notas}` : ''}`;
}

function promptCorrecao({ a, chave, correcoes }) {
  return `Image 1 is the current draft of an isolated football club crest. Image 2 is the original photo of the real crest (the reference).
Keep the canvas, framing and everything that is already correct. Fix ONLY these problems:
${correcoes.map((c) => `- ${c}`).join('\n')}

Rules that must still hold:
${blocoFiel(a)}
${blocoFundo(chave)}`;
}

function sistemaRevisor(papel, foco) {
  return `Você é o ${papel} do controle de qualidade dos escudos de clubes de futebol recriados pela Gocase em PNG transparente.
Seu foco: ${foco}
Seja rigoroso, porém justo. Responda SOMENTE um JSON:
{
  "nota": 0-10,
  "aprovado": true|false,
  "problemas": ["problemas concretos em português, do mais grave ao menos grave"],
  "correcoes_en": ["instruções curtas e imperativas EM INGLÊS para o editor de imagem corrigir cada problema"]
}
Aprove (aprovado=true) somente com nota >= 7 e nenhum problema grave. Não penalize a ausência do tecido da camisa (ele deve sumir) nem a correção de perspectiva, luz e dobras da foto.`;
}

const REVISORES = [
  {
    papel: 'Revisor 1 — Fidelidade ao escudo',
    foco: 'comparar o escudo recriado com a foto: contorno, proporções, divisões, símbolos, estrelas, letras (grafia exata, sem letras tortas) e cores.',
    texto: (a) => `Imagem 1: foto do escudo real (referência). Imagem 2: escudo recriado sobre fundo xadrez (xadrez = transparente).
${a.textos?.length ? `Textos que devem aparecer, com a grafia exata: ${a.textos.join(' · ')}.` : ''}
Penalize forte: elemento faltando ou inventado, letra errada ou distorcida, forma ou proporção diferente, cor diferente, desenho "redesenhado" ou simplificado.`,
  },
  {
    papel: 'Revisor 2 — Textura e acabamento',
    foco: 'verificar se o material e a textura batem com a foto (bordado, emborrachado, transfer, metalizado…), se o escudo está frontal e nítido, e se o recorte está limpo para produção.',
    texto: (a) => `Imagem 1: foto do escudo real (referência). Imagem 2: escudo recriado sobre fundo xadrez (xadrez = transparente).
Material esperado: ${a.material || 'o da foto'} — ${a.textura_en || ''}
Penalize: textura diferente da foto (ex.: virou vetor liso quando era bordado), escudo torto ou em perspectiva, borrões, pedaços de tecido ou de fundo, halo verde/magenta/azul nas bordas, fragmentos soltos, partes do escudo cortadas.`,
  },
];

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const ativos = new Map(); // gerações rodando nesta aba
const chaveBlob = (id, nome) => `e:${id}:${nome}`;
const urlBlob = (chave) => `/api/blob/${encodeURIComponent(chave)}`;

class Escudo {
  constructor(estado) { this.estado = estado; this.ouvintes = new Set(); this._t = null; this.brutos = new Map(); }
  get id() { return this.estado.id; }
  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  salvar(agora = false) {
    this.estado.atualizadoEm = new Date().toISOString();
    for (const fn of this.ouvintes) fn(this);
    clearTimeout(this._t);
    const enviar = () => fetch(`/api/escudos/${this.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.estado) }).catch(() => {});
    if (agora) return enviar();
    this._t = setTimeout(enviar, 600);
  }
  log(msg) { this.estado.log.push({ t: new Date().toISOString(), msg }); this.salvar(); }
}

async function gerarImagem(prompt, imagens) {
  try {
    return await editarImagem({ prompt, imagens, size: '1024x1024' });
  } catch (e) {
    // se o AI Proxy não aceitar "size", tenta de novo no tamanho padrão
    if (e.fatal && /size/i.test(e.message)) return editarImagem({ prompt, imagens });
    throw e;
  }
}

async function revisar(a, imagens) {
  const modelos = [MODELOS.revisor1, MODELOS.revisor2];
  return Promise.all(REVISORES.map(async (r, i) => {
    try {
      const v = await chatJSON({ modelo: modelos[i], sistema: sistemaRevisor(r.papel, r.foco), texto: r.texto(a), imagens });
      const nota = Number(v.nota);
      return {
        agente: r.papel, modelo: modelos[i], nota: Number.isFinite(nota) ? nota : 0,
        aprovado: Boolean(v.aprovado) && nota >= NOTA_MIN,
        problemas: Array.isArray(v.problemas) ? v.problemas : [],
        correcoes_en: Array.isArray(v.correcoes_en) ? v.correcoes_en : v.correcoes_en ? [String(v.correcoes_en)] : [],
      };
    } catch (e) {
      return { agente: r.papel, modelo: modelos[i], erro: e.message, nota: null, aprovado: null, problemas: [], correcoes_en: [] };
    }
  }));
}

/** Uma versão: gera (ou corrige a anterior), tira o fundo, monta o PNG 1000×1000 e passa pelos revisores. */
async function versao(job, { correcoes = [], anterior = null } = {}) {
  const st = job.estado;
  const n = (st.versoes.at(-1)?.n || 0) + 1;
  const v = { n, status: 'gerando' };
  st.versoes.push(v);
  job.salvar();
  const a = st.analise;
  const chave = I.chavePorHex(st.chave);
  let png;
  try {
    const recorte = await baixarBlob(st.recorte.chave);
    const ref = await baixarBlob(st.ref.chave);
    const [recURI, refURI] = await Promise.all([I.dataURI(recorte, 1536, 'png'), I.dataURI(ref, 1024)]);
    const bruto = anterior && correcoes.length
      ? await gerarImagem(promptCorrecao({ a, chave, correcoes }), [await I.dataURI(anterior, 1536, 'png'), recURI])
      : await gerarImagem(promptEscudo({ a, chave, notas: st.notas }), [recURI, refURI]);
    job.brutos.set(n, bruto);
    const b = await I.bitmap(bruto);
    const semFundo = await I.recortarChroma(bruto, chave, { w: b.width, h: b.height });
    const { cobertura } = await I.infoAlfa(semFundo);
    if (cobertura < 0.01) throw new Error('o escudo saiu vazio depois de tirar o fundo');
    png = await I.quadrado(semFundo, LADO, OCUPACAO);
    v.imagem = await enviarBlob(chaveBlob(st.id, `v${n}`), png);
  } catch (e) {
    if (e.fatal && /sessão/.test(e.message)) throw e;
    v.status = 'erro'; v.erro = e.message; job.salvar();
    return v;
  }
  v.status = 'revisando';
  job.salvar();
  const recRev = await I.dataURI(await baixarBlob(st.recorte.chave), 1024);
  const revs = await revisar(a, [recRev, await I.sobreXadrez(png, 768)]);
  const validas = revs.filter((r) => r.nota !== null);
  v.revisoes = revs;
  v.media = validas.length ? +(validas.reduce((s, r) => s + r.nota, 0) / validas.length).toFixed(1) : null;
  v.aprovada = validas.length > 0 && validas.every((r) => r.aprovado);
  v.status = v.aprovada ? 'aprovada' : 'reprovada';
  v.correcoes = revs.flatMap((r) => r.correcoes_en).filter(Boolean).slice(0, 10);
  job.salvar();
  return v;
}

async function comStatus(job, operacao, fn) {
  ativos.set(job.id, job);
  job.estado.status = 'rodando';
  job.estado.operacao = operacao;
  delete job.estado.erro;
  job.salvar();
  try {
    await fn();
    job.estado.status = 'concluido';
  } catch (e) {
    console.error(e);
    job.estado.status = 'erro';
    job.estado.erro = e.message;
  }
  delete job.estado.operacao;
  ativos.delete(job.id);
  await job.salvar(true);
}

function escolher(job, n, manual) {
  const v = job.estado.versoes.find((x) => x.n === n);
  job.estado.escolhida = n;
  job.estado.manual = manual;
  job.estado.capa = v?.imagem || job.estado.capa;
}

async function iniciar({ file, notas, opcoes, usuario }) {
  const id = `${new Date().toISOString().slice(0, 10)}_${Math.random().toString(16).slice(2, 8)}`;
  const job = new Escudo({ id, criadoEm: new Date().toISOString(), status: 'rodando', autor: usuario, notas, opcoes, modelos: { ...MODELOS }, versoes: [], log: [] });
  const executar = comStatus(job, 'Gerando escudo', async () => {
    const st = job.estado;
    st.operacao = 'Enviando a foto';
    const ref = await (await fetch(await I.dataURI(file, 2048, 'jpeg'))).blob();
    st.ref = { chave: chaveBlob(id, 'ref'), url: await enviarBlob(chaveBlob(id, 'ref'), ref) };
    job.salvar();

    st.operacao = 'Analisando o escudo';
    job.salvar();
    const a = await chatJSON({ modelo: MODELOS.analise, sistema: SISTEMA_ANALISE, texto: textoAnalise(notas), imagens: [await I.dataURI(ref, 1536)] });
    if (a.encontrado === false && !opcoes.inteira) throw new Error('A IA não encontrou um escudo nessa foto. Tente uma foto mais próxima ou marque "A foto já é só o escudo".');
    st.analise = a;
    st.nome = a.identificacao || 'Escudo';
    job.salvar();

    st.operacao = 'Extraindo o escudo da foto';
    const c = a.caixa || {};
    const ok = [c.x0, c.y0, c.x1, c.y1].every((x) => Number.isFinite(+x)) && c.x1 - c.x0 > 0.03 && c.y1 - c.y0 > 0.03;
    const caixa = ok ? { x0: Math.max(0, +c.x0), y0: Math.max(0, +c.y0), x1: Math.min(1, +c.x1), y1: Math.min(1, +c.y1) } : null;
    if (!caixa && !opcoes.inteira) job.log('Não deu para delimitar o escudo — usando a foto inteira.');
    const recorte = opcoes.inteira || !caixa ? await I.emQuadrado(ref) : await I.recortarCaixa(ref, caixa);
    st.recorte = { chave: chaveBlob(id, 'recorte'), url: await enviarBlob(chaveBlob(id, 'recorte'), recorte) };
    st.chave = (await I.escolherChave(recorte)).hex;
    job.log(`Cor de recorte escolhida: ${st.chave}`);

    const max = Math.max(1, Math.min(5, Number(opcoes.tentativas) || 3));
    let melhor = null;
    for (let i = 0; i < max; i++) {
      st.operacao = i === 0 ? 'Recriando o escudo' : `Corrigindo pelo parecer dos agentes (versão ${i + 1})`;
      const v = await versao(job, { correcoes: melhor?.correcoes || [], anterior: melhor ? job.brutos.get(melhor.n) : null });
      if (v.status === 'erro') continue;
      if (!melhor || (v.media ?? 0) > (melhor.media ?? 0)) melhor = v;
      if (v.aprovada) { melhor = v; break; }
    }
    if (!melhor) throw new Error(`Nenhuma versão foi gerada (${st.versoes.at(-1)?.erro || 'erro'})`);
    escolher(job, melhor.n, false);
  });
  return { job, executar };
}

async function novaVersao(job) {
  return comStatus(job, 'Gerando outra versão', async () => {
    const v = await versao(job);
    if (v.status === 'erro') throw new Error(v.erro);
    if (!job.estado.escolhida) escolher(job, v.n, false);
  });
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
let usuario = '';
let arquivo = null;
const opcoes = { tentativas: 3, inteira: false };
let atual = null, desligar = null, poll = null, fundo = 'xadrez';
const INTERROMPIDA_MS = 4 * 60 * 1000;

const ST = {
  aprovada: ['ok', 'Aprovada'], concluido: ['ok', 'Pronto'], reprovada: ['bad', 'Reprovada'], erro: ['bad', 'Erro'],
  interrompida: ['bad', 'Interrompida'], rodando: ['run', 'Em andamento'], gerando: ['run', 'Gerando'], revisando: ['run', 'Revisando'],
};
const badge = (s, txt) => { const [c, l] = ST[s] || ['idle', s]; return `<span class="badge b-${c}">${c === 'run' ? '<span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>' : ''}${txt || l}</span>`; };
const interrompido = (e) => e.status === 'rodando' && !ativos.has(e.id) && Date.now() - new Date(e.atualizadoEm || e.atualizado_em) > INTERROMPIDA_MS;
const statusDe = (e) => (interrompido(e) ? 'interrompida' : e.status);

function renderUpload() {
  const box = $('#escDrop');
  box.classList.toggle('filled', Boolean(arquivo));
  box.innerHTML = arquivo
    ? `<img src="${arquivo.url}" alt=""><button class="x" title="Remover">×</button><span class="escDrop-nome">${esc(arquivo.file.name)}</span>`
    : `<div class="slot-empty">${CREST}<span>Foto do escudo na camisa — close ou camisa inteira<br><b style="color:var(--muted)">arraste, clique ou Ctrl+V</b></span></div>`;
  $('#btnEscGo').disabled = !arquivo;
  $('#escReqNote').textContent = arquivo ? 'PNG transparente · 1000 × 1000 px' : 'Falta a foto do escudo';
}
function definirArquivo(f) {
  if (!f || !f.type.startsWith('image/')) return;
  if (arquivo) URL.revokeObjectURL(arquivo.url);
  arquivo = { file: f, url: URL.createObjectURL(f) };
  renderUpload();
}

function renderRev(r) {
  if (r.erro) return `<div class="rv"><div class="rv-h"><div class="ring" style="--c:#555"><span>–</span></div><div><b>${esc(r.agente)}</b><small>revisor indisponível</small></div></div></div>`;
  const cor = r.aprovado ? 'var(--ok)' : r.nota >= 5 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="rv"><div class="rv-h"><div class="ring" style="--p:${r.nota * 10};--c:${cor}"><span>${r.nota}</span></div>
    <div style="flex:1"><b>${esc(r.agente.replace(/^Revisor \d — /, ''))}</b><small>${esc(r.modelo)}</small></div>${r.aprovado ? '<span style="color:var(--ok);font-weight:800">✓</span>' : '<span style="color:var(--bad);font-weight:800">✕</span>'}</div>
    ${r.problemas.length ? `<details ${r.aprovado ? '' : 'open'}><summary>▸ ${r.problemas.length} observaç${r.problemas.length > 1 ? 'ões' : 'ão'}</summary><ul>${r.problemas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}</div>`;
}

const tempo = (e) => { const s = Math.max(0, ((e.status === 'rodando' && !interrompido(e) ? Date.now() : new Date(e.atualizadoEm)) - new Date(e.criadoEm)) / 1000); return `${Math.floor(s / 60)}min ${String(Math.floor(s % 60)).padStart(2, '0')}s`; };

function renderJob() {
  const el = $('#escJob');
  if (!atual) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const e = atual.estado, a = e.analise, st = statusDe(e), local = ativos.has(e.id);
  const livre = st !== 'rodando';
  const esc1 = e.versoes.find((v) => v.n === e.escolhida);
  let h = `<div class="job-h"><div class="tt"><h2>${esc(e.nome || 'Analisando a foto…')}</h2>
    <div class="meta">${badge(st)}${e.operacao && st === 'rodando' ? `<span style="color:var(--run)">${esc(e.operacao)}…</span>` : ''}<span>⏱ <span id="escTempo">${tempo(e)}</span></span><span>${new Date(e.criadoEm).toLocaleString('pt-BR')}</span>${e.autor ? `<span>${esc(e.autor)}</span>` : ''}</div></div>
    <button class="btn" id="escFechar">Fechar</button></div>`;
  if (local) h += `<div class="keep"><span class="spin"></span>O escudo é gerado nesta aba — deixe-a aberta até terminar (≈2 min).</div>`;
  else if (st === 'rodando') h += `<div class="keep">Este escudo está sendo gerado no navegador de ${esc(e.autor || 'outra pessoa')}. A tela atualiza sozinha.</div>`;
  if (st === 'interrompida') h += `<div class="err"><b>Interrompido:</b> a aba que gerava este escudo foi fechada.</div>`;
  if (e.erro) h += `<div class="err"><b>Erro:</b> ${esc(e.erro)}</div>`;

  h += `<div class="esc-compare">
    <div class="esc-col"><div class="esc-lbl">Referência extraída</div><div class="esc-box">${e.recorte ? `<img src="${e.recorte.url}" alt="">` : e.ref ? `<img src="${e.ref.url}" alt="">` : '<div class="skel">enviando…</div>'}</div></div>
    <div class="esc-arrow">→</div>
    <div class="esc-col"><div class="esc-lbl">Escudo gerado <span class="mbadge">PNG ${LADO}×${LADO}</span>
      <div class="seg" id="escFundo">${['xadrez', 'escuro', 'claro'].map((f) => `<button data-f="${f}" class="${fundo === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div></div>
      <div class="esc-box fundo-${fundo}">${esc1?.imagem ? `<img src="${esc1.imagem}" alt="">` : `<div class="skel">${st === 'rodando' ? 'gerando escudo…' : 'sem versão'}</div>`}</div></div>
  </div>`;
  if (esc1?.imagem) {
    h += `<div class="dl"><div class="txt"><b>Pronto para baixar</b><small>Versão ${esc1.n}${e.manual ? ' · sua escolha' : ' · escolha dos agentes'}${esc1.media != null ? ` · nota ${esc1.media}` : ''} · PNG transparente ${LADO} × ${LADO} px</small></div>
      ${livre ? `<button class="btn" id="escNova">+ Gerar outra versão</button>` : ''}
      <button class="btn grad" id="escBaixar">${DOWN} Baixar PNG</button></div>`;
  } else if (livre && e.recorte && e.analise) {
    h += `<div class="dl"><div class="txt"><b>Nenhuma versão pronta</b><small>Tente gerar de novo.</small></div><button class="btn grad" id="escNova">Gerar outra versão</button></div>`;
  }
  if (e.versoes.length) {
    h += `<div class="sec">Versões e revisões</div><p class="secs">Cada versão passa por 2 agentes (nota mínima ${NOTA_MIN}). Reprovou → a IA corrige seguindo o parecer.</p>
    <div class="tents">${e.versoes.map((v) => `<div class="tn ${e.escolhida === v.n ? 'esc' : ''}">
      <div class="tn-h"><span>Versão ${v.n}</span>${badge(v.status)}</div>
      <div class="im xadrez sq">${v.imagem ? `<a href="${v.imagem}" target="_blank"><img src="${v.imagem}"></a>` : v.erro ? `<span style="color:var(--bad);padding:14px;font-size:12px">${esc(v.erro)}</span>` : '<div class="skel">gerando imagem…</div>'}</div>
      ${v.imagem && v.revisoes ? (e.escolhida === v.n ? `<div class="inuse">✓ Em uso</div>` : livre ? `<button class="btn usar" data-usar="${v.n}">Usar esta versão</button>` : '') : ''}
      ${(v.revisoes || []).map(renderRev).join('')}
      ${v.status === 'revisando' ? '<div class="rv"><div class="rv-h"><span class="spin"></span><small>2 agentes revisando…</small></div></div>' : ''}</div>`).join('')}</div>`;
  }
  if (a) {
    h += `<div class="sec" style="margin-top:22px">Análise</div>
    ${(a.alertas || []).map((x) => `<div class="alert">⚠️ <span>${esc(x)}</span></div>`).join('')}
    <div class="panel" style="margin:10px 0"><dl class="kv">
      <dt>Escudo</dt><dd><b>${esc(a.identificacao)}</b></dd>
      <dt>Material</dt><dd>${esc(a.material || '—')}</dd>
      <dt>Cores</dt><dd><div class="cores">${(a.cores || []).map((c) => `<span class="cor"><i style="background:${esc(c.hex)}"></i>${esc(c.nome)} <span style="color:var(--muted)">${esc(c.hex)}</span></span>`).join('')}</div></dd>
      ${a.textos?.length ? `<dt>Textos</dt><dd>${esc(a.textos.join(' · '))}</dd>` : ''}
      ${a.problemas_foto?.length ? `<dt>Corrigido da foto</dt><dd>${esc(a.problemas_foto.join(' · '))}</dd>` : ''}
      <dt>Modelos</dt><dd style="color:var(--muted)">análise ${esc(e.modelos?.analise)} · revisores ${esc(e.modelos?.revisor1)} + ${esc(e.modelos?.revisor2)}</dd>
    </dl></div>`;
  }
  const sx = $$('.tents', el).map((x) => x.scrollLeft);
  el.innerHTML = h;
  $$('.tents', el).forEach((x, i) => { x.scrollLeft = sx[i] || 0; });
  ligarJob();
}

function ligarJob() {
  $('#escFechar').onclick = () => { parar(); atual = null; renderJob(); };
  $$('#escFundo button').forEach((b) => b.onclick = () => { fundo = b.dataset.f; renderJob(); });
  const baixar = $('#escBaixar');
  if (baixar) baixar.onclick = async () => {
    const e = atual.estado;
    const blob = await baixarBlob(chaveBlob(e.id, `v${e.escolhida}`));
    if (!blob) return toast('Não consegui baixar o PNG');
    const u = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: u, download: `${slug(e.analise?.identificacao)}_escudo_${LADO}.png` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };
  const nova = $('#escNova');
  if (nova) nova.onclick = async () => {
    const job = atual;
    const p = novaVersao(job);
    abrir(job.id, job);
    await p;
    toast(job.estado.status === 'concluido' ? 'Nova versão pronta — os agentes revisaram' : 'Não deu certo: ' + (job.estado.erro || ''));
    historico();
  };
  $$('[data-usar]').forEach((b) => b.onclick = () => {
    escolher(atual, +b.dataset.usar, true);
    atual.salvar(true);
    if (!ativos.has(atual.id)) renderJob();
    historico();
  });
}

function parar() { clearInterval(poll); desligar?.(); desligar = null; }

function abrir(id, local = ativos.get(id)) {
  parar();
  if (local) {
    atual = local;
    let agendado = false;
    desligar = local.ouvir(() => { if (!agendado) { agendado = true; requestAnimationFrame(() => { agendado = false; renderJob(); }); } });
    renderJob();
    poll = setInterval(() => { const t = $('#escTempo'); if (t && atual) t.textContent = tempo(atual.estado); }, 1000);
  } else {
    let ultimo = '';
    const tick = async () => {
      const r = await fetch('/api/escudos/' + id);
      if (!r.ok) { toast('Escudo não encontrado'); return parar(); }
      const estado = await r.json();
      if (ativos.has(id)) return abrir(id);
      atual = new Escudo(estado);
      if (estado.atualizadoEm + estado.status !== ultimo) { ultimo = estado.atualizadoEm + estado.status; renderJob(); }
      if (estado.status !== 'rodando' || interrompido(estado)) clearInterval(poll);
    };
    tick(); poll = setInterval(tick, 4000);
  }
  $('#escJob').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function historico() {
  const l = await fetch('/api/escudos').then((r) => r.json()).catch(() => []);
  $('#escHist').innerHTML = l.length ? l.map((e) => `<div class="ec" data-id="${e.id}">
      <div class="ec-im xadrez">${e.capa ? `<img src="${e.capa}" loading="lazy" alt="">` : `<div class="ec-vazio">${CREST}</div>`}</div>
      <div class="info"><b>${esc(e.nome || 'Escudo')}</b><small>${new Date(e.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small><div class="autor">${esc(e.autor || '')}</div><div style="margin-top:6px">${badge(statusDe(e))}</div></div></div>`).join('')
    : '<div class="empty" style="grid-column:1/-1">Nenhum escudo gerado ainda.</div>';
  $$('#escHist .ec').forEach((d) => d.onclick = () => abrir(d.dataset.id));
}

export function iniciarAba(u) {
  usuario = u || usuario;
  const drop = $('#escDrop'), input = $('#escFile');
  drop.onclick = (ev) => {
    if (ev.target.closest('.x')) { URL.revokeObjectURL(arquivo.url); arquivo = null; return renderUpload(); }
    input.click();
  };
  input.onchange = () => { definirArquivo(input.files[0]); input.value = ''; };
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (ev) => { ev.preventDefault(); drop.classList.remove('over'); definirArquivo(ev.dataTransfer.files[0]); };
  document.addEventListener('paste', (ev) => { const f = ev.clipboardData?.files?.[0]; if (f && $('#v-escudo').classList.contains('on')) definirArquivo(f); });
  $('[data-esc-inteira]').onclick = (ev) => { opcoes.inteira = !opcoes.inteira; ev.currentTarget.classList.toggle('on', opcoes.inteira); };
  $$('#segEscTent button').forEach((b) => b.onclick = () => { $$('#segEscTent button').forEach((x) => x.classList.toggle('on', x === b)); opcoes.tentativas = +b.dataset.v; });
  $('#btnEscGo').onclick = async () => {
    if (!arquivo) return;
    const { job, executar } = await iniciar({ file: arquivo.file, notas: $('#escNotas').value.trim(), opcoes: { ...opcoes }, usuario });
    URL.revokeObjectURL(arquivo.url); arquivo = null; $('#escNotas').value = ''; renderUpload();
    abrir(job.id, job);
    historico();
    executar.then(() => { toast(job.estado.status === 'concluido' ? `Escudo pronto: ${job.estado.nome}` : 'O escudo parou com erro'); historico(); });
  };
  window.addEventListener('beforeunload', (ev) => { if (ativos.size) { ev.preventDefault(); ev.returnValue = ''; } });
  renderUpload();
}

export function mostrar(u) {
  if (u) usuario = u;
  historico();
}

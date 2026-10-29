// Motor do conversor no navegador: análise → arte com escudo → sem escudo + camadas → exportação.
// Cada imagem passa por 2 agentes revisores; reprovou → correção dirigida pelo feedback.
// Estado e versões ficam no servidor (env.DB); arquivos em alta são gerados aqui, sob demanda.
import * as P from './prompts.js';
import * as I from './imagem.js';
import ESTILO_PADRAO from './assets/estilo-padrao.js';
import ESTILO_COSTAS from './assets/estilo-costas.js';
import ESTILO_ESCUDO from './assets/estilo-escudo.js';
export const ESTILOS_PADRAO = { frente: ESTILO_PADRAO, costas: ESTILO_COSTAS, escudo: ESTILO_ESCUDO };
export const MODELOS_ARTE = P.MODELOS_ARTE;
const modeloDe = (t) => t.estado.opcoes.modelo || 'frente';

const NOTA_MIN = 7;
export let MODELOS = { analise: 'gpt-6-astra', revisor1: 'gpt-6-astra', revisor2: 'gpt-5.6-sol' };
export const definirModelos = (m) => { MODELOS = m; };

// ---------------------------------------------------------------------------
// Comunicação com o servidor
// ---------------------------------------------------------------------------
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function semaforo(max) {
  let ativos = 0;
  const fila = [];
  return async (fn) => {
    if (ativos >= max) await new Promise((r) => fila.push(r));
    ativos++;
    try { return await fn(); } finally { ativos--; fila.shift()?.(); }
  };
}
const filaImagens = semaforo(4);
const filaChat = semaforo(8);

async function postIA(rota, corpo, tentativas = 3) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch { throw Object.assign(new Error(r.status === 401 || /<html/i.test(txt) ? 'Sua sessão expirou — recarregue a página.' : `Resposta inválida do servidor (${r.status})`), { fatal: r.status === 401 }); }
      if (r.ok) return j;
      ultimo = new Error(`AI Proxy ${r.status}: ${j.error?.message || j.erro || txt.slice(0, 200)}`);
      if (r.status < 500 && r.status !== 429) throw Object.assign(ultimo, { fatal: true });
    } catch (e) {
      ultimo = e;
      if (e.fatal) throw e;
    }
    await espera(2000 * (i + 1));
  }
  throw ultimo;
}

export async function chatJSON({ modelo, sistema, texto, imagens = [] }) {
  const content = [{ type: 'text', text: texto }, ...imagens.map((url) => ({ type: 'image_url', image_url: { url } }))];
  return filaChat(async () => {
    for (let i = 0; i < 2; i++) {
      const j = await postIA('/api/ai/chat', { model: modelo, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sistema }, { role: 'user', content }] });
      const raw = j.choices?.[0]?.message?.content || '';
      try { return JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()); } catch { if (i === 1) throw new Error(`Resposta não-JSON do modelo ${modelo}`); }
    }
  });
}

export async function editarImagem({ prompt, imagens, size }) {
  return filaImagens(async () => {
    const j = await postIA('/api/ai/image', { prompt, images: imagens, quality: 'high', ...(size ? { size } : {}) });
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('AI Proxy não devolveu imagem');
    return I.base64ParaBlob(b64);
  });
}

const cacheBlobs = new Map();
export async function enviarBlob(chave, blob) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`/api/blob/${encodeURIComponent(chave)}`, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/png' }, body: blob });
    if (r.ok) { cacheBlobs.set(chave, blob); return `/api/blob/${encodeURIComponent(chave)}`; }
    await espera(1500 * (i + 1));
  }
  throw new Error('Não consegui salvar a imagem no servidor.');
}
export async function baixarBlob(chave) {
  if (cacheBlobs.has(chave)) return cacheBlobs.get(chave);
  const r = await fetch(`/api/blob/${encodeURIComponent(chave)}`);
  if (!r.ok) return null;
  const b = await r.blob();
  cacheBlobs.set(chave, b);
  return b;
}

// ---------------------------------------------------------------------------
// Tarefa (uma conversão)
// ---------------------------------------------------------------------------
export class Tarefa {
  constructor(estado) {
    this.estado = estado;
    this.ouvintes = new Set();
    this._t = null;
  }
  get id() { return this.estado.id; }
  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  salvar(agora = false) {
    this.estado.atualizadoEm = new Date().toISOString();
    for (const fn of this.ouvintes) fn(this);
    clearTimeout(this._t);
    const enviar = () => fetch(`/api/tarefas/${this.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.estado) }).catch(() => {});
    if (agora) return enviar();
    this._t = setTimeout(enviar, 600);
  }
  etapa(id, titulo, tipo) {
    let e = this.estado.etapas.find((x) => x.id === id);
    if (!e) { e = { id, titulo, tipo, status: 'aguardando', tentativas: [] }; this.estado.etapas.push(e); this.salvar(); }
    return e;
  }
  log(msg) { this.estado.log.push({ t: new Date().toISOString(), msg }); this.salvar(); }
  chave(nome) { return `t:${this.id}:${nome}`; }
  async salvarVersao(nome, blob, transparente) {
    const [mini] = await Promise.all([I.miniatura(blob, 440, transparente), enviarBlob(this.chave(`${nome}_full`), blob)]);
    return enviarBlob(this.chave(nome), mini);
  }
  /** PNG (Blob) da versão escolhida (ou de uma versão específica) de uma etapa. */
  async imagem(etapaId, n) {
    const e = this.estado.etapas.find((x) => x.id === etapaId);
    const v = n ?? e?.escolhida;
    return v ? baixarBlob(this.chave(`${etapaId}_t${v}_full`)) : null;
  }
}

async function revisar(revisores, ctx, imagens) {
  const modelos = [MODELOS.revisor1, MODELOS.revisor2];
  return Promise.all(revisores.map(async (r, i) => {
    try {
      const v = await chatJSON({ modelo: modelos[i], sistema: P.sistemaRevisor(r.papel, r.foco), texto: r.texto(ctx), imagens });
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

async function tentativa(tarefa, etapa, def, correcoes = [], anteriorN = null) {
  const n = (etapa.tentativas.at(-1)?.n || 0) + 1;
  const t = { n, status: 'gerando' };
  etapa.tentativas.push(t);
  tarefa.salvar();
  let res;
  try {
    res = await def.gerar({ n, correcoes, anterior: anteriorN ? await tarefa.imagem(etapa.id, anteriorN) : null });
    t.imagem = await tarefa.salvarVersao(`${etapa.id}_t${n}`, res.png, def.transparente);
  } catch (e) {
    if (e.fatal && /sessão/.test(e.message)) throw e;
    t.status = 'erro'; t.erro = e.message; tarefa.salvar();
    return t;
  }
  t.status = 'revisando';
  tarefa.salvar();
  const revs = await revisar(def.revisores, def.ctx, res.revisaoImgs);
  const validas = revs.filter((r) => r.nota !== null);
  t.revisoes = revs;
  t.media = validas.length ? +(validas.reduce((s, r) => s + r.nota, 0) / validas.length).toFixed(1) : null;
  t.aprovada = validas.length > 0 && validas.every((r) => r.aprovado);
  t.status = t.aprovada ? 'aprovada' : 'reprovada';
  t.correcoes = revs.flatMap((r) => r.correcoes_en).filter(Boolean).slice(0, 10);
  tarefa.salvar();
  return t;
}

async function cicloRevisado(tarefa, etapa, def, maxTentativas) {
  etapa.status = 'rodando';
  tarefa.salvar();
  let melhor = null;
  for (let i = 0; i < maxTentativas; i++) {
    const t = await tentativa(tarefa, etapa, def, melhor?.correcoes || [], melhor?.n);
    if (t.status === 'erro') continue;
    if (!melhor || (t.media ?? 0) > (melhor.media ?? 0)) melhor = t;
    if (t.aprovada) { melhor = t; break; }
  }
  if (!melhor) {
    etapa.status = 'erro';
    tarefa.salvar();
    throw new Error(`${etapa.titulo}: nenhuma versão foi gerada (${etapa.tentativas.at(-1)?.erro || 'erro'})`);
  }
  etapa.escolhida = melhor.n;
  etapa.manual = false;
  etapa.status = melhor.aprovada ? 'aprovado' : 'ressalvas';
  tarefa.salvar();
}

// ---------------------------------------------------------------------------
// Contexto e definição das etapas
// ---------------------------------------------------------------------------
async function contexto(tarefa) {
  const st = tarefa.estado;
  const refs = await Promise.all(st.referencias.slice(0, 8).map(async (r) => ({ papel: r.papel, blob: await baixarBlob(r.chave) })));
  const modelo = st.opcoes.modelo || 'frente';
  const estilos = (st.estilosUrls?.length ? st.estilosUrls : [`padrao:${modelo}`]).map((u) => (u === 'padrao' ? ESTILO_PADRAO : u.startsWith('padrao:') ? ESTILOS_PADRAO[u.slice(7)] || ESTILO_PADRAO : u));
  const estilosURI = await Promise.all(estilos.slice(0, 2).map((u) => I.dataURI(u, 1024)));
  const refsURI = await Promise.all(refs.map((r) => I.dataURI(r.blob, 1024)));
  const desc = {
    frente: ['FRONT view of the NEW uniform (reproduce its colors, pattern, collar, trims and crest)', 'FRENTE do uniforme novo'],
    escudo: ['OFFICIAL CREST of the new uniform (reproduce it exactly)', 'ESCUDO oficial do uniforme novo'],
    costas: ['BACK view of the NEW uniform — use it only to understand colors, fabric and trims; do NOT draw back elements (numbers, names, back-neck print) on the front artwork', 'COSTAS do uniforme novo (só referência; não vai para a arte)'],
  };
  const papel = (p) => desc[p] || desc.frente;
  return {
    estilosURI, refsURI,
    refsEN: refs.map((r) => papel(r.papel)[0]),
    refsPT: refs.map((r) => papel(r.papel)[1]),
    estiloEN: 'APPROVED GOCASE ARTWORK EXAMPLE (copy its composition, crop, framing, scale, texture and finish — NOT its colors, crest or the white gocase logo sticker)',
    estiloPT: 'arte Gocase aprovada (referência de padrão)',
    max: Math.max(1, Math.min(5, Number(st.opcoes.tentativas) || 3)),
  };
}
const listaEN = (arr, inicio = 1) => arr.map((p, i) => `- Image ${i + inicio}: ${p}`).join('\n');
const listaPT = (arr, inicio = 1) => arr.map((p, i) => `- Imagem ${i + inicio}: ${p}`).join('\n');

async function definicao(tarefa, ctx, etapaId) {
  const { analise, opcoes, notas } = tarefa.estado;
  if (etapaId === 'arte') {
    const papeisBase = [...ctx.estilosURI.map(() => ctx.estiloEN), ...ctx.refsEN];
    return {
      revisores: P.revisoresArte(opcoes.modelo || 'frente'),
      ctx: { opcoes, nn: P.nomeNumero(opcoes, analise), papeis: listaPT([...ctx.refsPT, ...ctx.estilosURI.map(() => ctx.estiloPT), 'ARTE CANDIDATA']) },
      gerar: async ({ correcoes, anterior }) => {
        let bruto;
        if (anterior && correcoes.length) {
          const extras = [...ctx.refsEN, ...ctx.estilosURI.slice(0, 1).map(() => ctx.estiloEN)];
          bruto = await editarImagem({
            prompt: P.promptCorrecao({ papeisImagens: listaEN(extras, 2), correcoes, opcoes, analise }),
            imagens: [await I.dataURI(anterior, 1800, 'png'), ...ctx.refsURI, ...ctx.estilosURI.slice(0, 1)],
          });
        } else {
          bruto = await editarImagem({ prompt: P.promptArte({ papeisImagens: listaEN(papeisBase), analise, opcoes, notas }), imagens: [...ctx.estilosURI, ...ctx.refsURI] });
        }
        let png = await I.normalizar(bruto);
        if ((opcoes.modelo || 'frente') === 'escudo') {
          // o escudo estourado não tem gola; se a IA desenhou, uma passada de remoção resolve
          const v = await chatJSON({ modelo: MODELOS.revisor1, sistema: P.SISTEMA_GOLA, texto: 'A arte tem gola ou frisos de ombro?', imagens: [await I.dataURI(png, 768)] }).catch(() => ({}));
          if (v.tem_gola) {
            tarefa.log('Gola detectada no escudo estourado — removendo automaticamente.');
            png = await I.normalizar(await editarImagem({ prompt: P.PROMPT_SEM_GOLA, imagens: [await I.dataURI(png, 1800, 'png')] }));
          }
        }
        return { png, revisaoImgs: [...ctx.refsURI, ...ctx.estilosURI, await I.dataURI(png, 1024)] };
      },
    };
  }
  const arte = await tarefa.imagem('arte');
  const arteURI = await I.dataURI(arte, 1800, 'png');
  const arteRev = await I.dataURI(arte, 1024);

  if (etapaId === 'sem_escudo') {
    const alvo = P.alvoRemocao(opcoes, analise);
    return {
      revisores: P.revisoresRemocao(alvo), ctx: {},
      gerar: async ({ correcoes }) => {
        const png = await I.normalizar(await editarImagem({ prompt: P.promptRemover({ alvo, opcoes, correcoes }), imagens: [arteURI] }));
        return { png, revisaoImgs: [arteRev, await I.dataURI(png, 1024)] };
      },
    };
  }
  if (etapaId === 'camada_fundo') {
    const sem = (await tarefa.imagem('sem_escudo')) || arte;
    const semURI = await I.dataURI(sem, 1800, 'png');
    const semRev = await I.dataURI(sem, 1024);
    const removidos = analise.camadas.map((c) => c.isolar_en);
    return {
      revisores: P.REVISORES.fundo, ctx: {},
      gerar: async ({ correcoes }) => {
        const png = await I.normalizar(await editarImagem({ prompt: P.promptFundo({ removidos, correcoes }), imagens: [semURI] }));
        return { png, revisaoImgs: [semRev, await I.dataURI(png, 1024)] };
      },
    };
  }
  const camada = analise.camadas.find((c) => `camada_${c.id}` === etapaId);
  if (!camada) throw new Error(`Etapa desconhecida: ${etapaId}`);
  if (!tarefa.estado.chave) tarefa.estado.chave = (await I.escolherChave(arte)).hex;
  const chave = I.chavePorHex(tarefa.estado.chave);
  const outras = analise.camadas.filter((c) => c.id !== camada.id).map((c) => c.isolar_en);
  return {
    revisores: P.REVISORES.camada, ctx: { camada }, transparente: true,
    gerar: async ({ correcoes }) => {
      const png = await I.recortarChroma(await editarImagem({ prompt: P.promptIsolar({ camada, outras, chave, correcoes }), imagens: [arteURI] }), chave);
      const { cobertura } = await I.infoAlfa(png);
      if (cobertura < 0.001) throw new Error('camada saiu vazia');
      return { png, revisaoImgs: [arteRev, await I.sobreXadrez(png, 768)] };
    },
  };
}

async function derivados(tarefa, ctx) {
  const { analise, opcoes } = tarefa.estado;
  const modelo = modeloDe(tarefa);
  const arte = await tarefa.imagem('arte');
  analise.camadas = modelo === 'frente' ? analise.camadasPlanejadas || analise.camadas : P.camadasDoModelo(opcoes, analise);
  const extras = modelo === 'frente' ? analise.camadas.filter((c) => !['gola_ombros', 'escudo'].includes(c.id)) : [];
  if (extras.length) {
    try {
      const v = await chatJSON({
        modelo: MODELOS.revisor1, sistema: P.SISTEMA_PRESENCA,
        texto: `Elementos a conferir:\n${extras.map((c) => `- ${c.id}: ${c.isolar_en}`).join('\n')}`,
        imagens: [await I.dataURI(arte, 1024)],
      });
      const ausentes = new Set(v.ausentes || []);
      const removidas = extras.filter((c) => ausentes.has(c.id));
      if (removidas.length) {
        analise.camadas = analise.camadas.filter((c) => !ausentes.has(c.id));
        tarefa.log(`Camadas descartadas (não aparecem na arte): ${removidas.map((c) => c.nome).join(', ')}`);
      }
    } catch (e) { tarefa.log(`Checagem de camadas falhou: ${e.message}`); }
  }
  tarefa.estado.chave = (await I.escolherChave(arte)).hex;
  tarefa.log(`Cor de recorte escolhida: ${tarefa.estado.chave}`);

  const rodar = async (id, titulo) => cicloRevisado(tarefa, tarefa.etapa(id, titulo, id === 'sem_escudo' ? 'arte' : 'camada'), await definicao(tarefa, ctx, id), ctx.max);
  const temSem = modelo === 'costas' ? Boolean(P.nomeNumero(opcoes, analise)) || analise.tem_escudo !== false : analise.tem_escudo !== false;
  const semP = temSem ? rodar('sem_escudo', `Arte: ${P.MODELOS_ARTE[modelo].rotulos.sem}`) : Promise.resolve();
  // uma camada que falha não derruba a conversão: fica registrada e sai do ZIP
  const camP = Promise.all(analise.camadas.map((c) => rodar(`camada_${c.id}`, `Camada: ${c.nome}`).catch((e) => tarefa.log(`Camada "${c.nome}" não pôde ser separada: ${e.message}`))));
  await semP;
  // no escudo estourado, a versão sem o escudo já é o fundo
  await Promise.all([camP, modelo === 'escudo' ? Promise.resolve() : rodar('camada_fundo', 'Camada: Fundo')]);
  await finalizar(tarefa);
}

/** Registra o resultado (o que entra no ZIP); os arquivos em alta são gerados por prepararArquivos. */
async function finalizar(tarefa) {
  const { analise } = tarefa.estado;
  const e = tarefa.etapa('exportacao', 'Exportação em alta resolução + ZIP', 'exportacao');
  const ordem = (cid) => (cid === 'escudo' ? 90 : cid === 'gola_ombros' ? 50 : 30);
  const camadas = [];
  const idFundo = modeloDe(tarefa) === 'escudo' ? 'sem_escudo' : 'camada_fundo';
  const fundo = tarefa.estado.etapas.find((x) => x.id === idFundo);
  if (fundo?.escolhida) camadas.push({ id: 'fundo', nome: 'Fundo', etapa: idFundo });
  for (const c of [...analise.camadas].sort((a, b) => ordem(a.id) - ordem(b.id))) {
    const et = tarefa.estado.etapas.find((x) => x.id === `camada_${c.id}`);
    if (et?.escolhida) camadas.push({ id: c.id, nome: c.nome, etapa: et.id });
  }
  tarefa.estado.resultado = { camadas, versao: Date.now() };
  tarefa.estado.capa = tarefa.estado.etapas.find((x) => x.id === 'arte')?.tentativas.find((t) => t.n === tarefa.estado.etapas.find((x) => x.id === 'arte').escolhida)?.imagem;
  e.status = 'aprovado';
  tarefa.salvar();
  arquivosCache.delete(tarefa.id);
}

// ---------------------------------------------------------------------------
// Arquivos finais em alta (gerados no navegador, cacheados por sessão)
// ---------------------------------------------------------------------------
const arquivosCache = new Map();
const slug = (s) => (s || 'uniforme').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

export function prepararArquivos(tarefa, logoUrl, aoProgresso = () => {}) {
  const chaveCache = `${tarefa.estado.resultado?.versao}|${logoUrl}`;
  const c = arquivosCache.get(tarefa.id);
  if (c?.chave === chaveCache) return c.promessa;
  const promessa = gerarArquivos(tarefa, logoUrl, aoProgresso);
  arquivosCache.set(tarefa.id, { chave: chaveCache, promessa });
  promessa.catch(() => arquivosCache.delete(tarefa.id));
  return promessa;
}

async function gerarArquivos(tarefa, logoUrl, aoProgresso) {
  const { analise, opcoes, resultado } = tarefa.estado;
  const alvo = I.EXPORTACAO[opcoes.resolucao] || I.EXPORTACAO.alta;
  const nomeBase = slug(analise.identificacao);
  const passos = 5 + resultado.camadas.length * 2;
  let feitos = 0;
  const passo = (msg) => aoProgresso(Math.round((++feitos / passos) * 100), msg);

  const com = await tarefa.imagem('arte');
  const sem = (await tarefa.imagem('sem_escudo')) || com;
  const logo = opcoes.aplicarLogo ? await I.camadaLogo(logoUrl, alvo) : null;
  const comHD = await I.ampliar(com, alvo); passo('arte com escudo');
  const semHD = await I.ampliar(sem, alvo); passo('arte sem escudo');
  const arq = P.MODELOS_ARTE[modeloDe(tarefa)].arquivos;
  const nomes = { com: `${nomeBase}_${arq.com}.png`, sem: `${nomeBase}_${arq.sem}.png` };
  const temSem = sem !== com;
  const arquivos = {};
  const artes = { com: logo ? await I.sobrepor(comHD, [logo]) : comHD, sem: temSem ? (logo ? await I.sobrepor(semHD, [logo]) : semHD) : null };
  arquivos[`arte/${nomes.com}`] = artes.com;
  if (temSem) arquivos[`arte/${nomes.sem}`] = artes.sem;
  // mockups no case transparente (com o logo, como o cliente vê)
  const mockups = { com: await I.mockup(artes.com), sem: temSem ? await I.mockup(artes.sem) : null };
  arquivos[`mockup/${nomes.com.replace('.png', '_mockup.png')}`] = mockups.com;
  if (temSem) arquivos[`mockup/${nomes.sem.replace('.png', '_mockup.png')}`] = mockups.sem;
  passo('mockups');
  if (logo) {
    arquivos[`arte/sem_logo_gocase/${nomes.com}`] = comHD;
    if (temSem) arquivos[`arte/sem_logo_gocase/${nomes.sem}`] = semHD;
  }
  const pilha = [];
  for (const c of resultado.camadas) {
    let png = await tarefa.imagem(c.etapa);
    if (!png) continue;
    if (c.id === 'escudo' && temSem && modeloDe(tarefa) !== 'costas') {
      const { blob, ajuste } = await I.alinharPelaDiferenca(png, com, sem);
      if (blob) { png = blob; console.info('escudo realinhado', ajuste); }
    }
    pilha.push({ ...c, png: await I.ampliar(png, alvo, c.id !== 'fundo') });
    passo(c.nome);
  }
  if (logo) pilha.push({ id: 'logo_gocase', nome: 'Logo gocase', png: logo });
  const camadas = [];
  for (const [i, c] of pilha.entries()) {
    const nome = `${String(i + 1).padStart(2, '0')}_${c.id}.png`;
    arquivos[`camadas/${nome}`] = c.png;
    if (c.id !== 'fundo') { arquivos[`recortes/${c.id}.png`] = await I.aparar(c.png); passo('recortes'); }
    camadas.push({ ...c, arquivo: nome, caminho: `camadas/${nome}` });
  }
  if (pilha.length) arquivos['conferencia/camadas_empilhadas.png'] = await I.sobrepor(pilha[0].png, pilha.slice(1).map((c) => c.png));

  const zip = new window.JSZip();
  for (const [k, v] of Object.entries(arquivos)) zip.file(k, v);
  zip.file('relatorio_qa.json', JSON.stringify({
    uniforme: analise.identificacao, geradoEm: new Date().toISOString(), resolucao: `${alvo.w}x${alvo.h}px`, modelos: tarefa.estado.modelos, analise,
    etapas: tarefa.estado.etapas.map((e) => ({ etapa: e.titulo, status: e.status, versaoEscolhida: e.escolhida, escolhaManual: Boolean(e.manual), tentativas: e.tentativas.map((t) => ({ n: t.n, status: t.status, media: t.media, revisoes: t.revisoes })) })),
  }, null, 2));
  zip.file('LEIA-ME.txt', [
    `JerseyFlow (Gocase) — ${analise.identificacao}`,
    `Resolução: ${alvo.w} x ${alvo.h} px (proporção da arte de case Gocase).`, '',
    `arte/        → ${P.MODELOS_ARTE[modeloDe(tarefa)].rotulos.com}${temSem ? ' e ' + P.MODELOS_ARTE[modeloDe(tarefa)].rotulos.sem : ''}` + (logo ? ' (com logo gocase; versões sem logo em arte/sem_logo_gocase/)' : ''),
    'camadas/     → elementos separados em PNG transparente, todos no mesmo tamanho do canvas:',
    '               abra todos no Photoshop/Illustrator, empilhe na ordem numérica e eles se encaixam.',
    'recortes/    → os mesmos elementos aparados no tamanho do próprio elemento.',
    'conferencia/ → as camadas empilhadas, para conferir o encaixe.',
    'mockup/      → a arte aplicada no case transparente (fundo transparente), para apresentação.',
    'relatorio_qa.json → análise da IA e o parecer dos 2 agentes revisores em cada etapa.',
  ].join('\n'));
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  passo('zip');
  return { arquivos, camadas, zip: zipBlob, artes, mockups, nomes, zipNome: `${nomeBase}_gocase.zip`, nomeBase, resolucao: `${alvo.w} × ${alvo.h}px` };
}

// ---------------------------------------------------------------------------
// Entradas públicas
// ---------------------------------------------------------------------------
export const ativas = new Map(); // conversões rodando nesta aba

async function comStatus(tarefa, operacao, fn) {
  ativas.set(tarefa.id, tarefa);
  tarefa.estado.status = 'rodando';
  tarefa.estado.operacao = operacao;
  delete tarefa.estado.erro;
  tarefa.salvar();
  try {
    await fn();
    tarefa.estado.status = 'concluido';
  } catch (e) {
    console.error(e);
    tarefa.estado.status = 'erro';
    tarefa.estado.erro = e.message;
    for (const et of tarefa.estado.etapas) if (et.status === 'rodando') et.status = 'erro';
  }
  delete tarefa.estado.operacao;
  ativas.delete(tarefa.id);
  await tarefa.salvar(true);
}

/** referencias: [{ file, papel }], estilosUrls: até 2 URLs da biblioteca. */
export async function iniciar({ referencias, estilosUrls, notas, opcoes, usuario }) {
  const id = `${new Date().toISOString().slice(0, 10)}_${Math.random().toString(16).slice(2, 8)}`;
  const tarefa = new Tarefa({
    id, criadoEm: new Date().toISOString(), status: 'rodando', autor: usuario, notas, opcoes,
    estilosUrls, modelos: MODELOS, etapas: [], log: [], referencias: [],
  });
  ativas.set(id, tarefa);
  const prioridade = { frente: 0, escudo: 1, costas: 2 };
  const ordenadas = [...referencias].sort((a, b) => prioridade[a.papel] - prioridade[b.papel]);
  const executar = comStatus(tarefa, 'Conversão completa', async () => {
    tarefa.estado.referencias = await Promise.all(ordenadas.map(async (r, i) => {
      const chave = tarefa.chave(`ref_${i + 1}`);
      // guarda a referência já reduzida (2048px) — sobra qualidade para a IA e economiza banco
      const blob = await (await fetch(await I.dataURI(r.file, 2048, 'jpeg'))).blob();
      return { papel: r.papel, chave, url: await enviarBlob(chave, blob) };
    }));
    tarefa.salvar();
    const ctx = await contexto(tarefa);

    const eA = tarefa.etapa('analise', 'Análise das referências', 'analise');
    eA.status = 'rodando'; tarefa.salvar();
    const analise = await chatJSON({
      modelo: MODELOS.analise, sistema: P.SISTEMA_ANALISE,
      texto: P.textoAnalise({ papeis: [...ctx.estilosURI.map(() => ctx.estiloPT), ...ctx.refsPT], notas, opcoes }),
      imagens: [...ctx.estilosURI, ...ctx.refsURI],
    });
    analise.camadas = (analise.camadas || []).filter((c) => c?.id && c.id !== 'fundo').slice(0, 6);
    if (!analise.camadas.some((c) => c.id === 'gola_ombros')) analise.camadas.unshift({ id: 'gola_ombros', nome: 'Gola e ombros', isolar_en: 'the collar and the shoulder trims/stripes' });
    if (analise.tem_escudo !== false && !analise.camadas.some((c) => c.id === 'escudo')) analise.camadas.push({ id: 'escudo', nome: 'Escudo', isolar_en: 'the club crest and the star(s) above it' });
    analise.camadasPlanejadas = [...analise.camadas];
    tarefa.estado.analise = analise;
    tarefa.estado.nome = `${analise.identificacao} · ${P.MODELOS_ARTE[opcoes.modelo || 'frente'].nome}`;
    if ((opcoes.modelo === 'escudo') && analise.tem_escudo === false) throw new Error('As referências não mostram um escudo — o modelo "Escudo estourado" precisa de um.');
    eA.status = 'aprovado';
    tarefa.salvar();

    await cicloRevisado(tarefa, tarefa.etapa('arte', `Arte: ${P.MODELOS_ARTE[opcoes.modelo || 'frente'].rotulos.com}`, 'arte'), await definicao(tarefa, ctx, 'arte'), ctx.max);
    await derivados(tarefa, ctx);
  });
  return { tarefa, executar };
}

function liberada(tarefa) {
  if (tarefa.estado.status === 'rodando') throw new Error('Esta conversão ainda está rodando.');
}

export async function escolherVersao(tarefa, etapaId, n) {
  liberada(tarefa);
  const etapa = tarefa.estado.etapas.find((e) => e.id === etapaId);
  if (!etapa?.tentativas.find((x) => x.n === n)?.imagem) throw new Error('Versão não encontrada.');
  if (etapa.escolhida === n) return;
  etapa.escolhida = n;
  etapa.manual = true;
  tarefa.log(`Versão ${n} escolhida em "${etapa.titulo}".`);
  if (etapaId === 'arte') {
    tarefa.estado.etapas = tarefa.estado.etapas.filter((e) => ['analise', 'arte'].includes(e.id));
    delete tarefa.estado.resultado;
    return comStatus(tarefa, 'Refazendo sem escudo e camadas a partir da arte escolhida', async () => derivados(tarefa, await contexto(tarefa)));
  }
  return comStatus(tarefa, 'Atualizando com a versão escolhida', () => finalizar(tarefa));
}

export async function novaVersao(tarefa, etapaId) {
  liberada(tarefa);
  const etapa = tarefa.estado.etapas.find((e) => e.id === etapaId);
  if (!etapa || !['arte', 'camada'].includes(etapa.tipo)) throw new Error('Etapa inválida.');
  return comStatus(tarefa, `Gerando outra versão de "${etapa.titulo}"`, async () => {
    const t = await tentativa(tarefa, etapa, await definicao(tarefa, await contexto(tarefa), etapaId));
    if (t.status === 'erro') throw new Error(t.erro);
  });
}

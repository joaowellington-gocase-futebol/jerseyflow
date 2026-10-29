// Pipeline do conversor: análise → arte com escudo → sem escudo + camadas → exportação.
// Cada imagem gerada passa por 2 agentes revisores; reprovou → correção dirigida pelo feedback.
// Toda versão fica salva em work/<etapa>_t<n>_full.png, então o designer pode trocar a versão
// escolhida de qualquer etapa (ou pedir mais uma) e só o que depende dela é refeito.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { chatJSON, editarImagem, MODELOS } from './ai.mjs';
import * as P from './prompts.mjs';
import * as I from './imaging.mjs';

const NOTA_MIN = 7;

class Tarefa {
  constructor(dir, estado) {
    this.dir = dir;
    this.estado = estado;
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    this.salvar();
  }
  static carregar(dir) {
    return new Tarefa(dir, JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')));
  }
  salvar() {
    this.estado.atualizadoEm = new Date().toISOString();
    fs.writeFileSync(path.join(this.dir, 'job.json'), JSON.stringify(this.estado, null, 2));
  }
  etapa(id, titulo, tipo) {
    let e = this.estado.etapas.find((x) => x.id === id);
    if (!e) {
      e = { id, titulo, tipo, status: 'aguardando', tentativas: [] };
      this.estado.etapas.push(e);
      this.salvar();
    }
    return e;
  }
  log(msg) {
    this.estado.log.push({ t: new Date().toISOString(), msg });
    this.salvar();
  }
  url(rel) {
    return `/output/${this.estado.id}/${rel}`;
  }
  async salvarVersao(nome, png, transparente = false) {
    const rel = `work/${nome}.${transparente ? 'png' : 'jpg'}`;
    let img = sharp(png).resize(440);
    img = transparente ? img.png() : img.jpeg({ quality: 85 });
    await img.toFile(path.join(this.dir, rel));
    fs.writeFileSync(path.join(this.dir, `work/${nome}_full.png`), png);
    return this.url(rel);
  }
  /** PNG da versão escolhida (ou de uma versão específica) de uma etapa. */
  imagem(etapaId, n) {
    const e = this.estado.etapas.find((x) => x.id === etapaId);
    const v = n ?? e?.escolhida;
    if (!v) return null;
    const p = path.join(this.dir, `work/${etapaId}_t${v}_full.png`);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
}

/** Roda os 2 revisores em paralelo. Falha de um revisor não derruba a etapa. */
async function revisar(revisores, ctx, imagens) {
  const modelos = [MODELOS.revisor1, MODELOS.revisor2];
  return Promise.all(revisores.map(async (r, i) => {
    try {
      const v = await chatJSON({
        modelo: modelos[i],
        sistema: P.sistemaRevisor(r.papel, r.foco),
        texto: r.texto(ctx),
        imagens,
      });
      const nota = Number(v.nota);
      return {
        agente: r.papel,
        modelo: modelos[i],
        nota: Number.isFinite(nota) ? nota : 0,
        aprovado: Boolean(v.aprovado) && nota >= NOTA_MIN,
        problemas: Array.isArray(v.problemas) ? v.problemas : [],
        correcoes_en: Array.isArray(v.correcoes_en) ? v.correcoes_en : v.correcoes_en ? [String(v.correcoes_en)] : [],
      };
    } catch (e) {
      return { agente: r.papel, modelo: modelos[i], erro: e.message, nota: null, aprovado: null, problemas: [], correcoes_en: [] };
    }
  }));
}

/** Gera e revisa UMA versão de uma etapa. */
async function tentativa(tarefa, etapa, def, correcoes = [], anteriorN = null) {
  const n = (etapa.tentativas.at(-1)?.n || 0) + 1;
  const t = { n, status: 'gerando' };
  etapa.tentativas.push(t);
  tarefa.salvar();
  let res;
  try {
    res = await def.gerar({ n, correcoes, anterior: anteriorN ? tarefa.imagem(etapa.id, anteriorN) : null });
  } catch (e) {
    t.status = 'erro';
    t.erro = e.message;
    tarefa.salvar();
    return t;
  }
  t.imagem = await tarefa.salvarVersao(`${etapa.id}_t${n}`, res.png, def.transparente);
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

/** Gera → revisa → corrige até aprovar ou esgotar tentativas; marca a melhor como escolhida. */
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

const slug = (s) => (s || 'uniforme').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

// ---------------------------------------------------------------------------
// Contexto: referências e estilos já convertidos, reconstruível a partir do job salvo.
// ---------------------------------------------------------------------------
async function contexto(tarefa, dirDados) {
  const st = tarefa.estado;
  const referencias = st.referencias.slice(0, 8).map((r) => ({
    papel: r.papel,
    buf: fs.readFileSync(path.join(tarefa.dir, 'refs', r.arquivo || path.basename(r.url))),
  }));
  let estilos = (st.estilos || []).filter((p) => fs.existsSync(p));
  if (!estilos.length) {
    const dir = path.join(dirDados, 'estilo');
    estilos = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().slice(0, 2).map((f) => path.join(dir, f));
  }
  const estilosURI = await Promise.all(estilos.slice(0, 2).map((p) => I.dataURI(p, 1024)));
  const refsURI = await Promise.all(referencias.map((r) => I.dataURI(r.buf, 1024)));
  const descPapel = {
    frente: ['FRONT view of the NEW uniform (reproduce its colors, pattern, collar, trims and crest)', 'FRENTE do uniforme novo'],
    escudo: ['OFFICIAL CREST of the new uniform (reproduce it exactly)', 'ESCUDO oficial do uniforme novo'],
    costas: ['BACK view of the NEW uniform — use it only to understand colors, fabric and trims; do NOT draw back elements (numbers, names, back-neck print) on the front artwork', 'COSTAS do uniforme novo (só referência; não vai para a arte)'],
  };
  const papel = (p) => descPapel[p] || descPapel.frente;
  const estiloEN = 'APPROVED GOCASE ARTWORK EXAMPLE (copy its composition, crop, framing, scale, texture and finish — NOT its colors, crest or the white gocase logo sticker)';
  const estiloPT = 'arte Gocase aprovada (referência de padrão)';
  return {
    estilosURI,
    refsURI,
    refsEN: referencias.map((r) => papel(r.papel)[0]),
    refsPT: referencias.map((r) => papel(r.papel)[1]),
    estiloEN,
    estiloPT,
    max: Math.max(1, Math.min(5, Number(st.opcoes.tentativas) || 3)),
  };
}
const listaEN = (arr, inicio = 1) => arr.map((p, i) => `- Image ${i + inicio}: ${p}`).join('\n');
const listaPT = (arr, inicio = 1) => arr.map((p, i) => `- Imagem ${i + inicio}: ${p}`).join('\n');

/** Como gerar/revisar cada etapa. Depende das versões escolhidas das etapas anteriores. */
async function definicao(tarefa, ctx, etapaId) {
  const { analise, opcoes, notas } = tarefa.estado;

  if (etapaId === 'arte') {
    const imagensBase = [...ctx.estilosURI, ...ctx.refsURI];
    const papeisBase = [...ctx.estilosURI.map(() => ctx.estiloEN), ...ctx.refsEN];
    return {
      revisores: P.REVISORES.arte,
      ctx: { opcoes, papeis: listaPT([...ctx.refsPT, ...ctx.estilosURI.map(() => ctx.estiloPT), 'ARTE CANDIDATA']) },
      gerar: async ({ correcoes, anterior }) => {
        let bruto;
        if (anterior && correcoes.length) {
          const extras = [...ctx.refsEN, ...ctx.estilosURI.slice(0, 1).map(() => ctx.estiloEN)];
          bruto = await editarImagem({
            prompt: P.promptCorrecao({ papeisImagens: listaEN(extras, 2), correcoes, opcoes, analise }),
            imagens: [await I.dataURI(anterior, 1800, 'png'), ...ctx.refsURI, ...ctx.estilosURI.slice(0, 1)],
          });
        } else {
          bruto = await editarImagem({ prompt: P.promptArte({ papeisImagens: listaEN(papeisBase), analise, opcoes, notas }), imagens: imagensBase });
        }
        const { png } = await I.normalizar(bruto);
        return { png, revisaoImgs: [...ctx.refsURI, ...ctx.estilosURI, await I.dataURI(png, 1024)] };
      },
    };
  }

  const arte = tarefa.imagem('arte');
  const arteURI = await I.dataURI(arte, 1800, 'png');
  const arteRev = await I.dataURI(arte, 1024);

  if (etapaId === 'sem_escudo') {
    return {
      revisores: P.REVISORES.semEscudo,
      ctx: {},
      gerar: async ({ correcoes }) => {
        const bruto = await editarImagem({ prompt: P.promptSemEscudo({ opcoes, analise, correcoes }), imagens: [arteURI] });
        const { png } = await I.normalizar(bruto);
        return { png, revisaoImgs: [arteRev, await I.dataURI(png, 1024)] };
      },
    };
  }

  if (etapaId === 'camada_fundo') {
    const sem = tarefa.imagem('sem_escudo') || arte;
    const semURI = await I.dataURI(sem, 1800, 'png');
    const semRev = await I.dataURI(sem, 1024);
    const removidos = analise.camadas.filter((c) => c.id !== 'escudo').map((c) => c.isolar_en);
    return {
      revisores: P.REVISORES.fundo,
      ctx: {},
      gerar: async ({ correcoes }) => {
        const bruto = await editarImagem({ prompt: P.promptFundo({ removidos, correcoes }), imagens: [semURI] });
        const { png } = await I.normalizar(bruto);
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
    revisores: P.REVISORES.camada,
    ctx: { camada },
    transparente: true,
    gerar: async ({ correcoes }) => {
      const bruto = await editarImagem({ prompt: P.promptIsolar({ camada, outras, chave, correcoes }), imagens: [arteURI] });
      const png = await I.recortarChroma(bruto, chave);
      const { cobertura } = await I.infoAlfa(png);
      if (cobertura < 0.001) throw new Error('camada saiu vazia');
      return { png, revisaoImgs: [arteRev, await I.sobreXadrez(png, 768)] };
    },
  };
}

// ---------------------------------------------------------------------------
// Etapas que dependem da arte com escudo escolhida.
// ---------------------------------------------------------------------------
async function derivados(tarefa, ctx, dirDados) {
  const { analise } = tarefa.estado;
  const arte = tarefa.imagem('arte');

  // só vira camada o que realmente ficou visível na arte escolhida
  analise.camadas = analise.camadasPlanejadas || analise.camadas;
  const extras = analise.camadas.filter((c) => !['gola_ombros', 'escudo'].includes(c.id));
  if (extras.length) {
    try {
      const v = await chatJSON({
        modelo: MODELOS.revisor1,
        sistema: P.SISTEMA_PRESENCA,
        texto: `Elementos a conferir:\n${extras.map((c) => `- ${c.id}: ${c.isolar_en}`).join('\n')}`,
        imagens: [await I.dataURI(arte, 1024)],
      });
      const ausentes = new Set(v.ausentes || []);
      const removidas = extras.filter((c) => ausentes.has(c.id));
      if (removidas.length) {
        analise.camadas = analise.camadas.filter((c) => !ausentes.has(c.id));
        tarefa.log(`Camadas descartadas (não aparecem na arte): ${removidas.map((c) => c.nome).join(', ')}`);
      }
    } catch (e) {
      tarefa.log(`Checagem de camadas falhou: ${e.message}`);
    }
  }
  tarefa.estado.chave = (await I.escolherChave(arte)).hex;
  tarefa.log(`Cor de recorte escolhida: ${tarefa.estado.chave}`);
  tarefa.salvar();

  const rodar = async (id, titulo) => {
    const def = await definicao(tarefa, ctx, id);
    await cicloRevisado(tarefa, tarefa.etapa(id, titulo, id === 'sem_escudo' ? 'arte' : 'camada'), def, ctx.max);
  };
  const semEscudoP = analise.tem_escudo === false ? Promise.resolve() : rodar('sem_escudo', 'Arte sem escudo');
  const camadasP = Promise.all(analise.camadas.map((c) => rodar(`camada_${c.id}`, `Camada: ${c.nome}`)));
  await semEscudoP;
  await Promise.all([camadasP, rodar('camada_fundo', 'Camada: Fundo')]);
  await exportar(tarefa, dirDados);
}

// ---------------------------------------------------------------------------
// Exportação: sempre a partir das versões escolhidas.
// ---------------------------------------------------------------------------
async function exportar(tarefa, dirDados) {
  const { analise, opcoes, id } = tarefa.estado;
  const eExp = tarefa.etapa('exportacao', 'Exportação em alta resolução + ZIP', 'exportacao');
  eExp.status = 'rodando';
  tarefa.salvar();

  const comEscudo = tarefa.imagem('arte');
  const semEscudo = tarefa.imagem('sem_escudo') || comEscudo;
  const fundo = tarefa.imagem('camada_fundo');
  const camadas = analise.camadas
    .map((camada) => ({ camada, png: tarefa.imagem(`camada_${camada.id}`) }))
    .filter((c) => c.png);

  // alinhamento fino do escudo usando (com escudo − sem escudo) como gabarito
  const esc = camadas.find((c) => c.camada.id === 'escudo');
  if (esc && semEscudo !== comEscudo) {
    const { png, ajuste } = await I.alinharPelaDiferenca(esc.png, comEscudo, semEscudo);
    if (ajuste) {
      esc.png = png;
      tarefa.log(`Escudo realinhado à arte: escala ${ajuste.escala}, deslocamento ${ajuste.dx}px/${ajuste.dy}px.`);
    }
  }

  const alvo = I.EXPORTACAO[opcoes.resolucao] || I.EXPORTACAO.alta;
  const nomeBase = slug(analise.identificacao);
  const zip = new JSZip();
  const finalDir = path.join(tarefa.dir, 'final');
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.mkdirSync(finalDir, { recursive: true });
  const versao = Date.now().toString(36); // evita cache do navegador ao reexportar
  const gravar = (rel, buf) => {
    zip.file(rel, buf);
    const p = path.join(finalDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    return `${tarefa.url(`final/${rel}`)}?v=${versao}`;
  };

  const logo = opcoes.aplicarLogo ? await I.camadaLogo(dirDados, alvo) : null;
  const [comHD, semHD] = await Promise.all([I.ampliar(comEscudo, alvo), I.ampliar(semEscudo, alvo)]);
  const resultado = { arquivos: {}, camadas: [] };
  resultado.arquivos.comEscudo = gravar(`arte/${nomeBase}_com_escudo.png`, logo ? await I.sobrepor(comHD, [logo]) : comHD);
  resultado.arquivos.semEscudo = gravar(`arte/${nomeBase}_sem_escudo.png`, logo ? await I.sobrepor(semHD, [logo]) : semHD);
  // mockups na capinha transparente (com o logo, como o cliente vê)
  const [mockCom, mockSem] = await Promise.all([
    I.mockup(logo ? await I.sobrepor(comHD, [logo]) : comHD),
    I.mockup(logo ? await I.sobrepor(semHD, [logo]) : semHD),
  ]);
  gravar(`mockup/${nomeBase}_com_escudo_mockup.png`, mockCom);
  gravar(`mockup/${nomeBase}_sem_escudo_mockup.png`, mockSem);
  if (logo) {
    gravar(`arte/sem_logo_gocase/${nomeBase}_com_escudo.png`, comHD);
    gravar(`arte/sem_logo_gocase/${nomeBase}_sem_escudo.png`, semHD);
  }

  // ordem de empilhamento: fundo → extras → gola/ombros → escudo → logo
  const ordem = (cid) => (cid === 'escudo' ? 90 : cid === 'gola_ombros' ? 50 : 30);
  const pilha = [];
  if (fundo) pilha.push({ id: 'fundo', nome: 'Fundo', png: await I.ampliar(fundo, alvo) });
  for (const c of [...camadas].sort((a, b) => ordem(a.camada.id) - ordem(b.camada.id))) {
    pilha.push({ id: c.camada.id, nome: c.camada.nome, png: await I.ampliar(c.png, alvo) });
  }
  if (logo) pilha.push({ id: 'logo_gocase', nome: 'Logo gocase', png: logo });
  for (const [i, c] of pilha.entries()) {
    const nome = `${String(i + 1).padStart(2, '0')}_${c.id}.png`;
    const url = gravar(`camadas/${nome}`, c.png);
    if (c.id !== 'fundo') gravar(`recortes/${c.id}.png`, await I.aparar(c.png));
    const et = tarefa.estado.etapas.find((e) => e.id === `camada_${c.id}`);
    const nota = et?.tentativas.find((t) => t.n === et.escolhida)?.media ?? null;
    resultado.camadas.push({ id: c.id, nome: c.nome, url, arquivo: nome, etapa: et?.id, status: et ? (et.manual ? 'manual' : et.status) : 'aprovado', nota, versoes: et?.tentativas.filter((t) => t.imagem).length || 0 });
  }
  if (pilha.length) {
    const montagem = await I.sobrepor(pilha[0].png, pilha.slice(1).map((c) => c.png));
    resultado.arquivos.montagem = gravar(`conferencia/camadas_empilhadas.png`, montagem);
  }

  const relatorio = {
    uniforme: analise.identificacao,
    geradoEm: new Date().toISOString(),
    resolucao: `${alvo.w}x${alvo.h}px`,
    modelos: MODELOS,
    analise,
    etapas: tarefa.estado.etapas.map((e) => ({
      etapa: e.titulo, status: e.status, versaoEscolhida: e.escolhida, escolhaManual: Boolean(e.manual),
      tentativas: e.tentativas.map((t) => ({ n: t.n, status: t.status, media: t.media, revisoes: t.revisoes })),
    })),
  };
  zip.file('relatorio_qa.json', JSON.stringify(relatorio, null, 2));
  zip.file('LEIA-ME.txt', [
    `Conversor de Uniformes Gocase — ${analise.identificacao}`,
    `Resolução: ${alvo.w} x ${alvo.h} px (proporção da arte de capinha Gocase).`,
    '',
    'arte/        → arte final com e sem escudo' + (logo ? ' (com logo gocase; versões sem logo em arte/sem_logo_gocase/)' : ''),
    'camadas/     → elementos separados em PNG transparente, todos no mesmo tamanho do canvas:',
    '               abra todos no Photoshop/Illustrator, empilhe na ordem numérica e eles se encaixam.',
    'recortes/    → os mesmos elementos aparados no tamanho do próprio elemento.',
    'conferencia/ → as camadas empilhadas, para conferir o encaixe.',
    'mockup/      → a arte aplicada na capinha transparente (fundo transparente), para apresentação.',
    'relatorio_qa.json → análise da IA e o parecer dos 2 agentes revisores em cada etapa.',
  ].join('\n'));
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  for (const f of fs.readdirSync(tarefa.dir)) if (f.endsWith('.zip')) fs.unlinkSync(path.join(tarefa.dir, f));
  fs.writeFileSync(path.join(tarefa.dir, `${nomeBase}_gocase.zip`), zipBuf);
  resultado.zip = `/api/tarefas/${id}/zip`;
  resultado.zipMB = +(zipBuf.length / 1e6).toFixed(1);
  resultado.resolucao = `${alvo.w} × ${alvo.h}px`;

  eExp.status = 'aprovado';
  tarefa.estado.resultado = resultado;
  tarefa.salvar();
}

// ---------------------------------------------------------------------------
// Entradas públicas
// ---------------------------------------------------------------------------
async function comStatus(tarefa, operacao, fn) {
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
  tarefa.salvar();
}

export async function executar({ id, dir, referencias, estilos, notas, opcoes, dirDados }) {
  const tarefa = new Tarefa(dir, {
    id,
    criadoEm: new Date().toISOString(),
    status: 'rodando',
    notas,
    opcoes,
    estilos,
    modelos: MODELOS,
    etapas: [],
    log: [],
    referencias: referencias.map((r) => ({ papel: r.papel, arquivo: r.arquivo, url: `/output/${id}/refs/${r.arquivo}` })),
  });
  await comStatus(tarefa, 'Conversão completa', async () => {
    const ctx = await contexto(tarefa, dirDados);

    // 1. análise
    const eA = tarefa.etapa('analise', 'Análise das referências', 'analise');
    eA.status = 'rodando'; tarefa.salvar();
    const analise = await chatJSON({
      modelo: MODELOS.analise,
      sistema: P.SISTEMA_ANALISE,
      texto: P.textoAnalise({ papeis: [...ctx.estilosURI.map(() => ctx.estiloPT), ...ctx.refsPT], notas, opcoes }),
      imagens: [...ctx.estilosURI, ...ctx.refsURI],
    });
    analise.camadas = (analise.camadas || []).filter((c) => c?.id && c.id !== 'fundo').slice(0, 6);
    if (!analise.camadas.some((c) => c.id === 'gola_ombros')) {
      analise.camadas.unshift({ id: 'gola_ombros', nome: 'Gola e ombros', isolar_en: 'the collar and the shoulder trims/stripes' });
    }
    if (analise.tem_escudo !== false && !analise.camadas.some((c) => c.id === 'escudo')) {
      analise.camadas.push({ id: 'escudo', nome: 'Escudo', isolar_en: 'the club crest and the star(s) above it' });
    }
    analise.camadasPlanejadas = [...analise.camadas];
    tarefa.estado.analise = analise;
    tarefa.estado.nome = analise.identificacao;
    eA.status = 'aprovado';
    tarefa.salvar();

    // 2. arte com escudo
    const eArte = tarefa.etapa('arte', 'Arte com escudo', 'arte');
    await cicloRevisado(tarefa, eArte, await definicao(tarefa, ctx, 'arte'), ctx.max);

    // 3 + 4. sem escudo, camadas e exportação
    await derivados(tarefa, ctx, dirDados);
  });
}

const ocupadas = new Set();
function travar(dir) {
  const t = Tarefa.carregar(dir);
  if (t.estado.status === 'rodando' || ocupadas.has(t.estado.id)) throw Object.assign(new Error('Esta conversão ainda está rodando.'), { status: 409 });
  return t;
}

/** Designer troca a versão escolhida de uma etapa. */
export async function escolherVersao({ dir, etapaId, n, dirDados }) {
  const tarefa = travar(dir);
  const etapa = tarefa.estado.etapas.find((e) => e.id === etapaId);
  const t = etapa?.tentativas.find((x) => x.n === n);
  if (!etapa || !t?.imagem) throw Object.assign(new Error('Versão não encontrada.'), { status: 404 });
  if (etapa.escolhida === n) return;
  etapa.escolhida = n;
  etapa.manual = true;
  tarefa.log(`Você escolheu a versão ${n} de "${etapa.titulo}".`);
  ocupadas.add(tarefa.estado.id);

  if (etapaId === 'arte') {
    // tudo que foi feito a partir da arte antiga é refeito
    tarefa.estado.etapas = tarefa.estado.etapas.filter((e) => ['analise', 'arte'].includes(e.id));
    delete tarefa.estado.resultado;
    comStatus(tarefa, 'Refazendo sem escudo e camadas a partir da arte escolhida', async () => {
      const ctx = await contexto(tarefa, dirDados);
      await derivados(tarefa, ctx, dirDados);
    }).finally(() => ocupadas.delete(tarefa.estado.id));
  } else {
    comStatus(tarefa, 'Reexportando com a versão escolhida', () => exportar(tarefa, dirDados))
      .finally(() => ocupadas.delete(tarefa.estado.id));
  }
}

/** Gera mais uma versão de uma etapa (revisada pelos 2 agentes), sem trocar a escolhida. */
export async function novaVersao({ dir, etapaId, dirDados }) {
  const tarefa = travar(dir);
  const etapa = tarefa.estado.etapas.find((e) => e.id === etapaId);
  if (!etapa || etapa.tipo === 'analise' || etapa.tipo === 'exportacao') throw Object.assign(new Error('Etapa inválida.'), { status: 400 });
  ocupadas.add(tarefa.estado.id);
  comStatus(tarefa, `Gerando outra versão de "${etapa.titulo}"`, async () => {
    const ctx = await contexto(tarefa, dirDados);
    const def = await definicao(tarefa, ctx, etapaId);
    const t = await tentativa(tarefa, etapa, def);
    if (t.status === 'erro') throw new Error(t.erro);
    if (!tarefa.estado.resultado) await exportar(tarefa, dirDados);
  }).finally(() => ocupadas.delete(tarefa.estado.id));
}

// Interface do JerseyFlow (GoDeploy). O motor roda nesta aba.
import * as M from './motor.js';
import { enviarBlob } from './motor.js';
import ESTILO_PADRAO from './assets/estilo-padrao.js';
import * as Img from './imagem.js';
import * as Esc from './escudo.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };
const I = {
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};
const SHIRT_FRONT = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M22 6l-12 6-6 14 9 4 3-6v34h32V24l3 6 9-4-6-14-12-6c-1 4-5 7-10 7s-9-3-10-7z"/><path d="M26 7c1 3 3 5 6 5s5-2 6-5"/><path d="M40 22h6v6c0 2-1.5 3-3 3.5-1.5-.5-3-1.5-3-3.5z"/></svg>';
const CREST = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M32 6l20 7v17c0 13-9 22-20 28C21 52 12 43 12 30V13z"/><path d="M32 18l3 7h7l-5.5 4.5 2 7.5L32 32.5 25.5 37l2-7.5L22 25h7z"/></svg>';
const SHIRT_BACK = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M22 6l-12 6-6 14 9 4 3-6v34h32V24l3 6 9-4-6-14-12-6c-2 2-6 3-10 3s-8-1-10-3z"/><path d="M27 26h10M32 26v18" stroke-width="3"/></svg>';

let usuario = '';
let logoUrl = '/assets/logo-gocase.svg';
fetch('/api/config').then((r) => r.json()).then((c) => {
  M.definirModelos(c.modelos); usuario = c.usuario; Esc.mostrar(c.usuario);
  $('#m1').textContent = c.modelos.revisor1; $('#m2').textContent = c.modelos.revisor2;
  $('#chipModelos').textContent = `AI Proxy · ${c.modelos.analise}`;
}).catch(() => toast('Não consegui falar com o servidor'));

// ---------- navegação ----------
let poll = null, atual = null, desligar = null;
function ver(v) {
  $$('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  window.scrollTo({ top: 0 });
}
function pararAcompanhamento() { clearInterval(poll); desligar?.(); desligar = null; }
$$('.nav button').forEach((b) => b.onclick = () => {
  pararAcompanhamento(); atual = null; history.replaceState(null, '', location.pathname);
  if (b.dataset.v === 'hist') historico();
  else if (b.dataset.v === 'escudo') { ver('escudo'); Esc.mostrar(); }
  else ver('nova');
});
window.addEventListener('beforeunload', (e) => { if (M.ativas.size) { e.preventDefault(); e.returnValue = ''; } });

// ---------- modelos de arte ----------
const MODELOS_UI = [
  { id: 'frente', nome: 'Frente', desc: 'camisa de frente, com e sem escudo' },
  { id: 'escudo', nome: 'Escudo estourado', desc: 'escudo grande sobre o padrão da camisa' },
  { id: 'costas', nome: 'Costas', desc: 'costas da camisa, com nome e número opcionais' },
];
const modelosSel = new Set(['frente']);
const costas = { nomeNumero: true };
function renderModelos() {
  $('#modelos').innerHTML = MODELOS_UI.map((m) => `<div class="mod ${modelosSel.has(m.id) ? 'on' : ''}" data-mod="${m.id}">
    <div class="mt"><img src="${M.ESTILOS_PADRAO[m.id]}" alt=""></div><div><b>${m.nome}</b><small>${m.desc}</small></div><span class="ck">${modelosSel.has(m.id) ? '✓' : ''}</span></div>`).join('');
  $$('.mod').forEach((el) => el.onclick = () => {
    const id = el.dataset.mod;
    if (modelosSel.has(id)) { if (modelosSel.size > 1) modelosSel.delete(id); } else modelosSel.add(id);
    renderModelos(); renderSlots();
  });
  $('#costasOpts').hidden = !modelosSel.has('costas');
  const o = $('[data-cn]'); o.classList.toggle('on', costas.nomeNumero);
  $('#nnCampos').hidden = !costas.nomeNumero;
}
$('[data-cn]').onclick = () => { costas.nomeNumero = !costas.nomeNumero; renderModelos(); };

// ---------- slots de referência ----------
const SLOTS = [
  { id: 'frente', nome: 'Frente', tag: 'principal', req: true, max: 3, icon: SHIRT_FRONT, dica: 'Camisa de frente, inteira e nítida' },
  { id: 'escudo', nome: 'Escudo', tag: 'recomendado', max: 2, icon: CREST, dica: 'Escudo oficial em boa resolução' },
  { id: 'costas', nome: 'Costas', tag: 'para o modelo costas', max: 2, icon: SHIRT_BACK, dica: 'Costas com nome e número, se quiser copiar a fonte' },
];
const refs = { frente: [], escudo: [], costas: [] };
let picker = null;
const filePicker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
document.body.append(filePicker);
filePicker.onchange = () => { addRefs(picker, filePicker.files); filePicker.value = ''; };
function addRefs(slot, files) {
  const def = SLOTS.find((s) => s.id === slot);
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (refs[slot].length >= def.max) { toast(`Máximo de ${def.max} imagens em ${def.nome}`); break; }
    refs[slot].push({ file: f, url: URL.createObjectURL(f) });
  }
  renderSlots();
}
function renderSlots() {
  $('#slots').innerHTML = SLOTS.map((s) => {
    const list = refs[s.id];
    return `<div class="slot ${list.length ? 'filled' : ''}" data-s="${s.id}">
      <div class="slot-h"><b>${s.nome}</b><span class="tag ${s.req ? 'req' : ''}">${s.tag}</span></div>
      ${list.length ? `<div class="thumbs">${list.map((r, i) => `<div class="th"><img src="${r.url}"><button class="x" data-i="${i}">×</button></div>`).join('')}${list.length < s.max ? '<div class="th add">+</div>' : ''}</div>`
        : `<div class="slot-empty">${s.icon}<span>${s.dica}<br><b style="color:var(--muted)">arraste ou clique</b></span></div>`}
    </div>`;
  }).join('');
  $$('.slot').forEach((el) => {
    const s = el.dataset.s;
    el.onclick = (e) => {
      if (e.target.closest('.x')) { refs[s].splice(+e.target.closest('.x').dataset.i, 1); return renderSlots(); }
      if (el.classList.contains('filled') && !e.target.closest('.add')) return;
      picker = s; filePicker.click();
    };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
    el.ondragleave = () => el.classList.remove('over');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); addRefs(s, e.dataTransfer.files); };
  });
  const falta = [];
  if (modelosSel.has('frente') && !refs.frente.length) falta.push('a foto da frente');
  if (modelosSel.has('costas') && !refs.costas.length && !refs.frente.length) falta.push('uma foto das costas (ou da frente)');
  if (modelosSel.has('escudo') && !refs.escudo.length && !refs.frente.length) falta.push('o escudo (ou a foto da frente)');
  const total = refs.frente.length + refs.escudo.length + refs.costas.length;
  $('#btnGo').disabled = falta.length > 0;
  $('#btnGo').textContent = modelosSel.size > 1 ? `Converter ${modelosSel.size} modelos →` : 'Converter uniforme →';
  $('#reqNote').textContent = falta.length ? `Falta ${[...new Set(falta)].join(' e ')}` : `${total} imagem(ns) · ${[...modelosSel].map((m) => MODELOS_UI.find((x) => x.id === m).nome).join(' + ')}`;
}
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { if (!e.target.closest('.slot')) e.preventDefault(); });
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length && $('#v-nova').classList.contains('on')) addRefs('frente', f); });

// ---------- opções ----------
const opcoes = { removerFornecedor: true, removerPatrocinio: true, aplicarLogo: true, resolucao: 'alta', tentativas: 3 };
$$('.opt[data-o]').forEach((o) => o.onclick = () => { opcoes[o.dataset.o] = !opcoes[o.dataset.o]; o.classList.toggle('on', opcoes[o.dataset.o]); });
const seg = (id, key, cb) => $$('#' + id + ' button').forEach((b) => b.onclick = () => {
  $$('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b)); opcoes[key] = isNaN(b.dataset.v) ? b.dataset.v : +b.dataset.v; cb?.();
});
seg('segRes', 'resolucao', () => $('#resInfo').textContent = opcoes.resolucao === 'alta' ? '2000 × 4094 px' : '3000 × 6141 px');
seg('segTent', 'tentativas');

// ---------- biblioteca de estilo + logo (compartilhadas no servidor) ----------
const selPorModelo = { frente: new Set(), escudo: new Set(), costas: new Set() };
let abaEstilo = 'frente';
let todosEstilos = [];
let listaEstilos = [];
const NOMES_PADRAO = { frente: 'Flamengo frente (padrão)', escudo: 'Escudo estourado (padrão)', costas: 'Flamengo costas (padrão)' };
const estilosDoModelo = (m) => [{ id: `padrao:${m}`, nome: NOMES_PADRAO[m], url: M.ESTILOS_PADRAO[m], fixo: true }, ...todosEstilos.filter((e) => (e.modelo || 'frente') === m)];
function urlsEstilo(m) {
  const lista = estilosDoModelo(m), sel = selPorModelo[m];
  const escolhidos = lista.filter((e) => sel.has(e.id));
  return (escolhidos.length ? escolhidos : lista.slice(0, 2)).map((e) => (e.fixo ? e.id : e.url));
}
$$('#segEstilo button').forEach((b) => b.onclick = () => { abaEstilo = b.dataset.m; $$('#segEstilo button').forEach((x) => x.classList.toggle('on', x === b)); carregarEstilos(false); });
async function carregarEstilos(buscar = true) {
  if (buscar) todosEstilos = await fetch('/api/estilo').then((r) => r.json()).catch(() => []);
  listaEstilos = estilosDoModelo(abaEstilo);
  const estilosSel = selPorModelo[abaEstilo];
  if (!estilosSel.size) listaEstilos.slice(0, 2).forEach((e) => estilosSel.add(e.id));
  for (const n of [...estilosSel]) if (!listaEstilos.some((e) => e.id === n)) estilosSel.delete(n);
  $('#styles').innerHTML = listaEstilos.map((e) => `<div class="st ${estilosSel.has(e.id) ? 'on' : ''}" data-n="${esc(e.id)}" title="${esc(e.nome)}${e.autor ? ' · ' + esc(e.autor) : ''}"><img src="${e.url}" loading="lazy"><span class="ck">✓</span>${e.fixo ? '' : `<button class="x" data-del="${esc(e.id)}">×</button>`}</div>`).join('')
    + `<div class="st add" id="addEst" title="Adicionar arte aprovada">+</div>`;
  $$('#styles .st[data-n]').forEach((d) => d.onclick = async (ev) => {
    const del = ev.target.dataset.del;
    if (del) {
      if (!confirm('Remover esta arte da biblioteca de estilo? (vale para todo o time)')) return;
      await fetch('/api/estilo/' + encodeURIComponent(del), { method: 'DELETE' }); estilosSel.delete(del); return carregarEstilos();
    }
    const n = d.dataset.n;
    if (estilosSel.has(n)) estilosSel.delete(n); else { if (estilosSel.size >= 2) estilosSel.delete([...estilosSel][0]); estilosSel.add(n); }
    carregarEstilos(false);
  });
  $('#addEst').onclick = () => $('#fileEstilo').click();
}
async function reduzir(file, max, tipo = 'image/jpeg') {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (tipo === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, tipo, 0.92));
}
$('#fileEstilo').onchange = async (e) => {
  toast('Enviando para a biblioteca…');
  for (const f of e.target.files) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await enviarBlob(`estilo:${id}`, await reduzir(f, 1600));
    await fetch('/api/estilo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, nome: f.name.replace(/\.[^.]+$/, ''), modelo: abaEstilo }) });
  }
  e.target.value = ''; toast('Arte adicionada à biblioteca'); carregarEstilos();
};
async function carregarLogo() {
  const l = await fetch('/api/logo').then((r) => r.json()).catch(() => ({ url: '/assets/logo-gocase.svg' }));
  logoUrl = l.url;
  $('#logoPrev').src = l.url; $('#btnLogoReset').hidden = !l.custom;
  $('#logoInfo').textContent = l.custom ? 'Logo oficial enviado pelo time' : 'Logo vetorizado do padrão';
}
$('#btnLogo').onclick = () => $('#fileLogo').click();
$('#fileLogo').onchange = async (e) => {
  await enviarBlob('logo', await reduzir(e.target.files[0], 3000, 'image/png'));
  await fetch('/api/logo', { method: 'POST' }); e.target.value = ''; toast('Logo atualizado'); carregarLogo();
};
$('#btnLogoReset').onclick = async () => { await fetch('/api/logo', { method: 'DELETE' }); carregarLogo(); };

// ---------- envio ----------
$('#btnGo').onclick = async () => {
  const referencias = SLOTS.flatMap((s) => refs[s.id].map((r) => ({ file: r.file, papel: s.id })));
  const notas = $('#notas').value;
  const iniciadas = [];
  for (const modelo of MODELOS_UI.map((m) => m.id).filter((m) => modelosSel.has(m))) {
    const op = { ...opcoes, modelo };
    if (modelo === 'costas') Object.assign(op, { nomeNumero: costas.nomeNumero, nome: $('#nnNome').value.trim(), numero: $('#nnNumero').value.trim() });
    const { tarefa, executar } = await M.iniciar({ referencias, estilosUrls: urlsEstilo(modelo), notas, opcoes: op, usuario });
    executar.then(() => toast(tarefa.estado.status === 'concluido' ? `Pronto: ${tarefa.estado.nome}` : `${tarefa.estado.nome || 'Uma conversão'} parou com erro`));
    iniciadas.push(tarefa);
  }
  refs.frente = []; refs.escudo = []; refs.costas = []; $('#notas').value = ''; renderSlots();
  if (iniciadas.length > 1) toast(`${iniciadas.length} conversões rodando — acompanhe pelo Histórico`);
  abrir(iniciadas[0].id);
};

// ---------- tarefa ----------
let aba = 'resultado', flat = false, ocultas = new Set();
const INTERROMPIDA_MS = 4 * 60 * 1000;
function abrir(id, manterAba = false) {
  history.replaceState(null, '', '#' + id);
  if (!manterAba) { aba = 'resultado'; ocultas = new Set(); }
  pararAcompanhamento();
  ver('job'); $$('.nav button').forEach((b) => b.classList.remove('on'));
  const local = M.ativas.get(id);
  if (local) {
    atual = local;
    let agendado = false;
    desligar = local.ouvir(() => { if (!agendado) { agendado = true; requestAnimationFrame(() => { agendado = false; renderJob(); }); } });
    renderJob();
    poll = setInterval(atualizarTempo, 1000);
    return;
  }
  if (!manterAba) $('#v-job').innerHTML = '<div class="empty"><span class="spin"></span></div>';
  let ultimo = '';
  const tick = async () => {
    const r = await fetch('/api/tarefas/' + id);
    if (!r.ok) { $('#v-job').innerHTML = '<div class="empty">Conversão não encontrada.</div>'; return pararAcompanhamento(); }
    const estado = await r.json();
    if (M.ativas.get(id)) return abrir(id, true); // passou a rodar nesta aba
    atual = new M.Tarefa(estado);
    if (estado.atualizadoEm + estado.status !== ultimo) { ultimo = estado.atualizadoEm + estado.status; renderJob(); } else atualizarTempo();
    if (estado.status !== 'rodando' || interrompida(estado)) clearInterval(poll);
  };
  tick(); poll = setInterval(tick, 4000);
}
const interrompida = (t) => t.status === 'rodando' && !M.ativas.has(t.id) && Date.now() - new Date(t.atualizadoEm) > INTERROMPIDA_MS;
const statusDe = (t) => (interrompida(t) ? 'interrompida' : t.status);

const ST = {
  aprovado: ['ok', 'Aprovado'], aprovada: ['ok', 'Aprovada'], concluido: ['ok', 'Concluído'], manual: ['ok', 'Sua escolha'],
  ressalvas: ['warn', 'Com ressalvas'], reprovada: ['bad', 'Reprovada'], erro: ['bad', 'Erro'], interrompida: ['bad', 'Interrompida'],
  rodando: ['run', 'Em andamento'], gerando: ['run', 'Gerando'], revisando: ['run', 'Revisando'], aguardando: ['idle', 'Aguardando'],
};
const badge = (s, txt) => { const [c, l] = ST[s] || ['idle', s]; return `<span class="badge b-${c}">${c === 'run' ? '<span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>' : ''}${txt || l}</span>`; };
const papelNome = { frente: 'Frente', escudo: 'Escudo', costas: 'Costas' };
const urlVersao = (t, etapaId, sufixo = '_full') => { const e = t.etapas.find((x) => x.id === etapaId); return e?.escolhida ? `/api/blob/${encodeURIComponent(`t:${t.id}:${etapaId}_t${e.escolhida}${sufixo}`)}` : null; };
const tempo = (t) => { const s = Math.max(0, ((t.status === 'rodando' && !interrompida(t) ? Date.now() : new Date(t.atualizadoEm)) - new Date(t.criadoEm)) / 1000); return `${Math.floor(s / 60)}min ${String(Math.floor(s % 60)).padStart(2, '0')}s`; };
function atualizarTempo() { const el = $('#tempo'); if (el && atual) el.textContent = tempo(atual.estado); }

function fases(t) {
  const e = (id) => t.etapas.find((x) => x.id === id);
  const camadas = t.etapas.filter((x) => x.id.startsWith('camada_'));
  const agg = (arr) => !arr.length ? 'aguardando' : arr.some((x) => x.status === 'erro') ? 'erro' : arr.some((x) => ['rodando', 'aguardando'].includes(x.status)) ? 'rodando' : arr.some((x) => x.status === 'ressalvas') ? 'ressalvas' : 'aprovado';
  const totalCam = (t.analise?.camadas?.length || 2) + 1;
  const prontas = camadas.filter((x) => ['aprovado', 'ressalvas'].includes(x.status)).length;
  return [
    { n: 'Análise', s: e('analise')?.status || (t.status === 'rodando' ? 'rodando' : 'aguardando'), d: 'referências' },
    { n: 'Arte', s: e('arte')?.status || 'aguardando', d: e('arte') ? `${e('arte').tentativas.length} versão(ões)` : 'com escudo' },
    { n: { frente: 'Sem escudo', escudo: 'Fundo', costas: 'Sem nome/nº' }[t.opcoes.modelo || 'frente'], s: e('sem_escudo')?.status || (t.status === 'concluido' ? 'aprovado' : 'aguardando'), d: 'remoção' },
    { n: 'Camadas', s: agg(camadas), d: `${prontas}/${totalCam} prontas` },
    { n: 'Exportação', s: e('exportacao')?.status || 'aguardando', d: 'PNG + ZIP' },
  ];
}
function progresso(t) {
  if (t.status === 'concluido') return 100;
  const total = 4 + (t.analise?.camadas?.length || 2) + 1;
  const feitas = t.etapas.filter((x) => ['aprovado', 'ressalvas'].includes(x.status)).length;
  const parciais = t.etapas.filter((x) => x.status === 'rodando').reduce((s, x) => s + Math.min(0.8, x.tentativas.length * 0.35), 0);
  return Math.min(97, Math.round(((feitas + parciais) / total) * 100)) || 3;
}

function renderJob() {
  if (!atual) return;
  const t = atual.estado, r = t.resultado, a = t.analise, st = statusDe(t);
  const local = M.ativas.has(t.id);
  const cls = { aprovado: 'ok', ressalvas: 'warn', erro: 'bad', rodando: 'run' };
  let h = `<div class="job-h"><div class="tt">
      <h2>${esc(t.nome || `Analisando referências… (${M.MODELOS_ARTE[t.opcoes.modelo || 'frente'].nome})`)}</h2>
      <div class="meta">${badge(st)}${t.operacao && st === 'rodando' ? `<span style="color:var(--run)">${esc(t.operacao)}…</span>` : ''}<span>⏱ <span id="tempo">${tempo(t)}</span></span><span>${new Date(t.criadoEm).toLocaleString('pt-BR')}</span>${t.autor ? `<span>${esc(t.autor)}</span>` : ''}</div>
    </div></div>
    <div class="prog ${st !== 'rodando' ? 'done' : ''}"><i style="width:${progresso(t)}%"></i></div>
    <div class="stepper">${fases(t).map((f, i) => `<div class="stp ${cls[f.s] || ''}"><span class="si">${f.s === 'aprovado' ? '✓' : f.s === 'ressalvas' ? '!' : f.s === 'erro' ? '×' : i + 1}</span><div><b>${f.n}</b><small>${esc(f.d)}</small></div></div>`).join('')}</div>`;
  if (local) h += `<div class="keep"><span class="spin"></span>A conversão roda nesta aba — deixe-a aberta até terminar (≈5 min). Pode usar outras abas normalmente.</div>`;
  else if (st === 'rodando') h += `<div class="keep">Esta conversão está rodando no navegador de ${esc(t.autor || 'outra pessoa')}. A tela atualiza sozinha.</div>`;
  if (st === 'interrompida') h += `<div class="err"><b>Interrompida:</b> a aba que rodava esta conversão foi fechada. ${t.etapas.find((e) => e.id === 'arte')?.escolhida ? 'Você ainda pode escolher versões ou gerar outras nas etapas que terminaram.' : ''}</div>`;
  if (t.erro) h += `<div class="err"><b>Erro:</b> ${esc(t.erro)}</div>`;
  if (r && st !== 'rodando') {
    h += `<div class="dl"><div class="txt"><b>Pronto para baixar</b><small>Arte com e sem escudo + ${r.camadas.length} camadas em PNG · ${t.opcoes.resolucao === 'maxima' ? '3000 × 6141' : '2000 × 4094'}px · gerados no seu navegador</small></div>
      <span class="dlprog" id="dlprog"></span>
      <button class="btn grad" data-baixar="zip">${I.down} Baixar ZIP completo</button></div>`;
  }
  const tabs = r ? ['resultado', 'revisoes', 'analise'] : ['revisoes', 'analise'];
  if (!tabs.includes(aba)) aba = tabs[0];
  const nomes = { resultado: 'Resultado', revisoes: 'Revisões dos agentes', analise: 'Análise' };
  h += `<div class="tabs">${tabs.map((x) => `<button data-aba="${x}" class="${aba === x ? 'on' : ''}">${nomes[x]}</button>`).join('')}</div>`;
  if (aba === 'resultado') h += renderResultado(t, r);
  if (aba === 'revisoes') h += renderRevisoes(t, st);
  if (aba === 'analise') h += renderAnalise(t, a);
  const sy = window.scrollY, sx = $$('.tents').map((el) => el.scrollLeft);
  $('#v-job').innerHTML = h;
  $$('.tents').forEach((el, i) => { el.scrollLeft = sx[i] || 0; });
  window.scrollTo({ top: sy });
  $$('#v-job [data-aba]').forEach((b) => b.onclick = () => { aba = b.dataset.aba; renderJob(); });
  ligar();
}

function renderResultado(t, r) {
  const comUrl = urlVersao(t, 'arte'), semUrl = urlVersao(t, 'sem_escudo');
  const logo = t.opcoes.aplicarLogo ? `<img class="lg" src="${logoUrl}">` : '';
  const rot = M.MODELOS_ARTE[t.opcoes.modelo || 'frente'].rotulos;
  const fin = [['com', rot.com, comUrl, 'arte'], ...(semUrl ? [['sem', rot.sem, semUrl, 'sem_escudo']] : [])];
  const camadas = [...r.camadas.map((c) => ({ ...c, url: urlVersao(t, c.etapa), et: t.etapas.find((e) => e.id === c.etapa) }))];
  const logoLayer = t.opcoes.aplicarLogo ? [{ id: 'logo_gocase', nome: 'Logo gocase', logo: true }] : [];
  return `<div class="toggle-flat"><div class="seg" id="segFlat"><button data-f="0" class="${flat ? '' : 'on'}">No case</button><button data-f="1" class="${flat ? 'on' : ''}">Arte plana</button></div></div>
    <div class="hero">${fin.map(([k, l, u, etapa]) => `<div class="fin">${flat
        ? `<div class="phone flat"><img src="${u}">${logo}</div>`
        : `<div class="mock" data-mock="${u}" data-logo="${t.opcoes.aplicarLogo ? 1 : ''}" data-nome="${k}"><div class="skel"></div></div>`}
      <div class="lbl">${l}<button class="iconbtn" data-baixar="${k}" title="Baixar arte em PNG (alta)">${I.down}</button><button class="btn mini" data-baixar-mock="${k}" title="Baixar mockup">Mockup</button></div>
      <button class="link" data-ir="${etapa}">trocar versão</button></div>`).join('')}</div>
    <div class="sec">Camadas separadas</div>
    <p class="secs">PNG transparente, todas do mesmo tamanho: empilhadas na ordem, montam a arte. Passe o mouse para destacar, use o olho para ligar/desligar.</p>
    <div class="lx">
      <div class="stackview xadrez" id="stackview">${camadas.map((c) => `<img src="${c.url}" data-id="${c.id}" class="${ocultas.has(c.id) ? 'off' : ''}">`).join('')}${logoLayer.length ? `<img src="${logoUrl}" data-id="logo_gocase" class="${ocultas.has('logo_gocase') ? 'off' : ''}" style="inset:3.5% 7% auto auto;width:27.5%;height:auto">` : ''}</div>
      <div class="layers">${[...camadas, ...logoLayer].reverse().map((c, i, arr) => {
        const num = String(arr.length - i).padStart(2, '0');
        const nota = c.et?.tentativas.find((x) => x.n === c.et.escolhida)?.media;
        const b = c.logo ? '' : c.et?.manual ? badge('manual') : c.et?.status === 'ressalvas' ? badge('ressalvas', `Revisar${nota != null ? ' · ' + nota : ''}`) : badge('aprovado', `Aprovada${nota != null ? ' · ' + nota : ''}`);
        const nv = c.et?.tentativas.filter((x) => x.imagem).length || 0;
        return `<div class="ly" data-id="${c.id}">
          <div class="lt ${c.id === 'fundo' ? '' : 'xadrez'}"><img src="${c.logo ? logoUrl : c.url}" loading="lazy" style="${c.logo ? 'object-fit:contain' : ''}"></div>
          <div class="ln"><b>${esc(c.nome)}</b><small>${num}_${c.id}.png</small></div>
          ${b}${c.et ? `<button class="link" data-ir="${c.et.id}">${nv > 1 ? nv + ' versões' : 'versões'}</button>` : ''}
          <button class="eye ${ocultas.has(c.id) ? 'off' : ''}" data-eye="${c.id}" title="Mostrar/ocultar">${ocultas.has(c.id) ? I.eyeoff : I.eye}</button>
          <button class="iconbtn" data-baixar="camada:${c.id}" title="Baixar PNG em alta">${I.down}</button></div>`;
      }).join('')}</div>
    </div>`;
}

function renderRev(r) {
  if (r.erro) return `<div class="rv"><div class="rv-h"><div class="ring" style="--c:#555"><span>–</span></div><div><b>${esc(r.agente)}</b><small>revisor indisponível</small></div></div></div>`;
  const cor = r.aprovado ? 'var(--ok)' : r.nota >= 5 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="rv"><div class="rv-h"><div class="ring" style="--p:${r.nota * 10};--c:${cor}"><span>${r.nota}</span></div>
    <div style="flex:1"><b>${esc(r.agente.replace(/^Revisor \d — /, ''))}</b><small>${esc(r.modelo)}</small></div>${r.aprovado ? '<span style="color:var(--ok);font-weight:800">✓</span>' : '<span style="color:var(--bad);font-weight:800">✕</span>'}</div>
    ${r.problemas.length ? `<details ${r.aprovado ? '' : 'open'}><summary>▸ ${r.problemas.length} observaç${r.problemas.length > 1 ? 'ões' : 'ão'}</summary><ul>${r.problemas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}</div>`;
}
function renderRevisoes(t, st) {
  if (!t.etapas.length) return '<div class="empty"><span class="spin"></span><p>Enviando referências…</p></div>';
  const livre = st !== 'rodando';
  const escolhivel = (e) => e.tipo === 'arte' || e.tipo === 'camada';
  return t.etapas.filter((e) => e.tipo !== 'exportacao').map((e) => `<div class="et" id="et-${e.id}"><div class="et-h"><b>${esc(e.titulo)}</b>${badge(e.manual ? 'manual' : e.status)}
    ${escolhivel(e) && livre && e.escolhida ? `<button class="btn" data-nova="${e.id}">${I.plus} Gerar outra versão</button>` : ''}</div>
    ${e.tipo === 'analise' ? `<small style="color:var(--muted)">${e.status === 'aprovado' ? 'Uniforme identificado — veja a aba Análise.' : 'Lendo as referências…'}</small>` : ''}
    ${e.tentativas.length ? `<div class="tents">${e.tentativas.map((x) => `<div class="tn ${e.escolhida === x.n ? 'esc' : ''}">
      <div class="tn-h"><span>Versão ${x.n}</span>${badge(x.status)}</div>
      <div class="im ${e.tipo === 'camada' && e.id !== 'camada_fundo' ? 'xadrez' : ''}">${x.imagem ? `<a href="${x.imagem}_full" target="_blank"><img src="${x.imagem}"></a>` : x.erro ? `<span style="color:var(--bad);padding:14px;font-size:12px">${esc(x.erro)}</span>` : '<div class="skel">gerando imagem…</div>'}</div>
      ${escolhivel(e) && x.imagem && x.revisoes ? (e.escolhida === x.n
        ? `<div class="inuse">✓ Em uso · ${e.manual ? 'sua escolha' : 'escolha dos agentes'}</div>`
        : livre ? `<button class="btn usar" data-usar="${e.id}" data-n="${x.n}">Usar esta versão</button>` : '') : ''}
      ${(x.revisoes || []).map(renderRev).join('')}
      ${x.status === 'revisando' ? '<div class="rv"><div class="rv-h"><span class="spin"></span><small>2 agentes revisando…</small></div></div>' : ''}</div>`).join('')}</div>` : ''}</div>`).join('');
}
function renderAnalise(t, a) {
  let h = '';
  if (a) {
    if (a.alertas?.length) h += a.alertas.map((x) => `<div class="alert">⚠️ <span>${esc(x)}</span></div>`).join('');
    h += `<div class="panel" style="margin:14px 0"><dl class="kv">
      <dt>Uniforme</dt><dd><b>${esc(a.identificacao)}</b></dd>
      <dt>Cores</dt><dd><div class="cores">${(a.cores || []).map((c) => `<span class="cor"><i style="background:${esc(c.hex)}"></i>${esc(c.nome)} <span style="color:var(--muted)">${esc(c.hex)}</span></span>`).join('')}</div></dd>
      <dt>Escudo</dt><dd>${a.tem_escudo === false ? 'sem escudo' : esc(a.posicao_escudo === 'centro' ? 'centralizado no peito' : 'peito esquerdo (lado direito da arte)')}</dd>
      <dt>Removido</dt><dd>${esc([...(a.marcas_fornecedor || []), ...(a.patrocinios || [])].join(' · ') || '—')}</dd>
      <dt>Camadas</dt><dd>${esc(['Fundo', ...(a.camadas || []).map((c) => c.nome)].join(' · '))}</dd>
      <dt>Modelos</dt><dd style="color:var(--muted)">análise ${esc(t.modelos?.analise)} · revisores ${esc(t.modelos?.revisor1)} + ${esc(t.modelos?.revisor2)}</dd>
    </dl></div>`;
  } else h += '<div class="empty"><span class="spin"></span><p>Analisando as referências…</p></div>';
  if (t.log?.length) h += `<div class="sec" style="margin-top:20px">Registro</div><ul style="color:var(--muted);font-size:12.5px">${t.log.map((l) => `<li>${esc(l.msg)}</li>`).join('')}</ul>`;
  h += `<div class="sec" style="margin-top:20px">Referências usadas</div><div class="refsrow" style="margin-top:10px">${(t.referencias || []).map((x) => `<figure><img src="${x.url}"><figcaption>${papelNome[x.papel] || x.papel}</figcaption></figure>`).join('')}</div>`;
  return h;
}

// ---------- mockups (renderizados aqui, com cache por arte + logo) ----------
const mockCache = new Map();
let logoTrabalho = null;
function gerarMockup(arteUrl, comLogo, largura) {
  const chave = `${arteUrl}|${comLogo ? logoUrl : ''}|${largura || ''}`;
  if (!mockCache.has(chave)) {
    mockCache.set(chave, (async () => {
      let arte = await (await fetch(arteUrl)).blob();
      if (comLogo) {
        if (logoTrabalho?.url !== logoUrl) logoTrabalho = { url: logoUrl, png: Img.camadaLogo(logoUrl, Img.TRABALHO) };
        arte = await Img.sobrepor(arte, [await logoTrabalho.png]);
      }
      const blob = await Img.mockup(arte, largura);
      return { blob, url: URL.createObjectURL(blob) };
    })().catch((e) => { mockCache.delete(chave); throw e; }));
  }
  return mockCache.get(chave);
}
function preencherMockups() {
  $$('[data-mock]').forEach(async (el) => {
    try {
      const m = await gerarMockup(el.dataset.mock, Boolean(el.dataset.logo), el.dataset.largura ? +el.dataset.largura : undefined);
      if (el.isConnected) el.innerHTML = `<img src="${m.url}" alt="mockup">`;
    } catch (e) { console.error(e); if (el.isConnected) el.innerHTML = '<div class="empty">mockup indisponível</div>'; }
  });
}
async function baixarMockup(qual) {
  const el = $(`[data-mock][data-nome="${qual}"]`);
  const t = atual.estado;
  const url = el?.dataset.mock || urlVersao(t, qual === 'sem' ? 'sem_escudo' : 'arte') || urlVersao(t, 'arte');
  const m = await gerarMockup(url, Boolean(t.opcoes.aplicarLogo));
  const arq = M.MODELOS_ARTE[t.opcoes.modelo || 'frente'].arquivos[qual];
  salvarArquivo(m.blob, `${(t.analise?.identificacao || 'uniforme').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}_${arq}_mockup.png`);
}

// ---------- ações ----------
function salvarArquivo(blob, nome) {
  const u = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: u, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
}
async function baixar(qual) {
  const t = atual;
  const prog = (p, msg) => { const el = $('#dlprog'); if (el) el.textContent = `Gerando em alta… ${p}% (${msg})`; };
  toast('Preparando arquivos em alta resolução…');
  try {
    const f = await M.prepararArquivos(t, logoUrl, prog);
    const el = $('#dlprog'); if (el) el.textContent = '';
    if (qual === 'zip') return salvarArquivo(f.zip, f.zipNome);
    if (qual === 'com' || qual === 'sem') return salvarArquivo(f.artes[qual], f.nomes[qual]);
    const c = f.camadas.find((x) => `camada:${x.id}` === qual);
    if (c) salvarArquivo(c.png, c.arquivo);
  } catch (e) { console.error(e); toast('Falha ao gerar os arquivos: ' + e.message); }
}
function irPara(etapa) {
  aba = 'revisoes'; renderJob();
  setTimeout(() => { const el = document.getElementById('et-' + etapa); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }, 50);
}
async function executarAcao(fn, msg) {
  const t = atual;
  try {
    const p = fn(t);
    toast(msg);
    abrir(t.id, true);
    await p;
    toast(t.estado.status === 'concluido' ? 'Atualizado' : 'Não deu certo: ' + (t.estado.erro || ''));
  } catch (e) { toast(e.message); }
}
function ligar() {
  $$('#segFlat button').forEach((b) => b.onclick = () => { flat = b.dataset.f === '1'; renderJob(); });
  const sv = $('#stackview');
  if (sv) $$('.ly').forEach((ly) => {
    ly.onmouseenter = () => { sv.classList.add('focus'); $$('img', sv).forEach((i) => i.classList.toggle('hl', i.dataset.id === ly.dataset.id)); };
    ly.onmouseleave = () => sv.classList.remove('focus');
  });
  $$('[data-eye]').forEach((b) => b.onclick = () => { const id = b.dataset.eye; ocultas.has(id) ? ocultas.delete(id) : ocultas.add(id); renderJob(); });
  $$('[data-baixar]').forEach((b) => b.onclick = () => baixar(b.dataset.baixar));
  $$('[data-baixar-mock]').forEach((b) => b.onclick = () => baixarMockup(b.dataset.baixarMock));
  preencherMockups();
  $$('[data-ir]').forEach((b) => b.onclick = (ev) => { ev.preventDefault(); irPara(b.dataset.ir); });
  $$('[data-usar]').forEach((b) => b.onclick = () => {
    const etapa = b.dataset.usar, n = +b.dataset.n;
    if (etapa === 'arte' && !confirm('A versão sem escudo e todas as camadas são feitas a partir da arte com escudo.\nTrocar a arte vai refazê-las a partir desta versão (≈4 min, com a aba aberta). Continuar?')) return;
    executarAcao((t) => M.escolherVersao(t, etapa, n), etapa === 'arte' ? 'Refazendo sem escudo e camadas…' : 'Versão escolhida');
  });
  $$('[data-nova]').forEach((b) => b.onclick = () => executarAcao((t) => M.novaVersao(t, b.dataset.nova), 'Gerando outra versão… os agentes vão revisar'));
}

// ---------- histórico ----------
async function historico() {
  ver('hist');
  const l = await fetch('/api/tarefas').then((r) => r.json()).catch(() => []);
  $('#hist').innerHTML = l.length ? l.map((t) => {
    const st = t.status === 'rodando' && !M.ativas.has(t.id) && Date.now() - new Date(t.atualizado_em) > INTERROMPIDA_MS ? 'interrompida' : t.status;
    return `<div class="hc" data-id="${t.id}">${t.capa ? `<div class="mock" data-mock="${t.capa}" data-largura="320"><div class="skel"></div></div>` : '<div class="phone"></div>'}
    <div class="info"><b>${esc(t.nome || 'Sem nome')}</b><small>${new Date(t.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small><div class="autor">${esc(t.autor || '')}</div><div style="margin-top:6px">${badge(st)}</div></div></div>`;
  }).join('') : '<div class="empty">Nenhuma conversão ainda.</div>';
  $$('.hc').forEach((d) => d.onclick = () => abrir(d.dataset.id));
  preencherMockups();
}

renderModelos(); renderSlots(); carregarEstilos(); carregarLogo(); Esc.iniciarAba(usuario);
const porHash = () => { const id = location.hash.slice(1); if (id && atual?.id !== id) abrir(id); };
window.addEventListener('hashchange', porHash);
porHash();

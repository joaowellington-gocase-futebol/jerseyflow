// Conversor de Uniformes Gocase — servidor local.
// Rodar: npm start  → http://localhost:4321
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import sharp from 'sharp';
import { executar, escolherVersao, novaVersao } from './lib/pipeline.mjs';
import { MODELOS } from './lib/ai.mjs';
import { mockup } from './lib/imaging.mjs';

const RAIZ = path.resolve('.');
const DADOS = path.join(RAIZ, 'data');
const ESTILO = path.join(DADOS, 'estilo');
const SAIDA = path.join(RAIZ, 'output');
for (const d of [ESTILO, SAIDA]) fs.mkdirSync(d, { recursive: true });

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 16 } });
app.use(express.json());
app.use(express.static(path.join(RAIZ, 'public')));
app.use('/output', express.static(SAIDA));
app.use('/estilo-img', express.static(ESTILO));
app.use('/assets', express.static(path.join(RAIZ, 'assets')));

const imagensEstilo = () =>
  fs.readdirSync(ESTILO).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();

// ---------- biblioteca de estilo (artes Gocase aprovadas) ----------
app.get('/api/estilo', (req, res) => {
  res.json(imagensEstilo().map((f) => ({ nome: f, url: `/estilo-img/${encodeURIComponent(f)}` })));
});
app.post('/api/estilo', upload.array('imagens'), async (req, res) => {
  for (const f of req.files || []) {
    const base = path.parse(f.originalname).name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'arte';
    await sharp(f.buffer).rotate().png().toFile(path.join(ESTILO, `${base}_${Date.now().toString(36)}.png`));
  }
  res.json({ ok: true });
});
app.delete('/api/estilo/:nome', (req, res) => {
  const alvo = path.join(ESTILO, path.basename(req.params.nome));
  if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
  res.json({ ok: true });
});

// ---------- logo gocase (substituível pelo oficial) ----------
app.get('/api/logo', (req, res) => {
  const custom = fs.existsSync(path.join(DADOS, 'logo.png'));
  res.json({ url: custom ? `/api/logo/arquivo?v=${fs.statSync(path.join(DADOS, 'logo.png')).mtimeMs}` : '/assets/logo-gocase.svg', custom });
});
app.get('/api/logo/arquivo', (req, res) => res.sendFile(path.join(DADOS, 'logo.png')));
app.post('/api/logo', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'envie um PNG' });
  await sharp(req.file.buffer).png().toFile(path.join(DADOS, 'logo.png'));
  res.json({ ok: true });
});
app.delete('/api/logo', (req, res) => {
  const p = path.join(DADOS, 'logo.png');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ---------- tarefas ----------
app.post('/api/tarefas', upload.array('referencias'), async (req, res) => {
  const arquivos = req.files || [];
  if (!arquivos.length) return res.status(400).json({ erro: 'Envie pelo menos uma imagem de referência do uniforme.' });
  const papeis = JSON.parse(req.body.papeis || '[]');
  const opcoes = JSON.parse(req.body.opcoes || '{}');
  const estilosEscolhidos = JSON.parse(req.body.estilos || '[]');

  const id = `${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(SAIDA, id);
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  const prioridade = { frente: 0, escudo: 1, costas: 2 };
  const referencias = (await Promise.all(arquivos.map(async (f, i) => {
    const arquivo = `ref_${i + 1}.png`;
    const buf = await sharp(f.buffer).rotate().png().toBuffer();
    fs.writeFileSync(path.join(dir, 'refs', arquivo), buf);
    return { buf, papel: prioridade[papeis[i]] !== undefined ? papeis[i] : 'frente', arquivo };
  }))).sort((a, b) => prioridade[a.papel] - prioridade[b.papel]);
  if (!referencias.some((r) => r.papel === 'frente')) {
    return res.status(400).json({ erro: 'Envie pelo menos uma foto da FRENTE da camisa.' });
  }
  const disponiveis = imagensEstilo();
  const estilos = (estilosEscolhidos.length ? estilosEscolhidos.filter((e) => disponiveis.includes(e)) : disponiveis)
    .map((f) => path.join(ESTILO, f));

  executar({
    id, dir, referencias, estilos,
    notas: (req.body.notas || '').slice(0, 1500),
    opcoes: {
      removerFornecedor: opcoes.removerFornecedor !== false,
      removerPatrocinio: opcoes.removerPatrocinio !== false,
      aplicarLogo: opcoes.aplicarLogo !== false,
      resolucao: opcoes.resolucao === 'maxima' ? 'maxima' : 'alta',
      tentativas: opcoes.tentativas || 3,
    },
    dirDados: DADOS,
  });
  res.json({ id });
});

const lerTarefa = (id) => {
  const p = path.join(SAIDA, path.basename(id), 'job.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
app.get('/api/tarefas/:id', (req, res) => {
  const t = lerTarefa(req.params.id);
  t ? res.json(t) : res.status(404).json({ erro: 'não encontrada' });
});
app.get('/api/tarefas', (req, res) => {
  const lista = fs.readdirSync(SAIDA)
    .map(lerTarefa)
    .filter(Boolean)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .map((t) => ({
      id: t.id, nome: t.nome || 'Analisando…', status: t.status, criadoEm: t.criadoEm,
      capa: t.resultado?.arquivos?.comEscudo || t.etapas?.find((e) => e.id === 'arte')?.tentativas?.at(-1)?.imagem || t.referencias?.[0]?.url,
    }));
  res.json(lista);
});
// designer escolhe a versão de uma etapa / pede mais uma versão
const acao = (fn) => async (req, res) => {
  const dir = path.join(SAIDA, path.basename(req.params.id));
  if (!fs.existsSync(path.join(dir, 'job.json'))) return res.status(404).json({ erro: 'não encontrada' });
  try {
    await fn(dir, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
};
app.post('/api/tarefas/:id/escolher', acao((dir, b) => escolherVersao({ dir, etapaId: String(b.etapa), n: Number(b.n), dirDados: DADOS })));
app.post('/api/tarefas/:id/nova-versao', acao((dir, b) => novaVersao({ dir, etapaId: String(b.etapa), dirDados: DADOS })));

// mockup na capinha transparente, gerado sob demanda a partir da arte final (com cache)
app.get('/api/tarefas/:id/mockup/:qual', async (req, res) => {
  const dir = path.join(SAIDA, path.basename(req.params.id));
  const qual = req.params.qual === 'sem' ? 'sem' : 'com';
  const artes = path.join(dir, 'final', 'arte');
  if (!fs.existsSync(artes)) return res.status(404).end();
  const arte = fs.readdirSync(artes).find((f) => f.endsWith(`_${qual}_escudo.png`));
  if (!arte) return res.status(404).end();
  const largura = Math.min(843, Math.max(120, Number(req.query.w) || 843));
  const cache = path.join(dir, 'final', 'mockup', `.${qual}_${largura}.png`);
  try {
    if (!fs.existsSync(cache)) {
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      let png = await mockup(fs.readFileSync(path.join(artes, arte)));
      if (largura < 843) png = await sharp(png).resize(largura).png().toBuffer();
      fs.writeFileSync(cache, png);
    }
    res.set('Cache-Control', 'no-cache');
    if (req.query.baixar) return res.download(cache, arte.replace('.png', '_mockup.png'));
    res.sendFile(cache);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// downloads diretos (forçam "salvar arquivo") e atalho para a pasta no Finder
app.get('/api/tarefas/:id/zip', (req, res) => {
  const dir = path.join(SAIDA, path.basename(req.params.id));
  const zip = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.zip'));
  zip ? res.download(path.join(dir, zip)) : res.status(404).json({ erro: 'ZIP ainda não gerado' });
});
app.get('/api/baixar', (req, res) => {
  const alvo = path.resolve(SAIDA, String(req.query.p || '').replace(/^\/output\//, ''));
  if (!alvo.startsWith(SAIDA + path.sep) || !fs.existsSync(alvo)) return res.status(404).end();
  res.download(alvo);
});
app.post('/api/tarefas/:id/abrir-pasta', (req, res) => {
  const dir = path.join(SAIDA, path.basename(req.params.id));
  const alvo = fs.existsSync(path.join(dir, 'final')) ? path.join(dir, 'final') : dir;
  if (!fs.existsSync(alvo)) return res.status(404).json({ erro: 'não encontrada' });
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [alvo], (e) => res.json({ ok: !e, pasta: alvo }));
});
app.get('/api/config', (req, res) => res.json({ modelos: MODELOS }));

// tarefas interrompidas por reinício do servidor
for (const d of fs.readdirSync(SAIDA)) {
  const t = lerTarefa(d);
  if (t?.status === 'rodando') {
    t.status = 'erro';
    t.erro = 'Interrompida (o servidor foi reiniciado).';
    fs.writeFileSync(path.join(SAIDA, d, 'job.json'), JSON.stringify(t, null, 2));
  }
}

const PORTA = Number(process.env.PORT || 4321);
app.listen(PORTA, () => console.log(`Conversor de Uniformes Gocase → http://localhost:${PORTA}`));

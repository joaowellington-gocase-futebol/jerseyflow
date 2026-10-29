// JerseyFlow (antigo Conversor de Uniformes Gocase) — worker do GoDeploy.
// O pipeline e o processamento de imagem rodam no navegador; aqui ficam só:
//  - a ponte com o AI Proxy (a chave fica no segredo AI_PROXY_KEY, nunca vai para o navegador)
//  - o armazenamento compartilhado no env.DB: conversões, escudos gerados, versões de imagem, biblioteca de estilo e logo.

const AI = 'https://ai-proxy.gogroupbr.com';
const MODELOS = { analise: 'gpt-6-astra', revisor1: 'gpt-6-astra', revisor2: 'gpt-5.6-sol' };
const PERMITIDOS = new Set(Object.values(MODELOS));
const PEDACO = 1_000_000; // caracteres base64 por linha (limite de linha do SQLite é 2 MB)

let pronto = false;
async function schema(db) {
  if (pronto) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS blobs (chave TEXT NOT NULL, idx INTEGER NOT NULL, tipo TEXT, dados TEXT NOT NULL, PRIMARY KEY (chave, idx))`, []);
  await db.exec(`CREATE TABLE IF NOT EXISTS tarefas (id TEXT PRIMARY KEY, nome TEXT, status TEXT, autor TEXT, capa TEXT, criado_em TEXT, atualizado_em TEXT, json TEXT NOT NULL)`, []);
  await db.exec(`CREATE TABLE IF NOT EXISTS estilos (id TEXT PRIMARY KEY, nome TEXT, autor TEXT, criado_em TEXT)`, []);
  await db.exec(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)`, []);
  // biblioteca de estilo separada por modelo de arte (frente / escudo / costas)
  try { await db.exec(`ALTER TABLE estilos ADD COLUMN modelo TEXT DEFAULT 'frente'`, []); } catch { /* coluna já existe */ }
  // aba "Gerar escudo": cada geração de escudo PNG 1000×1000
  await db.exec(`CREATE TABLE IF NOT EXISTS escudos (id TEXT PRIMARY KEY, nome TEXT, status TEXT, autor TEXT, capa TEXT, criado_em TEXT, atualizado_em TEXT, json TEXT NOT NULL)`, []);
  pronto = true;
}

const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const erro = (msg, status = 400) => json({ erro: msg }, status);
const chaveValida = (c) => /^[A-Za-z0-9_.:-]{1,160}$/.test(c);

function paraBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function salvarBlob(db, chave, tipo, buf) {
  const b64 = paraBase64(buf);
  await db.exec(`DELETE FROM blobs WHERE chave = ?`, [chave]);
  for (let i = 0, idx = 0; i < b64.length; i += PEDACO, idx++) {
    await db.exec(`INSERT INTO blobs (chave, idx, tipo, dados) VALUES (?, ?, ?, ?)`, [chave, idx, tipo, b64.slice(i, i + PEDACO)]);
  }
}
async function lerBlob(db, chave) {
  const r = await db.query(`SELECT tipo, dados FROM blobs WHERE chave = ? ORDER BY idx`, [chave]);
  if (!r.rows.length) return null;
  return { tipo: r.rows[0].tipo || 'application/octet-stream', bytes: deBase64(r.rows.map((x) => x.dados).join('')) };
}

/** Repassa para o AI Proxy com a chave do servidor. Corpo da resposta é transmitido sem buffer. */
async function proxyIA(env, caminho, corpo) {
  if (!env.AI_PROXY_KEY) return erro('AI_PROXY_KEY não configurada no GoDeploy', 500);
  const r = await fetch(AI + caminho, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AI_PROXY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    const usuario = req.headers.get('x-godeploy-user-email') || 'anônimo';
    if (!p.startsWith('/api/')) return new Response('Not found', { status: 404 });
    const db = env.DB;
    await schema(db);

    try {
      // ---------- IA ----------
      if (p === '/api/config' && m === 'GET') return json({ modelos: MODELOS, usuario });
      if (p === '/api/ai/chat' && m === 'POST') {
        const b = await req.json();
        if (!PERMITIDOS.has(b.model)) return erro('modelo não permitido');
        return proxyIA(env, '/v1/chat/completions', { model: b.model, messages: b.messages, response_format: b.response_format });
      }
      if (p === '/api/ai/image' && m === 'POST') {
        const b = await req.json();
        if (!b.prompt || !Array.isArray(b.images)) return erro('prompt e images são obrigatórios');
        const corpo = { prompt: b.prompt, images: b.images.slice(0, 10), quality: b.quality || 'high' };
        if (['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(b.size)) corpo.size = b.size;
        return proxyIA(env, '/v1/images/edits', corpo);
      }

      // ---------- blobs (imagens) ----------
      const mb = p.match(/^\/api\/blob\/([^/]+)$/);
      if (mb) {
        const chave = decodeURIComponent(mb[1]);
        if (!chaveValida(chave)) return erro('chave inválida');
        if (m === 'PUT') {
          const buf = await req.arrayBuffer();
          if (buf.byteLength > 25e6) return erro('arquivo grande demais', 413);
          await salvarBlob(db, chave, req.headers.get('Content-Type') || 'application/octet-stream', buf);
          return json({ ok: true, bytes: buf.byteLength });
        }
        if (m === 'GET') {
          const b = await lerBlob(db, chave);
          if (!b) return new Response('não encontrado', { status: 404 });
          // versões de conversões nunca mudam de conteúdo; estilo/logo usam ?v= para quebrar cache
          const imutavel = chave.startsWith('t:') || chave.startsWith('e:') || url.searchParams.has('v');
          return new Response(b.bytes, { headers: { 'Content-Type': b.tipo, 'Cache-Control': imutavel ? 'private, max-age=31536000, immutable' : 'no-cache' } });
        }
        if (m === 'DELETE') {
          await db.exec(`DELETE FROM blobs WHERE chave = ?`, [chave]);
          return json({ ok: true });
        }
      }

      // ---------- conversões ----------
      if (p === '/api/tarefas' && m === 'GET') {
        const r = await db.query(`SELECT id, nome, status, autor, capa, criado_em, atualizado_em FROM tarefas ORDER BY criado_em DESC LIMIT 300`, []);
        return json(r.rows);
      }
      const mt = p.match(/^\/api\/tarefas\/([A-Za-z0-9_-]{4,60})$/);
      if (mt) {
        const id = mt[1];
        if (m === 'GET') {
          const r = await db.query(`SELECT json, atualizado_em FROM tarefas WHERE id = ?`, [id]);
          if (!r.rows.length) return erro('não encontrada', 404);
          return new Response(r.rows[0].json, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        if (m === 'PUT') {
          const txt = await req.text();
          if (txt.length > 1_900_000) return erro('estado grande demais', 413);
          const t = JSON.parse(txt);
          const atual = await db.query(`SELECT autor FROM tarefas WHERE id = ?`, [id]);
          const autor = atual.rows[0]?.autor || usuario;
          await db.exec(
            `INSERT INTO tarefas (id, nome, status, autor, capa, criado_em, atualizado_em, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, status = excluded.status, capa = excluded.capa, atualizado_em = excluded.atualizado_em, json = excluded.json`,
            [id, t.nome || null, t.status || null, autor, t.capa || null, t.criadoEm || new Date().toISOString(), t.atualizadoEm || new Date().toISOString(), txt],
          );
          return json({ ok: true });
        }
      }

      // ---------- escudos (aba Gerar escudo) ----------
      if (p === '/api/escudos' && m === 'GET') {
        const r = await db.query(`SELECT id, nome, status, autor, capa, criado_em, atualizado_em FROM escudos ORDER BY criado_em DESC LIMIT 200`, []);
        return json(r.rows);
      }
      const mesc = p.match(/^\/api\/escudos\/([A-Za-z0-9_-]{4,60})$/);
      if (mesc) {
        const id = mesc[1];
        if (m === 'GET') {
          const r = await db.query(`SELECT json FROM escudos WHERE id = ?`, [id]);
          if (!r.rows.length) return erro('não encontrado', 404);
          return new Response(r.rows[0].json, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        if (m === 'PUT') {
          const txt = await req.text();
          if (txt.length > 1_900_000) return erro('estado grande demais', 413);
          const e = JSON.parse(txt);
          const atual = await db.query(`SELECT autor FROM escudos WHERE id = ?`, [id]);
          const autor = atual.rows[0]?.autor || usuario;
          await db.exec(
            `INSERT INTO escudos (id, nome, status, autor, capa, criado_em, atualizado_em, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, status = excluded.status, capa = excluded.capa, atualizado_em = excluded.atualizado_em, json = excluded.json`,
            [id, e.nome || null, e.status || null, autor, e.capa || null, e.criadoEm || new Date().toISOString(), e.atualizadoEm || new Date().toISOString(), txt],
          );
          return json({ ok: true });
        }
        if (m === 'DELETE') {
          await db.exec(`DELETE FROM escudos WHERE id = ?`, [id]);
          await db.exec(`DELETE FROM blobs WHERE chave LIKE ?`, [`e:${id}:%`]);
          return json({ ok: true });
        }
      }

      // ---------- biblioteca de estilo ----------
      if (p === '/api/estilo' && m === 'GET') {
        const r = await db.query(`SELECT id, nome, autor, COALESCE(modelo, 'frente') AS modelo FROM estilos ORDER BY criado_em`, []);
        return json(r.rows.map((x) => ({ ...x, url: `/api/blob/estilo:${x.id}?v=1` })));
      }
      if (p === '/api/estilo' && m === 'POST') {
        const b = await req.json();
        if (!chaveValida(b.id)) return erro('id inválido');
        const modelo = ['frente', 'escudo', 'costas'].includes(b.modelo) ? b.modelo : 'frente';
        await db.exec(`INSERT OR REPLACE INTO estilos (id, nome, autor, criado_em, modelo) VALUES (?, ?, ?, ?, ?)`, [b.id, String(b.nome || 'arte').slice(0, 80), usuario, new Date().toISOString(), modelo]);
        return json({ ok: true });
      }
      const me = p.match(/^\/api\/estilo\/([^/]+)$/);
      if (me && m === 'DELETE') {
        const id = decodeURIComponent(me[1]);
        await db.exec(`DELETE FROM estilos WHERE id = ?`, [id]);
        await db.exec(`DELETE FROM blobs WHERE chave = ?`, [`estilo:${id}`]);
        return json({ ok: true });
      }

      // ---------- logo ----------
      if (p === '/api/logo') {
        if (m === 'GET') {
          const r = await db.query(`SELECT valor FROM config WHERE chave = 'logo_v'`, []);
          const v = r.rows[0]?.valor;
          return json(v ? { url: `/api/blob/logo?v=${v}`, custom: true } : { url: '/assets/logo-gocase.svg', custom: false });
        }
        if (m === 'POST') {
          await db.exec(`INSERT OR REPLACE INTO config (chave, valor) VALUES ('logo_v', ?)`, [Date.now().toString(36)]);
          return json({ ok: true });
        }
        if (m === 'DELETE') {
          await db.exec(`DELETE FROM config WHERE chave = 'logo_v'`, []);
          await db.exec(`DELETE FROM blobs WHERE chave = 'logo'`, []);
          return json({ ok: true });
        }
      }
      return erro('rota não encontrada', 404);
    } catch (e) {
      console.error(p, e?.stack || e);
      return erro(String(e?.message || e), 500);
    }
  },
};

// Simula o GoDeploy localmente: serve os assets de deploy/ e roda o worker com env.DB em SQLite.
// Rodar: node --env-file=.env devserver.mjs  → http://localhost:4322
import http from 'http';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import worker from './deploy/src/index.js';

const RAIZ = path.resolve('deploy');
const banco = new DatabaseSync(path.resolve('data/dev-godeploy.sqlite'));
const DB = {
  async query(sql, params = []) {
    const rows = banco.prepare(sql).all(...params);
    return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, rowsRead: rows.length };
  },
  async exec(sql, params = []) {
    const r = banco.prepare(sql).run(...params);
    return { rowsWritten: r.changes };
  },
};
const env = { DB, AI_PROXY_KEY: process.env.AI_PROXY_KEY };
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const p = path.join(RAIZ, rel);
    if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile() && !rel.startsWith('src/')) {
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
      return fs.createReadStream(p).pipe(res);
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const corpo = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'));
  headers.set('x-godeploy-user-email', 'dev@local');
  const r = await worker.fetch(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corpo }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  if (r.body) for await (const c of r.body) res.write(c);
  res.end();
}).listen(4322, () => console.log('GoDeploy local → http://localhost:4322'));

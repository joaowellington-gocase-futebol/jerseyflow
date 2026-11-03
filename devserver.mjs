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
// radar de mentira para testar a aba "Novos uniformes" (matérias reais do Footy Headlines)
const env = { DB, AI_PROXY_KEY: process.env.AI_PROXY_KEY, RADAR_URL: 'http://localhost:4322/_radar', RADAR_API_KEY: 'dev' };
const hojeMenos = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const RADAR_FAKE = [
  { kit_id: 'botafogo|26-27|OUTRO', clube_nome: 'Botafogo', tipo: 'OUTRO', temporada: '26-27', fornecedor: 'Reebok', estagio: 'LANCADO', licenciado: 1, lancado_em: hojeMenos(3), mudou_em: hojeMenos(3), veredito: 'GO', score: 72,
    links: [{ titulo: 'Botafogo 26-27 Fourth Pink October Kit Released', link: 'https://www.footyheadlines.com/8545743502/botafogo-26-27-fourth-pink-october-kit-released.html', fonte: 'footyheadlines.com', estagio: 'LANCADO' }] },
  { kit_id: 'atletico-mg|26-27|TERCEIRA', clube_nome: 'Atlético Mineiro', tipo: 'TERCEIRA', temporada: '26-27', fornecedor: 'Nike', estagio: 'LANCADO', licenciado: 1, lancado_em: hojeMenos(10), mudou_em: hojeMenos(10), veredito: 'GO', score: 80,
    links: [{ titulo: 'Nike Atlético Mineiro 26-27 Manto da Massa Kit Revealed', link: 'https://www.footyheadlines.com/4617508466/nike-atletico-mineiro-26-27-manto-da-massa-kit-revealed.html', fonte: 'footyheadlines.com', estagio: 'LANCADO' }] },
];
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
  if (url.pathname === '/_radar/api/kits') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(RADAR_FAKE.filter((k) => k.estagio === url.searchParams.get('estagio'))));
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

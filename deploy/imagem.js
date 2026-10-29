import { GEO, MOLDURA, SOMBRA, MASCARA } from './assets/mockup-molde.js';
// Processamento de imagem no navegador (canvas + pica): normalização, chroma key,
// alinhamento, ampliação em alta qualidade e logo. Imagens circulam como Blob PNG.

export const PROPORCAO = 766 / 1568;
export const TRABALHO = { w: 880, h: Math.round(880 / PROPORCAO) };
export const EXPORTACAO = {
  alta: { w: 2000, h: Math.round(2000 / PROPORCAO) },
  maxima: { w: 3000, h: Math.round(3000 / PROPORCAO) },
};
const LOGO = { largura: 0.275, margemDireita: 0.07, topo: 0.035 };

const novoCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
const paraBlob = (c, tipo = 'image/png', q) => new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('falha ao gerar imagem'))), tipo, q));

/** Aceita Blob, URL ou data URI e devolve um ImageBitmap. */
export async function bitmap(src) {
  if (src instanceof ImageBitmap) return src;
  if (src instanceof Blob) return createImageBitmap(src);
  if (typeof src === 'string' && /\.svg(\?|$)/.test(src)) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`não consegui carregar a imagem (${r.status})`);
  return createImageBitmap(await r.blob());
}

function desenharCover(img, w, h, opaco = false) {
  const c = novoCanvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  if (opaco) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); } // arte nunca fica com buracos transparentes
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  g.drawImage(img, (img.width - sw) / 2, 0, sw, sh, 0, 0, w, h); // ancorado no topo: preserva a gola
  return c;
}
const dados = (c) => ctx2d(c).getImageData(0, 0, c.width, c.height);

export async function dataURI(src, max = 1024, formato = 'jpeg') {
  const img = await bitmap(src);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = novoCanvas(Math.round(img.width * s), Math.round(img.height * s));
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  if (formato === 'jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(formato === 'png' ? 'image/png' : 'image/jpeg', 0.88);
}

export async function base64ParaBlob(b64) {
  return (await fetch(`data:image/png;base64,${b64}`)).blob();
}

/** Ajusta a saída da IA ao canvas de trabalho (corte ancorado no topo). */
export async function normalizar(src) {
  const img = await bitmap(src);
  const c = desenharCover(img, TRABALHO.w, TRABALHO.h, true);
  return paraBlob(c);
}

export async function miniatura(src, largura = 440, transparente = false) {
  const img = await bitmap(src);
  const c = novoCanvas(largura, Math.round((largura / img.width) * img.height));
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return transparente ? paraBlob(c) : paraBlob(c, 'image/jpeg', 0.85);
}

const CHAVES = [
  { hex: '#00FF00', rgb: [0, 255, 0], nome: 'pure chroma-key green (#00FF00)', k: [1], o: [0, 2] },
  { hex: '#FF00FF', rgb: [255, 0, 255], nome: 'pure magenta (#FF00FF)', k: [0, 2], o: [1] },
  { hex: '#0000FF', rgb: [0, 0, 255], nome: 'pure blue (#0000FF)', k: [2], o: [0, 1] },
  { hex: '#00FFFF', rgb: [0, 255, 255], nome: 'pure cyan (#00FFFF)', k: [1, 2], o: [0] },
];
export const chavePorHex = (hex) => CHAVES.find((c) => c.hex === hex) || CHAVES[0];

/** Escolhe a cor de chroma mais distante das cores do design. */
export async function escolherChave(src) {
  const img = await bitmap(src);
  const c = novoCanvas(160, Math.round((160 / img.width) * img.height));
  ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  const d = dados(c).data;
  let melhor = CHAVES[0], melhorNota = -1;
  for (const k of CHAVES) {
    const dist = [];
    for (let i = 0; i < d.length; i += 4) dist.push(Math.hypot(d[i] - k.rgb[0], d[i + 1] - k.rgb[1], d[i + 2] - k.rgb[2]));
    dist.sort((a, b) => a - b);
    const nota = dist[Math.floor(dist.length * 0.01)];
    if (nota > melhorNota) { melhorNota = nota; melhor = k; }
  }
  return melhor;
}

/** Remove o fundo chroma e devolve PNG RGBA no canvas de trabalho (ou no `tamanho` pedido). */
export async function recortarChroma(src, chave, tamanho = TRABALHO) {
  const { w, h } = tamanho;
  const c = desenharCover(await bitmap(src), w, h);
  const id = dados(c);
  const d = id.data;
  const n = w * h;

  // cor real do fundo gerado: mediana dos pixels parecidos com a chave
  const amostra = [[], [], []];
  for (let i = 0; i < n; i += 7) {
    const p = i * 4;
    if (Math.hypot(d[p] - chave.rgb[0], d[p + 1] - chave.rgb[1], d[p + 2] - chave.rgb[2]) < 110) for (let k = 0; k < 3; k++) amostra[k].push(d[p + k]);
  }
  const mediana = (a) => (a.sort((x, y) => x - y), a[a.length >> 1]);
  const kc = amostra[0].length > 100 ? amostra.map(mediana) : chave.rgb;

  const t0 = 45, t1 = 125;
  const px = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    px[0] = d[p]; px[1] = d[p + 1]; px[2] = d[p + 2];
    const dist = Math.hypot(px[0] - kc[0], px[1] - kc[1], px[2] - kc[2]);
    let a = Math.min(1, Math.max(0, (dist - t0) / (t1 - t0)));
    if (a < 0.04) a = 0;
    if (a > 0 && a < 1) for (let k = 0; k < 3; k++) px[k] = Math.min(255, Math.max(0, (px[k] - (1 - a) * kc[k]) / a));
    if (a > 0) {
      let mk = 255, mo = 0;
      for (const k of chave.k) mk = Math.min(mk, px[k]);
      for (const k of chave.o) mo = Math.max(mo, px[k]);
      const spill = mk - mo;
      if (spill > 0) for (const k of chave.k) px[k] -= spill;
    }
    // pixels transparentes ficam pretos, não com a cor da chave (evita halo ao ampliar)
    if (a === 0) { px[0] = px[1] = px[2] = 0; }
    d[p] = px[0]; d[p + 1] = px[1]; d[p + 2] = px[2]; d[p + 3] = Math.round(a * 255);
  }
  removerCiscos(d, w, h, 60);
  ctx2d(c).putImageData(id, 0, 0);
  return paraBlob(c);
}

function removerCiscos(rgba, w, h, areaMin) {
  const n = w * h;
  const visto = new Uint8Array(n);
  const pilha = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (visto[s] || rgba[s * 4 + 3] < 128) continue;
    let topo = 0;
    const membros = [];
    pilha[topo++] = s; visto[s] = 1;
    while (topo) {
      const p = pilha[--topo];
      membros.push(p);
      const x = p % w;
      const viz = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const v of viz) {
        if (v < 0 || v >= n || visto[v] || rgba[v * 4 + 3] < 128) continue;
        visto[v] = 1; pilha[topo++] = v;
      }
    }
    if (membros.length < areaMin) {
      for (const p of membros) {
        const x = p % w, y = (p / w) | 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) rgba[(yy * w + xx) * 4 + 3] = 0;
        }
      }
    }
  }
}

function caixaAlfa(d, w, h, limiar = 64) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, cont = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > limiar) {
      cont++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { cobertura: cont / (w * h), caixa: x1 < 0 ? null : { x0, y0, x1, y1 } };
}

export async function infoAlfa(src) {
  const img = await bitmap(src);
  const c = novoCanvas(img.width, img.height);
  ctx2d(c).drawImage(img, 0, 0);
  return caixaAlfa(dados(c).data, c.width, c.height);
}

function borrar(d, w, h, r = 2) {
  // box blur separável em RGB
  const tmp = new Float32Array(w * h * 3), out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let s = 0, c = 0;
    for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) { s += d[(y * w + xx) * 4 + k]; c++; } }
    tmp[(y * w + x) * 3 + k] = s / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy >= 0 && yy < h) { s += tmp[(yy * w + x) * 3 + k]; c++; } }
    out[(y * w + x) * 3 + k] = s / c;
  }
  return out;
}

/** Alinha a camada do escudo à posição real dele, usando (com escudo − sem escudo) como gabarito. */
export async function alinharPelaDiferenca(camadaSrc, comSrc, semSrc) {
  const { w, h } = TRABALHO;
  const cam = desenharCover(await bitmap(camadaSrc), w, h);
  const { caixa: cx } = caixaAlfa(dados(cam).data, w, h);
  if (!cx) return { blob: null, ajuste: null };
  const a = borrar(dados(desenharCover(await bitmap(comSrc), w, h)).data, w, h);
  const b = borrar(dados(desenharCover(await bitmap(semSrc), w, h)).data, w, h);
  const lw = cx.x1 - cx.x0, lh = cx.y1 - cx.y0;
  const r = { x0: Math.max(0, cx.x0 - lw * 0.4) | 0, x1: Math.min(w - 1, cx.x1 + lw * 0.4), y0: Math.max(0, cx.y0 - lh * 0.4) | 0, y1: Math.min(h - 1, cx.y1 + lh * 0.4) };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    const p = (y * w + x) * 3;
    if (Math.hypot(a[p] - b[p], a[p + 1] - b[p + 1], a[p + 2] - b[p + 2]) > 60) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { blob: null, ajuste: null };
  const s = ((x1 - x0) / lw + (y1 - y0) / lh) / 2;
  const dx = (x0 + x1) / 2 - (cx.x0 + cx.x1) / 2, dy = (y0 + y1) / 2 - (cx.y0 + cx.y1) / 2;
  if (s < 0.8 || s > 1.25 || Math.abs(dx) > lw * 0.5 || Math.abs(dy) > lh * 0.5) return { blob: null, ajuste: null };
  if (Math.abs(s - 1) < 0.03 && Math.abs(dx) < 4 && Math.abs(dy) < 4) return { blob: null, ajuste: null };
  const out = novoCanvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  const nw = (lw + 1) * s, nh = (lh + 1) * s;
  g.drawImage(cam, cx.x0, cx.y0, lw + 1, lh + 1, (x0 + x1) / 2 - nw / 2, (y0 + y1) / 2 - nh / 2, nw, nh);
  return { blob: await paraBlob(out), ajuste: { escala: +s.toFixed(3), dx: Math.round(dx), dy: Math.round(dy) } };
}

/** Camada sobre xadrez — é assim que os revisores enxergam a transparência. */
export async function sobreXadrez(src, largura = 768) {
  const img = await bitmap(src);
  const c = novoCanvas(largura, Math.round((largura / img.width) * img.height));
  const g = ctx2d(c);
  for (let y = 0; y < c.height; y += 12) for (let x = 0; x < c.width; x += 12) {
    g.fillStyle = ((x + y) / 12) % 2 ? '#bdbdbd' : '#f2f2f2';
    g.fillRect(x, y, 12, 12);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

// ---------- ampliação de alta qualidade (lanczos3 via pica) ----------
let _pica;
const pica = () => (_pica ||= window.pica({ features: ['js', 'wasm', 'ww'] }));

async function resizePica(origem, w, h, nitidez) {
  const destino = novoCanvas(w, h);
  await pica().resize(origem, destino, { filter: 'lanczos3', ...(nitidez ? { unsharpAmount: 60, unsharpRadius: 0.6, unsharpThreshold: 2 } : {}) });
  return destino;
}

/** Amplia para exportação. Com transparência, amplia cor pré-multiplicada e alfa separados (sem halo). */
export async function ampliar(src, { w, h }, transparente = false) {
  const img = await bitmap(src);
  const base = novoCanvas(img.width, img.height);
  ctx2d(base).drawImage(img, 0, 0);
  if (!transparente) return paraBlob(await resizePica(base, w, h, true));

  const id = dados(base);
  const cor = new ImageData(id.width, id.height), alfa = new ImageData(id.width, id.height);
  for (let i = 0; i < id.data.length; i += 4) {
    const a = id.data[i + 3];
    cor.data[i] = (id.data[i] * a) / 255; cor.data[i + 1] = (id.data[i + 1] * a) / 255; cor.data[i + 2] = (id.data[i + 2] * a) / 255; cor.data[i + 3] = 255;
    alfa.data[i] = alfa.data[i + 1] = alfa.data[i + 2] = a; alfa.data[i + 3] = 255;
  }
  const cc = novoCanvas(id.width, id.height); ctx2d(cc).putImageData(cor, 0, 0);
  const ca = novoCanvas(id.width, id.height); ctx2d(ca).putImageData(alfa, 0, 0);
  const [rc, ra] = await Promise.all([resizePica(cc, w, h, true), resizePica(ca, w, h, false)]);
  const dc = dados(rc), da = dados(ra).data;
  for (let i = 0; i < dc.data.length; i += 4) {
    const a = da[i];
    if (a < 2) { dc.data[i] = dc.data[i + 1] = dc.data[i + 2] = 0; dc.data[i + 3] = 0; continue; }
    dc.data[i] = Math.min(255, (dc.data[i] * 255) / a);
    dc.data[i + 1] = Math.min(255, (dc.data[i + 1] * 255) / a);
    dc.data[i + 2] = Math.min(255, (dc.data[i + 2] * 255) / a);
    dc.data[i + 3] = a;
  }
  ctx2d(rc).putImageData(dc, 0, 0);
  return paraBlob(rc);
}

/** Camada full-canvas com o logo gocase na posição do padrão. */
export async function camadaLogo(logoUrl, { w, h }) {
  const img = await bitmap(logoUrl);
  // apara bordas transparentes (logo enviado pelo usuário pode ter margem)
  const t = novoCanvas(img.width || 1000, img.height || 400);
  ctx2d(t).drawImage(img, 0, 0, t.width, t.height);
  const { caixa } = caixaAlfa(dados(t).data, t.width, t.height, 8);
  const cx = caixa || { x0: 0, y0: 0, x1: t.width - 1, y1: t.height - 1 };
  const largura = Math.round(w * LOGO.largura);
  const altura = Math.round(((cx.y1 - cx.y0 + 1) / (cx.x1 - cx.x0 + 1)) * largura);
  const c = novoCanvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  const left = Math.round(w - w * LOGO.margemDireita - largura), top = Math.round(h * LOGO.topo);
  if (/\.svg(\?|$)/.test(logoUrl)) {
    // SVG: rasteriza direto no tamanho final (nítido em qualquer resolução)
    const fx = largura / (cx.x1 - cx.x0 + 1);
    g.drawImage(img, left - cx.x0 * fx, top - cx.y0 * fx, t.width * fx, t.height * fx);
  } else {
    g.drawImage(t, cx.x0, cx.y0, cx.x1 - cx.x0 + 1, cx.y1 - cx.y0 + 1, left, top, largura, altura);
  }
  return paraBlob(c);
}

export async function sobrepor(base, camadas) {
  const b = await bitmap(base);
  const c = novoCanvas(b.width, b.height);
  const g = ctx2d(c);
  g.drawImage(b, 0, 0);
  for (const cam of camadas) g.drawImage(await bitmap(cam), 0, 0, c.width, c.height);
  return paraBlob(c);
}

export async function aparar(src) {
  const img = await bitmap(src);
  const c = novoCanvas(img.width, img.height);
  ctx2d(c).drawImage(img, 0, 0);
  const { caixa } = caixaAlfa(dados(c).data, c.width, c.height, 1);
  if (!caixa) return paraBlob(c);
  const o = novoCanvas(caixa.x1 - caixa.x0 + 1, caixa.y1 - caixa.y0 + 1);
  ctx2d(o).drawImage(c, caixa.x0, caixa.y0, o.width, o.height, 0, 0, o.width, o.height);
  return paraBlob(o);
}

// ---------- mockup na capinha transparente ----------
// Molde gerado por lib/gerar-molde-mockup.cjs: moldura (capinha com a área impressa vazada),
// sombra (luz/relevo da capinha, multiplicada sobre a arte) e máscara da área impressa.
let _molde;
const molde = () => (_molde ||= Promise.all([MOLDURA, SOMBRA, MASCARA].map((u) => bitmap(u))));

/** Arte dentro da capinha transparente; fundo transparente. `largura` reduz para miniaturas. */
export async function mockup(arteSrc, largura = GEO.w) {
  const [moldura, sombra, mascara] = await molde();
  const s = largura / GEO.w;
  const c = novoCanvas(Math.round(GEO.w * s), Math.round(GEO.h * s));
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  const arte = await bitmap(arteSrc);
  const r = GEO.impressao;
  const rw = r.w * s, rh = r.h * s;
  const k = Math.max(rw / arte.width, rh / arte.height);
  const sw = rw / k, sh = rh / k;
  g.drawImage(arte, (arte.width - sw) / 2, 0, sw, sh, r.x * s, r.y * s, rw, rh);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(sombra, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mascara, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(moldura, 0, 0, c.width, c.height);
  return paraBlob(c);
}

// ---------- escudo isolado (aba Gerar escudo) ----------

/** Recorta a região do escudo (caixa em frações 0–1) num quadrado com margem; o que sair da foto fica branco. */
export async function recortarCaixa(src, caixa, margem = 0.12, max = 1536) {
  const img = await bitmap(src);
  const x0 = caixa.x0 * img.width, x1 = caixa.x1 * img.width, y0 = caixa.y0 * img.height, y1 = caixa.y1 * img.height;
  const lado = Math.max(x1 - x0, y1 - y0) * (1 + 2 * margem);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const s = Math.min(1, max / lado);
  const c = novoCanvas(Math.round(lado * s), Math.round(lado * s));
  const g = ctx2d(c);
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  // a origem pode passar da borda da foto: o canvas recorta e ajusta o destino proporcionalmente
  g.drawImage(img, cx - lado / 2, cy - lado / 2, lado, lado, 0, 0, c.width, c.height);
  return paraBlob(c);
}

/** Quadrado com a imagem inteira centralizada (sem cortar); sobra em branco. */
export async function emQuadrado(src, max = 1536) {
  const img = await bitmap(src);
  const lado = Math.max(img.width, img.height);
  const s = Math.min(1, max / lado);
  const c = novoCanvas(Math.round(lado * s), Math.round(lado * s));
  const g = ctx2d(c);
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, ((lado - img.width) / 2) * s, ((lado - img.height) / 2) * s, img.width * s, img.height * s);
  return paraBlob(c);
}

/** PNG transparente lado × lado com o elemento aparado, centralizado, ocupando `ocupacao` do lado maior. */
export async function quadrado(src, lado = 1000, ocupacao = 0.92) {
  const aparado = await aparar(src);
  const img = await bitmap(aparado);
  const s = (lado * ocupacao) / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const redim = await bitmap(await ampliar(aparado, { w, h }, true));
  const c = novoCanvas(lado, lado);
  ctx2d(c).drawImage(redim, Math.round((lado - w) / 2), Math.round((lado - h) / 2));
  return paraBlob(c);
}

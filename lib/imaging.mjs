// Processamento de imagem local: normalização do canvas, chroma key, alinhamento, upscale e logo.
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Proporção da arte Gocase de capa (exemplo aprovado: 766 x 1568).
export const PROPORCAO = 766 / 1568;
export const TRABALHO = { w: 880, h: Math.round(880 / PROPORCAO) }; // resolução de trabalho (≈ nativa da IA)
export const EXPORTACAO = {
  alta: { w: 2000, h: Math.round(2000 / PROPORCAO) },
  maxima: { w: 3000, h: Math.round(3000 / PROPORCAO) },
};

// Posição do logo gocase medida no exemplo aprovado (frações do canvas).
const LOGO = { largura: 0.275, margemDireita: 0.07, topo: 0.035 };

export async function dataURI(entrada, max = 1024, formato = 'jpeg') {
  let img = sharp(entrada).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true });
  img = formato === 'png' ? img.png() : img.flatten({ background: '#fff' }).jpeg({ quality: 88 });
  return `data:image/${formato};base64,${(await img.toBuffer()).toString('base64')}`;
}

/** Ajusta a saída da IA ao canvas de trabalho. Corta pelo topo para preservar a gola. */
export async function normalizar(buf) {
  const meta = await sharp(buf).metadata();
  const desvio = Math.abs(meta.width / meta.height - PROPORCAO) / PROPORCAO;
  const png = await sharp(buf)
    .removeAlpha()
    .resize(TRABALHO.w, TRABALHO.h, { fit: 'cover', position: 'top', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { png, desvio, original: [meta.width, meta.height] };
}

const CHAVES = [
  { hex: '#00FF00', rgb: [0, 255, 0], nome: 'pure chroma-key green (#00FF00)', k: [1], o: [0, 2] },
  { hex: '#FF00FF', rgb: [255, 0, 255], nome: 'pure magenta (#FF00FF)', k: [0, 2], o: [1] },
  { hex: '#0000FF', rgb: [0, 0, 255], nome: 'pure blue (#0000FF)', k: [2], o: [0, 1] },
  { hex: '#00FFFF', rgb: [0, 255, 255], nome: 'pure cyan (#00FFFF)', k: [1, 2], o: [0] },
];

export const chavePorHex = (hex) => CHAVES.find((c) => c.hex === hex) || CHAVES[0];

/** Escolhe a cor de chroma mais distante das cores do design. */
export async function escolherChave(buf) {
  const { data } = await sharp(buf).resize(160).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let melhor = CHAVES[0], melhorNota = -1;
  for (const c of CHAVES) {
    const dists = [];
    for (let i = 0; i < data.length; i += 3) {
      dists.push(Math.hypot(data[i] - c.rgb[0], data[i + 1] - c.rgb[1], data[i + 2] - c.rgb[2]));
    }
    dists.sort((a, b) => a - b);
    const nota = dists[Math.floor(dists.length * 0.01)]; // distância robusta ao pixel mais próximo
    if (nota > melhorNota) { melhorNota = nota; melhor = c; }
  }
  return melhor;
}

/** Remove o fundo chroma e devolve PNG RGBA no canvas de trabalho. */
export async function recortarChroma(buf, chave) {
  const { w, h } = TRABALHO;
  const { data } = await sharp(buf)
    .removeAlpha()
    .resize(w, h, { fit: 'cover', position: 'top' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = w * h;

  // Cor real do fundo gerado (a IA nunca entrega o hex perfeito): mediana dos pixels parecidos.
  const amostra = [[], [], []];
  for (let i = 0; i < n; i += 7) {
    const p = i * 3;
    if (Math.hypot(data[p] - chave.rgb[0], data[p + 1] - chave.rgb[1], data[p + 2] - chave.rgb[2]) < 110) {
      for (let c = 0; c < 3; c++) amostra[c].push(data[p + c]);
    }
  }
  const mediana = (a) => (a.sort((x, y) => x - y), a[a.length >> 1]);
  const kc = amostra[0].length > 100 ? amostra.map(mediana) : chave.rgb;

  const t0 = 45, t1 = 125;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 3, q = i * 4;
    const px = [data[p], data[p + 1], data[p + 2]];
    const d = Math.hypot(px[0] - kc[0], px[1] - kc[1], px[2] - kc[2]);
    let a = Math.min(1, Math.max(0, (d - t0) / (t1 - t0)));
    if (a < 0.04) a = 0;
    if (a > 0 && a < 1) {
      // "despremultiplica" a borda: tira a contribuição da cor de fundo
      for (let c = 0; c < 3; c++) px[c] = Math.min(255, Math.max(0, (px[c] - (1 - a) * kc[c]) / a));
    }
    if (a > 0) {
      // remove o "vazamento" de cor da chave (halo)
      const spill = Math.min(...chave.k.map((c) => px[c])) - Math.max(...chave.o.map((c) => px[c]));
      if (spill > 0) for (const c of chave.k) px[c] -= spill;
    }
    out[q] = px[0]; out[q + 1] = px[1]; out[q + 2] = px[2]; out[q + 3] = Math.round(a * 255);
  }
  removerCiscos(out, w, h, 60);
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Zera componentes opacos muito pequenos (sujeira da IA). */
function removerCiscos(rgba, w, h, areaMin) {
  const n = w * h;
  const visto = new Uint8Array(n);
  const pilha = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (visto[s] || rgba[s * 4 + 3] < 128) continue;
    let topo = 0, cont = 0;
    const membros = [];
    pilha[topo++] = s; visto[s] = 1;
    while (topo) {
      const p = pilha[--topo];
      membros.push(p); cont++;
      const x = p % w;
      for (const v of [p - 1, p + 1, p - w, p + w]) {
        if (v < 0 || v >= n || visto[v]) continue;
        if ((v === p - 1 && x === 0) || (v === p + 1 && x === w - 1)) continue;
        if (rgba[v * 4 + 3] < 128) continue;
        visto[v] = 1; pilha[topo++] = v;
      }
    }
    if (cont < areaMin) {
      for (const p of membros) {
        // limpa também a franja semitransparente em volta
        const x = p % w, y = (p / w) | 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) rgba[(yy * w + xx) * 4 + 3] = 0;
        }
      }
    }
  }
}

/** Fração do canvas coberta pela camada (0..1) e caixa delimitadora. */
export async function infoAlfa(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, cont = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 64) {
      cont++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { cobertura: cont / (w * h), caixa: x1 < 0 ? null : { x0, y0, x1, y1 } };
}

/**
 * Alinha a camada do escudo à posição real do escudo na arte, usando a diferença
 * entre a arte com escudo e sem escudo como gabarito.
 */
export async function alinharPelaDiferenca(camadaPng, comPng, semPng) {
  const { w, h } = TRABALHO;
  const { caixa: cx } = await infoAlfa(camadaPng);
  if (!cx) return { png: camadaPng, ajuste: null };
  const blur = (b) => sharp(b).removeAlpha().blur(2).raw().toBuffer();
  const [a, b] = await Promise.all([blur(comPng), blur(semPng)]);
  const lw = cx.x1 - cx.x0, lh = cx.y1 - cx.y0;
  const r = { x0: Math.max(0, cx.x0 - lw * 0.4), x1: Math.min(w - 1, cx.x1 + lw * 0.4), y0: Math.max(0, cx.y0 - lh * 0.4), y1: Math.min(h - 1, cx.y1 + lh * 0.4) };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = r.y0 | 0; y <= r.y1; y++) for (let x = r.x0 | 0; x <= r.x1; x++) {
    const p = (y * w + x) * 3;
    if (Math.hypot(a[p] - b[p], a[p + 1] - b[p + 1], a[p + 2] - b[p + 2]) > 60) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { png: camadaPng, ajuste: null };
  const dw = x1 - x0, dh = y1 - y0;
  const s = (dw / lw + dh / lh) / 2;
  const dx = (x0 + x1) / 2 - (cx.x0 + cx.x1) / 2, dy = (y0 + y1) / 2 - (cx.y0 + cx.y1) / 2;
  // só corrige desvios plausíveis; fora disso a diferença não é confiável
  if (s < 0.8 || s > 1.25 || Math.abs(dx) > lw * 0.5 || Math.abs(dy) > lh * 0.5) return { png: camadaPng, ajuste: null };
  if (Math.abs(s - 1) < 0.03 && Math.abs(dx) < 4 && Math.abs(dy) < 4) return { png: camadaPng, ajuste: null };
  const recorte = await sharp(camadaPng)
    .extract({ left: cx.x0, top: cx.y0, width: lw + 1, height: lh + 1 })
    .resize(Math.round((lw + 1) * s), Math.round((lh + 1) * s), { kernel: 'lanczos3' })
    .png().toBuffer();
  const meta = await sharp(recorte).metadata();
  const left = Math.round((x0 + x1) / 2 - meta.width / 2), top = Math.round((y0 + y1) / 2 - meta.height / 2);
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: recorte, left: Math.max(0, left), top: Math.max(0, top) }])
    .png().toBuffer();
  return { png, ajuste: { escala: +s.toFixed(3), dx: Math.round(dx), dy: Math.round(dy) } };
}

/** Camada sobre xadrez — é assim que os revisores enxergam a transparência. */
export async function sobreXadrez(png, largura = 640) {
  const meta = await sharp(png).metadata();
  const hh = Math.round((largura / meta.width) * meta.height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${hh}"><defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#bdbdbd"/><rect width="12" height="12" fill="#f2f2f2"/><rect x="12" y="12" width="12" height="12" fill="#f2f2f2"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  const camada = await sharp(png).resize(largura, hh).png().toBuffer();
  const buf = await sharp(Buffer.from(svg)).composite([{ input: camada }]).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** Upscale para exportação (lanczos + nitidez leve). */
export async function ampliar(png, { w, h }) {
  return sharp(png)
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.6, m1: 0.5, m2: 2 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function caminhoLogo(dirDados) {
  const custom = path.join(dirDados, 'logo.png');
  return fs.existsSync(custom) ? custom : path.resolve('assets/logo-gocase.svg');
}

/** Camada full-canvas com o logo gocase na posição do padrão. */
export async function camadaLogo(dirDados, { w, h }) {
  const largura = Math.round(w * LOGO.largura);
  const logo = await sharp(caminhoLogo(dirDados), { density: 600 }).trim().resize(largura).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, left: Math.round(w - w * LOGO.margemDireita - largura), top: Math.round(h * LOGO.topo) }])
    .png().toBuffer();
}

export async function sobrepor(base, camadas) {
  return sharp(base).composite(camadas.map((input) => ({ input }))).png({ compressionLevel: 9 }).toBuffer();
}

export async function aparar(png) {
  return sharp(png).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toBuffer();
}

// ---------- mockup na capinha transparente ----------
// Molde gerado por lib/gerar-molde-mockup.cjs: moldura (capinha com a área impressa vazada),
// sombra (luz/relevo da capinha, multiplicada sobre a arte) e máscara da área impressa.
const MOLDE = {
  geo: JSON.parse(fs.readFileSync(path.resolve('assets/mockup/geo.json'), 'utf8')),
  moldura: path.resolve('assets/mockup/moldura.png'),
  sombra: path.resolve('assets/mockup/sombra.jpg'),
  mascara: path.resolve('assets/mockup/mascara.png'),
};

/** Arte (já com logo, se for o caso) dentro da capinha transparente. Devolve PNG com fundo transparente. */
export async function mockup(artePng) {
  const { w, h, impressao: r } = MOLDE.geo;
  const arte = await sharp(artePng).resize(r.w, r.h, { fit: 'cover', position: 'top', kernel: 'lanczos3' }).png().toBuffer();
  const impressa = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: arte, left: r.x, top: r.y }])
    .png().toBuffer();
  const sombreada = await sharp(impressa)
    .composite([{ input: MOLDE.sombra, blend: 'multiply' }, { input: MOLDE.mascara, blend: 'dest-in' }])
    .png().toBuffer();
  return sharp(sombreada).composite([{ input: MOLDE.moldura }]).png({ compressionLevel: 9 }).toBuffer();
}

// Gera o molde do mockup a partir de um template com a área impressa em verde (#00FF00)
// e o fundo em magenta (#FF00FF) — feito pela IA a partir da foto do produto.
// Uso: node lib/gerar-molde-mockup.cjs <template.png> <saida-js>
const sharp = require('sharp'); const fs = require('fs');
const [, , TEMPLATE, SAIDA_JS] = process.argv;
const clamp = (v) => Math.min(1, Math.max(0, v));
(async () => {
  const { data, info } = await sharp(TEMPLATE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, n = W * H;
  const dist = (p, c) => Math.hypot(data[p] - c[0], data[p + 1] - c[1], data[p + 2] - c[2]);
  const fundo = new Float32Array(n), impressao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    fundo[i] = 1 - clamp((dist(p, [255, 0, 255]) - 60) / 90); // 1 = fundo magenta
    impressao[i] = 1 - clamp((dist(p, [0, 255, 0]) - 70) / 100); // 1 = área impressa verde
  }
  // caixa da área impressa
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (impressao[y * W + x] > 0.5) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  // recorte final: só a capinha, com margem
  const m = 12, cx0 = Math.max(0, x0 - 60), cy0 = Math.max(0, y0 - 60);
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fundo[y * W + x] < 0.5) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const crop = { left: Math.max(0, bx0 - m), top: Math.max(0, by0 - m) };
  crop.width = Math.min(W, bx1 + m) - crop.left; crop.height = Math.min(H, by1 + m) - crop.top;

  const moldura = Buffer.alloc(n * 4), mascara = Buffer.alloc(n * 4), sombra = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    let r = data[p], g = data[p + 1], b = data[p + 2];
    // tira o vazamento de magenta (borda transparente) e de verde (contorno da impressão)
    const sm = Math.min(r, b) - g; if (sm > 0) { r -= sm; b -= sm; }
    const sv = g - Math.max(r, b); if (sv > 0) g -= sv;
    const a = (1 - fundo[i]) * (1 - impressao[i]);
    moldura[i * 4] = r; moldura[i * 4 + 1] = g; moldura[i * 4 + 2] = b; moldura[i * 4 + 3] = Math.round(a * 255);
    mascara[i * 4] = mascara[i * 4 + 1] = mascara[i * 4 + 2] = 255; mascara[i * 4 + 3] = Math.round(impressao[i] * 255);
  }
  // sombra: leve escurecimento junto às bordas da área impressa (profundidade sob a capinha)
  const borrada = await sharp(Buffer.from(Float32Array.from(impressao, (v) => v * 255).map(Math.round)), { raw: { width: W, height: H, channels: 1 } })
    .blur(9).raw().toBuffer();
  for (let i = 0; i < n; i++) {
    const v = Math.round(255 - 70 * (1 - borrada[i] / 255));
    sombra[i * 3] = sombra[i * 3 + 1] = sombra[i * 3 + 2] = v;
  }
  const raw = (b, ch) => sharp(b, { raw: { width: W, height: H, channels: ch } }).extract(crop);
  const molduraPng = await raw(moldura, 4).png({ compressionLevel: 9 }).toBuffer();
  const sombraJpg = await raw(sombra, 3).jpeg({ quality: 90 }).toBuffer();
  const mascaraPng = await raw(mascara, 4).png({ compressionLevel: 9 }).toBuffer();
  const geo = { w: crop.width, h: crop.height, impressao: { x: x0 - crop.left, y: y0 - crop.top, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
  fs.writeFileSync('assets/mockup/moldura.png', molduraPng);
  fs.writeFileSync('assets/mockup/sombra.jpg', sombraJpg);
  fs.writeFileSync('assets/mockup/mascara.png', mascaraPng);
  fs.writeFileSync('assets/mockup/geo.json', JSON.stringify(geo));
  const uri = (b, t) => `data:${t};base64,${b.toString('base64')}`;
  fs.writeFileSync(SAIDA_JS, `// Molde do mockup (iPhone 16 · capinha SlimAir): gerado por lib/gerar-molde-mockup.cjs\nexport const GEO = ${JSON.stringify(geo)};\nexport const MOLDURA = "${uri(molduraPng, 'image/png')}";\nexport const SOMBRA = "${uri(sombraJpg, 'image/jpeg')}";\nexport const MASCARA = "${uri(mascaraPng, 'image/png')}";\n`);
  console.log(geo, 'moldura', molduraPng.length, 'sombra', sombraJpg.length, 'mascara', mascaraPng.length);
})();

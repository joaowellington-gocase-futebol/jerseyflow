// Todos os textos enviados aos modelos. Prompts de imagem em inglês (o modelo segue melhor);
// prompts dos agentes em português, com saída JSON.
// Três modelos de arte: 'frente' (camisa de frente), 'escudo' (escudo estourado) e 'costas'.

export const MODELOS_ARTE = {
  frente: { nome: 'Frente', rotulos: { com: 'Com escudo', sem: 'Sem escudo' }, arquivos: { com: 'frente_com_escudo', sem: 'frente_sem_escudo' } },
  escudo: { nome: 'Escudo estourado', rotulos: { com: 'Escudo estourado', sem: 'Só o fundo' }, arquivos: { com: 'escudo_estourado', sem: 'escudo_estourado_fundo' } },
  costas: { nome: 'Costas', rotulos: { com: 'Costas', sem: 'Costas sem nome e número' }, arquivos: { com: 'costas', sem: 'costas_sem_nome_numero' } },
};

const BASE_GOCASE = `- One single flat artwork filling the ENTIRE portrait canvas edge to edge (aspect ratio about 1:2.05), like a phone-case print. No mannequin, hanger, person, background, outer shadow, border, mockup or phone.
- A full RECTANGLE with square corners: the pattern fills every corner and the camera area. No rounded corners, no holes, no white or transparent areas — even if an example is shown cut in the phone-case shape.
- Keep the top-right area (x 62-95%, y 2-9%) free of important details: the gocase logo is added there in post-production. The top-left corner is the phone camera area: no important details there.
- Premium sports fabric look: subtle micro-perforated dry-fit texture, very soft natural folds and lighting, faithful saturated colors, crisp sharp edges, print-ready.
- No watermark.`;

export const PADRAO = {
  frente: `GOCASE JERSEY ARTWORK STANDARD — FRONT (mandatory):
- Flat, front-facing view of the jersey torso. The collar is centered at the very top edge (partially cut by the top edge); the shoulder seams/trims sweep in an arc across the two top corners; the body pattern continues to the bottom edge. Sleeves are not visible.
- Crest position follows the REAL uniform: if the crest is on the wearer's left chest, place it on the RIGHT side of the image (crest center at about 77% of the width and 25% of the height); if the real uniform has it centered on the chest, keep it centered below the collar. Crest width about 22-28% of the canvas width; star(s) directly above it if the club uses them.
- No text, no numbers or names.
${BASE_GOCASE}`,
  escudo: `GOCASE JERSEY ARTWORK STANDARD — BIG CREST ("escudo estourado") (mandatory):
- Background: ONLY the jersey body pattern (same stripes/colors/proportions and fabric texture as the uniform), seen flat, filling the whole canvas. ABSOLUTELY NO collar, NO neckline, NO shoulder seams or trims, no sleeves: the stripes simply continue straight up to the top edge.
- The club crest, greatly enlarged, perfectly centered horizontally, its center at about 50% of the height, crest width about 68-75% of the canvas width. Faithful shape, colors and lettering, very sharp. It may have the subtle embroidered/printed texture of a real crest.
- Nothing else: no small crest, no stars unless they are part of the crest design, no text, no numbers, no names.
${BASE_GOCASE}`,
  costas: `GOCASE JERSEY ARTWORK STANDARD — BACK (mandatory):
- Flat view of the BACK of the jersey torso. At the very top: the back of the collar/neckline (if visible on the real jersey) and the shoulder seams/trims sweeping in an arc across the two top corners; the back body pattern continues to the bottom edge. Sleeves are not visible.
- No front elements: no front crest on the chest, no front sponsor.
- A small club crest centered near the bottom (center at about 87% of the height, width about 22% of the canvas), like the approved Gocase back example.
${BASE_GOCASE}`,
};
// compatibilidade com a versão anterior
export const PADRAO_GOCASE = PADRAO.frente;

export const SISTEMA_ANALISE = `Você é o diretor de arte da Gocase especializado em capinhas de camisas de futebol.
Analise as referências de um uniforme e devolva SOMENTE um JSON neste formato:
{
  "identificacao": "clube + modelo provável, ex.: 'Flamengo — camisa I 2025'",
  "descricao_en": "descrição detalhada EM INGLÊS da FRENTE do uniforme, para um gerador de imagem: cor base, padrão (listras, faixas, gradientes) com proporções e posições, gola (tipo, cores, frisos), ombros/mangas (frisos, listras), textura, detalhes. NÃO descreva logos de fornecedor nem patrocinadores aqui.",
  "costas_en": "descrição detalhada EM INGLÊS das COSTAS do uniforme (gola/nuca vista de trás, frisos de ombro, padrão das costas, detalhes); se não houver foto das costas, deduza das outras referências e diga isso",
  "escudo_en": "descrição EM INGLÊS do escudo (forma, letras/monograma, cores) e de estrelas acima dele; vazio se não houver escudo",
  "tem_escudo": true,
  "posicao_escudo": "peito_esquerdo" ou "centro" (como no uniforme real),
  "nome_numero": {"nome": "nome impresso nas costas na referência, ou vazio", "numero": "número nas costas na referência, ou vazio", "estilo_en": "descrição EM INGLÊS da fonte do nome e do número: formato das letras/algarismos, cores, contornos, detalhes internos (ex.: escudo pequeno dentro do número) — vazio se não houver"},
  "cores": [{"hex": "#000000", "nome": "preto"}],
  "marcas_fornecedor": ["logos de fabricante de material esportivo visíveis, ex.: 'adidas (logo performance no peito)'"],
  "patrocinios": ["patrocinadores visíveis, inclusive dentro do número das costas"],
  "camadas": [
    {"id": "gola_ombros", "nome": "Gola e ombros", "isolar_en": "the collar and the shoulder trims/stripes"},
    {"id": "escudo", "nome": "Escudo", "isolar_en": "the club crest and the star(s) above it"}
  ],
  "alertas": ["avisos úteis em português, ex.: escudo com baixa resolução na referência"]
}
Regras para "camadas" (valem para a arte da FRENTE): sempre inclua "gola_ombros" e, se houver escudo, "escudo". Acrescente no máximo 4 camadas extras apenas para elementos gráficos destacáveis que estarão na arte final (ex.: faixa diagonal, gola interna, patch, detalhe de manga, patrocínio quando ele deve ser mantido). O fundo/corpo da camisa é tratado automaticamente: NÃO inclua "fundo". Os ids devem ser snake_case sem acento.
Marcas de fornecedor e patrocinadores NÃO viram camada quando forem removidos.`;

export function textoAnalise({ papeis, notas, opcoes }) {
  return `Imagens enviadas, na ordem:
${papeis.map((p, i) => `- Imagem ${i + 1}: ${p}`).join('\n')}

Modelo de arte pedido: ${MODELOS_ARTE[opcoes.modelo || 'frente'].nome}.
Opções do pedido: ${opcoes.removerFornecedor ? 'REMOVER logos de fornecedor' : 'MANTER logos de fornecedor'}; ${opcoes.removerPatrocinio ? 'REMOVER patrocinadores' : 'MANTER patrocinadores'}.
${notas ? `Observações do designer: ${notas}` : ''}
Analise o uniforme (as imagens de estilo Gocase servem só de contexto de formato).`;
}

function regrasMarcas(opcoes, analise) {
  const r = [];
  if (opcoes.removerFornecedor) {
    r.push(`Do NOT include any sportswear manufacturer logo${analise.marcas_fornecedor?.length ? ` (${analise.marcas_fornecedor.join(', ')})` : ''}: fill those spots with the surrounding fabric. Design trims such as shoulder stripes are part of the uniform and must be kept.`);
  }
  if (opcoes.removerPatrocinio) {
    r.push(`Do NOT include sponsors${analise.patrocinios?.length ? ` (${analise.patrocinios.join(', ')})` : ''}, not even inside the name or number: fill those spots with the surrounding fabric or the plain number color.`);
  }
  return r.join('\n');
}

/** Nome e número que vão nas costas (null = sem nome/número). */
export function nomeNumero(opcoes, analise) {
  if ((opcoes.modelo || 'frente') !== 'costas' || !opcoes.nomeNumero) return null;
  const ref = analise.nome_numero || {};
  const nome = (opcoes.nome || ref.nome || '').trim();
  const numero = String(opcoes.numero || ref.numero || '').trim();
  if (!nome && !numero) return null;
  return { nome, numero, estilo: ref.estilo_en || '' };
}

function blocoNomeNumero(nn) {
  if (!nn) return 'NO player name and NO number on the back.';
  return `PLAYER NAME AND NUMBER on the back, centered horizontally:
${nn.nome ? `- Name "${nn.nome.toUpperCase()}" in an arc-free straight line, centered, its center at about 33% of the height, letter height about 4% of the canvas height.` : '- No name.'}
${nn.numero ? `- Number "${nn.numero}" big, centered, spanning from about 38% to 72% of the height (height about 34% of the canvas).` : '- No number.'}
- Typography: ${nn.estilo ? `reproduce EXACTLY the club's official name/number font from the reference: ${nn.estilo}` : "use the club's official name/number font style, clean and bold"}. Exact spelling, crisp edges, no extra text.`;
}

export function promptArte({ papeisImagens, analise, opcoes, notas }) {
  const modelo = opcoes.modelo || 'frente';
  const crest = analise.tem_escudo ? `CREST: ${analise.escudo_en}. Reproduce it faithfully, sharp and undistorted.` : 'This uniform has no crest.';
  let alvo;
  if (modelo === 'escudo') {
    alvo = `BODY PATTERN TO REPRODUCE (use ONLY its stripes/colors/fabric texture — IGNORE any collar, neckline, sleeve or trim it mentions): ${analise.descricao_en}\n${crest} Enlarge it as the hero element ("escudo estourado").\nThe top edge of the canvas shows only the stripes: there is NO collar and NO shoulder trim anywhere.`;
  } else if (modelo === 'costas') {
    alvo = `BACK OF THE UNIFORM TO REPRODUCE: ${analise.costas_en || analise.descricao_en}\nFront details for reference only (colors/pattern): ${analise.descricao_en}\n${crest} Use it small, near the bottom.\n${blocoNomeNumero(nomeNumero(opcoes, analise))}`;
  } else {
    alvo = `UNIFORM TO REPRODUCE: ${analise.descricao_en}\n${analise.tem_escudo ? `${crest} On the real uniform the crest is ${analise.posicao_escudo === 'centro' ? 'CENTERED on the chest, right below the collar — keep it centered' : "on the wearer's left chest — place it on the RIGHT side of the image"}.` : crest}`;
  }
  return `Create a new Gocase phone-case jersey artwork — model: ${MODELOS_ARTE[modelo].nome.toUpperCase()}.

IMAGE ROLES:
${papeisImagens}

${alvo}
${regrasMarcas(opcoes, analise)}

${PADRAO[modelo]}
Do NOT draw the white "gocase" logo sticker, the phone, the camera cut-out or any mockup element that may appear in the style examples.
${notas ? `Designer notes: ${notas}` : ''}`;
}

export function promptCorrecao({ papeisImagens, correcoes, opcoes, analise }) {
  const modelo = opcoes.modelo || 'frente';
  return `Image 1 is the current draft of a Gocase phone-case jersey artwork (model: ${MODELOS_ARTE[modelo].nome}). Keep its exact canvas, framing, composition and everything that is already correct. Fix ONLY these problems:
${correcoes.map((c) => `- ${c}`).join('\n')}

Other images:
${papeisImagens}

${modelo === 'costas' ? blocoNomeNumero(nomeNumero(opcoes, analise)) : ''}
${regrasMarcas(opcoes, analise)}
${PADRAO[modelo]}`;
}

/** O que a versão "sem" remove, por modelo. */
export function alvoRemocao(opcoes, analise) {
  const modelo = opcoes.modelo || 'frente';
  if (modelo === 'costas' && nomeNumero(opcoes, analise)) {
    return { en: 'the player name and the number (including all their outlines and inner details)', pt: 'o nome e o número' };
  }
  if (modelo === 'escudo') return { en: 'the big centered club crest', pt: 'o escudo grande' };
  if (modelo === 'costas') return { en: 'the club crest centered near the bottom edge', pt: 'o escudo pequeno da base' };
  return { en: `the club crest${analise.escudo_en?.toLowerCase().includes('star') ? ' and the star(s) above it' : ' and any star(s) above it'}`, pt: 'o escudo e as estrelas' };
}

export function promptRemover({ alvo, opcoes, correcoes = [] }) {
  return `Image 1 is a finished Gocase jersey artwork. Produce the exact same artwork with ${alvo.en} completely removed${opcoes.removerFornecedor ? ', and also any sportswear brand logo' : ''}. Fill those areas with the continuing jersey pattern and fabric texture so it looks like they never existed — no ghost, outline or smudge.
Everything else must stay identical: same canvas size, framing, scale, colors, stripes/pattern positions, collar, trims, texture and lighting.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
}
// compatibilidade com a versão anterior
export const promptSemEscudo = ({ opcoes, analise, correcoes }) => promptRemover({ alvo: alvoRemocao({ ...opcoes, modelo: 'frente' }, analise), opcoes, correcoes });

export function promptIsolar({ camada, outras, chave, correcoes = [] }) {
  return `Image 1 is a finished jersey artwork. Produce the SAME canvas (identical size, framing and scale) where ONLY ${camada.isolar_en} remain(s), identical in shape, colors, details, position and scale.
Replace absolutely everything else — the jersey body fabric, the stripes/pattern${outras.length ? `, ${outras.join(', ')}` : ''} — with a perfectly flat, uniform ${chave.nome} background. The ${chave.hex} area must have no texture, no gradient, no shadow, no noise. Do not add outlines, glows or anything new.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
}

export function promptFundo({ removidos, correcoes = [] }) {
  return `Image 1 is a jersey artwork. Remove ${removidos.join(', ')} and recreate the plain jersey body underneath: continue the body pattern (stripes/colors) and the fabric texture seamlessly over those areas, up to the top edge and across the whole canvas, so only the plain body pattern remains, full-bleed.
Keep the body pattern exactly in the same positions, colors and proportions. Same canvas size, framing and scale. No crest, no logos, no collar, no trims, no names or numbers.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
}

/** Camadas a separar em cada modelo. */
export function camadasDoModelo(opcoes, analise) {
  const modelo = opcoes.modelo || 'frente';
  if (modelo === 'escudo') return analise.tem_escudo === false ? [] : [{ id: 'escudo', nome: 'Escudo', isolar_en: 'the big centered club crest' }];
  if (modelo === 'costas') {
    const c = [{ id: 'gola_ombros', nome: 'Gola e ombros (costas)', isolar_en: 'the back collar/neckline trim and the shoulder trims/stripes' }];
    if (nomeNumero(opcoes, analise)) c.push({ id: 'nome_numero', nome: 'Nome e número', isolar_en: 'the player name and the number (with all their outlines and inner details)' });
    if (analise.tem_escudo !== false) c.push({ id: 'escudo', nome: 'Escudo', isolar_en: 'the club crest centered near the BOTTOM edge of the artwork (at about 87% of the height, about 22% of the canvas width) — NOT the tiny monogram inside the number' });
    return c;
  }
  return analise.camadas;
}

// ---------- Agentes revisores ----------

export function sistemaRevisor(papel, foco) {
  return `Você é o ${papel} do controle de qualidade das artes de capinhas de celular de camisas de futebol da Gocase.
Seu foco: ${foco}
Seja rigoroso, porém justo. Responda SOMENTE um JSON:
{
  "nota": 0-10,
  "aprovado": true|false,
  "problemas": ["problemas concretos em português, do mais grave ao menos grave"],
  "correcoes_en": ["instruções curtas e imperativas EM INGLÊS para o editor de imagem corrigir cada problema"]
}
Aprove (aprovado=true) somente com nota >= 7 e nenhum problema grave. Se aprovado, "correcoes_en" pode ficar vazio.`;
}

const NAO_PENALIZE = `Não penalize: a estilização para arte plana de capinha, a textura de tecido, a remoção intencional de logos de fornecedor/patrocinadores, nem a ausência do logo "gocase" (ele entra depois). Frisos/listras de ombro e gola fazem parte do design e devem existir.`;

const CHECKLIST = {
  frente: `- Vista frontal plana ocupando 100% do quadro vertical, sem manequim, fundo, borda, sombra externa ou mockup.
- Gola centralizada no topo cortada pela borda; frisos dos ombros em arco nos cantos superiores; sem mangas.
- Escudo na altura do peito, em escala parecida com a das aprovadas. Posição: a mesma do uniforme real (lado DIREITO da imagem quando o escudo fica no peito esquerdo de quem veste; centralizado quando o uniforme real é assim — nesse caso centralizado está CORRETO).
- Sem texto, nomes ou números.`,
  escudo: `- Fundo com o padrão do corpo da camisa ocupando 100% do quadro, SEM gola, sem frisos de ombro e sem mangas — gola ou frisos aparecendo é problema GRAVE (reprove).
- As listras/padrão seguem retas até a borda de cima.
- Escudo GRANDE ("estourado"), centralizado na horizontal, por volta do meio da altura, ocupando ~70% da largura.
- Nenhum outro elemento: sem escudo pequeno, sem texto, nomes ou números.`,
  costas: `- Vista das COSTAS plana ocupando 100% do quadro, com a nuca/gola de trás e os frisos dos ombros no topo; sem mangas.
- Sem elementos da frente (escudo no peito, patrocínio da frente).
- Escudo pequeno centralizado perto da base, como no exemplo aprovado de costas.
- Nome e número (quando pedidos) centralizados, nome acima do número, número grande na região central.`,
};

export function revisoresArte(modelo = 'frente') {
  return [
    {
      papel: 'Revisor 1 — Fidelidade ao uniforme',
      foco: modelo === 'costas'
        ? 'comparar a arte com as referências do uniforme real: cores exatas, padrão das costas, gola de trás, frisos de ombro, escudo e — quando pedidos — o nome e o número (grafia exata e fonte igual à da referência).'
        : 'comparar a arte com as referências do uniforme real: cores exatas, padrão e proporção das listras/faixas, gola (formato e cores), frisos de ombro, escudo (forma, letras, cores, estrelas).',
      texto: ({ papeis, opcoes, nn }) => `Imagens, na ordem:
${papeis}
A ÚLTIMA imagem é a arte candidata (modelo: ${MODELOS_ARTE[modelo].nome}).
${opcoes.removerFornecedor ? 'Logos de fornecedor DEVEM estar ausentes — se aparecerem, é problema grave.' : ''}
${opcoes.removerPatrocinio ? 'Patrocinadores DEVEM estar ausentes (inclusive dentro do número) — se aparecerem, é problema grave.' : ''}
${NAO_PENALIZE}
${modelo === 'frente' ? 'Imagens de COSTAS servem só para entender o uniforme: números, nomes e estampas da nuca NÃO devem aparecer na arte (que é a frente).' : ''}
${modelo === 'costas' ? (nn ? `Nome e número pedidos: ${nn.nome ? `nome "${nn.nome.toUpperCase()}"` : 'sem nome'}, ${nn.numero ? `número "${nn.numero}"` : 'sem número'}. Grafia errada ou fonte muito diferente da referência é problema grave.` : 'NÃO deve haver nome nem número nas costas.') : ''}
${modelo === 'escudo' ? 'O escudo deve ser fiel ao oficial (forma, letras, cores), só que grande.' : ''}
Penalize forte: cor errada, padrão errado, escudo deformado/errado, letras distorcidas.`,
    },
    {
      papel: 'Revisor 2 — Padrão Gocase',
      foco: `verificar se a arte segue o padrão visual das artes aprovadas da Gocase para o modelo ${MODELOS_ARTE[modelo].nome}: enquadramento, posição e escala dos elementos, áreas reservadas (logo no canto superior direito, câmera no superior esquerdo), acabamento e qualidade de impressão.`,
      texto: ({ papeis }) => `Imagens, na ordem:
${papeis}
A ÚLTIMA imagem é a arte candidata; as anteriores marcadas como arte Gocase são APROVADAS (referência de padrão, não de cores). Algumas podem estar aplicadas numa capinha — ignore o celular e a câmera delas.
Checklist do modelo ${MODELOS_ARTE[modelo].nome}:
${CHECKLIST[modelo]}
- Retângulo cheio: o padrão preenche os 4 cantos; cantos arredondados, buraco de câmera, áreas brancas ou vazias são problema GRAVE (reprove).
- Canto superior direito livre para o logo gocase; nada importante no canto superior esquerdo (câmera).
- Sem marca d'água, logos de marca esportiva ou artefatos de IA (letras tortas, assimetrias estranhas, borrões).
- Nitidez e acabamento prontos para impressão.
${NAO_PENALIZE}`,
    },
  ];
}

export function revisoresRemocao(alvo) {
  return [
    {
      papel: `Revisor 1 — Remoção (${alvo.pt})`,
      foco: `confirmar que ${alvo.pt} foi removido por completo, sem fantasma, contorno ou mancha, com o tecido preenchido naturalmente.`,
      texto: () => `Imagem 1: arte original. Imagem 2: versão candidata sem ${alvo.pt}.
Verifique se não sobrou nenhum vestígio de ${alvo.pt} ou de logos de marca esportiva, e se o preenchimento continua o padrão do tecido.`,
    },
    {
      papel: 'Revisor 2 — Consistência com a arte',
      foco: 'confirmar que todo o resto da arte ficou idêntico: cores, posição das listras, gola, frisos, enquadramento, textura e qualidade.',
      texto: () => `Imagem 1: arte original. Imagem 2: versão candidata sem ${alvo.pt}.
Fora a região removida, as duas devem ser praticamente idênticas. Penalize qualquer mudança de enquadramento, cor, padrão, gola ou perda de nitidez.`,
    },
  ];
}

export const REVISORES = {
  arte: revisoresArte('frente'),
  semEscudo: revisoresRemocao({ pt: 'o escudo e as estrelas' }),
  camada: [
    {
      papel: 'Revisor 1 — Completude do elemento',
      foco: 'confirmar que a camada contém o elemento inteiro, idêntico ao da arte (forma, cores, detalhes, posição e escala), sem partes faltando ou cortadas.',
      texto: ({ camada }) => `Imagem 1: arte completa. Imagem 2: camada isolada "${camada.nome}" (${camada.isolar_en}) sobre fundo xadrez (xadrez = transparente).
O elemento na camada deve corresponder ao da arte, na mesma posição.`,
    },
    {
      papel: 'Revisor 2 — Limpeza para produção',
      foco: 'confirmar que a camada contém SOMENTE o elemento pedido, com bordas limpas, sem halo colorido, sem restos de outros elementos ou do fundo, pronta para impressão.',
      texto: ({ camada }) => `Imagem 1: arte completa. Imagem 2: camada isolada "${camada.nome}" (${camada.isolar_en}) sobre fundo xadrez (xadrez = transparente).
Penalize: pedaços do corpo da camisa ou de outros elementos, halo verde/magenta/azul nas bordas, fragmentos soltos, bordas serrilhadas ou borradas.`,
    },
  ],
  fundo: [
    {
      papel: 'Revisor 1 — Fidelidade do fundo',
      foco: 'confirmar que o fundo mantém o padrão do corpo da camisa idêntico (cores, posição e proporção das listras, textura).',
      texto: () => `Imagem 1: arte de referência. Imagem 2: camada de FUNDO candidata (só o corpo da camisa, sem gola, frisos, escudo, nome ou número).
O padrão do corpo deve coincidir com o da imagem 1.`,
    },
    {
      papel: 'Revisor 2 — Limpeza do fundo',
      foco: 'confirmar que o fundo não tem gola, frisos de ombro, escudo, nome, número, logos ou outros elementos, e que cobre o quadro inteiro de forma contínua.',
      texto: () => `Imagem 1: arte de referência. Imagem 2: camada de FUNDO candidata.
Penalize: restos de gola/frisos/escudo/nome/número/logos, emendas visíveis, áreas vazias ou borradas, mudança de enquadramento.`,
    },
  ],
};

export const SISTEMA_PRESENCA = `Você confere quais elementos gráficos estão visíveis numa arte de camisa.
Responda SOMENTE JSON: {"presentes": ["ids"], "ausentes": ["ids"]}.
Um elemento só está presente se dá para vê-lo claramente na arte.`;

export const SISTEMA_GOLA = `Você confere uma arte de capinha. Responda SOMENTE JSON: {"tem_gola": true|false}.
tem_gola = true se aparecer gola, decote, nuca ou frisos de ombro de camisa em qualquer parte da arte.`;
export const PROMPT_SEM_GOLA = `Image 1 is a finished jersey artwork. Remove the collar/neckline and any shoulder seams or trims completely: continue the body stripes/pattern and fabric texture straight up to the top edge, as if they never existed. Keep EVERYTHING else identical — especially the big crest (shape, colors, position, size), the stripes positions, colors, texture and framing.`;

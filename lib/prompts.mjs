// Todos os textos enviados aos modelos. Prompts de imagem em inglês (o modelo segue melhor);
// prompts dos agentes em português, com saída JSON.

export const PADRAO_GOCASE = `GOCASE JERSEY ARTWORK STANDARD (mandatory):
- One single flat, front-facing view of the jersey filling the ENTIRE portrait canvas edge to edge (aspect ratio about 1:2.05), like a phone-case print. No mannequin, hanger, person, background, outer shadow, border, mockup or phone.
- Framing: close crop of the jersey torso. The collar is centered at the very top edge (partially cut by the top edge); the shoulder seams/trims sweep in an arc across the two top corners; the body pattern continues to the bottom edge. Sleeves are not visible.
- Crest position follows the REAL uniform: if the crest is on the wearer's left chest, place it on the RIGHT side of the image (crest center at about 77% of the width and 25% of the height); if the real uniform has it centered on the chest, keep it centered below the collar. Crest width about 22-28% of the canvas width; star(s) directly above it if the club uses them.
- Keep the top-right area (x 62-95%, y 2-9%) free of the crest and important details: the gocase logo is added there in post-production. The top-left corner is the phone camera area: no important details there.
- Premium sports fabric look: subtle micro-perforated dry-fit texture, very soft natural folds and lighting, faithful saturated colors, crisp sharp edges, print-ready.
- No text, no watermark, no numbers or names unless requested.`;

export const SISTEMA_ANALISE = `Você é o diretor de arte da Gocase especializado em capinhas de camisas de futebol.
Analise as referências de um uniforme e devolva SOMENTE um JSON neste formato:
{
  "identificacao": "clube + modelo provável, ex.: 'Flamengo — camisa I 2025'",
  "descricao_en": "descrição detalhada EM INGLÊS do uniforme, para um gerador de imagem: cor base, padrão (listras, faixas, gradientes) com proporções e posições, gola (tipo, cores, frisos), ombros/mangas (frisos, listras), textura, detalhes. NÃO descreva logos de fornecedor nem patrocinadores aqui.",
  "escudo_en": "descrição EM INGLÊS do escudo (forma, letras/monograma, cores) e de estrelas acima dele; vazio se não houver escudo",
  "tem_escudo": true,
  "posicao_escudo": "peito_esquerdo" ou "centro" (como no uniforme real),
  "cores": [{"hex": "#000000", "nome": "preto"}],
  "marcas_fornecedor": ["logos de fabricante de material esportivo visíveis, ex.: 'adidas (logo performance no peito)'"],
  "patrocinios": ["patrocinadores visíveis"],
  "camadas": [
    {"id": "gola_ombros", "nome": "Gola e ombros", "isolar_en": "the collar and the shoulder trims/stripes"},
    {"id": "escudo", "nome": "Escudo", "isolar_en": "the club crest and the star(s) above it"}
  ],
  "alertas": ["avisos úteis em português, ex.: escudo com baixa resolução na referência"]
}
Regras para "camadas": sempre inclua "gola_ombros" e, se houver escudo, "escudo". Acrescente no máximo 4 camadas extras apenas para elementos gráficos destacáveis que estarão na arte final (ex.: faixa diagonal, gola interna, patch, detalhe de manga, patrocínio quando ele deve ser mantido). O fundo/corpo da camisa é tratado automaticamente: NÃO inclua "fundo". Os ids devem ser snake_case sem acento.
Marcas de fornecedor e patrocinadores NÃO viram camada quando forem removidos.`;

export function textoAnalise({ papeis, notas, opcoes }) {
  return `Imagens enviadas, na ordem:
${papeis.map((p, i) => `- Imagem ${i + 1}: ${p}`).join('\n')}

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
    r.push(`Do NOT include sponsors${analise.patrocinios?.length ? ` (${analise.patrocinios.join(', ')})` : ''}: fill those spots with the surrounding fabric.`);
  }
  return r.join('\n');
}

export function promptArte({ papeisImagens, analise, opcoes, notas }) {
  return `Create a new Gocase phone-case jersey artwork.

IMAGE ROLES:
${papeisImagens}

UNIFORM TO REPRODUCE: ${analise.descricao_en}
${analise.tem_escudo ? `CREST: ${analise.escudo_en}. Reproduce it faithfully, sharp and undistorted. On the real uniform the crest is ${analise.posicao_escudo === 'centro' ? 'CENTERED on the chest, right below the collar — keep it centered' : "on the wearer's left chest — place it on the RIGHT side of the image"}.` : 'This uniform has no crest.'}
${regrasMarcas(opcoes, analise)}

${PADRAO_GOCASE}
Do NOT draw the white "gocase" logo sticker that appears in the style examples.
${notas ? `Designer notes: ${notas}` : ''}`;
}

export function promptCorrecao({ papeisImagens, correcoes, opcoes, analise }) {
  return `Image 1 is the current draft of a Gocase phone-case jersey artwork. Keep its exact canvas, framing, composition and everything that is already correct. Fix ONLY these problems:
${correcoes.map((c) => `- ${c}`).join('\n')}

Other images:
${papeisImagens}

${regrasMarcas(opcoes, analise)}
${PADRAO_GOCASE}`;
}

export function promptSemEscudo({ opcoes, analise, correcoes = [] }) {
  return `Image 1 is a finished Gocase jersey artwork. Produce the exact same artwork with the club crest${analise.escudo_en?.toLowerCase().includes('star') ? ' and the star(s) above it' : ' and any star(s) above it'} completely removed${opcoes.removerFornecedor ? ', and also any sportswear brand logo' : ''}. Fill those areas with the continuing jersey pattern and fabric texture so it looks like they never existed — no ghost, outline or smudge.
Everything else must stay identical: same canvas size, framing, scale, colors, stripes/pattern positions, collar, trims, texture and lighting.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
}

export function promptIsolar({ camada, outras, chave, correcoes = [] }) {
  return `Image 1 is a finished jersey artwork. Produce the SAME canvas (identical size, framing and scale) where ONLY ${camada.isolar_en} remain(s), identical in shape, colors, details, position and scale.
Replace absolutely everything else — the jersey body fabric, the stripes/pattern${outras.length ? `, ${outras.join(', ')}` : ''} — with a perfectly flat, uniform ${chave.nome} background. The ${chave.hex} area must have no texture, no gradient, no shadow, no noise. Do not add outlines, glows or anything new.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
}

export function promptFundo({ removidos, correcoes = [] }) {
  return `Image 1 is a jersey artwork. Remove ${removidos.join(', ')} and recreate the plain jersey body underneath: continue the body pattern (stripes/colors) and the fabric texture seamlessly over those areas, up to the top edge and across the whole canvas, so only the plain body pattern remains, full-bleed.
Keep the body pattern exactly in the same positions, colors and proportions. Same canvas size, framing and scale. No crest, no logos, no collar, no trims.
${correcoes.length ? `Also fix:\n${correcoes.map((c) => `- ${c}`).join('\n')}` : ''}`;
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

export const REVISORES = {
  arte: [
    {
      papel: 'Revisor 1 — Fidelidade ao uniforme',
      foco: 'comparar a arte com as referências do uniforme real: cores exatas, padrão e proporção das listras/faixas, gola (formato e cores), frisos de ombro, escudo (forma, letras, cores, estrelas) e o lado do escudo.',
      texto: ({ papeis, opcoes }) => `Imagens, na ordem:
${papeis}
A ÚLTIMA imagem é a arte candidata.
${opcoes.removerFornecedor ? 'Logos de fornecedor DEVEM estar ausentes — se aparecerem, é problema grave.' : ''}
${opcoes.removerPatrocinio ? 'Patrocinadores DEVEM estar ausentes — se aparecerem, é problema grave.' : ''}
${NAO_PENALIZE}
Imagens de COSTAS servem só para entender o uniforme: números, nomes e estampas da nuca NÃO devem aparecer na arte (que é a frente).
Penalize forte: cor errada, padrão errado, escudo deformado/errado ou na posição errada em relação ao uniforme real, letras distorcidas.`,
    },
    {
      papel: 'Revisor 2 — Padrão Gocase',
      foco: 'verificar se a arte segue o padrão visual das artes aprovadas da Gocase: enquadramento, posição e escala do escudo, áreas reservadas (logo no canto superior direito, câmera no superior esquerdo), acabamento e qualidade de impressão.',
      texto: ({ papeis }) => `Imagens, na ordem:
${papeis}
A ÚLTIMA imagem é a arte candidata; as anteriores são artes Gocase APROVADAS (referência de padrão, não de cores).
Checklist:
- Vista frontal plana ocupando 100% do quadro vertical, sem manequim, fundo, borda, sombra externa ou mockup.
- Gola centralizada no topo cortada pela borda; frisos dos ombros em arco nos cantos superiores; sem mangas.
- Escudo na altura do peito, em escala parecida com a das aprovadas. Posição: a mesma do uniforme real (lado DIREITO da imagem quando o escudo fica no peito esquerdo de quem veste; centralizado quando o uniforme real é assim — nesse caso centralizado está CORRETO).
- Canto superior direito livre para o logo gocase (escudo não pode invadir); nada importante no canto superior esquerdo (câmera).
- Sem texto, marca d'água, logos de marca esportiva ou artefatos de IA (letras tortas, assimetrias estranhas, borrões).
- Nitidez e acabamento prontos para impressão.
${NAO_PENALIZE}`,
    },
  ],
  semEscudo: [
    {
      papel: 'Revisor 1 — Remoção do escudo',
      foco: 'confirmar que o escudo e as estrelas foram removidos por completo, sem fantasma, contorno ou mancha, com o tecido preenchido naturalmente.',
      texto: () => `Imagem 1: arte original COM escudo. Imagem 2: versão candidata SEM escudo.
Verifique se não sobrou nenhum vestígio do escudo, das estrelas ou de logos de marca esportiva, e se o preenchimento continua o padrão do tecido.`,
    },
    {
      papel: 'Revisor 2 — Consistência com a arte',
      foco: 'confirmar que todo o resto da arte ficou idêntico: cores, posição das listras, gola, frisos, enquadramento, textura e qualidade.',
      texto: () => `Imagem 1: arte original COM escudo. Imagem 2: versão candidata SEM escudo.
Fora a região do escudo, as duas devem ser praticamente idênticas. Penalize qualquer mudança de enquadramento, cor, padrão, gola ou perda de nitidez.`,
    },
  ],
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
      texto: () => `Imagem 1: arte sem escudo. Imagem 2: camada de FUNDO candidata (só o corpo da camisa, sem gola e frisos).
O padrão do corpo deve coincidir com o da imagem 1.`,
    },
    {
      papel: 'Revisor 2 — Limpeza do fundo',
      foco: 'confirmar que o fundo não tem gola, frisos de ombro, escudo, logos ou outros elementos, e que cobre o quadro inteiro de forma contínua.',
      texto: () => `Imagem 1: arte sem escudo. Imagem 2: camada de FUNDO candidata.
Penalize: restos de gola/frisos/escudo/logos, emendas visíveis, áreas vazias ou borradas, mudança de enquadramento.`,
    },
  ],
};

export const SISTEMA_PRESENCA = `Você confere quais elementos gráficos estão visíveis numa arte de camisa.
Responda SOMENTE JSON: {"presentes": ["ids"], "ausentes": ["ids"]}.
Um elemento só está presente se dá para vê-lo claramente na arte.`;

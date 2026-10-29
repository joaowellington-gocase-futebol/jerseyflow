// Cliente do Gogroup AI Proxy (API compatível com OpenAI).
// - /v1/chat/completions  → análise e agentes revisores (visão + JSON)
// - /v1/images/edits      → geração/edição de imagem a partir de referências (JSON, campo `images`)
// Obs.: o proxy ignora `size`; o formato de saída segue as imagens de entrada.

const BASE = process.env.AI_PROXY_URL || 'https://ai-proxy.gogroupbr.com';
const KEY = process.env.AI_PROXY_KEY;

export const MODELOS = {
  analise: process.env.MODELO_ANALISE || 'gpt-6-astra',
  revisor1: process.env.MODELO_REVISOR_1 || 'gpt-6-astra',
  revisor2: process.env.MODELO_REVISOR_2 || 'gpt-5.6-sol',
};

// Limita chamadas de imagem simultâneas ao proxy (todas as tarefas compartilham).
function semaforo(max) {
  let ativos = 0;
  const fila = [];
  return async (fn) => {
    if (ativos >= max) await new Promise((r) => fila.push(r));
    ativos++;
    try {
      return await fn();
    } finally {
      ativos--;
      fila.shift()?.();
    }
  };
}
const filaImagens = semaforo(Number(process.env.MAX_IMAGENS_PARALELAS || 4));
const filaChat = semaforo(8);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, { timeout = 300_000, tentativas = 3 } = {}) {
  if (!KEY) throw new Error('AI_PROXY_KEY não configurada no .env');
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(BASE + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const txt = await r.text();
      if (r.ok) return JSON.parse(txt);
      let msg = txt.slice(0, 300);
      try { msg = JSON.parse(txt).error?.message || msg; } catch {}
      ultimoErro = new Error(`AI Proxy ${r.status}: ${msg}`);
      // 4xx (exceto 429) não melhora tentando de novo
      if (r.status < 500 && r.status !== 429) throw ultimoErro;
    } catch (e) {
      ultimoErro = e;
      if (/AI Proxy 4\d\d/.test(e.message) && !/AI Proxy 429/.test(e.message)) throw e;
    }
    await espera(2000 * (i + 1));
  }
  throw ultimoErro;
}

/** Chamada de chat com visão que devolve JSON. `imagens` = data URIs. */
export async function chatJSON({ modelo, sistema, texto, imagens = [] }) {
  const content = [{ type: 'text', text: texto }];
  for (const url of imagens) content.push({ type: 'image_url', image_url: { url } });
  const messages = [{ role: 'system', content: sistema }, { role: 'user', content }];
  return filaChat(async () => {
    for (let i = 0; i < 2; i++) {
      const j = await post('/v1/chat/completions', {
        model: modelo,
        response_format: { type: 'json_object' },
        messages,
      }, { timeout: 180_000 });
      const raw = j.choices?.[0]?.message?.content || '';
      try {
        return JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
      } catch {
        if (i === 1) throw new Error(`Resposta não-JSON do modelo ${modelo}: ${raw.slice(0, 200)}`);
      }
    }
  });
}

/** Gera uma imagem a partir de referências. Devolve Buffer PNG. */
export async function editarImagem({ prompt, imagens, qualidade = 'high' }) {
  return filaImagens(async () => {
    const j = await post('/v1/images/edits', { prompt, images: imagens, quality: qualidade });
    const item = j.data?.[0];
    if (!item?.b64_json) throw new Error('AI Proxy não devolveu imagem');
    return Buffer.from(item.b64_json, 'base64');
  });
}

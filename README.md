# JerseyFlow

*(antigo "Conversor de Uniformes Gocase")*

Transforma fotos de um uniforme de futebol em **artes de case no padrão Gocase**, prontas para produção:
arte final, versão alternativa, **camadas separadas em PNG transparente**, **mockup no case** e um ZIP com tudo.
Também recria **escudos de clubes em PNG transparente 1000 × 1000**, com a mesma textura da foto (aba *Gerar escudo*).
Cada imagem gerada passa por **2 agentes revisores de IA** antes de ser entregue.

- **App publicado:** https://conversor-uniformes.devgogroup.com/ (GoDeploy, app `cc72034c`, login Gogroup obrigatório)
- **IA:** Gogroup AI Proxy (`https://ai-proxy.gogroupbr.com`), API compatível com OpenAI
- **Autor:** joao.wellington@gocase.com · construído com Claude Code em out/2026

---

## 1. O que o app entrega

### Três modelos de arte

Na tela inicial dá para marcar **um ou mais modelos**. Cada modelo marcado vira uma conversão separada, usando as mesmas fotos.

| Modelo | Arte principal | Versão alternativa | Camadas separadas |
|---|---|---|---|
| **Frente** | camisa de frente com escudo | sem escudo | fundo, gola e ombros, escudo, extras (faixas, patches…) |
| **Escudo estourado** | escudo grande centralizado sobre as listras, sem gola | só o fundo | fundo, escudo |
| **Costas** | costas da camisa, com nome e número opcionais | sem nome e número (para personalização) | fundo, gola e ombros (costas), nome e número, escudo da base |

**Costas — toggle "Nome e número":**
- **Ligado:** reproduz a fonte oficial do clube a partir da foto de referência (ex.: PEDRO 9). Os campos *Nome* e *Número* são opcionais: em branco, usa o que está na foto; preenchidos, escreve o texto digitado na fonte do clube.
- **Desligado:** sai só a costa da camisa.

### Referências (slots)

| Slot | Uso |
|---|---|
| **Frente** | foto da camisa de frente. Obrigatória para o modelo Frente |
| **Escudo** | escudo oficial em boa resolução (recomendado) |
| **Costas** | foto das costas. Usada no modelo Costas e para copiar a fonte de nome e número |

### Opções

- Remover logo do fornecedor (adidas, nike, puma…). Padrão: sim. Frisos de ombro são mantidos.
- Remover patrocinadores, inclusive os que ficam dentro do número. Padrão: sim.
- Aplicar logo gocase no canto superior direito. Padrão: sim. O logo é trocável pelo oficial no app.
- Resolução final: **Alta 2000 × 4094 px** ou **Máxima 3000 × 6141 px**.
- Tentativas por etapa: 2, 3 ou 4. É quantas vezes a IA corrige uma imagem reprovada.

### Aba "Gerar escudo"

Recebe a foto de um escudo aplicado numa camisa (close ou camisa inteira) e entrega o escudo isolado em **PNG transparente de 1000 × 1000 px**, ocupando 92% do quadro.

1. **Análise** (`gpt-6-astra`): localiza o escudo na foto (caixa delimitadora) e identifica:
   - material: bordado, emborrachado, termocolante, silk, jacquard ou metalizado;
   - textura, textos exatos e cores;
   - problemas da foto: perspectiva, dobra, reflexo, sombra.
2. **Recorte** da região do escudo, ou da foto inteira se marcado *"A foto já é só o escudo"*.
3. **Recriação** sobre fundo chroma: mesmo desenho e mesma textura, de frente, sem distorção nem reflexo.
4. **Remoção do fundo** e montagem do PNG quadrado.
5. **2 revisores**: *Fidelidade ao escudo* (desenho, letras, cores) e *Textura e acabamento* (material, nitidez, recorte limpo). Nota mínima 7; reprovou, a IA corrige pelo parecer.

Na tela:
- comparação lado a lado (referência × gerado), com fundo xadrez, escuro ou claro;
- escolha manual de versão e "Gerar outra versão";
- histórico **"Escudos gerados"**, compartilhado com o time.

Código: `deploy/escudo.js`.

### O ZIP

```
arte/                    arte principal + alternativa (com logo gocase)
arte/sem_logo_gocase/    as mesmas, sem o logo
camadas/                 PNG transparente, todas no MESMO tamanho de canvas:
                         empilhe na ordem numérica e elas se encaixam
                         (01_fundo, 02_…, …, NN_logo_gocase)
recortes/                os mesmos elementos aparados no tamanho do elemento
mockup/                  a arte aplicada no iPhone 16 com case SlimAir (fundo transparente)
conferencia/             as camadas empilhadas, para conferir o encaixe
relatorio_qa.json        análise da IA + parecer dos 2 revisores em cada etapa
LEIA-ME.txt
```

---

## 2. Como funciona (pipeline)

```
Referências ──► 1. Análise (gpt-6-astra)
                   identifica clube/modelo, cores, padrão, gola, escudo,
                   posição do escudo, nome/número e fonte, marcas a remover
                      │
                      ▼
               2. Arte principal ──► 2 revisores ──► reprovou? corrige com o parecer (até N vezes)
                      │                               (escudo estourado: agente checa gola e remove)
                      ▼
               3. Em paralelo:
                  • versão alternativa (remove escudo / nome+número)   ──► 2 revisores
                  • cada camada isolada em fundo chroma-key            ──► 2 revisores
                      │
                      ▼
               4. Fundo (remove gola, frisos etc. da versão alternativa) ──► 2 revisores
                      │
                      ▼
               5. Exportação: ampliação lanczos3 + logo + mockup + ZIP
```

### Os dois agentes revisores

| Agente | Modelo | O que confere |
|---|---|---|
| **Revisor 1: Fidelidade** | `gpt-6-astra` | cores, padrão das listras, gola, frisos, escudo (forma, letras, posição), nome/número (grafia e fonte) |
| **Revisor 2: Padrão Gocase** | `gpt-5.6-sol` | enquadramento, escala e posição dos elementos, áreas reservadas (logo e câmera), cantos cheios, acabamento de impressão |

- Os dois usam famílias de modelo diferentes de propósito: assim não erram juntos.
- Aprovação: **nota ≥ 7 nos dois**. Reprovou: a próxima tentativa é uma **edição dirigida** da melhor versão até ali, seguindo as correções pedidas pelos revisores.
- Esgotadas as tentativas, fica a versão de maior nota, marcada como **"com ressalvas"**.
- As camadas têm revisores próprios (*Completude do elemento* e *Limpeza para produção*), e o fundo também (*Fidelidade* e *Limpeza*).

### Escolha manual de versões

Toda versão gerada fica salva. Na aba **Revisões dos agentes** dá para:
- **Usar esta versão** em qualquer etapa:
  - trocar a versão alternativa ou uma camada só reexporta;
  - trocar a arte principal refaz a versão alternativa e todas as camadas a partir dela (pede confirmação, ~4 min).
- **Gerar outra versão**: mais uma tentativa, revisada pelos 2 agentes, sem trocar a que está em uso.

### Técnicas de imagem

- **Proporção da arte:** 766:1568 (≈ 1:2,05), medida na arte Gocase aprovada. Resolução de trabalho: 880 × 1801.
- **O proxy ignora o parâmetro `size`:** o formato sai pela proporção das imagens de entrada. Por isso tudo é normalizado com corte ancorado no topo (preserva a gola).
- **Camadas:** a IA redesenha só o elemento sobre uma cor chroma. O código escolhe automaticamente a cor mais distante da paleta do uniforme (verde, magenta, azul ou ciano). O recorte é feito em código, com despremultiplicação da borda, remoção de halo e limpeza de ciscos.
  - *Por quê:* o fundo transparente nativo da IA deixava furos.
- **Alinhamento do escudo:** a diferença entre a arte com e sem escudo serve de gabarito para reposicionar a camada.
- **Ampliação:** pica (lanczos3 + unsharp). Camadas transparentes são ampliadas com cor pré-multiplicada e alfa separados (sem halo).
- **Logo gocase:** vetorizado (SVG) a partir da arte aprovada, por isso fica nítido em qualquer resolução. Posição: 27,5% da largura, 7% da margem direita, 3,5% do topo.

### Mockup (iPhone 16 · case SlimAir)

- **Origem do molde:** foto de produto da Gocase. A IA gerou uma versão limpa, com a área de impressão em verde e o fundo em magenta.
- **Script** `lib/gerar-molde-mockup.cjs`: recorta as duas cores e produz moldura transparente, máscara da área impressa e sombra leve nas bordas.
- **Montagem:** arte na área impressa → sombra multiplicada → máscara → moldura por cima.

---

## 3. Arquitetura

O projeto tem **duas versões** do mesmo produto:

| | **Publicada (GoDeploy)**: pasta `deploy/` | **Local (Mac)**: raiz do projeto |
|---|---|---|
| Onde roda o pipeline | **no navegador** de quem clica em Converter | no servidor Node local |
| Processamento de imagem | canvas + pica + JSZip (CDN) | sharp + jszip |
| Armazenamento | `env.DB` (SQLite do GoDeploy), compartilhado com o time | pasta `output/` |
| Modelos de arte | Frente, Escudo estourado, Costas | só Frente |
| Mockup | iPhone 16 SlimAir | iPhone 16 SlimAir |

> A versão publicada é a principal. A local ficou na funcionalidade "Frente" e serve de laboratório.

### Por que o pipeline roda no navegador

- O GoDeploy é um Cloudflare Worker compartilhado: só HTTP, CPU/memória limitadas, sem processo em segundo plano e sem bibliotecas nativas (sharp).
- Por isso o worker é fino: guarda a chave, repassa as chamadas de IA e armazena os dados. A orquestração e todo o processamento de imagem acontecem na aba do usuário.
- **A aba precisa ficar aberta durante a conversão (~5 min).** O app avisa e pede confirmação antes de fechar.

### Worker (`deploy/src/index.js`)

| Rota | Função |
|---|---|
| `GET /api/escudos` · `GET/PUT/DELETE /api/escudos/:id` | gerações da aba "Gerar escudo" |
| `GET /api/config` | modelos em uso + e-mail do usuário (header do GoDeploy) |
| `POST /api/ai/chat` | repassa para `/v1/chat/completions` (só modelos permitidos) |
| `POST /api/ai/image` | repassa para `/v1/images/edits` (resposta transmitida sem buffer; aceita `size` 1024x1024, 1024x1536, 1536x1024 ou auto) |
| `PUT/GET/DELETE /api/blob/:chave` | imagens em base64, fatiadas em linhas de 1 MB (limite de 2 MB por linha) |
| `GET /api/tarefas` · `GET/PUT /api/tarefas/:id` | histórico e estado de cada conversão (JSON) |
| `GET/POST /api/estilo` · `DELETE /api/estilo/:id` | biblioteca de estilo, separada por modelo |
| `GET/POST/DELETE /api/logo` | logo gocase customizado |

**Tabelas no `env.DB`:**
- `blobs (chave, idx, tipo, dados)`
- `tarefas (id, nome, status, autor, capa, criado_em, atualizado_em, json)`
- `estilos (id, nome, autor, criado_em, modelo)`
- `escudos (id, nome, status, autor, capa, criado_em, atualizado_em, json)`
- `config (chave, valor)`

**Chaves de blob:**
- `t:<id>:<etapa>_t<n>`: miniatura da versão n de uma etapa;
- mesma chave com `_full` no final: PNG completo dessa versão;
- `t:<id>:ref_<n>`: referências enviadas;
- `e:<id>:ref`, `e:<id>:recorte` e `e:<id>:v<n>`: foto, recorte e versões da aba "Gerar escudo";
- `estilo:<id>` e `logo`.

### Segurança

- A chave do AI Proxy fica **só** no segredo `AI_PROXY_KEY` do GoDeploy (versão publicada) e no `.env` local (fora do git). Nunca vai para a página.
- O app é **autenticado**: só logins Gogroup.
- O worker aceita apenas os modelos de IA da lista permitida.

---

## 4. Estrutura de arquivos

```
deploy/                     ← versão publicada no GoDeploy
  index.html                interface (identidade "Football Studio": navy + verde volt, Archivo/Poppins; CSS inline)
  app.js                    lógica da interface: modelos, slots, histórico, versões, downloads, mockups
  escudo.js                 aba "Gerar escudo": prompts, revisores, pipeline e interface próprios
  motor.js                  pipeline no navegador: análise, gerações, revisores, versões, exportação/ZIP
  imagem.js                 canvas: normalização, chroma key, alinhamento, ampliação (pica), logo, mockup
  prompts.js                TODOS os prompts e regras (padrões por modelo, revisores, checklists)
  src/index.js              worker (API + armazenamento)
  assets/
    logo-gocase.svg         logo vetorizado (aplicado nas artes)
    logo-topo.svg           logo do cabeçalho do app
    estilo-padrao.js        exemplo aprovado — Frente (Flamengo 2025), embutido em base64
    estilo-costas.js        exemplo aprovado — Costas (limpo, retangular)
    estilo-escudo.js        exemplo aprovado — Escudo estourado (limpo, retangular)
    mockup-molde.js         molde do mockup (moldura, sombra, máscara + medidas)
  _teste/                   imagens de teste (NÃO sobem no deploy)

server.mjs                  ← versão local (Express) — npm start → http://localhost:4321
lib/ai.mjs                  cliente do AI Proxy (Node)
lib/pipeline.mjs            pipeline local
lib/imaging.mjs             processamento com sharp + mockup
lib/prompts.mjs             prompts da versão local (só Frente)
lib/gerar-molde-mockup.cjs  gera o molde do mockup a partir de um template verde/magenta
public/index.html           interface local

devserver.mjs               simulador local do GoDeploy (worker + SQLite) → http://localhost:4322
assets/mockup/              fotos e PNGs do molde do mockup
refs/                       exemplos e referências originais usados no projeto
data/                       biblioteca de estilo local + banco do simulador
output/                     conversões da versão local
.env                        AI_PROXY_KEY, PORT, modelos (NÃO versionar)
```

---

## 5. Como rodar e publicar

### Simulador local do GoDeploy (testar antes de publicar)

```bash
node --env-file=.env devserver.mjs
```

Abre em http://localhost:4322. Roda o mesmo código de `deploy/` com um SQLite local no lugar do `env.DB`.

### Versão local antiga (só Frente)

```bash
npm start
```

### Publicar no GoDeploy

Pelo MCP do GoDeploy (no Claude):

1. `getUploadToken`
2. Enviar os arquivos (sem `deploy/_teste/`):
   ```bash
   cd deploy && curl -s -X POST -H "Authorization: Bearer $TOKEN" \
     -F "index.html=@./index.html" -F "app.js=@./app.js" -F "motor.js=@./motor.js" \
     -F "imagem.js=@./imagem.js" -F "prompts.js=@./prompts.js" -F "escudo.js=@./escudo.js" \
     -F "assets/logo-gocase.svg=@./assets/logo-gocase.svg" -F "assets/logo-topo.svg=@./assets/logo-topo.svg" \
     -F "assets/estilo-padrao.js=@./assets/estilo-padrao.js" \
     -F "assets/estilo-costas.js=@./assets/estilo-costas.js" \
     -F "assets/estilo-escudo.js=@./assets/estilo-escudo.js" \
     -F "assets/mockup-molde.js=@./assets/mockup-molde.js" \
     -F "src/index.js=@./src/index.js" -F "package.json=@./package.json" \
     https://mcp.devgogroup.com/upload
   ```
3. `updateApp` com:
   - `appId: cc72034c`
   - `entrypoint: src/index.js`
   - `assets`: todos os arquivos acima, menos `src/index.js` e `package.json`

**Atenção:**
- Imagens binárias não sobem bem como asset no GoDeploy. Por isso exemplos, molde e afins vão **embutidos em base64 dentro de arquivos `.js`**.
- O banco (`env.DB`) é preservado entre deploys.
- Para trocar a chave do AI Proxy: `setAppSecret` com `AI_PROXY_KEY`. Não precisa redeploy.
- Para debugar: `getAppLogs` do app `cc72034c`.

### Trocar o modelo do mockup

1. Gere (com a IA) um template do celular/capinha com a **área impressa em #00FF00** e o **fundo em #FF00FF**.
2. Rode:
   ```bash
   node lib/gerar-molde-mockup.cjs <template.png> assets/mockup-molde.js
   ```
3. Copie `assets/mockup-molde.js` para `deploy/assets/` e publique.

---

### Antes de publicar: puxe a versão que está no ar

Mais de uma pessoa pode publicar o app. Se você publicar a partir de uma cópia desatualizada, **apaga o que os outros publicaram**. Por isso:

1. Antes de mudar algo, compare a pasta `deploy/` com o app publicado: `getApp` com `include: ["manifest"]` mostra o tamanho de cada arquivo.
2. Se houver diferença, traga os arquivos com `getAppFile` e faça commit.
3. Mexa, teste no `devserver.mjs`, faça commit e só então publique.

Este repositório é a fonte da verdade do código: toda publicação deve corresponder a um commit.

## 6. Onde ajustar o comportamento

Tudo que a IA "sabe" sobre o padrão Gocase está em **`deploy/prompts.js`**:

| O que mudar | Onde |
|---|---|
| Regras visuais de cada modelo (enquadramento, posição e escala do escudo, áreas reservadas) | `PADRAO.frente / .escudo / .costas` e `BASE_GOCASE` |
| O que a análise extrai das referências | `SISTEMA_ANALISE` |
| Critérios dos revisores | `revisoresArte()`, `CHECKLIST`, `NAO_PENALIZE`, `REVISORES.camada / .fundo` |
| Camadas de cada modelo | `camadasDoModelo()` |
| O que a versão alternativa remove | `alvoRemocao()` |
| Nota mínima de aprovação | `NOTA_MIN` em `motor.js` (hoje 7) |
| Modelos de IA usados | `MODELOS` em `deploy/src/index.js` |
| Regras e revisores da aba "Gerar escudo" | `SISTEMA_ANALISE`, `blocoFiel`, `blocoFundo`, `REVISORES` em `deploy/escudo.js` |
| Tamanho e margem do escudo PNG | `LADO` (1000) e `OCUPACAO` (0,92) em `deploy/escudo.js` |

**Biblioteca de estilo:** no próprio app, aba por modelo. Artes aprovadas adicionadas ali passam a ensinar o padrão para todo o time (até 2 por conversão).

---

## 7. Decisões e aprendizados

- **Exemplos com formato de capinha confundem a IA:** ela copia os cantos arredondados e o buraco da câmera. Os exemplos embutidos foram "limpos" com IA para ficarem retangulares, e os revisores reprovam cantos vazios.
- **Gola no Escudo estourado:** a descrição do uniforme menciona a gola, e a IA insiste em desenhá-la. A solução que funcionou foi uma checagem por agente seguida de uma passada automática de remoção. Remover elementos é o que a IA faz com mais precisão.
- **Escudo centralizado:** o padrão segue o uniforme real. Ex.: Palmeiras III tem escudo centralizado, e antes a regra forçava o lado direito.
- **Camadas que não existem na arte** (ex.: patch descrito na análise mas ausente na arte final) são descartadas por um agente antes de gerar.
- **Camada que falha** não derruba a conversão: é registrada e sai do ZIP.
- **Costas:** o escudo pequeno na base segue o exemplo aprovado. A camada mira esse escudo, não o micro monograma dentro do número.
- **Qualidade das referências manda no resultado:** fotos pequenas ou com a camisa ocupando pouco do quadro geram mais ressalvas.

## 8. Limitações conhecidas

- A resolução nativa da IA é de ~1,57 MP (≈ 880 × 1800). As saídas em 2000/3000 px são ampliadas com lanczos3 e nitidez, não redesenhadas.
- A conversão roda na aba de quem iniciou. Fechar a aba no meio interrompe (fica marcada como "Interrompida", mas dá para escolher versões das etapas que terminaram).
- O link público das imagens do AI Proxy expira em ~48h. O app não depende dele: guarda tudo no banco.
- Grafismos tonais de baixo contraste (ex.: Palmeiras III) são os mais difíceis de reproduzir no fundo. Use "Gerar outra versão" e escolha a melhor.

## 9. Próximos passos sugeridos

- Tornar opcional o escudo pequeno na base do modelo Costas.
- Adicionar artes aprovadas de Costas e Escudo estourado na biblioteca de estilo, para reforçar o padrão.
- Mais modelos de mockup (outros iPhones e Samsung) com seletor no app.
- Registrar o projeto no GoDocs.
- Usar os escudos gerados na aba "Gerar escudo" como referência oficial nas conversões (slot Escudo).

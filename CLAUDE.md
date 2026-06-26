# CLAUDE.md - Simulados Hey, Teacher!™ (IELTS Academic)

Contexto e regras para o Claude Code. Leia este arquivo antes de qualquer tarefa.

---

## 1. O que é o projeto

Suite de simulados dos exames de proficiência em inglês, sob a marca Hey, Teacher!™, linkada a partir do site institucional heyteacher.com.br. Fatia atual: **IELTS Academic**, prova completa (Listening, Reading, Writing, Speaking).

Produto é um **simulado no estilo IELTS**, com itens autorais e originais. Não reproduz questões reais. Exibir aviso de não afiliação. IELTS é marca dos IELTS Partners.

Objetivo de fidelidade: estrutura, tipos de questão, tom dos textos, critérios e pontuação próximos do exame real. A página é moderna e responsiva, mas o foco é a avaliação, não o enfeite.

---

## 2. Stack

- Front-end: **HTML, CSS e JS vanilla** (ES modules). Sem framework.
- Backend: **Supabase** (Postgres + Storage + Edge Functions em Deno).
- Áudio (Listening): **Google Cloud TTS** com cache (ver `build-brief-tts-cache.md`).
- Correção produtiva (Writing/Speaking): **IA** via Edge Function.
- Deploy do front: GitHub Pages + Cloudflare (padrão já usado no projeto).

---

## 3. Escopo e status

Pronto (entregue como dado/spec):
- Blueprint do exame e schema de item: `ielts-academic-blueprint.md`.
- Conteúdo da Prova 01: Reading, Writing, Speaking em `ielts-academic-paper-01.json`; Listening em `ielts-academic-paper-01-listening.json`.
- Brief do cache de TTS: `build-brief-tts-cache.md`.

A construir agora:
- Banco de dados (este pacote: `schema.sql`).
- Engine de prova (este pacote: `build-brief-engine.md`).
- Edge Functions: `tts-synthesize`, `tts-warm-paper`, `score-objective`, `score-productive`.

Fora de escopo nesta fatia: General Training, os outros quatro exames, contas de aluno (tentativas são anônimas por enquanto), Speaking interativo ao vivo.

---

## 4. Estrutura de pastas (alvo)

```
/                     index e páginas
  index.html
  exam/ielts/         página do simulado IELTS
/css
  tokens.css          design tokens (cores, tipografia, espaçamento, motion)
  base.css            reset e base
  components.css      botões, campos, cards
  test.css           layout de prova e resultados
/js
  app.js             entrypoint
  api.js             wrappers do Supabase (carregar prova, criar tentativa, enviar respostas, pontuar)
  state.js           máquina de estados da prova + timer por seção
  results.js         relatório de score
  player/
    listening-player.js
  render/
    single-select.js  multi-select.js  matching.js
    gap-fill.js  labelling.js  free-text.js  spoken-response.js
/supabase
  migrations/        SQL (a partir de schema.sql)
  functions/         tts-synthesize, tts-warm-paper, score-objective, score-productive
/seed
  ielts-academic-paper-01.json
  ielts-academic-paper-01-listening.json
```

---

## 5. Modelo de dados (resumo)

Detalhe completo em `schema.sql`. Pontos que não se pode errar:

- Item é união discriminada por `primitive` (`single_select`, `multi_select`, `matching`, `gap_fill`, `labelling`, `free_text`, `spoken_response`). Payload em `jsonb`.
- **O gabarito nunca vai para o cliente.** Tabela base `items` é service-role only. O cliente lê a view `items_public`, que omite `answer_key`. Idem para `audios`: o cliente vê os `segments` de áudio, nunca o `transcript`.
- Tabelas de conversão bruto-para-banda e mapa CEFR são **dados**, não código (configuráveis por prova).

---

## 6. Pontuação (regras canônicas)

- Listening e Reading: 1 ponto por acerto, sem desconto, máximo 40 cada. Bruto convertido por tabela (`band_conversion`).
- Writing: banda da seção = `(bandaTask1 + 2 * bandaTask2) / 3`, arredondada para o 0.5 mais próximo.
- Speaking: média dos 4 critérios, arredondada para 0.5.
- Banda geral: média das 4 seções, arredondada para 0.5. Regra: `.25` sobe para `.5`; `.75` sobe para o inteiro.
- CEFR exibido ao lado, a partir de `cefr_map`. É referência aproximada, não equivalência exata.

---

## 7. Convenções (obrigatórias)

Copy:
- Sem em-dash. Use vírgula, parênteses, dois-pontos ou ponto.
- Sem emoji em contexto de UI ou marketing.
- Português gramaticalmente correto. Inglês correto nos itens.

Código e design:
- CSS dirigido por tokens. Nada de cor, fonte ou espaçamento hardcoded fora de `tokens.css`.
- Tipografia editorial. Identidade visual do heyteacher.com.br: paleta navy/coral, Fraunces (display) e Plus Jakarta Sans (texto). Extrair os valores exatos do CSS do site publicado e refletir em `tokens.css`.
- Estética anti-genérica. Evitar o visual de template de IA.
- Animações disciplinadas e sempre com `prefers-reduced-motion` respeitado.
- Acessibilidade WCAG AA: navegação por teclado, foco visível, ARIA nos controles customizados (matching, labelling, gravação). Contraste conforme tokens.
- Responsivo de verdade, mobile incluso.
- Ao construir UI, aplique a skill `frontend-design`.

Integridade da prova:
- Correção só no servidor. Cliente nunca recebe gabarito.
- Listening toca uma vez, sem pausar nem retroceder.
- Timer por seção controlado pelo estado, não confiável só no cliente para o resultado final.

---

## 8. Comandos e segredos

- Migrations: aplicar `schema.sql` via Supabase CLI (`supabase db push`) ou painel.
- Edge Functions: `supabase functions deploy <nome>`.
- Secrets no Supabase: `GOOGLE_TTS_API_KEY` (restrita ao Text-to-Speech), `TTS_ADMIN_SECRET`, e `GEMINI_API_KEY` (Generative Language API, provedor de IA do `score-productive`). Nunca no cliente.
- Seed: carregar os dois JSON da Prova 01 nas tabelas (ver seção de seeding em `build-brief-engine.md`).

---

## 9. Log de ADRs

- **ADR-01**: item como `jsonb` em união discriminada por `primitive`.
- **ADR-02**: separar primitivas de interação dos rótulos IELTS; renderizador e corretor operam pela primitiva.
- **ADR-03**: correção produtiva via Edge Function, chave de IA só no servidor. Provedor: Google Gemini (Generative Language API), para consolidar tudo na API do Google junto ao TTS; saída em JSON garantida por `responseSchema`.
- **ADR-04**: tabelas de conversão e CEFR como dados configuráveis, não hardcoded.
- **ADR-05**: Speaking MVP por resposta gravada; Pronunciation marcada como estimada.
- **ADR-06**: cache de TTS com bytes no Storage e índice no Postgres; chave SHA-256 por trecho; pré-geração idempotente; bucket público para leitura, escrita só via service role.
- **ADR-07 (revisa o blueprint)**: **toda** a correção é server-side, inclusive Listening e Reading. O cliente recebe itens sem gabarito (view `items_public`) e envia respostas para `score-objective`. Motivo: correção no cliente vazaria o gabarito e quebraria a credibilidade.
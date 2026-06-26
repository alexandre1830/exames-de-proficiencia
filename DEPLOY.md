# Deploy — Simulados Hey, Teacher! (IELTS Academic)

Ordem de execução para colocar a Prova 01 no ar.

## 1. Banco (migration)

```bash
supabase db push        # aplica supabase/migrations/0001_init.sql
# ou cole o SQL no painel (SQL Editor)
```

Cria tabelas, views públicas (`items_public`, `audios_public`), conversão de banda,
mapa CEFR, buckets de Storage e as policies de RLS.

## 2. Secrets (só no servidor, nunca no cliente)

```bash
supabase secrets set GOOGLE_TTS_API_KEY=...       # restrita a Cloud Text-to-Speech
supabase secrets set TTS_ADMIN_SECRET=...         # string aleatoria que voce gera
supabase secrets set GEMINI_API_KEY=...           # Generative Language API (score-productive)
# opcional: supabase secrets set GEMINI_MODEL=gemini-2.5-flash
```

A `GEMINI_API_KEY` e diferente da `GOOGLE_TTS_API_KEY`: habilite a
"Generative Language API" no projeto Google e gere uma chave que a permita
(a chave do TTS, restrita ao Text-to-Speech, nao funciona para a correcao).

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente das functions.

## 3. Edge Functions

```bash
supabase functions deploy score-objective
supabase functions deploy score-productive
supabase functions deploy tts-synthesize
supabase functions deploy tts-warm-paper
supabase functions deploy finalize-attempt
```

As funções de TTS exigem header `x-admin-secret` (o aluno nunca as chama).
`score-objective`, `score-productive` e `finalize-attempt` são chamadas pelo cliente com a chave anon.

## 4. Seed da Prova 01

```bash
npm install @supabase/supabase-js
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs
```

Separa o gabarito (`answer_key`) e o transcript (service-only) dos campos públicos.

## 5. Aquecer o áudio da Listening (uma vez)

```bash
curl -X POST "$SUPABASE_URL/functions/v1/tts-warm-paper" \
  -H "x-admin-secret: $TTS_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"ielts-academic-paper-01"}'
```

Idempotente: reexecutar custa zero (tudo vira cache hit). Grava `segments` e `segments_public`.
Confirme as vozes Neural2 no catálogo atual do Google (mapa em `tts-warm-paper`).

## 6. Front-end

Edite a chave anon e a URL em `js/config.js` (ou injete via
`window.__SUPABASE_URL__` / `window.__SUPABASE_ANON_KEY__` em `exam/ielts/index.html`).
Publique a raiz do repositório no GitHub Pages + Cloudflare (padrão do projeto).

## Verificação rápida (definition of done)

- `exam/ielts/` carrega e renderiza as 4 seções com os 6 renderizadores.
- DevTools → Network: as respostas de `items_public`/`audios_public` não contêm `answer_key` nem `transcript`.
- Listening toca uma vez, com prévias e sem controles; nenhuma chamada de TTS em prova.
- Relatório mostra banda por seção, banda geral arredondada e CEFR.

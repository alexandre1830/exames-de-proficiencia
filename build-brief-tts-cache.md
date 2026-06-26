# Build Brief: Cache de Áudio TTS (Google Cloud TTS + Supabase)

Destino: implementação via Claude Code. Stack: front-end vanilla, Supabase (Postgres + Storage + Edge Functions).

---

## 1. Objetivo e princípio

Gerar cada trecho de áudio **uma única vez** e servir do cache em todas as requisições seguintes, sem novas chamadas pagas à API do Google.

Princípio central: **chave de cache por hash**. O hash combina o texto (ou SSML) mais a voz e todos os parâmetros que afetam a saída. Entrada igual gera chave igual, e a chave igual serve o arquivo já salvo. Qualquer mudança gera chave nova e só então uma chamada paga.

Para a Listening (conteúdo fixo), vamos **pré-gerar** o áudio no deploy. Assim nem o primeiro aluno dispara chamada à API: em prova, o front-end só faz GET de arquivos já salvos, servidos por CDN.

---

## 2. Decisão de arquitetura

- **Bytes do áudio: Supabase Storage** (bucket `tts-audio`), nome do arquivo derivado do hash.
- **Índice e metadados: Postgres** (tabela `tts_cache`).
- **Não usar `bytea`** para os bytes: incha a tabela, encarece backup e prejudica o streaming. Servir do Storage é melhor e continua dentro do Supabase. Fallback documentado: se quiser tudo no Postgres, troque `storage_path/public_url` por uma coluna `audio bytea` e sirva via Edge Function. Recomendação é Storage.
- **Bucket público para leitura, escrita só via service role.** O aluno lê o áudio (de graça, via CDN), mas **não pode disparar síntese**. Só o job de pré-geração (service role) causa chamada paga. Esta separação é a principal proteção de custo.

---

## 3. Chave de cache

String canônica, depois SHA-256 em hex:

```
languageCode | voiceName | speakingRate | pitch | audioEncoding | (text|ssml) | conteudoNormalizado
```

`conteudoNormalizado` = `trim()` e colapso de espaços múltiplos. O hex resultante é a `cache_key` e também o nome do arquivo. Use os 2 primeiros caracteres como pasta para não criar um diretório gigante e plano: `tts-audio/ab/abcd...ef.mp3`.

---

## 4. Esquema (migration)

```sql
-- Bucket (uma vez)
insert into storage.buckets (id, name, public)
values ('tts-audio', 'tts-audio', true)
on conflict (id) do nothing;

create table public.tts_cache (
  cache_key        text primary key,        -- sha-256 hex da entrada canonica
  content          text,                    -- texto/ssml original (rastreio/debug)
  is_ssml          boolean not null default false,
  language_code    text    not null,
  voice_name       text    not null,
  speaking_rate    numeric not null default 1.0,
  pitch            numeric not null default 0.0,
  audio_encoding   text    not null default 'MP3',
  storage_path     text    not null,
  public_url       text    not null,
  char_count       integer not null,        -- para monitorar gasto
  byte_size        integer,
  created_at       timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count     integer not null default 0
);

create index tts_cache_created_at_idx on public.tts_cache (created_at);

alter table public.tts_cache enable row level security;

-- Leitura do indice liberada; escrita so via service role (sem policy de insert/update)
create policy "tts_cache_read" on public.tts_cache
  for select using (true);
```

Monitoramento de gasto: `select sum(char_count) from tts_cache;` dá o total de caracteres já sintetizados (cada um cobrado uma vez na vida). Defina também um teto de cota na própria console do Google como rede de segurança.

---

## 5. Edge Function `tts-synthesize` (com cache)

Núcleo do mecanismo: recebe um trecho, devolve a URL. Só chama o Google em cache miss.

Segredos (Supabase secrets): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_TTS_API_KEY` (chave restrita à Cloud Text-to-Speech API e a uso de servidor). Service account é mais seguro que API key; se preferir, troque a auth por JWT de service account.

Proteja a função para não virar porta de cobrança: exija header secreto de admin ou invoque só com service role. O aluno nunca chama esta função.

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const GOOGLE_KEY = Deno.env.get("GOOGLE_TTS_API_KEY")!;
const ADMIN_SECRET = Deno.env.get("TTS_ADMIN_SECRET")!;
const BUCKET = "tts-audio";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const {
    content, isSsml = false, languageCode, voiceName,
    speakingRate = 1.0, pitch = 0.0, audioEncoding = "MP3",
  } = await req.json();

  const canonical = [languageCode, voiceName, speakingRate, pitch, audioEncoding,
    isSsml ? "ssml" : "text", content.trim().replace(/\s+/g, " ")].join("|");
  const cacheKey = await sha256Hex(canonical);

  // 1. Cache hit?
  const { data: hit } = await supabase
    .from("tts_cache").select("public_url").eq("cache_key", cacheKey).maybeSingle();
  if (hit) {
    await supabase.rpc("noop"); // opcional: atualizar access stats
    return Response.json({ url: hit.public_url, cached: true });
  }

  // 2. Miss -> chama o Google (unico ponto de cobranca)
  const ttsRes = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: isSsml ? { ssml: content } : { text: content },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding, speakingRate, pitch },
      }),
    },
  );
  if (!ttsRes.ok) return new Response(await ttsRes.text(), { status: 502 });
  const { audioContent } = await ttsRes.json();
  const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));

  // 3. Sobe pro Storage
  const ext = audioEncoding === "MP3" ? "mp3" : audioEncoding === "OGG_OPUS" ? "ogg" : "bin";
  const path = `${cacheKey.slice(0, 2)}/${cacheKey}.${ext}`;
  await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: audioEncoding === "MP3" ? "audio/mpeg" : "audio/ogg",
    upsert: true,
  });
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // 4. Indexa (on conflict para corrida de requisicoes simultaneas)
  await supabase.from("tts_cache").upsert({
    cache_key: cacheKey, content, is_ssml: isSsml, language_code: languageCode,
    voice_name: voiceName, speaking_rate: speakingRate, pitch,
    audio_encoding: audioEncoding, storage_path: path, public_url: pub.publicUrl,
    char_count: content.length, byte_size: bytes.length,
  }, { onConflict: "cache_key", ignoreDuplicates: true });

  return Response.json({ url: pub.publicUrl, cached: false });
});
```

Nota sobre limite: o `text:synthesize` aceita cerca de 5000 caracteres por chamada. Por isso a unidade de cache é o **trecho/linha**, não o transcript inteiro. Isso resolve o limite, o cache fica granular e cada linha pode ter uma voz diferente.

---

## 6. Pré-geração: `tts-warm-paper`

Job idempotente que aquece o cache de uma prova e grava as URLs de volta. Rodar uma vez no deploy. Reexecutar é seguro: tudo vira cache hit, zero chamadas ao Google.

Fluxo:
1. Recebe `paperId`, lê a seção Listening (os `audioScripts`).
2. Para cada parte, para cada linha do transcript: resolve a voz pelo papel (ver mapa de vozes), chama a lógica do `tts-synthesize`, coleta `{ order, role, text, url, pauseAfterMs }`.
3. Monta o array `segments` por parte e grava na seção Listening da prova.
4. Idempotência garantida pelo hash.

Saída gravada em cada `audio-pN`:

```json
"segments": [
  { "order": 1, "role": "R", "text": "Good morning...", "url": "https://.../ab/ab12...mp3", "pauseAfterMs": 400 },
  { "order": 2, "role": "M", "text": "Hi, I'd like...", "url": "https://.../cd/cd34...mp3", "pauseAfterMs": 400 }
]
```

---

## 7. Consumo no front-end (player da Listening)

Regra de ouro: **em prova, zero chamadas à API**. O player só faz GET dos arquivos já salvos.

- Antes de iniciar uma parte, **pré-carrega** (fetch/preload) todos os `segments.url` daquela parte, para a reprodução ser contínua e de fato "uma única vez".
- Reproduz os segmentos em ordem, inserindo `pauseAfterMs` entre eles e as **prévias de 30s** antes de cada grupo de questões (conforme o `playback` da seção).
- Sem controles de pausar ou retroceder. Ao fim, 2 minutos para revisar.
- Se um `segment.url` estiver ausente (prova não aquecida), bloquear o início e avisar, em vez de chamar a API ao vivo.

---

## 8. Proteção de custo (resumo)

1. Cache por hash: cada trecho único é cobrado no máximo uma vez na vida.
2. Pré-geração no deploy, não em prova: o aluno nunca dispara síntese.
3. Bucket público para leitura, escrita só via service role: só o job de warm gera cobrança.
4. Warm idempotente: reexecutar custa zero.
5. `sum(char_count)` monitora o gasto acumulado; teto de cota no Google como rede de segurança.
6. Chave da API restrita à Text-to-Speech e a uso de servidor.

---

## 9. Mapa de vozes

Vozes **Studio** (tier de máxima qualidade do Google TTS), resolvidas por parte +
rótulo. Studio só existe para `en-US` e `en-GB`, então a Part 2 (antes AU) usa US
Studio para manter variedade de sotaque nativo (GB + US). Custo único graças ao cache.
Confirme os nomes no catálogo atual do Google, que muda com o tempo.

```json
{
  "1": { "R": "en-GB-Studio-C", "M": "en-GB-Studio-B" },
  "2": { "G": "en-US-Studio-Q" },
  "3": { "M (Mia)": "en-GB-Studio-C", "T (Tom)": "en-US-Studio-Q" },
  "4": { "L": "en-GB-Studio-C" }
}
```

Nota: o rótulo `M` é masculino na Part 1 (Caller) e feminino na Part 3 (Mia), por
isso a resolução é por parte, não por um mapa plano de rótulo.

---

## 10. ADR a registrar

**ADR-06**: cache de TTS com bytes no Supabase Storage e índice no Postgres; chave SHA-256 por trecho (texto + voz + parâmetros); pré-geração idempotente no deploy; bucket público para leitura e escrita só via service role. Alternativa rejeitada: bytes em `bytea` (incha tabela, prejudica streaming).
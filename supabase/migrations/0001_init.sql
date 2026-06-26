-- ============================================================
-- Simulados Hey, Teacher!  -  Schema IELTS Academic
-- Supabase / Postgres. Aplicar como migration.
-- O gabarito (answer_key) e os transcripts NUNCA sao expostos ao cliente.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Conteudo
-- ------------------------------------------------------------

create table public.papers (
  id          text primary key,
  exam        text not null,
  title       text not null,
  status      text not null default 'draft',
  sections    jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

create table public.passages (
  id          text primary key,
  paper_id    text not null references public.papers(id) on delete cascade,
  title       text not null,
  level       text,
  paragraphs  jsonb not null            -- array de string, ou de {key,text}
);

create table public.audios (
  id              text primary key,
  paper_id        text not null references public.papers(id) on delete cascade,
  part            int  not null,
  context         text,
  voices          jsonb,
  playback        jsonb,                -- previa, play unico, etc.
  transcript      jsonb,                -- SERVICE-ONLY (revela respostas)
  segments        jsonb,                -- SERVICE-ONLY: full, com text
  segments_public jsonb                 -- PUBLICO: [{order,url,pauseAfterMs}]
);

create table public.items (
  id              text primary key,
  paper_id        text not null references public.papers(id) on delete cascade,
  skill           text not null,        -- listening|reading|writing|speaking
  part            int  not null,
  question_type   text not null,
  primitive       text not null,        -- single_select|multi_select|matching|gap_fill|labelling|free_text|spoken_response
  instructions    text,
  points          int,
  difficulty_cefr text,
  question_numbers int[],
  passage_ref     text,
  audio_ref       text,
  content         jsonb not null,       -- PUBLICO: prompts/options/template/questions/wordLimit/chooseCount/etc (SEM respostas)
  answer_key      jsonb                 -- SERVICE-ONLY: answers/accepted/answerKey
);

create index items_paper_idx on public.items (paper_id, skill, part);

-- Views publicas (omitem gabarito e transcript).
-- security_invoker fica OFF (default) de proposito: a view acessa a base
-- como owner e expoe apenas a projecao filtrada.
create view public.items_public as
  select id, paper_id, skill, part, question_type, primitive, instructions,
         points, difficulty_cefr, question_numbers, passage_ref, audio_ref, content
  from public.items;

create view public.audios_public as
  select id, paper_id, part, context, voices, playback, segments_public
  from public.audios;

-- ------------------------------------------------------------
-- Pontuacao como dado (ADR-04). Aproximacoes configuraveis por prova.
-- ------------------------------------------------------------

create table public.band_conversion (
  skill   text not null,               -- listening|reading
  raw_min int  not null,
  raw_max int  not null,
  band    numeric(2,1) not null,
  primary key (skill, raw_min, raw_max)
);

insert into public.band_conversion (skill, raw_min, raw_max, band) values
  ('listening',39,40,9.0),('listening',37,38,8.5),('listening',35,36,8.0),
  ('listening',32,34,7.5),('listening',30,31,7.0),('listening',26,29,6.5),
  ('listening',23,25,6.0),('listening',18,22,5.5),('listening',16,17,5.0),
  ('listening',13,15,4.5),('listening',10,12,4.0),('listening',6,9,3.5),
  ('listening',4,5,3.0),('listening',0,3,2.5),
  ('reading',39,40,9.0),('reading',37,38,8.5),('reading',35,36,8.0),
  ('reading',33,34,7.5),('reading',30,32,7.0),('reading',27,29,6.5),
  ('reading',23,26,6.0),('reading',19,22,5.5),('reading',15,18,5.0),
  ('reading',13,14,4.5),('reading',10,12,4.0),('reading',8,9,3.5),
  ('reading',6,7,3.0),('reading',0,5,2.5);

create table public.cefr_map (
  band_min numeric(2,1) not null,
  band_max numeric(2,1) not null,
  cefr     text not null
);

insert into public.cefr_map (band_min, band_max, cefr) values
  (8.5,9.0,'C2'),(7.0,8.0,'C1'),(5.5,6.5,'B2'),
  (4.0,5.0,'B1'),(3.0,3.5,'A2'),(0.0,2.5,'A1');

-- ------------------------------------------------------------
-- Tentativas (MVP anonimo)
-- ------------------------------------------------------------

create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  paper_id     text not null references public.papers(id),
  status       text not null default 'in_progress',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  overall_band numeric(2,1),
  cefr         text
);

create table public.responses (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references public.attempts(id) on delete cascade,
  item_id         text not null,
  question_number int,
  raw             jsonb,
  correct         boolean,
  awarded_points  int
);
create index responses_attempt_idx on public.responses (attempt_id);

create table public.section_scores (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  skill      text not null,
  raw_score  int,
  band       numeric(2,1),
  criteria   jsonb,                      -- W/S: bandas por criterio + feedback
  primary key (attempt_id, skill)
);

-- ------------------------------------------------------------
-- Cache de TTS (ADR-06). Ver build-brief-tts-cache.md.
-- ------------------------------------------------------------

create table public.tts_cache (
  cache_key        text primary key,
  content          text,
  is_ssml          boolean not null default false,
  language_code    text not null,
  voice_name       text not null,
  speaking_rate    numeric not null default 1.0,
  pitch            numeric not null default 0.0,
  audio_encoding   text not null default 'MP3',
  storage_path     text not null,
  public_url       text not null,
  char_count       integer not null,
  byte_size        integer,
  created_at       timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count     integer not null default 0
);
create index tts_cache_created_at_idx on public.tts_cache (created_at);

-- ------------------------------------------------------------
-- Storage
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public) values
  ('tts-audio','tts-audio', true),
  ('speaking-responses','speaking-responses', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- RLS e grants
-- ------------------------------------------------------------

alter table public.papers          enable row level security;
alter table public.passages        enable row level security;
alter table public.audios          enable row level security;   -- base: sem policy anon
alter table public.items           enable row level security;   -- base: sem policy anon
alter table public.band_conversion enable row level security;
alter table public.cefr_map        enable row level security;
alter table public.attempts        enable row level security;
alter table public.responses       enable row level security;
alter table public.section_scores  enable row level security;
alter table public.tts_cache       enable row level security;

-- Leitura publica do que pode ser exposto
create policy papers_read   on public.papers          for select using (true);
create policy passages_read on public.passages        for select using (true);
create policy band_read     on public.band_conversion for select using (true);
create policy cefr_read     on public.cefr_map        for select using (true);
create policy tts_read      on public.tts_cache       for select using (true);

-- MVP anonimo: ler tentativas/scores (endurecer com contas depois)
create policy attempts_read  on public.attempts       for select using (true);
create policy attempts_ins   on public.attempts       for insert with check (true);
create policy responses_read on public.responses      for select using (true);
create policy scores_read    on public.section_scores for select using (true);
-- Escrita em responses/section_scores e em items/audios base: so service role (sem policy).

grant select on public.papers, public.passages, public.band_conversion,
               public.cefr_map, public.items_public, public.audios_public,
               public.attempts, public.responses, public.section_scores to anon;
grant insert on public.attempts to anon;

-- Nota: items_public e audios_public expoem a projecao sem gabarito/transcript.
-- As tabelas base items/audios nao tem policy anon, entao so o service role le tudo.
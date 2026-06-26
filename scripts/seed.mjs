// Seed da Prova 01 nas tabelas do Supabase.
// Separa o gabarito (answer_key) e o transcript dos campos publicos (content / segments_public).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs
// Depois, aquecer o audio uma vez:
//   curl -X POST "$SUPABASE_URL/functions/v1/tts-warm-paper" \
//     -H "x-admin-secret: $TTS_ADMIN_SECRET" -H "Content-Type: application/json" \
//     -d '{"paperId":"ielts-academic-paper-01"}'

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "seed");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Colunas "meta" do item (vao para colunas dedicadas, nao para content).
const META = new Set([
  "id", "skill", "part", "questionType", "primitive", "instructions", "points",
  "difficultyCEFR", "questionNumbers", "passageRef", "audioRef",
]);

// Separa um item em { row } pronto para a tabela items (content publico + answer_key service).
function splitItem(item, paperId) {
  const content = {};
  let answer_key = null;

  for (const [k, v] of Object.entries(item)) {
    if (!META.has(k)) content[k] = structuredClone(v);
  }

  switch (item.primitive) {
    case "single_select": {
      // answer por questao -> answer_key; remover answer do content.
      answer_key = {};
      for (const q of content.questions || []) {
        answer_key[q.n] = q.answer;
        delete q.answer;
      }
      break;
    }
    case "matching":
    case "labelling": {
      answer_key = content.answerKey || {};
      delete content.answerKey;
      break;
    }
    case "gap_fill": {
      answer_key = {};
      content.gaps = (content.gaps || []).map((g) => {
        answer_key[g.n] = g.accepted;
        return { n: g.n };
      });
      break;
    }
    case "multi_select": {
      answer_key = content.answerKey || [];
      delete content.answerKey;
      break;
    }
    case "free_text": {
      // O exemplo de resposta-modelo nao pode ir ao cliente.
      answer_key = content.modelAnswerBand8 ? { modelAnswerBand8: content.modelAnswerBand8 } : null;
      delete content.modelAnswerBand8;
      break;
    }
    case "spoken_response": {
      answer_key = null;
      break;
    }
  }

  return {
    id: item.id,
    paper_id: paperId,
    skill: item.skill,
    part: item.part,
    question_type: item.questionType,
    primitive: item.primitive,
    instructions: item.instructions ?? null,
    points: item.points ?? null,
    difficulty_cefr: item.difficultyCEFR ?? null,
    question_numbers: item.questionNumbers ?? null,
    passage_ref: item.passageRef ?? null,
    audio_ref: item.audioRef ?? null,
    content,
    answer_key,
  };
}

async function up(table, rows, conflict = "id") {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} linha(s)`);
}

async function main() {
  const main01 = JSON.parse(await readFile(join(SEED_DIR, "ielts-academic-paper-01.json"), "utf8"));
  const lst = JSON.parse(await readFile(join(SEED_DIR, "ielts-academic-paper-01-listening.json"), "utf8"));
  const paperId = main01.paper.id;

  console.log("Seeding", paperId);

  // paper (status published para o cliente carregar). Junta a seção listening do outro JSON.
  const sections = [...main01.paper.sections];
  const lstSection = sections.find((s) => s.skill === "listening");
  if (lstSection && lst.section) Object.assign(lstSection, lst.section, { skill: "listening", status: "complete" });
  await up("papers", [{
    id: paperId, exam: main01.paper.exam, title: main01.paper.title,
    status: "published", sections,
  }]);

  // passages
  await up("passages", (main01.passages || []).map((p) => ({
    id: p.id, paper_id: paperId, title: p.title, level: p.level ?? null, paragraphs: p.paragraphs,
  })));

  // audios (transcript service-only; segments preenchidos depois pelo warm)
  await up("audios", (lst.audioScripts || []).map((a) => {
    const transcript = a.example ? [a.example, ...a.transcript] : a.transcript;
    return {
      id: a.id, paper_id: paperId, part: a.part, context: a.context ?? null,
      voices: a.voices ?? null, playback: lst.section?.playback ?? null,
      transcript, segments: null, segments_public: null,
    };
  }));

  // items (de ambos os JSON)
  const items = [...(main01.items || []), ...(lst.items || [])].map((it) => splitItem(it, paperId));
  await up("items", items);

  console.log("OK. Agora rode tts-warm-paper para gerar o audio da Listening.");
}

main().catch((e) => { console.error(e); process.exit(1); });

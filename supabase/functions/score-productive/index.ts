// score-productive: correcao de Writing e Speaking via IA (LLM-judge), server-side.
// A chave de IA vive so no servidor (ADR-03). Provider: Google Gemini
// (Generative Language API), para consolidar tudo na API do Google junto ao TTS.
//
// Saida so em JSON garantida por responseMimeType + responseSchema do Gemini,
// com temperature baixa (o Gemini aceita temperature).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { preflight, json } from "../_shared/cors.ts";
import { writingSectionBand, meanBand } from "../_shared/band.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Chave da Generative Language API (NAO e a chave do TTS, que fica restrita ao TTS).
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

// Definicao original de cada criterio (nao copia os descritores oficiais do IELTS, ADR/brief).
const CRITERION_DEFS: Record<string, string> = {
  "Task Achievement":
    "How fully and accurately the response covers the data or visual, with clear overview and well chosen detail.",
  "Task Response":
    "How fully the prompt is addressed, with a clear position developed through relevant, extended ideas.",
  "Coherence and Cohesion":
    "Logical organisation, paragraphing and the natural use of linking devices and reference.",
  "Lexical Resource":
    "Range, precision and natural use of vocabulary, including collocation and the handling of less common items.",
  "Grammatical Range and Accuracy":
    "Range of structures and control of grammar and punctuation across the response.",
  "Fluency and Coherence":
    "Ability to speak at length with natural flow, logical sequencing and effective use of connectives.",
  "Pronunciation":
    "Clarity of individual sounds, stress, rhythm and intonation. Marked as estimated when no acoustic analysis is available.",
};

// Escala 0 a 9 com ancoras (redacao propria, alinhada ao CEFR).
const SCALE = [
  "9 = fully operational command, fully natural and accurate.",
  "7 = good command with occasional inaccuracies that do not impede communication.",
  "5 = modest command, copes with overall meaning but with frequent limitations.",
  "3 = limited command, conveys only basic meaning in familiar situations.",
  "1 = essentially no usable command.",
].join(" ");

function buildPrompt(opts: {
  taskType: string;
  prompt: string;
  studentText: string;
  criteria: string[];
}) {
  const defs = opts.criteria
    .map((c) => `- ${c}: ${CRITERION_DEFS[c] ?? ""}`)
    .join("\n");
  return [
    `You are an experienced IELTS-style examiner. Rate the candidate response below.`,
    ``,
    `Task type: ${opts.taskType}`,
    `Prompt:`,
    opts.prompt,
    ``,
    `Candidate response:`,
    `"""`,
    opts.studentText,
    `"""`,
    ``,
    `Score each criterion from 0 to 9 (half bands allowed). Scale anchors: ${SCALE}`,
    ``,
    `Criteria:`,
    defs,
    ``,
    `Give a band per criterion with a short justification, and a brief overall feedback paragraph.`,
  ].join("\n");
}

// Schema de saida no formato do Gemini (tipos em maiusculas, sem additionalProperties).
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          band: { type: "NUMBER" },
          justification: { type: "STRING" },
        },
        required: ["name", "band", "justification"],
      },
    },
    feedback: { type: "STRING" },
  },
  required: ["criteria", "feedback"],
};

async function callModel(promptText: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("gemini: resposta vazia");
  return JSON.parse(text);
}

// Banda nominal -> 0.5 mais proximo (o modelo pode devolver valores fora da grade).
function toHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const body = await req.json();
    const { attemptId, skill } = body;
    if (!attemptId || (skill !== "writing" && skill !== "speaking")) {
      return json({ error: "attemptId e skill (writing|speaking) obrigatorios" }, 400);
    }

    // tasks: array de { taskType, prompt, studentText, criteria }.
    // Writing manda 2 tasks (Task 1 e Task 2). Speaking manda 1 (resposta agregada).
    const tasks: Array<any> = body.tasks || [];
    if (!tasks.length) return json({ error: "tasks vazio" }, 400);

    const perTask = [];
    for (const t of tasks) {
      const out = await callModel(buildPrompt({
        taskType: t.taskType,
        prompt: t.prompt,
        studentText: t.studentText || "",
        criteria: t.criteria || [],
      }));
      const crit = (out.criteria || []).map((c: any) => ({
        name: c.name,
        band: toHalf(Number(c.band)),
        justification: c.justification,
        estimated: c.name === "Pronunciation", // ADR-05
      }));
      const taskBand = meanBand(crit.map((c: any) => c.band));
      perTask.push({ taskType: t.taskType, criteria: crit, band: taskBand, feedback: out.feedback });
    }

    // Banda da seção.
    let sectionBand: number;
    if (skill === "writing") {
      const t1 = perTask.find((p) => p.taskType?.startsWith("task1"))?.band ?? perTask[0].band;
      const t2 = perTask.find((p) => p.taskType?.startsWith("task2"))?.band ?? perTask[perTask.length - 1].band;
      sectionBand = writingSectionBand(t1, t2);
    } else {
      // Speaking: media dos 4 criterios da resposta agregada.
      sectionBand = meanBand(perTask[0].criteria.map((c: any) => c.band));
    }

    // Persistir em section_scores (criteria em jsonb).
    const { error: sErr } = await supabase.from("section_scores").upsert({
      attempt_id: attemptId,
      skill,
      raw_score: null,
      band: sectionBand,
      criteria: { tasks: perTask },
    }, { onConflict: "attempt_id,skill" });
    if (sErr) return json({ error: sErr.message }, 500);

    const feedback = perTask.map((p) => p.feedback).filter(Boolean).join("\n\n");
    return json({ sectionBand, tasks: perTask, feedback });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

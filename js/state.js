// Maquina de estados da prova: timer por secao, agrupamento de itens e
// montagem dos payloads de correcao. O resultado final so e montado em finalize.
import { SECTION_ORDER } from "./config.js";

// Arredondamento de banda (mesma regra do servidor; usado so para exibir).
export function roundBand(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.25) return f;
  if (d < 0.75) return f + 0.5;
  return f + 1;
}

// Criterios por skill/task (espelha o brief; alimenta score-productive).
const CRITERIA = {
  task1: ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
  task2: ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
  speaking: ["Fluency and Coherence", "Lexical Resource", "Grammatical Range and Accuracy", "Pronunciation"],
};

export class SectionTimer {
  constructor(seconds, onTick, onExpire) {
    this.left = seconds;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.id = null;
  }
  start() {
    if (!this.left) return;
    this.onTick(this.left);
    this.id = setInterval(() => {
      this.left--;
      this.onTick(this.left);
      if (this.left <= 0) { this.stop(); this.onExpire(); }
    }, 1000);
  }
  stop() { clearInterval(this.id); this.id = null; }
  static format(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
}

// Agrupa e ordena os itens por secao na ordem canonica.
export function groupBySection(items) {
  const map = { listening: [], reading: [], writing: [], speaking: [] };
  for (const it of items) (map[it.skill] ||= []).push(it);
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => (a.part - b.part) || ((a.question_numbers?.[0] ?? 0) - (b.question_numbers?.[0] ?? 0)));
  }
  return map;
}

export function orderedSections(paper) {
  const declared = (paper?.sections || []).map((s) => s.skill);
  return SECTION_ORDER.filter((s) => declared.includes(s));
}

export function sectionMeta(paper, skill) {
  return (paper?.sections || []).find((s) => s.skill === skill) || {};
}

// Monta { itemId: raw } para correcao objetiva (listening/reading).
export function buildObjectiveResponses(items, collect) {
  const responses = {};
  for (const it of items) responses[it.id] = collect(it);
  return responses;
}

// Monta { tasks: [...] } para correcao produtiva (writing/speaking).
// collect(item) devolve { text, wordCount } (writing) ou { transcript } (speaking).
export function buildProductiveTasks(skill, items, collect) {
  const tasks = [];
  if (skill === "writing") {
    for (const it of items) {
      const r = collect(it);
      const tt = it.content.taskType || (it.part === 1 ? "task1_visual" : "task2_essay");
      tasks.push({
        taskType: tt,
        prompt: it.content.prompt || "",
        studentText: r.text || "",
        criteria: tt.startsWith("task1") ? CRITERIA.task1 : CRITERIA.task2,
      });
    }
  } else {
    // Speaking: agrega as transcricoes das 3 partes em uma resposta.
    const parts = items.map((it) => {
      const r = collect(it);
      return `[${it.content.taskType || "part"}] ${r.transcript || ""}`;
    }).join("\n\n");
    const prompt = items.map((it) => (it.content.prompts || []).join(" ")).join("\n");
    tasks.push({ taskType: "speaking", prompt, studentText: parts, criteria: CRITERIA.speaking });
  }
  return { tasks };
}

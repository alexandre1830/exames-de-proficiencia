// Wrappers do Supabase. O cliente nunca le answer_key/transcript, nunca chama TTS,
// nunca pontua. Correcao acontece nas Edge Functions (ver ADR-07).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

async function callFunction(name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `funcao ${name} falhou (${res.status})`);
  return data;
}

// Carrega a prova: paper + passages + audios (publicos) + items (publicos, sem gabarito).
export async function loadPaper(paperId) {
  const [paper, passages, audios, items] = await Promise.all([
    supabase.from("papers").select("*").eq("id", paperId).maybeSingle(),
    supabase.from("passages").select("*").eq("paper_id", paperId),
    supabase.from("audios_public").select("*").eq("paper_id", paperId).order("part"),
    supabase.from("items_public").select("*").eq("paper_id", paperId).order("part"),
  ]);
  for (const r of [paper, passages, audios, items]) {
    if (r.error) throw new Error(r.error.message);
  }
  return {
    paper: paper.data,
    passages: passages.data || [],
    audios: audios.data || [],
    items: items.data || [],
  };
}

export async function createAttempt(paperId) {
  const { data, error } = await supabase
    .from("attempts").insert({ paper_id: paperId }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

// responses: { "<itemId>": raw }. Encaminha para a Edge Function certa.
export async function submitSection(attemptId, skill, responses) {
  if (skill === "listening" || skill === "reading") {
    return callFunction("score-objective", { attemptId, skill, responses });
  }
  // writing / speaking: { tasks: [...] } (ver buildProductiveTasks no state)
  return callFunction("score-productive", { attemptId, skill, ...responses });
}

export async function finalizeAttempt(attemptId) {
  return callFunction("finalize-attempt", { attemptId });
}

// Upload do audio da resposta de Speaking (bucket privado).
// Ponto de integracao plugavel: requer policy de escrita ou upload via funcao.
export async function uploadSpeaking(attemptId, part, blob) {
  const path = `${attemptId}/part-${part}.webm`;
  const { error } = await supabase.storage
    .from("speaking-responses").upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw new Error(error.message);
  return `storage://speaking-responses/${path}`;
}

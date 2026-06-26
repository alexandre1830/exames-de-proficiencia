// score-objective: correcao server-side de Listening e Reading.
// Recebe { attemptId, skill, responses }, le os itens COM answer_key (service role),
// corrige por primitiva, persiste em `responses` e `section_scores`, devolve { raw, band }.
// O cliente nunca recebe o gabarito.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { preflight, json } from "../_shared/cors.ts";
import { gradeItem, bandFromRaw } from "../_shared/scoring.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { attemptId, skill, responses } = await req.json();
    if (!attemptId || !skill) return json({ error: "attemptId e skill obrigatorios" }, 400);
    if (skill !== "listening" && skill !== "reading") {
      return json({ error: "score-objective so atende listening e reading" }, 400);
    }

    // 1. Confirmar a tentativa e descobrir a prova.
    const { data: attempt, error: aErr } = await supabase
      .from("attempts").select("id, paper_id, status").eq("id", attemptId).maybeSingle();
    if (aErr || !attempt) return json({ error: "tentativa nao encontrada" }, 404);

    // 2. Itens da seção, COM gabarito (tabela base, service role).
    const { data: items, error: iErr } = await supabase
      .from("items")
      .select("id, primitive, question_numbers, content, answer_key, points")
      .eq("paper_id", attempt.paper_id)
      .eq("skill", skill);
    if (iErr) return json({ error: iErr.message }, 500);

    // 3. Corrigir item a item.
    const rows: Array<Record<string, unknown>> = [];
    let raw = 0;
    for (const item of items || []) {
      const studentRaw = (responses || {})[item.id];
      const results = gradeItem(item, studentRaw);
      for (const r of results) {
        if (r.correct) raw += r.awarded_points;
        rows.push({
          attempt_id: attemptId,
          item_id: item.id,
          question_number: r.question_number,
          raw: studentRaw ?? null,
          correct: r.correct,
          awarded_points: r.awarded_points,
        });
      }
    }

    // 4. Persistir respostas (substitui correcoes anteriores desta seção).
    const itemIds = (items || []).map((i) => i.id);
    if (itemIds.length) {
      await supabase.from("responses").delete()
        .eq("attempt_id", attemptId).in("item_id", itemIds);
    }
    if (rows.length) {
      const { error: rErr } = await supabase.from("responses").insert(rows);
      if (rErr) return json({ error: rErr.message }, 500);
    }

    // 5. Converter bruto -> banda.
    const { data: conv } = await supabase
      .from("band_conversion").select("raw_min, raw_max, band").eq("skill", skill);
    const band = bandFromRaw(conv || [], raw);

    // 6. Persistir section_scores.
    const { error: sErr } = await supabase.from("section_scores").upsert({
      attempt_id: attemptId, skill, raw_score: raw, band, criteria: null,
    }, { onConflict: "attempt_id,skill" });
    if (sErr) return json({ error: sErr.message }, 500);

    return json({ raw, band });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

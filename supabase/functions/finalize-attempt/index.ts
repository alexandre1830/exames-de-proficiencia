// finalize-attempt: monta a banda geral e o CEFR a partir das section_scores e
// persiste em attempts (service role; anon nao tem update). Devolve o relatorio final.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { preflight, json } from "../_shared/cors.ts";
import { meanBand, cefrFor } from "../_shared/band.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SKILLS = ["listening", "reading", "writing", "speaking"];

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  try {
    const { attemptId } = await req.json();
    if (!attemptId) return json({ error: "attemptId obrigatorio" }, 400);

    const { data: scores, error } = await supabase
      .from("section_scores").select("skill, raw_score, band, criteria")
      .eq("attempt_id", attemptId);
    if (error) return json({ error: error.message }, 500);

    const bands = (scores || [])
      .filter((s) => SKILLS.includes(s.skill) && s.band != null)
      .map((s) => Number(s.band));
    const overall = meanBand(bands);

    const { data: cefrRows } = await supabase
      .from("cefr_map").select("band_min, band_max, cefr");
    const cefr = cefrFor(cefrRows || [], overall);

    const { error: uErr } = await supabase.from("attempts").update({
      status: "completed",
      finished_at: new Date().toISOString(),
      overall_band: overall,
      cefr,
    }).eq("id", attemptId);
    if (uErr) return json({ error: uErr.message }, 500);

    return json({ overallBand: overall, cefr, sections: scores });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

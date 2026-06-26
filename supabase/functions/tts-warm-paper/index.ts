// tts-warm-paper: pre-gera o audio da Listening de uma prova e grava os segments.
// Idempotente: reexecutar custa zero (tudo vira cache hit). Roda uma vez no deploy.
// Protegida por header de admin. O aluno nunca dispara sintese (ADR-06).
import { makeClient, synthesize } from "../_shared/tts.ts";

const ADMIN_SECRET = Deno.env.get("TTS_ADMIN_SECRET")!;
const GOOGLE_KEY = Deno.env.get("GOOGLE_TTS_API_KEY")!;
const supabase = makeClient();

const DEFAULT_PAUSE_MS = 400;

// Vozes Studio (tier de maxima qualidade do Google TTS). Studio so existe para
// en-US e en-GB, entao a Part 2 (antes AU) usa US Studio para manter variedade de
// sotaque nativo (GB + US). Resolucao por parte + rotulo: o rotulo "M" e masculino
// na Part 1 (Caller) mas feminino na Part 3 (Mia), por isso nao basta um mapa plano.
const V = {
  gbF: { languageCode: "en-GB", voiceName: "en-GB-Studio-C" }, // feminina britanica
  gbM: { languageCode: "en-GB", voiceName: "en-GB-Studio-B" }, // masculina britanica
  usF: { languageCode: "en-US", voiceName: "en-US-Studio-O" }, // feminina americana
  usM: { languageCode: "en-US", voiceName: "en-US-Studio-Q" }, // masculina americana
};
const VOICES_BY_PART: Record<number, Record<string, typeof V.gbF>> = {
  1: { R: V.gbF, M: V.gbM },          // recepcionista (F) + caller (M)
  2: { G: V.usM },                    // coordenador (monologo)
  3: { M: V.gbF, T: V.usM },          // Mia (F, GB) + Tom (M, US)
  4: { L: V.gbF },                    // palestrante (F)
};
const FALLBACK_VOICE = V.gbF;

function resolveVoice(part: number, label: string) {
  return VOICES_BY_PART[part]?.[label] ?? FALLBACK_VOICE;
}

// Cada linha do transcript e "LABEL: texto". Devolve { role, text }.
function parseLine(line: string): { role: string; text: string } {
  const m = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/s);
  if (m) return { role: m[1].toUpperCase(), text: m[2].trim() };
  return { role: "", text: line.trim() };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const { paperId } = await req.json();
    if (!paperId) return Response.json({ error: "paperId obrigatorio" }, { status: 400 });

    const { data: audios, error } = await supabase
      .from("audios").select("id, transcript")
      .eq("paper_id", paperId).order("part");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!audios?.length) return Response.json({ error: "sem audios para a prova" }, { status: 404 });

    const summary: Array<{ id: string; lines: number; misses: number }> = [];

    for (const audio of audios) {
      const lines: string[] = Array.isArray(audio.transcript) ? audio.transcript : [];
      const segments = [];
      const segmentsPublic = [];
      let order = 0;
      let misses = 0;

      for (const raw of lines) {
        const { role, text } = parseLine(String(raw));
        if (!text) continue;
        const voice = resolveVoice(audio.part, role);
        const { url, cached } = await synthesize(supabase, GOOGLE_KEY, {
          content: text,
          languageCode: voice.languageCode,
          voiceName: voice.voiceName,
          audioEncoding: "MP3",
        });
        if (!cached) misses++;
        order++;
        segments.push({ order, role, text, url, pauseAfterMs: DEFAULT_PAUSE_MS });
        segmentsPublic.push({ order, url, pauseAfterMs: DEFAULT_PAUSE_MS });
      }

      await supabase.from("audios").update({
        segments, segments_public: segmentsPublic,
      }).eq("id", audio.id);

      summary.push({ id: audio.id, lines: order, misses });
    }

    return Response.json({ paperId, warmed: summary });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
});

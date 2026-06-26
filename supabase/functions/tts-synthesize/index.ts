// tts-synthesize: recebe um trecho, devolve a URL do audio (cache-first).
// Protegida por header de admin: o aluno NUNCA chama esta funcao (ver ADR-06).
import { makeClient, synthesize } from "../_shared/tts.ts";

const ADMIN_SECRET = Deno.env.get("TTS_ADMIN_SECRET")!;
const GOOGLE_KEY = Deno.env.get("GOOGLE_TTS_API_KEY")!;
const supabase = makeClient();

Deno.serve(async (req) => {
  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const p = await req.json();
    if (!p.content || !p.languageCode || !p.voiceName) {
      return Response.json({ error: "content, languageCode e voiceName obrigatorios" }, { status: 400 });
    }
    const { url, cached } = await synthesize(supabase, GOOGLE_KEY, p);
    return Response.json({ url, cached });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
});

// Nucleo de sintese TTS com cache (ADR-06). Reusado por tts-synthesize e tts-warm-paper.
// Chave de cache = SHA-256 da string canonica (texto + voz + parametros).
// Cache hit serve do Storage; cache miss e o unico ponto de cobranca no Google.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const BUCKET = "tts-audio";

export function makeClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SynthParams = {
  content: string;
  isSsml?: boolean;
  languageCode: string;
  voiceName: string;
  speakingRate?: number;
  pitch?: number;
  audioEncoding?: string;
};

// Devolve { url, cached }. Sintetiza no Google so em cache miss.
export async function synthesize(
  supabase: SupabaseClient,
  googleKey: string,
  p: SynthParams,
): Promise<{ url: string; cached: boolean }> {
  const {
    content, isSsml = false, languageCode, voiceName,
    speakingRate = 1.0, pitch = 0.0, audioEncoding = "MP3",
  } = p;

  const normalized = content.trim().replace(/\s+/g, " ");
  const canonical = [
    languageCode, voiceName, speakingRate, pitch, audioEncoding,
    isSsml ? "ssml" : "text", normalized,
  ].join("|");
  const cacheKey = await sha256Hex(canonical);

  // 1. Cache hit?
  const { data: hit } = await supabase
    .from("tts_cache").select("public_url").eq("cache_key", cacheKey).maybeSingle();
  if (hit) return { url: hit.public_url, cached: true };

  // 2. Miss -> Google (unico ponto de cobranca).
  const ttsRes = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
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
  if (!ttsRes.ok) throw new Error(`google tts ${ttsRes.status}: ${await ttsRes.text()}`);
  const { audioContent } = await ttsRes.json();
  const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));

  // 3. Storage (pasta = 2 primeiros chars do hash).
  const ext = audioEncoding === "MP3" ? "mp3" : audioEncoding === "OGG_OPUS" ? "ogg" : "bin";
  const path = `${cacheKey.slice(0, 2)}/${cacheKey}.${ext}`;
  await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: audioEncoding === "MP3" ? "audio/mpeg" : "audio/ogg",
    upsert: true,
  });
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // 4. Indexa (idempotente sob corrida).
  await supabase.from("tts_cache").upsert({
    cache_key: cacheKey, content, is_ssml: isSsml, language_code: languageCode,
    voice_name: voiceName, speaking_rate: speakingRate, pitch,
    audio_encoding: audioEncoding, storage_path: path, public_url: pub.publicUrl,
    char_count: content.length, byte_size: bytes.length,
  }, { onConflict: "cache_key", ignoreDuplicates: true });

  return { url: pub.publicUrl, cached: false };
}

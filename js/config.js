// Configuracao do cliente. Preencher com os valores do projeto Supabase.
// Apenas a chave ANON (publica) vai ao cliente. Service role, chave de IA e
// TTS_ADMIN_SECRET NUNCA aparecem aqui.

export const SUPABASE_URL = window.__SUPABASE_URL__ || "https://xxuvmpdmzobokdgywmke.supabase.co";
export const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4dXZtcGRtem9ib2tkZ3l3bWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODg2NTksImV4cCI6MjA5ODA2NDY1OX0.cV9z5cRA93mkYM2vOfM1IM97Zml2vXo9ZH8o4b8UvJc";

export const DEFAULT_PAPER_ID = "ielts-academic-paper-01";

// Ordem canonica das secoes.
export const SECTION_ORDER = ["listening", "reading", "writing", "speaking"];

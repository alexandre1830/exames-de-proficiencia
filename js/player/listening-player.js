// Player da Listening. Reproducao unica, sem pausar nem retroceder.
// Fonte: audios_public.segments_public [{order,url,pauseAfterMs}]. Em prova,
// zero chamadas a API: so GET dos arquivos ja gerados (ver build-brief-tts-cache).

import { el } from "../render/dom.js";

const PREVIEW_MS = 30000;   // previa de 30s antes de cada parte
const REVIEW_MS = 120000;   // 2 minutos de revisao ao final

export class ListeningPlayer {
  // audios: array de audios_public (ordenado por part). onFinish: callback ao terminar.
  constructor(audios, onFinish) {
    this.audios = audios;
    this.onFinish = onFinish;
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
    this.stopped = false;
  }

  // Verifica se a prova foi aquecida (todos os segmentos tem url).
  get isWarm() {
    return this.audios.length > 0 && this.audios.every(
      (a) => Array.isArray(a.segments_public) && a.segments_public.length &&
             a.segments_public.every((s) => s.url),
    );
  }

  mount(container) {
    this.container = container;
    const ui = el("div", { class: "player" });
    this.statusEl = el("p", { class: "player__status", "aria-live": "polite" });
    const viz = el("div", { class: "player__viz", dataset: { playing: "false" } });
    for (let i = 0; i < 5; i++) viz.append(el("span"));
    this.viz = viz;

    if (!this.isWarm) {
      ui.append(el("div", { class: "errorbox" }, [
        "Listening audio is not ready for this paper. Please warm the paper before taking the exam.",
      ]));
      container.replaceChildren(ui);
      return;
    }

    this.startBtn = el("button", { class: "btn btn--lg", type: "button" }, ["Begin Listening (plays once)"]);
    this.startBtn.addEventListener("click", () => this.play());

    ui.append(
      el("h2", { text: "Listening" }),
      el("p", { class: "section-head" }, ["You will hear each recording once. You cannot pause or rewind."]),
      viz, this.statusEl, this.startBtn,
    );
    container.replaceChildren(ui);
  }

  setStatus(t) { if (this.statusEl) this.statusEl.textContent = t; }
  sleep(ms) { return new Promise((r) => { this._t = setTimeout(r, ms); }); }

  playSegment(url) {
    return new Promise((resolve, reject) => {
      this.audioEl.src = url;
      this.audioEl.onended = resolve;
      this.audioEl.onerror = () => reject(new Error("audio load failed"));
      this.audioEl.play().catch(reject);
    });
  }

  async play() {
    this.startBtn.disabled = true;
    this.startBtn.style.display = "none";
    this.viz.dataset.playing = "true";

    // Pre-carrega as urls da primeira parte (reproducao continua).
    for (const audio of this.audios) {
      if (this.stopped) return;
      const part = audio.part;
      this.setStatus(`Part ${part}: you have 30 seconds to read the questions.`);
      await this.sleep(PREVIEW_MS);

      for (const seg of audio.segments_public.sort((a, b) => a.order - b.order)) {
        if (this.stopped) return;
        this.setStatus(`Part ${part}: playing…`);
        try { await this.playSegment(seg.url); } catch { /* segue */ }
        if (seg.pauseAfterMs) await this.sleep(seg.pauseAfterMs);
      }
    }

    this.viz.dataset.playing = "false";
    this.setStatus("End of recording. You have 2 minutes to check your answers.");
    await this.sleep(REVIEW_MS);
    if (!this.stopped) this.onFinish?.();
  }

  destroy() {
    this.stopped = true;
    clearTimeout(this._t);
    try { this.audioEl.pause(); } catch { /* noop */ }
  }
}

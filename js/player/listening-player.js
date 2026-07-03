// Player da Listening. Reproducao unica, sem pausar nem retroceder.
// Fonte: audios_public.segments_public [{order,url,pauseAfterMs}]. Em prova,
// zero chamadas a API: so GET dos arquivos ja gerados (ver build-brief-tts-cache).
//
// UX: modal de instrucoes (fundo borrado) antes de comecar, countdown nos 30s de
// leitura antes de cada parte, e barra de progresso do audio durante a reproducao.

import { el } from "../render/dom.js";

const PREVIEW_SECONDS = 30;   // previa para ler as questoes, antes de cada parte
const REVIEW_SECONDS = 120;   // 2 minutos de revisao ao final

function fmt(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class ListeningPlayer {
  // audios: array de audios_public (ordenado por part). onFinish: callback ao terminar.
  constructor(audios, onFinish) {
    this.audios = audios;
    this.onFinish = onFinish;
    this.onPart = null;
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
    this.stopped = false;
    this._t = null;
    this._interval = null;
  }

  get isWarm() {
    return this.audios.length > 0 && this.audios.every(
      (a) => Array.isArray(a.segments_public) && a.segments_public.length &&
             a.segments_public.every((s) => s.url),
    );
  }

  mount(container) {
    this.container = container;
    const ui = el("div", { class: "player" });

    if (!this.isWarm) {
      ui.append(el("div", { class: "errorbox" }, [
        "Listening audio is not ready for this paper. Please warm the paper before taking the exam.",
      ]));
      container.replaceChildren(ui);
      return;
    }

    // Visualizador de barras (durante a reproducao).
    const viz = el("div", { class: "player__viz", dataset: { playing: "false" } });
    for (let i = 0; i < 5; i++) viz.append(el("span"));
    this.viz = viz;

    // Countdown grande (leitura / revisao).
    this.timerEl = el("div", { class: "player__timer", hidden: true, "aria-live": "polite" });

    // Barra de progresso do audio.
    this.progressFill = el("div", { class: "player__progress-fill" });
    this.progressBar = el("div", {
      class: "player__progress", hidden: true, role: "progressbar",
      "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0",
    }, [this.progressFill]);
    this.progressLabel = el("p", { class: "player__time-label", hidden: true });

    this.statusEl = el("p", { class: "player__status", "aria-live": "polite" });

    this.startBtn = el("button", { class: "btn btn--lg btn--accent", type: "button" }, ["Begin Listening"]);
    this.startBtn.addEventListener("click", () => this.play());

    ui.append(
      el("h2", { text: "Listening" }),
      el("p", { class: "section-head", text: "You will hear each recording once. You cannot pause or rewind." }),
      viz, this.timerEl, this.progressBar, this.progressLabel, this.statusEl, this.startBtn,
    );
    container.replaceChildren(ui);

    // Instrucoes primeiro: o modal abre ao entrar na secao. Depois de confirmar, o
    // aluno pode ler as questoes a vontade e so entao clicar em "Begin Listening".
    this.introModal();
  }

  // Modal de instrucoes com fundo borrado. Resolve quando o aluno confirma.
  introModal() {
    return new Promise((resolve) => {
      const dlg = el("dialog", { class: "modal" });
      const startBtn = el("button", { class: "btn btn--accent btn--lg", type: "button", text: "I'm ready, start" });
      dlg.append(
        el("h3", { text: "Before you begin" }),
        el("ul", { class: "modal__list" }, [
          el("li", { text: "Before each part you have 30 seconds to read the questions." }),
          el("li", { text: "Each recording plays once. You cannot pause or rewind." }),
          el("li", { text: "A progress bar shows how much of the audio is left." }),
          el("li", { text: "At the end you have 2 minutes to check your answers." }),
        ]),
        el("div", { class: "modal__actions" }, [startBtn]),
      );
      startBtn.addEventListener("click", () => dlg.close("start"));
      dlg.addEventListener("close", () => {
        dlg.remove();
        if (dlg.returnValue === "start") resolve();
        // ESC/cancel: nao inicia; o botao "Begin" continua disponivel.
      }, { once: true });
      document.body.append(dlg);
      dlg.showModal();
      startBtn.focus();
    });
  }

  setStatus(t) { if (this.statusEl) this.statusEl.textContent = t; }
  sleep(ms) { return new Promise((r) => { this._t = setTimeout(r, ms); }); }

  // Countdown visivel (leitura ou revisao).
  countdown(seconds, label) {
    return new Promise((resolve) => {
      let left = seconds;
      this.timerEl.hidden = false;
      const render = () => {
        this.timerEl.dataset.warning = left <= 5 ? "true" : "false";
        this.timerEl.innerHTML = "";
        this.timerEl.append(
          el("span", { class: "player__timer-label", text: label }),
          el("span", { class: "player__timer-time", text: fmt(left) }),
        );
      };
      render();
      this._interval = setInterval(() => {
        if (this.stopped) { clearInterval(this._interval); return; }
        left--;
        render();
        if (left <= 0) {
          clearInterval(this._interval);
          this.timerEl.hidden = true;
          resolve();
        }
      }, 1000);
    });
  }

  setProgress(ratio, elapsed, total) {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    this.progressFill.style.width = `${pct}%`;
    this.progressBar.setAttribute("aria-valuenow", String(Math.round(pct)));
    this.progressLabel.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
  }

  showProgress(on) {
    this.progressBar.hidden = !on;
    this.progressLabel.hidden = !on;
    this.viz.dataset.playing = on ? "true" : "false";
  }

  // Le a duracao de cada segmento (best-effort) e aquece o cache do navegador.
  preloadDurations(segs) {
    return Promise.all(segs.map((s) => new Promise((res) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => res(0);
      a.src = s.url;
    })));
  }

  playSegment(url, onTime) {
    return new Promise((resolve, reject) => {
      this.audioEl.src = url;
      this.audioEl.ontimeupdate = () => onTime(this.audioEl.currentTime || 0);
      this.audioEl.onended = () => { this.audioEl.ontimeupdate = null; resolve(); };
      this.audioEl.onerror = () => { this.audioEl.ontimeupdate = null; reject(new Error("audio")); };
      this.audioEl.play().catch(reject);
    });
  }

  async playPart(audio) {
    const segs = audio.segments_public.slice().sort((a, b) => a.order - b.order);
    const durations = await this.preloadDurations(segs);
    if (this.stopped) return;

    const pauses = segs.map((s) => (s.pauseAfterMs || 0) / 1000);
    const total = durations.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);

    this.showProgress(true);
    this.setStatus(`Part ${audio.part}: playing.`);
    let prior = 0;
    for (let k = 0; k < segs.length; k++) {
      if (this.stopped) return;
      try {
        await this.playSegment(segs[k].url, (cur) => {
          const elapsed = prior + cur;
          this.setProgress(total ? elapsed / total : 0, elapsed, total);
        });
      } catch { /* segmento falhou: segue para o proximo */ }
      prior += durations[k];
      this.setProgress(total ? prior / total : 0, prior, total);
      if (pauses[k]) await this.sleep(pauses[k] * 1000);
      prior += pauses[k];
    }
    this.setProgress(1, total, total);
    this.showProgress(false);
  }

  async play() {
    this.startBtn.disabled = true;
    this.startBtn.style.display = "none";

    for (let i = 0; i < this.audios.length; i++) {
      const audio = this.audios[i];
      if (this.stopped) return;
      this.onPart?.(i); // vira a pagina de questoes para a parte atual
      this.setStatus(`Part ${audio.part}: reading time.`);
      await this.countdown(PREVIEW_SECONDS, `Part ${audio.part} · reading time`);
      if (this.stopped) return;
      await this.playPart(audio);
    }

    if (this.stopped) return;
    this.setStatus("End of recording. Check your answers.");
    await this.countdown(REVIEW_SECONDS, "Review time");
    if (!this.stopped) this.onFinish?.();
  }

  destroy() {
    this.stopped = true;
    clearTimeout(this._t);
    clearInterval(this._interval);
    try { this.audioEl.pause(); } catch { /* noop */ }
  }
}

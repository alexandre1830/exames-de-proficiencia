// spoken_response (Speaking): grava com MediaRecorder, transcreve com Web Speech API (MVP).
// Respeita prepSeconds (Part 2) e talkSeconds. raw -> { transcript, blob }
// Pronunciation e estimada (ADR-05): sem analise acustica.
import { el, itemShell } from "./dom.js";

export const spokenResponse = {
  render(container, item) {
    const shell = itemShell(item);
    const c = item.content;
    const state = { blob: null, transcript: "", recorder: null, stream: null };
    item.__speaking = state;

    const part = el("div", { class: "speaking-part" });

    // Enunciado / cue card.
    const prompts = c.prompts || [];
    if (c.taskType === "part2_cue_card") {
      const card = el("div", { class: "cue-card" });
      card.append(el("p", { class: "qblock__stem", text: prompts[0] || "" }));
      const ul = el("ul");
      prompts.slice(1).forEach((p) => ul.append(el("li", { text: p })));
      card.append(ul);
      part.append(card);
    } else {
      const ul = el("ul");
      prompts.forEach((p) => ul.append(el("li", { text: p })));
      part.append(ul);
    }

    const status = el("p", { class: "player__status", "aria-live": "polite", text: "Ready to record." });
    const transcriptBox = el("p", { class: "notice", "aria-live": "polite" });

    const recBtn = el("button", { class: "btn btn--accent rec-btn", type: "button", dataset: { recording: "false" } }, [
      el("span", { class: "rec-dot" }), "Start recording",
    ]);

    let recognition = null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    async function start() {
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        status.textContent = "Microphone unavailable. You can still continue.";
        return;
      }
      const chunks = [];
      state.recorder = new MediaRecorder(state.stream);
      state.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      state.recorder.onstop = () => {
        state.blob = new Blob(chunks, { type: "audio/webm" });
        state.stream.getTracks().forEach((t) => t.stop());
      };
      state.recorder.start();

      if (SR) {
        recognition = new SR();
        recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
        recognition.onresult = (e) => {
          let txt = "";
          for (const r of e.results) txt += r[0].transcript;
          state.transcript = txt;
          transcriptBox.textContent = txt;
        };
        try { recognition.start(); } catch { /* ja iniciado */ }
      }

      recBtn.dataset.recording = "true";
      recBtn.lastChild.textContent = "Stop";
      status.textContent = "Recording…";
      if (c.talkSeconds) startTimer(c.talkSeconds, stop);
    }

    function stop() {
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
      if (recognition) try { recognition.stop(); } catch { /* noop */ }
      recBtn.dataset.recording = "false";
      recBtn.lastChild.textContent = "Re-record";
      status.textContent = "Saved. " + (SR ? "" : "(No transcript available in this browser.)");
    }

    recBtn.addEventListener("click", () => {
      if (recBtn.dataset.recording === "true") stop(); else start();
    });

    // Timer de fala (visual, opcional).
    const timer = el("span", { class: "timer", style: "display:none" });
    function startTimer(seconds, onEnd) {
      let left = seconds; timer.style.display = "inline-block"; timer.textContent = fmt(left);
      const id = setInterval(() => {
        left--; timer.textContent = fmt(left); timer.dataset.warning = left <= 15 ? "true" : "false";
        if (left <= 0) { clearInterval(id); onEnd(); }
      }, 1000);
    }
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    part.append(status, el("div", { style: "display:flex;gap:1rem;align-items:center" }, [recBtn, timer]), transcriptBox);
    shell.append(part);
    container.append(shell);
  },

  collectResponse(item) {
    const s = item.__speaking || {};
    return { transcript: s.transcript || "", blob: s.blob || null };
  },
};

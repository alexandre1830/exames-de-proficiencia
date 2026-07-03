// Entrypoint da prova. Conduz o aluno pelas 4 secoes com timer, coleta respostas,
// envia para correcao no servidor e exibe o relatorio. Nenhum gabarito no cliente.
import { DEFAULT_PAPER_ID } from "./config.js";
import { loadPaper, createAttempt, submitSection, finalizeAttempt, uploadSpeaking } from "./api.js";
import { rendererFor } from "./render/index.js";
import { ListeningPlayer } from "./player/listening-player.js";
import { createPager } from "./pager.js";
import { el } from "./render/dom.js";
import { renderResults } from "./results.js";
import {
  SectionTimer, groupBySection, orderedSections, sectionMeta,
  buildObjectiveResponses, buildProductiveTasks,
} from "./state.js";

const SKILL_LABEL = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };

class Exam {
  constructor(root, paperId) {
    this.root = root;
    this.paperId = paperId;
    this.attemptId = null;
    this.sections = [];
    this.index = 0;
    this.timer = null;
    this.player = null;
  }

  collect(item) {
    return rendererFor(item.primitive).collectResponse(item);
  }

  async boot() {
    this.root.innerHTML = `<div class="loading">Loading the exam…</div>`;
    try {
      this.data = await loadPaper(this.paperId);
    } catch (e) {
      this.root.innerHTML = `<div class="errorbox">Could not load the paper. ${e.message}</div>`;
      return;
    }
    this.bySkill = groupBySection(this.data.items);
    this.sections = orderedSections(this.data.paper).filter((s) => (this.bySkill[s] || []).length || s === "listening");
    this.renderIntro();
  }

  renderIntro() {
    const card = el("div", { class: "card measure", style: "margin-inline:auto;margin-top:3rem" }, [
      el("p", { class: "chip chip--accent", text: "IELTS Academic · Practice" }),
      el("h1", { text: this.data.paper.title }),
      el("p", { class: "measure", text: "Four sections in order: Listening, Reading, Writing, Speaking. Each section is timed. Listening plays once, without pause or rewind." }),
      el("p", { class: "notice", text: "Original practice test in the style of IELTS. Not affiliated with or endorsed by the IELTS partners. IELTS is a trademark of the IELTS partners." }),
      el("button", { class: "btn btn--lg btn--accent", type: "button", style: "margin-top:1rem", onclick: () => this.start() }, ["Start the exam"]),
    ]);
    this.root.replaceChildren(card);
  }

  async start() {
    try {
      this.attemptId = await createAttempt(this.paperId);
    } catch (e) {
      this.root.innerHTML = `<div class="errorbox">Could not start an attempt. ${e.message}</div>`;
      return;
    }
    this.scaffold();
    this.index = 0;
    this.renderSection();
  }

  scaffold() {
    this.bar = el("header", { class: "exam-bar" });
    this.brand = el("span", { class: "exam-bar__brand", text: "Hey, Teacher!" });
    this.nav = el("ul", { class: "exam-bar__sections" });
    this.timerEl = el("span", { class: "timer", "aria-live": "off", style: "display:none" });
    this.bar.append(this.brand, this.nav, this.timerEl);

    this.main = el("main", { id: "exam", class: "exam-main wrap" });
    this.root.replaceChildren(this.bar, this.main);
    this.renderNav();
  }

  renderNav() {
    this.nav.replaceChildren();
    this.sections.forEach((s, i) => {
      this.nav.append(el("li", {
        text: SKILL_LABEL[s],
        "aria-current": i === this.index ? "true" : "false",
        "data-done": i < this.index ? "true" : "false",
      }));
    });
  }

  get currentSkill() { return this.sections[this.index]; }

  renderSection() {
    this.renderNav();
    const skill = this.currentSkill;
    const items = this.bySkill[skill] || [];
    this.main.replaceChildren();
    this.stopTimer();

    if (skill === "listening") return this.renderListening(items);

    // Cabecalho da secao.
    const meta = sectionMeta(this.data.paper, skill);
    this.main.append(el("div", { class: "section-head" }, [
      el("h2", { text: SKILL_LABEL[skill] }),
      el("p", { class: "instructions", text: this.sectionInstructions(skill) }),
    ]));

    const pages = skill === "reading"
      ? this.buildReadingPages(items)
      : this.buildItemPages(items, (it) => (skill === "writing" ? `Task ${it.part}` : `Part ${it.part}`));

    const last = this.index === this.sections.length - 1;
    this.pager = createPager(pages, {
      onFinish: () => this.submitCurrent(),
      finishLabel: last ? "Finish and see results" : "Submit section",
    });
    this.main.append(this.pager.root);

    const dur = meta.durationSeconds;
    if (dur) this.startTimer(dur);
  }

  sectionInstructions(skill) {
    if (skill === "reading") return "Read the three passages and answer all 40 questions. You may move freely between questions.";
    if (skill === "writing") return "Complete both tasks. Task 2 carries more weight than Task 1.";
    if (skill === "speaking") return "Record your answers. Pronunciation is estimated in this practice test.";
    return "";
  }

  // Uma pagina por passagem: texto a esquerda, questoes a direita.
  buildReadingPages(items) {
    const pages = [];
    this.data.passages.forEach((passage, i) => {
      const passItems = items.filter((it) => it.passage_ref === passage.id);
      if (!passItems.length) return;

      const passEl = el("article", { class: "passage" }, [el("h3", { text: passage.title })]);
      for (const para of passage.paragraphs) {
        if (typeof para === "string") passEl.append(el("p", { text: para }));
        else passEl.append(el("p", { dataset: { key: para.key }, text: para.text }));
      }
      const qCol = el("div", { class: "questions" });
      for (const it of passItems) rendererFor(it.primitive).render(qCol, it);

      pages.push({ label: `Passage ${i + 1}`, node: el("section", { class: "split" }, [passEl, qCol]) });
    });
    return pages;
  }

  // Uma pagina por item (Writing task / Speaking part).
  buildItemPages(items, labelFn) {
    return items.map((it) => {
      const node = el("div", { class: "questions measure" });
      rendererFor(it.primitive).render(node, it);
      return { label: labelFn(it), node };
    });
  }

  // Agrupa itens por parte (Listening).
  pagesByPart(items) {
    const byPart = new Map();
    for (const it of items) {
      if (!byPart.has(it.part)) byPart.set(it.part, []);
      byPart.get(it.part).push(it);
    }
    return [...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([part, its]) => {
      const node = el("div", { class: "questions" });
      for (const it of its) rendererFor(it.primitive).render(node, it);
      return { label: `Part ${part}`, node };
    });
  }

  renderListening(items) {
    this.player = new ListeningPlayer(this.data.audios, () => this.afterListeningAudio());
    const stage = el("div", {});

    // Questoes paginadas por parte. A submissao e automatica (via player), entao o
    // paginador e so de navegacao; o player vira a pagina ao mudar de parte.
    const pages = this.pagesByPart(items);
    this.pager = createPager(pages, { navOnly: true });
    this.player.onPart = (i) => this.pager.show(i);

    this.main.append(stage, el("div", { style: "margin-top:2rem" }, [this.pager.root]));
    this.player.mount(stage);
  }

  afterListeningAudio() {
    // Audio acabou + 2 min de revisao: submete a secao automaticamente.
    this.submitCurrent();
  }

  startTimer(seconds) {
    this.timerEl.style.display = "inline-block";
    this.timer = new SectionTimer(
      seconds,
      (left) => {
        this.timerEl.textContent = SectionTimer.format(left);
        this.timerEl.dataset.warning = left <= 60 ? "true" : "false";
      },
      () => this.submitCurrent(true),
    );
    this.timer.start();
  }

  stopTimer() {
    if (this.timer) { this.timer.stop(); this.timer = null; }
    if (this.timerEl) this.timerEl.style.display = "none";
  }

  async submitCurrent(auto = false) {
    const skill = this.currentSkill;
    const items = this.bySkill[skill] || [];
    this.stopTimer();
    if (this.player) { this.player.destroy(); this.player = null; }

    this.main.append(el("div", { class: "loading", id: "submitting", text: "Marking your section…" }));

    try {
      if (skill === "listening" || skill === "reading") {
        const responses = buildObjectiveResponses(items, (it) => this.collect(it));
        await submitSection(this.attemptId, skill, responses);
      } else {
        // Speaking: faz upload do audio (best-effort) antes de pontuar.
        if (skill === "speaking") {
          for (const it of items) {
            const r = this.collect(it);
            if (r.blob) { try { await uploadSpeaking(this.attemptId, it.part, r.blob); } catch { /* opcional */ } }
          }
        }
        const payload = buildProductiveTasks(skill, items, (it) => this.collect(it));
        await submitSection(this.attemptId, skill, payload);
      }
    } catch (e) {
      document.getElementById("submitting")?.remove();
      this.main.append(el("div", { class: "errorbox", text: `Could not mark this section: ${e.message}` }));
      return;
    }

    this.index++;
    if (this.index >= this.sections.length) return this.finish();
    this.renderSection();
  }

  async finish() {
    this.main.replaceChildren(el("div", { class: "loading", text: "Building your report…" }));
    this.stopTimer();
    try {
      const report = await finalizeAttempt(this.attemptId);
      this.brand.textContent = "Hey, Teacher! · Results";
      this.nav.replaceChildren();
      renderResults(this.main, report);
    } catch (e) {
      this.main.replaceChildren(el("div", { class: "errorbox", text: `Could not finalise: ${e.message}` }));
    }
  }
}

const root = document.getElementById("app");
if (root) {
  const paperId = root.dataset.paper || DEFAULT_PAPER_ID;
  new Exam(root, paperId).boot();
}

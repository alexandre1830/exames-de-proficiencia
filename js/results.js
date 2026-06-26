// Relatorio de score. Banda em destaque, CEFR ao lado, detalhe por secao.
import { el } from "./render/dom.js";

const SKILL_LABEL = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };

function bandText(b) {
  return b == null ? "—" : Number(b).toFixed(1).replace(/\.0$/, ".0");
}

function sectionCard(s) {
  const card = el("div", { class: "score-card" });
  card.append(
    el("p", { class: "score-card__skill", text: SKILL_LABEL[s.skill] || s.skill }),
    el("p", { class: "score-card__band", text: bandText(s.band) }),
  );
  if (s.raw_score != null) {
    card.append(el("p", { class: "score-card__detail", text: `${s.raw_score} / 40 correct` }));
  }
  // W/S: criterios por task.
  const tasks = s.criteria?.tasks;
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      const ul = el("ul", { class: "criteria-list" });
      for (const c of t.criteria || []) {
        ul.append(el("li", {}, [
          el("span", {}, [c.name, c.estimated ? el("span", { class: "estimated", text: " (estimated)" }) : null]),
          el("b", { text: bandText(c.band) }),
        ]));
      }
      card.append(el("p", { class: "score-card__detail", text: t.taskType }), ul);
    }
  }
  return card;
}

export function renderResults(container, report) {
  const wrap = el("div", { class: "report" });

  wrap.append(el("div", { class: "report__hero" }, [
    el("div", {}, [
      el("p", { class: "chip", text: "Overall band" }),
      el("p", { class: "band-big", text: bandText(report.overallBand) }),
    ]),
    el("p", { class: "cefr-tag", text: report.cefr ? `≈ ${report.cefr}` : "" }),
  ]));

  wrap.append(el("p", { class: "notice" }, [
    "CEFR is shown as an approximate reference, not an exact equivalence. ",
    "This is an original practice test in the style of IELTS and is not affiliated with or endorsed by the IELTS partners.",
  ]));

  const grid = el("div", { class: "report__grid" });
  const order = ["listening", "reading", "writing", "speaking"];
  const bySkill = Object.fromEntries((report.sections || []).map((s) => [s.skill, s]));
  for (const skill of order) {
    if (bySkill[skill]) grid.append(sectionCard(bySkill[skill]));
  }
  wrap.append(grid);

  // Feedback produtivo agregado.
  const feedbacks = (report.sections || [])
    .filter((s) => s.criteria?.tasks)
    .flatMap((s) => (s.criteria.tasks || []).map((t) => ({ skill: s.skill, fb: t.feedback })))
    .filter((x) => x.fb);
  if (feedbacks.length) {
    const fbWrap = el("div", { class: "card" }, [el("h3", { text: "Examiner feedback" })]);
    for (const f of feedbacks) fbWrap.append(el("p", { class: "measure", text: f.fb }));
    wrap.append(fbWrap);
  }

  container.replaceChildren(wrap);
}

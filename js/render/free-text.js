// free_text (Writing): textarea com contador de palavras e minWords.
// Task 1 desenha o grafico a partir de chartData. raw -> { text, wordCount }
import { el, itemShell } from "./dom.js";

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Grafico de barras agrupadas simples (SVG), a partir de chartData.
function chart(data) {
  const years = data.years || [];
  const series = data.series || {};
  const labels = Object.keys(series);
  const max = Math.max(1, ...labels.flatMap((k) => series[k]));
  const W = 520, H = 260, padL = 36, padB = 40, padT = 12;
  const groupW = (W - padL) / years.length;
  const barW = Math.min(26, (groupW - 16) / labels.length);
  const colors = ["var(--navy)", "var(--red)", "var(--navy-light)"];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${data.unit || "values"} by year`);

  years.forEach((yr, gi) => {
    const gx = padL + gi * groupW + 8;
    labels.forEach((lab, li) => {
      const v = series[lab][gi] ?? 0;
      const h = (v / max) * (H - padB - padT);
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("x", gx + li * (barW + 2));
      rect.setAttribute("y", H - padB - h);
      rect.setAttribute("width", barW);
      rect.setAttribute("height", h);
      rect.setAttribute("fill", colors[li % colors.length]);
      rect.setAttribute("rx", "3");
      svg.append(rect);
    });
    const t = document.createElementNS(svg.namespaceURI, "text");
    t.setAttribute("x", gx + (labels.length * (barW + 2)) / 2);
    t.setAttribute("y", H - padB + 18);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "12");
    t.setAttribute("fill", "var(--text-mute)");
    t.textContent = yr;
    svg.append(t);
  });

  const legend = el("div", { style: "display:flex;gap:1rem;flex-wrap:wrap;margin-top:.5rem" });
  labels.forEach((lab, li) => {
    legend.append(el("span", { style: "display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem" }, [
      el("span", { style: `width:.8rem;height:.8rem;border-radius:3px;background:${colors[li % colors.length]}` }),
      lab,
    ]));
  });
  return el("figure", { class: "chart-figure" }, [svg, legend]);
}

export const freeText = {
  render(container, item) {
    const shell = itemShell(item);
    const wrap = el("div", { class: "writing-task" });

    wrap.append(el("p", { class: "qblock__stem", text: item.content.prompt || "" }));
    if (item.content.chartData) wrap.append(chart(item.content.chartData));

    const ta = el("textarea", {
      class: "field", id: `${item.id}-text`, spellcheck: "false",
      placeholder: "Write your answer here…", "aria-label": "Your answer",
    });
    const counter = el("p", { class: "word-count" });
    const min = item.content.minWords || 0;
    const update = () => {
      const wc = wordCount(ta.value);
      counter.dataset.under = wc < min ? "true" : "false";
      counter.textContent = `${wc} words${min ? ` (minimum ${min})` : ""}`;
    };
    ta.addEventListener("input", update);
    update();

    wrap.append(ta, counter);
    shell.append(wrap);
    container.append(shell);
  },

  collectResponse(item) {
    const ta = document.getElementById(`${item.id}-text`);
    const text = ta ? ta.value : "";
    return { text, wordCount: wordCount(text) };
  },
};

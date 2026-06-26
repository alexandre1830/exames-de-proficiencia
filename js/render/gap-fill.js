// gap_fill: form/note/flowchart completion. Inputs inline no template.
// raw -> { "<n>": "texto digitado" }
import { el, itemShell } from "./dom.js";

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export const gapFill = {
  render(container, item) {
    const shell = itemShell(item);
    const limit = item.content.wordLimit || {};
    const template = item.content.template || "";

    const tpl = el("div", { class: "gap-template" });
    // Divide por {{n}} mantendo os numeros.
    const parts = template.split(/(\{\{\d+\}\})/);
    const inputs = [];
    for (const part of parts) {
      const m = part.match(/^\{\{(\d+)\}\}$/);
      if (m) {
        const n = m[1];
        const input = el("input", {
          type: "text", class: "gap-input", inputmode: "text",
          "aria-label": `Answer ${n}`, dataset: { n },
          autocomplete: "off", autocapitalize: "off", spellcheck: "false",
        });
        inputs.push(input);
        tpl.append(el("span", { class: "qblock__num", text: n, style: "min-width:1.6rem;height:1.6rem" }), input);
      } else if (part) {
        tpl.append(document.createTextNode(part));
      }
    }
    shell.append(tpl);

    // Contador / aviso de limite (nao impede; o servidor decide).
    if (limit.maxWords) {
      const counter = el("p", { class: "gap-counter" });
      const update = () => {
        const over = inputs.some((i) => wordCount(i.value) > limit.maxWords);
        counter.dataset.over = over ? "true" : "false";
        counter.textContent = over
          ? `Limit: no more than ${limit.maxWords} word(s)${limit.allowNumber ? " and/or a number" : ""}.`
          : `Up to ${limit.maxWords} word(s)${limit.allowNumber ? " and/or a number" : ""} per gap.`;
      };
      inputs.forEach((i) => i.addEventListener("input", update));
      update();
      shell.append(counter);
    }

    container.append(shell);
  },

  collectResponse(item) {
    const raw = {};
    // Numeros de lacuna sao unicos dentro de uma secao montada.
    for (const g of item.content.gaps || []) {
      const input = document.querySelector(`.gap-input[data-n="${g.n}"]`);
      if (input && input.value.trim()) raw[g.n] = input.value;
    }
    return raw;
  },
};

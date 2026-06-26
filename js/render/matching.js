// matching: headings / features / sentence-endings. Select por sub-questao (acessivel).
// raw -> { "<n>": "key" }
import { el, itemShell } from "./dom.js";

function promptLabel(p) {
  if (p.statement) return p.statement;
  if (p.stem) return p.stem;
  if (p.text) return p.text;
  if (p.key) return `Paragraph ${p.key}`;
  return "";
}

export const matching = {
  render(container, item) {
    const shell = itemShell(item);
    const options = item.content.options || [];
    const reusable = item.content.reusableOptions !== false;
    const selects = [];

    for (const p of item.content.prompts || []) {
      const id = `${item.id}-${p.n}`;
      const select = el("select", { class: "field", id, "aria-label": `Question ${p.n}` });
      select.append(el("option", { value: "", text: "—" }));
      for (const opt of options) {
        select.append(el("option", { value: opt.key, text: `${opt.key}. ${opt.text}` }));
      }
      selects.push(select);

      shell.append(el("div", { class: "match-row" }, [
        el("span", { class: "match-row__prompt" }, [el("span", { class: "qblock__num", text: String(p.n) }), promptLabel(p)]),
        select,
      ]));
    }

    // Banco de opcoes (referencia visivel).
    const bank = el("div", { class: "match-options" }, [el("h4", { text: "Options" })]);
    const ul = el("ul");
    for (const opt of options) ul.append(el("li", {}, [el("b", { text: opt.key }), ` ${opt.text}`]));
    bank.append(ul);
    shell.append(bank);

    // Sem reuso: impedir a mesma opcao em mais de um select.
    if (!reusable) {
      const sync = () => {
        const used = new Set(selects.map((s) => s.value).filter(Boolean));
        for (const s of selects) {
          for (const o of s.options) {
            if (!o.value) continue;
            o.disabled = used.has(o.value) && s.value !== o.value;
          }
        }
      };
      selects.forEach((s) => s.addEventListener("change", sync));
    }

    container.append(shell);
  },

  collectResponse(item) {
    const raw = {};
    for (const p of item.content.prompts || []) {
      const v = document.getElementById(`${item.id}-${p.n}`)?.value;
      if (v) raw[p.n] = v;
    }
    return raw;
  },
};

// single_select: TFNG / YNNG (opcoes fixas) e multiple-choice (opcoes por questao).
// raw -> { "<n>": "VALUE" }  (VALUE = string da opcao ou letra)
import { el, itemShell } from "./dom.js";

function optionLabel(name, value, display) {
  return el("label", { class: "option" }, [
    el("input", { type: "radio", name, value }),
    el("span", { text: display }),
  ]);
}

export const singleSelect = {
  render(container, item) {
    const shell = itemShell(item);
    const fixed = item.content.options; // array de strings para TFNG/YNNG

    for (const q of item.content.questions || []) {
      const name = `${item.id}-${q.n}`;
      const block = el("fieldset", { class: "qblock" });
      const legend = el("legend", { class: "qblock__stem" }, [
        el("span", { class: "qblock__num", text: String(q.n) }),
        q.stem || q.statement || "",
      ]);
      block.append(legend);

      const list = el("div", { class: "options-list" });
      if (Array.isArray(fixed) && !q.options) {
        for (const opt of fixed) {
          list.append(optionLabel(name, opt, opt.replace(/_/g, " ")));
        }
      } else {
        for (const opt of q.options || []) {
          list.append(optionLabel(name, opt.key, `${opt.key}. ${opt.text}`));
        }
      }
      block.append(list);
      shell.append(block);
    }
    container.append(shell);
  },

  collectResponse(item) {
    const raw = {};
    for (const q of item.content.questions || []) {
      const checked = document.querySelector(`input[name="${item.id}-${q.n}"]:checked`);
      if (checked) raw[q.n] = checked.value;
    }
    return raw;
  },
};

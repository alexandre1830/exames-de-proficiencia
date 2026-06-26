// multi_select: escolher exatamente chooseCount letras.
// raw -> { selected: ["C","E"] }
import { el, itemShell } from "./dom.js";

export const multiSelect = {
  render(container, item) {
    const shell = itemShell(item);
    const choose = item.content.chooseCount;
    const name = `${item.id}-multi`;

    const hint = el("p", { class: "item__instructions" }, [
      `Choose ${choose === 2 ? "TWO" : choose} letters.`,
    ]);
    shell.append(hint);

    const list = el("div", { class: "options-list", role: "group", "aria-label": item.instructions || "" });
    const inputs = [];
    for (const opt of item.content.options || []) {
      const input = el("input", { type: "checkbox", name, value: opt.key });
      inputs.push(input);
      list.append(el("label", { class: "option" }, [input, el("span", { text: `${opt.key}. ${opt.text}` })]));
    }
    // Limita a selecao a chooseCount (avisa via aria, nao bloqueia silenciosamente).
    const enforce = () => {
      const checked = inputs.filter((i) => i.checked);
      const full = checked.length >= choose;
      for (const i of inputs) i.disabled = full && !i.checked;
      hint.dataset.over = checked.length > choose ? "true" : "false";
    };
    inputs.forEach((i) => i.addEventListener("change", enforce));

    shell.append(list);
    container.append(shell);
  },

  collectResponse(item) {
    const checked = [...document.querySelectorAll(`input[name="${item.id}-multi"]:checked`)];
    return { selected: checked.map((c) => c.value) };
  },
};

// labelling: mapa/diagrama com pontos numerados; cada ponto recebe uma letra.
// Sem imagem ainda: renderiza mapDescription como fallback textual (brief).
// raw -> { "<n>": "B" }
import { el, itemShell } from "./dom.js";

export const labelling = {
  render(container, item) {
    const shell = itemShell(item);
    const options = item.content.options || [];
    const grid = el("div", { class: "label-map" });

    // Coluna 1: imagem ou fallback textual.
    if (item.content.imageRef && /^https?:/.test(item.content.imageRef)) {
      grid.append(el("img", { src: item.content.imageRef, alt: "Map to label" }));
    } else {
      grid.append(el("div", { class: "label-map__fallback" }, [
        el("strong", { text: "Map description: " }),
        item.content.mapDescription || "Image pending.",
      ]));
    }

    // Coluna 2: pontos -> select de letras.
    const col = el("div");
    for (const p of item.content.prompts || []) {
      const id = `${item.id}-${p.n}`;
      const select = el("select", { class: "field", id, "aria-label": `Feature ${p.n}` });
      select.append(el("option", { value: "", text: "—" }));
      for (const opt of options) select.append(el("option", { value: opt, text: opt }));
      col.append(el("div", { class: "match-row" }, [
        el("span", { class: "match-row__prompt" }, [el("span", { class: "qblock__num", text: String(p.n) }), p.text]),
        select,
      ]));
    }
    grid.append(col);
    shell.append(grid);
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

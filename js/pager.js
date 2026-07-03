// Paginador de partes dentro de uma secao. Todas as paginas ficam montadas no DOM
// (so a ativa e visivel), para que as respostas nao se percam ao navegar e o
// envio continue lendo todas via collectResponse.
import { el } from "./render/dom.js";

// pages: [{ label, node }]
// opts: { onFinish, finishLabel, navOnly }
//   - onFinish: chamado ao clicar "enviar" na ultima pagina.
//   - navOnly: sem botao de envio (ex.: Listening, que submete via player).
export function createPager(pages, opts = {}) {
  let index = 0;

  const pagesWrap = el("div", { class: "pager__pages" });
  pages.forEach((p, i) => {
    p.node.classList.add("part-page");
    p.node.setAttribute("tabindex", "-1");
    p.node.hidden = i !== 0;
    pagesWrap.append(p.node);
  });

  const prevBtn = el("button", { class: "btn btn--ghost", type: "button", text: "Back" });
  const nextBtn = el("button", { class: "btn btn--accent", type: "button" });
  const indicator = el("span", { class: "pager__count", "aria-live": "polite" });

  const dots = el("div", { class: "pager__dots", role: "tablist", "aria-label": "Parts" });
  pages.forEach((p, i) => {
    dots.append(el("button", {
      class: "pager__dot", type: "button", role: "tab",
      "aria-label": p.label, title: p.label, onclick: () => show(i, true),
    }));
  });

  function show(i, focus = false) {
    index = Math.max(0, Math.min(pages.length - 1, i));
    pages.forEach((p, k) => { p.node.hidden = k !== index; });
    [...dots.children].forEach((d, k) => d.setAttribute("aria-current", k === index ? "true" : "false"));

    prevBtn.disabled = index === 0;
    indicator.textContent = `${pages[index].label} · ${index + 1} of ${pages.length}`;

    const last = index === pages.length - 1;
    if (opts.navOnly) {
      nextBtn.textContent = "Next";
      nextBtn.disabled = last;
    } else {
      nextBtn.disabled = false;
      nextBtn.textContent = last ? (opts.finishLabel || "Submit section") : "Next";
    }

    if (focus) {
      pagesWrap.scrollIntoView({ block: "start", behavior: "smooth" });
      pages[index].node.focus({ preventScroll: true });
    }
  }

  prevBtn.onclick = () => show(index - 1, true);
  nextBtn.onclick = () => {
    const last = index === pages.length - 1;
    if (last && !opts.navOnly) opts.onFinish?.();
    else if (!last) show(index + 1, true);
  };

  const nav = el("div", { class: "pager__nav" }, [
    prevBtn,
    el("div", { class: "pager__mid" }, [indicator, dots]),
    nextBtn,
  ]);

  const root = el("div", { class: "pager" }, [pagesWrap, nav]);
  show(0);

  return { root, show, get index() { return index; }, count: pages.length };
}

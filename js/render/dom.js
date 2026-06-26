// Helpers minimos de DOM para os renderizadores.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Bloco padrao de um item (cabecalho com faixa + instrucoes).
export function itemShell(item) {
  const range = item.question_numbers?.length
    ? `${item.question_numbers[0]}–${item.question_numbers[item.question_numbers.length - 1]}`
    : "";
  const wrap = el("section", { class: "item", "aria-label": `Questoes ${range}` });
  if (range || item.instructions) {
    wrap.append(el("p", { class: "item__instructions" }, [
      range ? el("span", { class: "item__range", text: `Questions ${range}. ` }) : null,
      item.instructions || "",
    ]));
  }
  return wrap;
}

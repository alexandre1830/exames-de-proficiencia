// Registro de renderizadores por primitiva (ADR-02: opera-se pela primitiva).
import { singleSelect } from "./single-select.js";
import { multiSelect } from "./multi-select.js";
import { matching } from "./matching.js";
import { gapFill } from "./gap-fill.js";
import { labelling } from "./labelling.js";
import { freeText } from "./free-text.js";
import { spokenResponse } from "./spoken-response.js";

export const RENDERERS = {
  single_select: singleSelect,
  multi_select: multiSelect,
  matching,
  gap_fill: gapFill,
  labelling,
  free_text: freeText,
  spoken_response: spokenResponse,
};

export function rendererFor(primitive) {
  const r = RENDERERS[primitive];
  if (!r) throw new Error(`Sem renderizador para a primitiva ${primitive}`);
  return r;
}

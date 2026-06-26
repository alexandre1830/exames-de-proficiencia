// Arredondamento de banda IELTS (regra canonica do CLAUDE.md / brief).
// .25 sobe para .5 ; .75 sobe para o inteiro.
export function roundBand(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.25) return f;
  if (d < 0.75) return f + 0.5;
  return f + 1;
}

// Banda da seção de Writing: (T1 + 2*T2) / 3, arredondada para 0.5.
export function writingSectionBand(task1: number, task2: number): number {
  return roundBand((task1 + 2 * task2) / 3);
}

// Media simples arredondada para 0.5 (Speaking, banda geral).
export function meanBand(values: number[]): number {
  if (!values.length) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return roundBand(sum / values.length);
}

export function cefrFor(
  rows: Array<{ band_min: number; band_max: number; cefr: string }>,
  band: number,
): string {
  const hit = rows.find((r) => band >= r.band_min && band <= r.band_max);
  return hit ? hit.cefr : "";
}

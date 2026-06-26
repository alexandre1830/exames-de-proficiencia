// Correcao objetiva por primitiva. Funcoes puras, sem I/O.
// O gabarito (answer_key) vive so no servidor. Estas funcoes recebem o item
// completo (com answer_key) e a resposta canonica do aluno (raw).

export type QuestionResult = {
  question_number: number | null;
  correct: boolean;
  awarded_points: number;
};

// ---- Normalizacao de gap_fill (centralizada, conforme o brief) ----

export function normalizeGap(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function countWords(normalized: string): number {
  if (!normalized) return 0;
  // Hifenizada conta como 1 (nao ha espaco). Conta tokens separados por espaco.
  return normalized.split(" ").filter(Boolean).length;
}

// Acerto de uma lacuna: o aluno bate com qualquer forma aceita (que ja inclui
// grafias britanica/americana quando o autor as listou). A lista accepted e
// autoritativa, entao um match sempre vale; o limite de palavras so rejeita
// respostas fora da lista.
export function gradeGap(
  student: string,
  accepted: string[],
  wordLimit?: { maxWords?: number; allowNumber?: boolean },
): boolean {
  const norm = normalizeGap(student);
  if (!norm) return false;
  const acc = (accepted || []).map(normalizeGap);
  if (acc.includes(norm)) return true;
  if (wordLimit?.maxWords && countWords(norm) > wordLimit.maxWords) return false;
  return false;
}

// ---- Helpers de comparacao exata (letras / numerais romanos) ----

function sameToken(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
}

// Extrai o array de selecoes de um multi_select, tolerante ao formato.
function selectionsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object") {
    const vals = Object.values(raw as Record<string, unknown>);
    const arr = vals.find((v) => Array.isArray(v));
    if (Array.isArray(arr)) return arr.map(String);
  }
  return [];
}

// ---- Grader por item ----
// item: { primitive, question_numbers, content, answer_key }
// raw: resposta canonica do aluno para ESTE item.
export function gradeItem(item: any, raw: any): QuestionResult[] {
  const primitive = item.primitive;
  const key = item.answer_key || {};
  const out: QuestionResult[] = [];

  switch (primitive) {
    case "single_select":
    case "matching":
    case "labelling": {
      for (const [n, expected] of Object.entries(key)) {
        const got = raw?.[n] ?? raw?.[Number(n)];
        const correct = sameToken(got, expected);
        out.push({ question_number: Number(n), correct, awarded_points: correct ? 1 : 0 });
      }
      return out;
    }

    case "gap_fill": {
      const wordLimit = item.content?.wordLimit;
      for (const [n, accepted] of Object.entries(key)) {
        const got = raw?.[n] ?? raw?.[Number(n)];
        const correct = gradeGap(String(got ?? ""), accepted as string[], wordLimit);
        out.push({ question_number: Number(n), correct, awarded_points: correct ? 1 : 0 });
      }
      return out;
    }

    case "multi_select": {
      const expected: string[] = Array.isArray(key) ? key : (key.answers || key.selected || []);
      const chooseCount = item.content?.chooseCount ?? expected.length;
      const nums: number[] = item.question_numbers || [];
      const picked = selectionsOf(raw).map((s) => s.trim().toUpperCase());
      const expSet = new Set(expected.map((s) => s.trim().toUpperCase()));

      // Selecao com contagem errada zera o grupo inteiro.
      let correctCount = 0;
      if (picked.length === chooseCount) {
        const seen = new Set<string>();
        for (const p of picked) {
          if (expSet.has(p) && !seen.has(p)) {
            correctCount++;
            seen.add(p);
          }
        }
      }
      // Distribui o credito pelas question_numbers do grupo.
      nums.forEach((n, i) => {
        const correct = i < correctCount;
        out.push({ question_number: n, correct, awarded_points: correct ? 1 : 0 });
      });
      return out;
    }

    default:
      return out;
  }
}

// Busca a banda a partir do bruto numa tabela de conversao (linhas com raw_min/raw_max/band).
export function bandFromRaw(
  rows: Array<{ raw_min: number; raw_max: number; band: number }>,
  raw: number,
): number {
  const hit = rows.find((r) => raw >= r.raw_min && raw <= r.raw_max);
  return hit ? Number(hit.band) : 0;
}

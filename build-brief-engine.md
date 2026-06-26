# Build Brief: Engine de Prova (IELTS Academic)

Destino: Claude Code. Pré-requisitos: `CLAUDE.md`, `schema.sql`, os dois JSON da Prova 01, `build-brief-tts-cache.md`.

---

## 1. Visão geral

Engine vanilla que carrega uma prova, conduz o aluno pelas quatro seções com timer, coleta respostas, envia para correção no servidor e exibe o relatório de banda. Nenhuma correção e nenhum gabarito no cliente.

---

## 2. Fluxo de prova (máquina de estados)

Ordem das seções: **Listening, Reading, Writing, Speaking**.

```
load_paper -> create_attempt -> [section: listening] -> submit_section
            -> [section: reading] -> submit_section
            -> [section: writing] -> submit_section
            -> [section: speaking] -> submit_section
            -> finalize -> results
```

`state.js` mantém: `attemptId`, `currentSection`, `responses` em memória por seção, e o timer da seção. Regras:

- Cada seção tem seu próprio timer (`durationSeconds`). Ao zerar, a seção é submetida automaticamente.
- Dentro de Reading e Writing o aluno navega livremente entre questões/tasks da seção. Não volta para seções já submetidas.
- Listening: o tempo é guiado pelo áudio (ver player). Termina o áudio, abre 2 minutos de revisão, depois submete.
- Speaking: guiado por prep/talk timers de cada parte.
- A submissão de cada seção chama a função de correção e persiste. O resultado final só é montado em `finalize`.

---

## 3. Renderizadores (6 primitivas)

Contrato comum. Cada renderer recebe um item de `items_public` (sem gabarito) e expõe:

```
render(container, item)      // monta o DOM
collectResponse(item) -> raw // devolve a resposta no formato canônico abaixo
```

Formato canônico de `raw` por primitiva (é o que vai para o servidor):

| primitive | raw |
|---|---|
| single_select | `{ "<n>": "B" }` por questão |
| multi_select | `{ "<grupo>": ["C","E"] }` |
| matching | `{ "<n>": "iv", ... }` |
| gap_fill | `{ "<n>": "texto digitado", ... }` |
| labelling | `{ "<n>": "E", ... }` |
| free_text | `{ "text": "...", "wordCount": 263 }` |
| spoken_response | `{ "audioPath": "storage://...", "transcript": "..."? }` |

Notas de implementação por primitiva:

- **single_select**: radios acessíveis. Para TFNG/YNNG, três opções fixas. Um item agrupa várias questões numeradas; renderizar cada uma como um bloco.
- **multi_select**: checkboxes com `chooseCount`. Bloquear seleção acima de `chooseCount` ou avisar. O servidor zera se a contagem estiver errada.
- **matching**: lista de `prompts` à esquerda, banco de `options` à direita. Se `reusableOptions` for falso, cada opção só pode ser usada uma vez (refletir na UI). Drag-and-drop ou select por item; select é mais acessível.
- **gap_fill**: renderizar `template` substituindo `{{n}}` por inputs inline. Mostrar a regra de `wordLimit` (ex.: "NO MORE THAN TWO WORDS"). Contar palavras ao digitar e avisar se exceder, mas não impedir (o servidor decide).
- **labelling**: imagem (`imageRef`) com pontos numerados; cada ponto recebe uma letra via select a partir de `options`. Enquanto a imagem não existir, renderizar a `mapDescription` como fallback textual.
- **free_text** (Writing): textarea com contador de palavras visível e o `minWords`. Sem corretor ortográfico do navegador (`spellcheck="false"`) para fidelidade.
- **spoken_response** (Speaking): ver seção 5.

---

## 4. Listening player

Fonte: `audios.segments` (via view `audios_public`, sem `transcript`). Cada segmento: `{ order, url, pauseAfterMs }`.

- **Pré-carregar** todos os `url` da parte antes de iniciar, para reprodução contínua.
- Tocar em ordem, inserindo `pauseAfterMs` entre segmentos e as **prévias de 30s** antes de cada grupo de questões (campo `playback`).
- **Sem controles** de pausar ou retroceder. Reprodução única.
- Ao final da última parte, 2 minutos de revisão, depois submete a seção.
- Se faltar `url` (prova não aquecida), bloquear o início e avisar. Nunca chamar a API de TTS em prova.

---

## 5. Speaking (gravação, upload, transcrição)

- Gravar com `MediaRecorder`. Respeitar `prepSeconds` (Part 2) e `talkSeconds` por parte.
- Upload do áudio para Storage (bucket privado `speaking-responses`, caminho por `attemptId`).
- Transcrição: ponto de integração plugável. MVP pode usar a Web Speech API no cliente; para mais robustez, uma Edge Function que transcreve o áudio enviado. O transcript alimenta `score-productive`.
- Pronunciation é **estimada** (ADR-05): sem análise acústica, pontue bem os outros três critérios e marque Pronunciation como estimada no relatório.

---

## 6. Correção objetiva (`score-objective`, server-side)

Edge Function com service role. Recebe `{ attemptId, skill, responses }`, lê `items` (com `answer_key`), corrige, persiste em `responses` e `section_scores`, devolve `{ raw, band }`.

Comparação por primitiva:

- **single_select / labelling**: match exato da letra. 1 ponto por questão.
- **matching**: match exato por sub-questão. 1 ponto cada.
- **multi_select**: exigir exatamente `chooseCount` seleções; se diferente, 0 no grupo. Caso correto, 1 ponto por letra certa (ordem irrelevante).
- **gap_fill**: normalizar e comparar contra `accepted[]`.

Normalização de `gap_fill` (centralizar numa função):

```
1. trim e colapso de espaços.
2. comparação case-insensitive.
3. contagem de palavras: hifenizada conta como 1. Exceder maxWords => errado.
4. número conta dentro do limite quando allowNumber.
5. aceitar grafia britânica e americana se ambas estiverem em accepted.
6. acerto se o valor normalizado bate com qualquer item de accepted.
```

Conversão final: somar bruto por skill, buscar em `band_conversion` a banda correspondente.

---

## 7. Correção produtiva (`score-productive`, server-side, IA)

Edge Function com service role e a chave de IA. Contrato:

```ts
// entrada
{ attemptId, skill: "writing"|"speaking", taskType, prompt, studentText, criteria: string[] }
// saida
{ criteria: [{ name, band, justification }], sectionBand, feedback }
```

Abordagem do MVP (realista, sem precisar de 32 células de descritor escritas à mão):

- Enviar ao modelo: o enunciado, a resposta do aluno, a lista de critérios com uma **definição original** de cada um, e a escala 0 a 9 com âncoras (ex.: 9 = uso plenamente operacional; 7 = bom uso com imprecisões ocasionais; 5 = uso modesto com limitações; abaixo, uso restrito). Pedir banda por critério com justificativa curta, **saída só em JSON**, `temperature` baixa.
- Não copiar os descritores oficiais do IELTS (são protegidos). Usar redação própria que captura o construto e está alinhada ao CEFR.
- Writing: aplicar a fórmula ponderada do Task 2. Speaking: média dos 4 critérios.
- **Calibrar** contra um conjunto de respostas-modelo já pontuadas antes de liberar. Adicionar descritores por banda mais finos depois melhora a consistência.

Critérios (nomes):
- Writing Task 1: Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.
- Writing Task 2: Task Response no lugar de Task Achievement.
- Speaking: Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation.

---

## 8. Relatório de resultado (`results.js`)

Mostrar por seção: bruto (L/R), banda (as quatro) e, no W/S, banda por critério mais o feedback. Depois, banda geral e CEFR.

Função de arredondamento (usar em todo lugar):

```js
function roundBand(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.25) return f;
  if (d < 0.75) return f + 0.5;
  return f + 1;
}
```

- Banda geral = `roundBand(média das 4 seções)`.
- CEFR a partir de `cefr_map`.
- Design: legível e on-brand, sem competir com o conteúdo. Banda em destaque, CEFR ao lado, detalhamento por seção abaixo. Aplicar tokens e a skill `frontend-design`.

---

## 9. Persistência

- `attempts`: criada no início, finalizada no fim, guarda `overall_band` e `cefr`.
- `responses`: uma linha por questão respondida, com `raw`, `correct` e `awarded_points` (preenchidos pela correção).
- `section_scores`: bruto e banda por skill; no W/S, guardar as bandas por critério em `jsonb`.
- MVP é anônimo: tentativa identificada pelo uuid. Endurecer RLS quando houver contas.

---

## 10. `api.js` (contratos do cliente)

```
loadPaper(paperId)            -> { paper, passages, audios(public), items(public) }
createAttempt(paperId)        -> attemptId
submitSection(attemptId, skill, responses) -> { raw?, band, criteria?, feedback? }
finalizeAttempt(attemptId)    -> { overallBand, cefr, sections: [...] }
uploadSpeaking(attemptId, part, blob) -> audioPath
```

Cliente nunca lê `answer_key`, nunca chama TTS, nunca pontua.

---

## 11. Acessibilidade, responsivo, motion

- Teclado em tudo. Foco visível por tokens. ARIA roles em matching, labelling e nos controles de gravação.
- Custom selects e drag-and-drop precisam de alternativa por teclado.
- Layout responsivo, mobile incluso. Em telas estreitas, prompts e opções empilham.
- Toda animação respeita `prefers-reduced-motion`.

---

## 12. Seeding

Carregar os dois JSON da Prova 01 nas tabelas:
- `paper` -> `papers`; `passages` -> `passages`; `audioScripts` -> `audios` (com `transcript` na coluna service-only e `segments` preenchidos depois pelo warm); `items` -> `items` (separar `answer_key` dos campos públicos); `rubrics` vira referência em `score-productive`.
- Depois rodar `tts-warm-paper` para a Prova 01 (uma vez) e gravar os `segments` de áudio.

---

## 13. Critérios de aceite (definition of done)

1. A Prova 01 carrega e renderiza as quatro seções com os 6 renderizadores.
2. Listening toca uma vez, com prévias e sem controles; sem chamada de TTS em prova.
3. L/R corrigidos no servidor, com as regras de normalização; gabarito nunca aparece no cliente (conferir no DevTools).
4. W/S pontuados pela Edge Function de IA, com banda por critério e feedback.
5. Relatório mostra banda por seção, banda geral arredondada e CEFR.
6. Tentativa e respostas persistidas. Anônimo funciona.
7. Acessível por teclado, responsivo, `prefers-reduced-motion` respeitado, tokens aplicados.
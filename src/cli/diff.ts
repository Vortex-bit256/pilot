


export type DiffLineType = "context" | "add" | "del" | "gap";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}


const MAX_TABLE_CELLS = 4_000_000;

type Op = { type: Exclude<DiffLineType, "gap">; text: string };


export function diffLines(oldText: string, newText: string, context = 3): DiffLine[] {
  const ops = computeOps(oldText.split("\n"), newText.split("\n"));


  const keep = new Set<number>();
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === "context") {
      continue;
    }
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) {
      keep.add(j);
    }
  }
  if (keep.size === 0) {
    return [];
  }

  const result: DiffLine[] = [];
  let previousKept = -2;
  for (let i = 0; i < ops.length; i++) {
    if (!keep.has(i)) {
      continue;
    }
    if (result.length > 0 && i > previousKept + 1) {
      result.push({ type: "gap", text: "…" });
    }
    result.push({ type: ops[i].type, text: ops[i].text });
    previousKept = i;
  }
  return result;
}


function computeOps(a: string[], b: string[]): Op[] {
  if (a.length * b.length > MAX_TABLE_CELLS) {

    return [...a.map((text): Op => ({ type: "del", text })), ...b.map((text): Op => ({ type: "add", text }))];
  }


  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {

      ops.push({ type: "del", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ type: "del", text: a[i++] });
  }
  while (j < b.length) {
    ops.push({ type: "add", text: b[j++] });
  }
  return ops;
}

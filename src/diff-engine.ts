import type { DiffChunk } from "./types";

export function computeDiff(original: string, proposed: string): DiffChunk[] {
  const origWords = tokenize(original);
  const propWords = tokenize(proposed);

  const lcs = lcsDP(origWords, propWords);

  const chunks: DiffChunk[] = [];
  let oi = 0;
  let pi = 0;

  for (const common of lcs) {
    while (oi < origWords.length && origWords[oi] !== common) {
      pushChunk(chunks, "remove", origWords[oi]!);
      oi++;
    }
    while (pi < propWords.length && propWords[pi] !== common) {
      pushChunk(chunks, "add", propWords[pi]!);
      pi++;
    }
    pushChunk(chunks, "keep", common);
    oi++;
    pi++;
  }

  while (oi < origWords.length) {
    pushChunk(chunks, "remove", origWords[oi]!);
    oi++;
  }
  while (pi < propWords.length) {
    pushChunk(chunks, "add", propWords[pi]!);
    pi++;
  }

  return mergeChunks(chunks);
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /(\S+|\s+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function lcsDP(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const result: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

function mergeChunks(chunks: DiffChunk[]): DiffChunk[] {
  const merged: DiffChunk[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    if (last && last.type === chunk.type) {
      last.text += chunk.text;
    } else {
      merged.push({ type: chunk.type, text: chunk.text });
    }
  }
  return merged;
}

function pushChunk(chunks: DiffChunk[], type: DiffChunk["type"], text: string) {
  chunks.push({ type, text });
}

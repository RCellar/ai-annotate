import type { Annotation } from "./types";

interface CodeRange {
  from: number;
  to: number;
}

function findCodeRanges(docText: string): CodeRange[] {
  const ranges: CodeRange[] = [];

  // Fenced code blocks: line-scanner approach to avoid backtracking
  const lines = docText.split("\n");
  let offset = 0;
  let fenceStart = -1;
  let fenceChar = "";
  let fenceLen = 0;

  for (const line of lines) {
    if (fenceStart === -1) {
      const openMatch = line.match(/^(`{3,}|~{3,})/);
      if (openMatch) {
        fenceStart = offset;
        fenceChar = openMatch[1]![0]!;
        fenceLen = openMatch[1]!.length;
      }
    } else {
      const pat = fenceChar === "`"
        ? new RegExp("^`{" + fenceLen + ",}\\s*$")
        : new RegExp("^~{" + fenceLen + ",}\\s*$");
      if (pat.test(line)) {
        ranges.push({ from: fenceStart, to: offset + line.length });
        fenceStart = -1;
      }
    }
    offset += line.length + 1;
  }

  // If a fence opened but never closed, treat the rest of the document as
  // code to match Obsidian's own rendering behaviour for unclosed fences.
  if (fenceStart !== -1) {
    ranges.push({ from: fenceStart, to: docText.length });
  }

  // Inline code: `...`
  const inlineRegex = /`[^`\n]+`/g;
  let match: RegExpExecArray | null;
  inlineRegex.lastIndex = 0;
  while ((match = inlineRegex.exec(docText)) !== null) {
    if (!isInsideCode(match.index, ranges)) {
      ranges.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  return ranges;
}

function isInsideCode(offset: number, codeRanges: CodeRange[]): boolean {
  return codeRanges.some((r) => offset >= r.from && offset < r.to);
}

export function parseAnnotations(docText: string): Annotation[] {
  const annotations: Annotation[] = [];
  const codeRanges = findCodeRanges(docText);
  const markerRegex = /%%ai\s+([\s\S]*?)%%/g;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(docText)) !== null) {
    const markerFrom = match.index;
    if (isInsideCode(markerFrom, codeRanges)) continue;

    const markerTo = match.index + match[0].length;
    const rawInstruction = (match[1] ?? "").trim();

    // Parse optional model: prefix
    let model: string | undefined;
    let instruction = rawInstruction;
    const modelMatch = rawInstruction.match(/^model:(\S+)\s+([\s\S]*)$/);
    if (modelMatch) {
      model = modelMatch[1];
      instruction = (modelMatch[2] ?? "").trim();
    }

    const { targetFrom, targetTo } = findTargetRange(docText, markerFrom);
    const originalText = docText.slice(targetFrom, targetTo);

    annotations.push({
      id: generateId(),
      state: "created",
      instruction,
      targetFrom,
      targetTo,
      originalText,
      source: "inline",
      markerFrom,
      markerTo,
      model,
    });
  }

  return annotations;
}

function findTargetRange(
  docText: string,
  markerFrom: number
): { targetFrom: number; targetTo: number } {
  const textBeforeMarker = docText.slice(0, markerFrom);

  const headingRegex = /^#{1,6}\s+.*$/gm;
  let contentStart = 0;
  let headingMatch: RegExpExecArray | null;

  headingRegex.lastIndex = 0;
  while ((headingMatch = headingRegex.exec(textBeforeMarker)) !== null) {
    // Start target after the heading line (skip heading + newline)
    contentStart = headingMatch.index + headingMatch[0].length;
    if (contentStart < textBeforeMarker.length && docText[contentStart] === "\n") {
      contentStart++;
    }
  }

  let targetTo = markerFrom;
  while (targetTo > contentStart && docText[targetTo - 1] === "\n") {
    targetTo--;
  }

  if (targetTo <= contentStart) {
    targetTo = contentStart;
  }

  return { targetFrom: contentStart, targetTo };
}

export function createSelectionAnnotation(
  instruction: string,
  selectedText: string,
  from: number,
  to: number
): Annotation {
  return {
    id: generateId(),
    state: "created",
    instruction,
    targetFrom: from,
    targetTo: to,
    originalText: selectedText,
    source: "selection",
  };
}

let counter = 0;
function generateId(): string {
  return `ann-${Date.now()}-${counter++}`;
}

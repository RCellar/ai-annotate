import type { Annotation } from "./types";

const MARKER_REGEX = /%%ai\s+([\s\S]*?)%%/g;

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
  let match: RegExpExecArray | null;

  MARKER_REGEX.lastIndex = 0;
  while ((match = MARKER_REGEX.exec(docText)) !== null) {
    const markerFrom = match.index;
    if (isInsideCode(markerFrom, codeRanges)) continue;

    const markerTo = match.index + match[0].length;
    const instruction = (match[1] ?? "").trim();

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

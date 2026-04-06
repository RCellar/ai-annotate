import { Notice } from "obsidian";
import type { Annotation } from "./types";
import type { AIAnnotateSettings, ContextStrategy } from "./settings";
import { invokeClaude } from "./claude-service";
import { computeDiff } from "./diff-engine";

function friendlyError(raw: string, claudePath: string, timeout: number): string {
  const lower = raw.toLowerCase();

  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("no such file")) {
    return `claude CLI not found at "${claudePath}". Check settings > AI annotate.`;
  }
  if (lower.includes("auth") || lower.includes("401") || lower.includes("unauthorized") || lower.includes("not logged in")) {
    return 'claude CLI not authenticated. Run "claude login" in your terminal.';
  }
  if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
    return "Rate limited by claude. Try again in a moment.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return `claude CLI timed out after ${timeout}s. Increase timeout in settings > AI annotate.`;
  }

  // Default: show first line of raw error, truncated
  const firstLine = raw.split("\n")[0] ?? raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine;
}

export class AnnotationManager {
  private annotations: Map<string, Annotation> = new Map();
  private activeCancels: Map<string, () => void> = new Map();

  async processAnnotation(
    annotation: Annotation,
    fullDocText: string,
    settings: AIAnnotateSettings,
    onStateChange: (annotation: Annotation) => void,
    onChunk?: (annotationId: string, partialText: string) => void
  ): Promise<Annotation> {
    this.annotations.set(annotation.id, annotation);

    annotation.state = "pending";
    onStateChange(annotation);

    const prompt = this.assemblePrompt(
      annotation,
      fullDocText,
      settings.contextStrategy
    );

    annotation.state = "processing";
    onStateChange(annotation);

    const { promise, cancel } = invokeClaude(
      prompt,
      {
        claudePath: settings.claudePath,
        timeout: settings.timeout,
        systemPrompt: settings.systemPrompt,
        model: annotation.model || settings.model,
        extraArgs: settings.extraArgs,
        envVars: settings.envVars,
      },
      (partialText: string) => {
        onChunk?.(annotation.id, partialText);
      }
    );

    this.activeCancels.set(annotation.id, cancel);

    const result = await promise;
    this.activeCancels.delete(annotation.id);

    if (result.error) {
      annotation.state = "created";
      onStateChange(annotation);
      if (result.error !== "Cancelled") {
        new Notice(
          `AI Annotate: ${friendlyError(result.error, settings.claudePath, settings.timeout)}`,
          8000
        );
      }
      return annotation;
    }

    if (!result.text) {
      annotation.state = "created";
      onStateChange(annotation);
      new Notice("AI annotate: claude returned an empty response.", 5000);
      return annotation;
    }

    annotation.proposedText = result.text;
    annotation.diffChunks = computeDiff(annotation.originalText, result.text);

    annotation.state = "review";
    onStateChange(annotation);

    return annotation;
  }

  cancelAll(): void {
    for (const cancel of this.activeCancels.values()) {
      cancel();
    }
    this.activeCancels.clear();
  }

  cancelAnnotation(annotationId: string): void {
    const cancel = this.activeCancels.get(annotationId);
    if (cancel) {
      cancel();
      this.activeCancels.delete(annotationId);
    }
    const annotation = this.annotations.get(annotationId);
    if (annotation) {
      annotation.state = "created";
    }
  }

  acceptAnnotation(annotationId: string): Annotation | undefined {
    const annotation = this.annotations.get(annotationId);
    if (annotation && annotation.state === "review") {
      annotation.state = "accepted";
      this.annotations.delete(annotationId);
      return annotation;
    }
    return undefined;
  }

  /**
   * Adjust offsets of all remaining annotations after a document edit.
   * Called after accepting an annotation to keep remaining annotations valid.
   * editFrom: where the edit started, delta: how many characters were added (negative = removed)
   */
  hasAnnotation(annotationId: string): boolean {
    return this.annotations.has(annotationId);
  }

  adjustOffsetsAfterEdit(editFrom: number, delta: number): void {
    for (const annotation of this.annotations.values()) {
      if (annotation.targetFrom >= editFrom) {
        annotation.targetFrom += delta;
        annotation.targetTo += delta;
        if (annotation.markerFrom !== undefined) {
          annotation.markerFrom += delta;
        }
        if (annotation.markerTo !== undefined) {
          annotation.markerTo += delta;
        }
      }
    }
  }

  rejectAnnotation(annotationId: string): Annotation | undefined {
    const annotation = this.annotations.get(annotationId);
    if (annotation && annotation.state === "review") {
      annotation.state = "rejected";
      this.annotations.delete(annotationId);
      return annotation;
    }
    return undefined;
  }

  getReviewAnnotations(): Annotation[] {
    return Array.from(this.annotations.values()).filter(
      (a) => a.state === "review"
    );
  }

  private assemblePrompt(
    annotation: Annotation,
    fullDocText: string,
    contextStrategy: ContextStrategy
  ): string {
    const lines = fullDocText.split("\n");

    // Find which line each character offset falls on
    let charCount = 0;
    let targetStartLine = -1;
    let targetEndLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineEnd = charCount + lines[i]!.length;
      if (targetStartLine === -1 && lineEnd >= annotation.targetFrom) {
        targetStartLine = i;
      }
      if (targetEndLine === -1 && lineEnd >= annotation.targetTo) {
        targetEndLine = i;
      }
      charCount = lineEnd + 1;
    }

    // Clamp to valid line indices when target reaches document boundaries
    if (targetStartLine === -1) targetStartLine = lines.length - 1;
    if (targetEndLine === -1) targetEndLine = lines.length - 1;

    // Determine which lines to include based on context strategy
    let fromLine = 0;
    let toLine = lines.length - 1;

    if (contextStrategy !== "full") {
      // Find heading-based section boundaries
      const headingLines = lines
        .map((line, i) => ({ line: i, isHeading: /^#{1,6}\s+/.test(line) }))
        .filter((h) => h.isHeading)
        .map((h) => h.line);

      // Find the section containing the target
      let sectionStart = 0;
      let sectionEnd = lines.length - 1;
      for (let i = 0; i < headingLines.length; i++) {
        if (headingLines[i]! <= targetStartLine) {
          sectionStart = headingLines[i]!;
          sectionEnd =
            i + 1 < headingLines.length
              ? headingLines[i + 1]! - 1
              : lines.length - 1;
        }
      }

      if (contextStrategy === "section") {
        fromLine = sectionStart;
        toLine = sectionEnd;
      } else {
        // "neighbors" — include previous and next sections
        // Find the index of the heading that starts the current section.
        // If the target is before the first heading, sectionStart is 0
        // and won't be in headingLines — treat as index -1.
        const sectionIdx = headingLines.indexOf(sectionStart);
        if (sectionIdx === -1) {
          // Target is before the first heading — include from doc start
          // through the end of the first heading's section
          fromLine = 0;
          toLine =
            headingLines.length >= 2
              ? headingLines[1]! - 1
              : lines.length - 1;
        } else {
          fromLine =
            sectionIdx > 0 ? headingLines[sectionIdx - 1]! : 0;
          toLine =
            sectionIdx + 2 < headingLines.length
              ? headingLines[sectionIdx + 2]! - 1
              : lines.length - 1;
        }
      }
    }

    const numberedLines: string[] = [];
    for (let i = fromLine; i <= toLine; i++) {
      if (i === targetStartLine) {
        numberedLines.push("<!-- TARGET START -->");
      }
      numberedLines.push(`${i + 1}: ${lines[i]}`);
      if (i === targetEndLine) {
        numberedLines.push("<!-- TARGET END -->");
      }
    }

    return `${numberedLines.join("\n")}\n\nInstruction: ${annotation.instruction}`;
  }
}

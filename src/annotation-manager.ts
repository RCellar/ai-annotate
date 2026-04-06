import { Notice } from "obsidian";
import type { Annotation } from "./types";
import type { AIAnnotateSettings } from "./settings";
import { invokeClaude } from "./claude-service";
import { computeDiff } from "./diff-engine";

function friendlyError(raw: string, claudePath: string, timeout: number): string {
  const lower = raw.toLowerCase();

  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("no such file")) {
    return `Claude CLI not found at "${claudePath}". Check Settings > AI Annotate.`;
  }
  if (lower.includes("auth") || lower.includes("401") || lower.includes("unauthorized") || lower.includes("not logged in")) {
    return 'Claude CLI not authenticated. Run "claude login" in your terminal.';
  }
  if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
    return "Rate limited by Claude. Try again in a moment.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return `Claude CLI timed out after ${timeout}s. Increase timeout in Settings > AI Annotate.`;
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

    const prompt = this.assemblePrompt(annotation, fullDocText);

    annotation.state = "processing";
    onStateChange(annotation);

    const { promise, cancel } = invokeClaude(
      prompt,
      {
        claudePath: settings.claudePath,
        timeout: settings.timeout,
        systemPrompt: settings.systemPrompt,
        model: settings.model,
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
      new Notice(
        `AI Annotate: ${friendlyError(result.error, settings.claudePath, settings.timeout)}`,
        8000
      );
      return annotation;
    }

    if (!result.text) {
      annotation.state = "created";
      onStateChange(annotation);
      new Notice("AI Annotate: Claude returned an empty response.");
      return annotation;
    }

    annotation.proposedText = result.text;
    annotation.diffChunks = computeDiff(annotation.originalText, result.text);

    annotation.state = "review";
    onStateChange(annotation);

    return annotation;
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
      if (annotation.targetFrom > editFrom) {
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

  private assemblePrompt(annotation: Annotation, fullDocText: string): string {
    const lines = fullDocText.split("\n");
    const numberedLines: string[] = [];

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

    for (let i = 0; i < lines.length; i++) {
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

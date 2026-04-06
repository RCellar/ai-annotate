import {
  StateField,
  StateEffect,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from "@codemirror/view";
import type { Annotation, DiffChunk } from "./types";

// --- Effects ---

export const addDiffEffect = StateEffect.define<{
  annotation: Annotation;
}>();

export const removeDiffEffect = StateEffect.define<{
  annotationId: string;
}>();

export const clearAllDiffsEffect = StateEffect.define<void>();

// --- Review Button Widget ---

type ReviewAction =
  | { type: "accept"; annotationId: string }
  | { type: "reject"; annotationId: string };

let reviewActionHandler: ((action: ReviewAction) => void) | null = null;

export function setReviewActionHandler(
  handler: (action: ReviewAction) => void
): void {
  reviewActionHandler = handler;
}

export function clearReviewActionHandler(): void {
  reviewActionHandler = null;
}

class ReviewButtonsWidget extends WidgetType {
  constructor(readonly annotationId: string) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "ai-annotate-review-bar";

    const label = container.createSpan({ cls: "ai-annotate-review-label" });
    label.textContent = "Review changes";

    container.createSpan({ cls: "ai-annotate-review-spacer" });

    const acceptBtn = container.createEl("button", {
      cls: "ai-annotate-accept-btn",
      attr: {
        "aria-label": "Accept proposed changes",
        "data-tooltip-position": "top",
      },
    });
    acceptBtn.textContent = "\u2713 accept";
    acceptBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reviewActionHandler?.({ type: "accept", annotationId: this.annotationId });
    });
    acceptBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        reviewActionHandler?.({
          type: "accept",
          annotationId: this.annotationId,
        });
      }
    });

    const rejectBtn = container.createEl("button", {
      cls: "ai-annotate-reject-btn",
      attr: {
        "aria-label": "Reject proposed changes",
        "data-tooltip-position": "top",
      },
    });
    rejectBtn.textContent = "\u2717 reject";
    rejectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reviewActionHandler?.({ type: "reject", annotationId: this.annotationId });
    });
    rejectBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        reviewActionHandler?.({
          type: "reject",
          annotationId: this.annotationId,
        });
      }
    });

    return container;
  }

  eq(other: ReviewButtonsWidget): boolean {
    return this.annotationId === other.annotationId;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// --- Diff Content Widget ---

class DiffContentWidget extends WidgetType {
  constructor(readonly diffChunks: DiffChunk[]) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "ai-annotate-diff-content";

    // Interleaved diff: render chunks in order with accessibility prefixes
    const contentEl = container.createDiv({ cls: "ai-annotate-diff-interleaved" });
    for (const chunk of this.diffChunks) {
      const span = contentEl.createSpan({
        cls:
          chunk.type === "remove"
            ? "ai-annotate-diff-removed"
            : chunk.type === "add"
              ? "ai-annotate-diff-added"
              : "ai-annotate-diff-context",
      });
      // Non-color indicator for accessibility (WCAG)
      if (chunk.type === "remove") {
        const prefix = span.createSpan({ cls: "ai-annotate-diff-prefix" });
        prefix.textContent = "\u2212";
      } else if (chunk.type === "add") {
        const prefix = span.createSpan({ cls: "ai-annotate-diff-prefix" });
        prefix.textContent = "+";
      }
      const text = span.createSpan();
      text.textContent = chunk.text;
    }

    return container;
  }

  eq(other: DiffContentWidget): boolean {
    if (this.diffChunks.length !== other.diffChunks.length) return false;
    return this.diffChunks.every(
      (c, i) =>
        c.type === other.diffChunks[i]?.type &&
        c.text === other.diffChunks[i]?.text
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// --- State Field ---

interface DiffFieldState {
  annotations: Map<string, Annotation>;
  decorations: DecorationSet;
}

function buildDecorations(
  annotations: Map<string, Annotation>
): DecorationSet {
  const ranges: Array<{ from: number; to: number; value: Decoration }> = [];

  for (const annotation of annotations.values()) {
    if (annotation.state !== "review" || !annotation.diffChunks) {
      continue;
    }

    // Skip annotations whose range has collapsed (e.g., target deleted during review)
    if (annotation.targetFrom >= annotation.targetTo) {
      continue;
    }

    // Review buttons widget (block, above target)
    ranges.push({
      from: annotation.targetFrom,
      to: annotation.targetFrom,
      value: Decoration.widget({
        widget: new ReviewButtonsWidget(annotation.id),
        block: true,
        side: -1,
      }),
    });

    // Diff content widget (replaces target range)
    ranges.push({
      from: annotation.targetFrom,
      to: annotation.targetTo,
      value: Decoration.replace({
        widget: new DiffContentWidget(annotation.diffChunks),
      }),
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide || a.to - b.to);
  return Decoration.set(ranges.map((r) => r.value.range(r.from, r.to)));
}

export const diffStateField = StateField.define<DiffFieldState>({
  create(): DiffFieldState {
    return {
      annotations: new Map(),
      decorations: Decoration.none,
    };
  },

  update(state: DiffFieldState, tr: Transaction): DiffFieldState {
    let changed = false;
    let annotations = state.annotations;

    // Map annotation positions through document changes
    if (tr.docChanged && annotations.size > 0) {
      annotations = new Map(annotations);
      for (const [id, ann] of annotations) {
        annotations.set(id, {
          ...ann,
          targetFrom: tr.changes.mapPos(ann.targetFrom),
          targetTo: tr.changes.mapPos(ann.targetTo),
          ...(ann.markerFrom !== undefined && {
            markerFrom: tr.changes.mapPos(ann.markerFrom),
          }),
          ...(ann.markerTo !== undefined && {
            markerTo: tr.changes.mapPos(ann.markerTo),
          }),
        });
      }
      changed = true;
    }

    for (const effect of tr.effects) {
      if (effect.is(addDiffEffect)) {
        if (!changed) {
          annotations = new Map(annotations);
          changed = true;
        }
        annotations.set(effect.value.annotation.id, effect.value.annotation);
      }
      if (effect.is(removeDiffEffect)) {
        if (!changed) {
          annotations = new Map(annotations);
          changed = true;
        }
        annotations.delete(effect.value.annotationId);
      }
      if (effect.is(clearAllDiffsEffect)) {
        return {
          annotations: new Map(),
          decorations: Decoration.none,
        };
      }
    }

    if (changed) {
      return {
        annotations,
        decorations: buildDecorations(annotations),
      };
    }

    return state;
  },

  provide(field) {
    return EditorView.decorations.from(field, (state) => state.decorations);
  },
});

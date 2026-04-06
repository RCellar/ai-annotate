import { WidgetType } from "@codemirror/view";
import type { AnnotationState } from "./types";

export type WidgetAction =
  | { type: "process"; markerFrom: number; markerTo: number }
  | { type: "cancel"; annotationId: string };

export class AnnotationMarkerWidget extends WidgetType {
  constructor(
    readonly instruction: string,
    readonly state: AnnotationState,
    readonly annotationId: string | null,
    readonly markerFrom: number,
    readonly markerTo: number,
    readonly onAction: (action: WidgetAction) => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "ai-annotate-marker";

    const label = container.createSpan({ cls: "ai-annotate-marker-label" });
    label.textContent = "%%ai";

    const instructionEl = container.createSpan({
      cls: "ai-annotate-marker-instruction",
    });
    instructionEl.textContent = this.instruction;

    if (this.state === "processing") {
      const spinner = container.createSpan({
        cls: "ai-annotate-marker-status",
      });
      spinner.textContent = "Streaming response\u2026";

      const cancelBtn = container.createEl("button", {
        cls: "ai-annotate-marker-cancel",
        attr: {
          "aria-label": "Cancel annotation processing",
          "data-tooltip-position": "top",
        },
      });
      cancelBtn.textContent = "\u25A0 Cancel";
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.annotationId) {
          this.onAction({ type: "cancel", annotationId: this.annotationId });
        }
      });
      cancelBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (this.annotationId) {
            this.onAction({ type: "cancel", annotationId: this.annotationId });
          }
        }
      });
    } else if (this.state === "created") {
      const processBtn = container.createEl("button", {
        cls: "ai-annotate-marker-process",
        attr: {
          "aria-label": "Process this annotation",
          "data-tooltip-position": "top",
        },
      });
      processBtn.textContent = "\u25B6 Process";
      processBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onAction({
          type: "process",
          markerFrom: this.markerFrom,
          markerTo: this.markerTo,
        });
      });
      processBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.onAction({
            type: "process",
            markerFrom: this.markerFrom,
            markerTo: this.markerTo,
          });
        }
      });
    }

    return container;
  }

  eq(other: AnnotationMarkerWidget): boolean {
    return (
      this.instruction === other.instruction &&
      this.state === other.state &&
      this.annotationId === other.annotationId
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

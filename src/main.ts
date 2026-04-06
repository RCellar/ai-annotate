import { Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";
import { spawn } from "child_process";
import { EditorView } from "@codemirror/view";
import {
  AIAnnotateSettings,
  DEFAULT_SETTINGS,
  AIAnnotateSettingTab,
} from "./settings";
import { parseAnnotations, createSelectionAnnotation } from "./annotation-parser";
import { AnnotationManager } from "./annotation-manager";
import {
  diffStateField,
  addDiffEffect,
  removeDiffEffect,
  setReviewActionHandler,
  clearReviewActionHandler,
} from "./diff-decorations";
import type { Annotation } from "./types";

export default class AIAnnotatePlugin extends Plugin {
  settings: AIAnnotateSettings = DEFAULT_SETTINGS;
  manager = new AnnotationManager();
  private pendingBatchAnnotations: Annotation[] = [];
  private processing = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AIAnnotateSettingTab(this.app, this));

    // Register CM6 extensions
    this.registerEditorExtension([diffStateField]);

    // Set up review action handler
    setReviewActionHandler((action) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;

      if (action.type === "accept") {
        this.acceptAnnotation(action.annotationId, view);
      } else {
        this.rejectAnnotation(action.annotationId, view);
      }
    });

    // Command: Process annotation at cursor
    this.addCommand({
      id: "process-annotation",
      name: "Process annotation at cursor",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.processAnnotationAtCursor(editor, view);
      },
    });

    // Command: Process all annotations
    this.addCommand({
      id: "process-all-annotations",
      name: "Process all annotations",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        void this.processAllAnnotations(editor, view);
      },
    });

    // Command: Annotate selection
    this.addCommand({
      id: "annotate-selection",
      name: "Annotate selection",
      editorCheckCallback: (
        checking: boolean,
        editor: Editor,
        view: MarkdownView
      ) => {
        const selection = editor.getSelection();
        if (!selection) return false;
        if (!checking) {
          this.annotateSelection(editor, view);
        }
        return true;
      },
    });

    // Command: Accept all changes
    this.addCommand({
      id: "accept-all",
      name: "Accept all changes",
      editorCallback: (_editor: Editor, view: MarkdownView) => {
        const annotations = this.manager
          .getReviewAnnotations()
          .sort((a, b) => b.targetFrom - a.targetFrom);
        for (const ann of annotations) {
          this.acceptAnnotation(ann.id, view);
        }
      },
    });

    // Command: Reject all changes
    this.addCommand({
      id: "reject-all",
      name: "Reject all changes",
      editorCallback: (_editor: Editor, view: MarkdownView) => {
        const annotations = this.manager.getReviewAnnotations();
        for (const ann of annotations) {
          this.rejectAnnotation(ann.id, view);
        }
      },
    });

    this.checkCliAvailability();
  }

  onunload() {
    this.manager.cancelAll();
    clearReviewActionHandler();
  }

  private checkCliAvailability(): void {
    const proc = spawn(this.settings.claudePath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errored = false;
    proc.on("error", () => {
      errored = true;
      new Notice(
        `AI annotate: claude CLI not found at "${this.settings.claudePath}". Check settings > AI annotate.`,
        8000
      );
    });
    proc.on("close", (code) => {
      if (!errored && code !== 0) {
        new Notice(
          `AI annotate: claude CLI at "${this.settings.claudePath}" exited with an error. Run "claude login" in your terminal if not authenticated.`,
          8000
        );
      }
    });
  }

  private processAnnotationAtCursor(editor: Editor, view: MarkdownView) {
    if (this.processing) {
      new Notice("AI annotate: already processing. Wait for the current annotation to finish.");
      return;
    }

    const cursor = editor.getCursor();
    const docText = editor.getValue();
    const offset = editor.posToOffset(cursor);

    const annotations = parseAnnotations(docText);

    // First: exact match on marker range
    let annotation = annotations.find(
      (a) =>
        a.markerFrom !== undefined &&
        a.markerTo !== undefined &&
        offset >= a.markerFrom &&
        offset <= a.markerTo
    );

    // Second: cursor is within the target range of an annotation
    if (!annotation) {
      annotation = annotations.find(
        (a) => offset >= a.targetFrom && offset <= a.targetTo
      );
    }

    // Third: find the nearest marker within 3 lines of the cursor
    if (!annotation) {
      const cursorLine = cursor.line;
      let bestDistance = Infinity;
      for (const a of annotations) {
        if (a.markerFrom === undefined) continue;
        const markerLine = editor.offsetToPos(a.markerFrom).line;
        const distance = Math.abs(markerLine - cursorLine);
        if (distance <= 3 && distance < bestDistance) {
          bestDistance = distance;
          annotation = a;
        }
      }
    }

    if (!annotation) {
      new Notice("No annotation found near cursor. Place cursor on or near a %%AI marker.");
      return;
    }

    this.processing = true;
    void this.processAnnotation(annotation, editor, view).finally(() => {
      this.processing = false;
    });
  }

  private async processAllAnnotations(editor: Editor, view: MarkdownView) {
    if (this.processing) {
      new Notice("AI annotate: already processing. Wait for the current batch to finish.");
      return;
    }

    const docText = editor.getValue();
    const annotations = parseAnnotations(docText);

    if (annotations.length === 0) {
      new Notice("No annotations found in this document.");
      return;
    }

    new Notice(`Processing ${annotations.length} annotation(s)...`);

    this.processing = true;
    this.pendingBatchAnnotations = annotations;
    try {
      for (const annotation of annotations) {
        await this.processAnnotation(annotation, editor, view);
      }
    } finally {
      this.pendingBatchAnnotations = [];
      this.processing = false;
    }
  }

  private async processAnnotation(
    annotation: Annotation,
    editor: Editor,
    view: MarkdownView
  ) {
    const docText = editor.getValue();
    const cmView = this.getCmView(view);
    if (!cmView) return;

    await this.manager.processAnnotation(
      annotation,
      docText,
      this.settings,
      (updated) => {
        if (updated.state === "review") {
          cmView.dispatch({
            effects: addDiffEffect.of({ annotation: updated }),
          });
        }
      }
    );
  }

  private annotateSelection(editor: Editor, view: MarkdownView) {
    if (this.processing) {
      new Notice("AI annotate: already processing. Wait for the current annotation to finish.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection) return;

    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));

    const modal = new InstructionModal(this.app, (instruction) => {
      if (this.processing) {
        new Notice("AI annotate: already processing. Wait for the current annotation to finish.");
        return;
      }
      const annotation = createSelectionAnnotation(
        instruction,
        selection,
        from,
        to
      );
      this.processing = true;
      void this.processAnnotation(annotation, editor, view).finally(() => {
        this.processing = false;
      });
    });
    modal.open();
  }

  private acceptAnnotation(annotationId: string, view: MarkdownView) {
    const annotation = this.manager.acceptAnnotation(annotationId);
    if (!annotation || !annotation.proposedText) return;

    const editor = view.editor;
    const cmView = this.getCmView(view);
    if (!cmView) return;

    // Remove diff decorations first
    cmView.dispatch({
      effects: removeDiffEffect.of({ annotationId }),
    });

    // Replace the target text with the proposed text
    const from = editor.offsetToPos(annotation.targetFrom);
    const to = editor.offsetToPos(annotation.targetTo);
    editor.replaceRange(annotation.proposedText, from, to);

    let totalDelta =
      annotation.proposedText.length - annotation.originalText.length;

    // If inline marker, also remove the %%ai ... %% marker or line
    if (
      annotation.source === "inline" &&
      annotation.markerFrom !== undefined &&
      annotation.markerTo !== undefined
    ) {
      const adjustedMarkerFrom = annotation.markerFrom + totalDelta;
      const adjustedMarkerTo = annotation.markerTo + totalDelta;

      const markerFromPos = editor.offsetToPos(adjustedMarkerFrom);
      const lineNum = markerFromPos.line;
      const lineStart = editor.posToOffset({ line: lineNum, ch: 0 });
      const docLength = editor.getValue().length;
      const nextLineStart = Math.min(
        editor.posToOffset({ line: lineNum + 1, ch: 0 }),
        docLength
      );

      const lineText = editor.getRange(
        editor.offsetToPos(lineStart),
        editor.offsetToPos(nextLineStart)
      );
      const markerText = editor.getRange(
        editor.offsetToPos(adjustedMarkerFrom),
        editor.offsetToPos(adjustedMarkerTo)
      );
      const markerOnly = lineText.trim() === markerText.trim();

      if (markerOnly) {
        // Marker is the only content on the line — delete the whole line
        const markerLineLength = nextLineStart - lineStart;
        editor.replaceRange(
          "",
          editor.offsetToPos(lineStart),
          editor.offsetToPos(nextLineStart)
        );
        totalDelta -= markerLineLength;
      } else {
        // Marker is inline with other text — delete only the marker
        const markerLength = adjustedMarkerTo - adjustedMarkerFrom;
        editor.replaceRange(
          "",
          editor.offsetToPos(adjustedMarkerFrom),
          editor.offsetToPos(adjustedMarkerTo)
        );
        totalDelta -= markerLength;
      }
    }

    // Adjust remaining annotations' offsets — both in the manager's map
    // and in any pending batch annotations not yet submitted to Claude
    this.manager.adjustOffsetsAfterEdit(annotation.targetFrom, totalDelta);
    for (const pending of this.pendingBatchAnnotations) {
      // Only adjust annotations NOT in the manager's map — those were
      // already adjusted by adjustOffsetsAfterEdit. Since these are shared
      // object references, adjusting both would double-shift the offsets.
      if (
        pending.id !== annotationId &&
        pending.targetFrom >= annotation.targetFrom &&
        !this.manager.hasAnnotation(pending.id)
      ) {
        pending.targetFrom += totalDelta;
        pending.targetTo += totalDelta;
        if (pending.markerFrom !== undefined) pending.markerFrom += totalDelta;
        if (pending.markerTo !== undefined) pending.markerTo += totalDelta;
      }
    }
  }

  private rejectAnnotation(annotationId: string, view: MarkdownView) {
    this.manager.rejectAnnotation(annotationId);
    const cmView = this.getCmView(view);
    if (!cmView) return;

    cmView.dispatch({
      effects: removeDiffEffect.of({ annotationId }),
    });
  }

  private getCmView(view: MarkdownView): EditorView | null {
    // @ts-expect-error -- internal Obsidian API
    return view.editor?.cm ?? null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// --- Instruction Modal ---

class InstructionModal extends Modal {
  private onSubmit: (instruction: string) => void;

  constructor(
    app: import("obsidian").App,
    onSubmit: (instruction: string) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: "What should claude do with this text?",
    });

    const input = contentEl.createEl("textarea", {
      cls: "ai-annotate-instruction-input",
      attr: {
        placeholder:
          "E.g., make this more concise, add citations, rewrite for clarity...",
        rows: "3",
        "aria-label": "Instruction for claude",
      },
    });
    const submitBtn = contentEl.createEl("button", {
      cls: "mod-cta",
      text: "Process",
      attr: {
        "aria-label": "Submit instruction to claude",
      },
    });

    submitBtn.addEventListener("click", () => {
      const instruction = input.value.trim();
      if (instruction) {
        this.close();
        this.onSubmit(instruction);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const instruction = input.value.trim();
        if (instruction) {
          this.close();
          this.onSubmit(instruction);
        }
      }
    });

    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

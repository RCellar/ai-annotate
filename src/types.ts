export type AnnotationState =
  | "created"
  | "pending"
  | "processing"
  | "review"
  | "accepted"
  | "rejected";

export type AnnotationSource = "inline" | "selection";

export interface Annotation {
  id: string;
  state: AnnotationState;
  instruction: string;
  targetFrom: number;
  targetTo: number;
  originalText: string;
  proposedText?: string;
  diffChunks?: DiffChunk[];
  source: AnnotationSource;
  /** For inline markers: the position range of the %%ai ... %% marker itself */
  markerFrom?: number;
  markerTo?: number;
}

export interface DiffChunk {
  type: "add" | "remove" | "keep";
  text: string;
}

export interface ClaudeStreamChunk {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{ type: string; text: string }>;
  };
  result?: string;
  is_error?: boolean;
}

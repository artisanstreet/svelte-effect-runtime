/**
 * Result of the markup preprocessor pass.
 *
 * @since 2.0.0
 */
export interface MarkupTransformResult {
  /** The transformed source code. */
  code: string;
  /** Whether any yield* expressions were found and lowered. */
  has_yield: boolean;
  /** Source map from transformed markup back to the original component. */
  map?: Record<string, unknown>;
  /** Offset ranges that preserve hoverable source spans inside lowered code. */
  relocations?: MarkupRelocation[];
}

/** Offset mapping between original markup and generated helper code. */
export interface MarkupRelocation {
  /** Start offset in the original source. */
  originalStart: number;
  /** End offset in the original source. */
  originalEnd: number;
  /** Start offset in the transformed source. */
  generatedStart: number;
  /** End offset in the transformed source. */
  generatedEnd: number;
}

/** Describes a brace expression that contains yield* and needs lowering. */
export interface MarkupCandidate {
  /** The placeholder identifier injected into the sanitized markup. */
  placeholder: string;
  /** Start offset of the expression in the original source. */
  start: number;
  /** End offset of the expression in the original source. */
  end: number;
  /** The expression text (without surrounding braces). */
  expr_text: string;
  /** Source filename used to keep generated cache ids component-scoped. */
  filename: string;
  /** Whether this expression is a key context (each/promise/render key). */
  key: TagKind;
}

export type TagKind = "plain" | "each" | "await" | "event" | "render";

export interface Replacement {
  start: number;
  end: number;
  text: string;
  helpers?: HelperDeclaration[];
  relocation?: PendingRelocation;
}

export interface HelperDeclaration {
  text: string;
  relocation?: PendingRelocation;
}

export interface PendingRelocation {
  originalStart: number;
  originalEnd: number;
  generatedStartInReplacement: number;
  generatedEndInReplacement: number;
}

export interface Insertion {
  start: number;
  text: string;
  relocations?: PendingRelocation[];
}

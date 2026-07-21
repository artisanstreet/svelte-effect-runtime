/**
 * Result of the markup transform pass.
 *
 * @example
 * ```ts
 * const result: MarkupTransformResult = {
 *   code: "<p>{__SER___value}</p>",
 *   has_yield: true,
 * };
 * ```
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

/**
 * Runtime environment that controls how markup effect reads are lowered.
 *
 * @example
 * ```ts
 * const target: MarkupTransformTarget = "client";
 * ```
 *
 * @since 2.5.0
 */
export type MarkupTransformTarget = "client" | "server" | "editor";

/**
 * Options accepted by the markup transform.
 *
 * @example
 * ```ts
 * const options: MarkupTransformOptions = { target: "server" };
 * ```
 *
 * @since 2.5.0
 */
export interface MarkupTransformOptions {
	/** Legacy emission target retained for compatibility with older callers. */
	target?: MarkupTransformTarget;
}

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

export type TagKind = "plain" | "each" | "await" | "event" | "html" | "render" | "render_argument";

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
	/** Additional insertions applied elsewhere in the file that shift offsets. */
	extra_insertions?: readonly { start: number; text: string }[];
	relocations?: PendingRelocation[];
}

export interface MarkupHelperBindings {
	codes: string;
	dispatcher: string;
	yieldable: string;
	/** The component scope binding shared with the script transform. */
	scope: string;
}

/**
 * Reserved names for the scope holder the markup transform injects when no
 * `<script effect>` already declared one (markup-only components).
 */
export interface MarkupScopeWiring {
	component_scope_ref: string;
	get_dispatcher: string;
	on_destroy: string;
}

export interface MarkupNameAllocator {
	reserve(name: string): string;
}

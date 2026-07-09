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

/**
 * Offset mapping between original markup and generated helper code.
 *
 * @example
 * ```ts
 * const relocation: MarkupRelocation = {
 *   originalStart: 4,
 *   originalEnd: 17,
 *   generatedStart: 32,
 *   generatedEnd: 45,
 * };
 * ```
 *
 * @since 3.2.3
 */
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

/**
 * Describes a brace expression that contains `yield*` and needs lowering.
 *
 * @example
 * ```ts
 * const candidate: MarkupCandidate = {
 *   placeholder: "__SER___0",
 *   start: 4,
 *   end: 19,
 *   expr_text: "yield* load()",
 *   filename: "App.svelte",
 *   key: "plain",
 * };
 * ```
 *
 * @since 2.0.0
 */
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

/**
 * Markup AST context where a lowered `yield*` expression was discovered.
 *
 * @example
 * ```ts
 * const kind: TagKind = "event";
 * ```
 *
 * @since 2.0.0
 */
export type TagKind = "plain" | "each" | "await" | "event" | "render" | "render_argument";

/**
 * Source edit emitted for one lowered markup candidate.
 *
 * @example
 * ```ts
 * const replacement: Replacement = {
 *   start: 4,
 *   end: 19,
 *   text: "__SER___value",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface Replacement {
	start: number;
	end: number;
	text: string;
	helpers?: HelperDeclaration[];
	relocation?: PendingRelocation;
}

/**
 * Helper declaration emitted alongside markup replacements.
 *
 * @example
 * ```ts
 * const helper: HelperDeclaration = {
 *   text: "const __SER___value = dispatcher.value(...);",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface HelperDeclaration {
	text: string;
	relocation?: PendingRelocation;
}

/**
 * Relocation range that is relative to a pending replacement.
 *
 * @example
 * ```ts
 * const relocation: PendingRelocation = {
 *   originalStart: 4,
 *   originalEnd: 17,
 *   generatedStartInReplacement: 6,
 *   generatedEndInReplacement: 19,
 * };
 * ```
 *
 * @since 3.2.3
 */
export interface PendingRelocation {
	originalStart: number;
	originalEnd: number;
	generatedStartInReplacement: number;
	generatedEndInReplacement: number;
}

/**
 * Helper-code insertion point with optional relocation metadata.
 *
 * @example
 * ```ts
 * const insertion: Insertion = {
 *   start: 42,
 *   text: "<script>const dispatcher = get_dispatcher();</script>",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface Insertion {
	start: number;
	text: string;
	relocations?: PendingRelocation[];
}

/**
 * Generated binding names used by markup helper injection.
 *
 * @example
 * ```ts
 * const bindings: MarkupHelperBindings = {
 *   codes: "__SER___codes",
 *   dispatcher: "__SER___dispatcher",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface MarkupHelperBindings {
	codes: string;
	dispatcher: string;
	yieldable: string;
}

/**
 * Allocator that reserves collision-free helper names for generated markup.
 *
 * @example
 * ```ts
 * const allocator: MarkupNameAllocator = {
 *   reserve: (name) => name,
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface MarkupNameAllocator {
	/**
	 * Reserves a generated name.
	 *
	 * @param name - Preferred identifier to reserve.
	 * @returns A collision-free identifier that can be emitted into generated
	 *   markup helper code.
	 */
	reserve(name: string): string;
}

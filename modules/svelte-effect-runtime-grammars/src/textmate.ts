import textmate_language_json from "./textmate/svelte-effect-runtime.tmLanguage.json" with { type: "json" };

/**
 * JSON-compatible TextMate capture map used by raw grammar rules.
 *
 * @example
 * ```ts
 * const captures: TextMateCaptureMap = {
 *   "1": { name: "keyword.control.ser.svelte" },
 * };
 * ```
 *
 * @since 3.2.0
 */
export interface TextMateCaptureMap {
	readonly [capture_id: string]: TextMateRawRule;
}

/**
 * JSON-compatible TextMate repository map used by raw grammar rules.
 *
 * @example
 * ```ts
 * const repository: TextMateRepository = {
 *   "ser-yield-star": { match: "\\byield\\s*\\*" },
 * };
 * ```
 *
 * @since 3.2.0
 */
export interface TextMateRepository {
	readonly [rule_name: string]: TextMateRawRule;
}

/**
 * JSON-compatible subset of a TextMate grammar rule.
 *
 * @example
 * ```ts
 * const rule: TextMateRawRule = {
 *   match: "\\byield\\s*(\\*)",
 *   name: "keyword.control.yield.ser.svelte",
 * };
 * ```
 *
 * @since 3.2.0
 */
export interface TextMateRawRule {
	readonly include?: string;
	readonly name?: string;
	readonly contentName?: string;
	readonly match?: string;
	readonly captures?: TextMateCaptureMap;
	readonly begin?: string;
	readonly beginCaptures?: TextMateCaptureMap;
	readonly end?: string;
	readonly endCaptures?: TextMateCaptureMap;
	readonly patterns?: readonly TextMateRawRule[];
	readonly repository?: TextMateRepository;
}

/**
 * Shiki-compatible TextMate language registration for a raw grammar.
 *
 * @example
 * ```ts
 * const language: TextMateLanguageRegistration = textmate.language;
 * ```
 *
 * @since 3.2.0
 */
export interface TextMateLanguageRegistration {
	readonly name: string;
	readonly displayName: string;
	readonly scopeName: string;
	readonly injectionSelector: string;
	readonly injectTo: readonly string[];
	readonly embeddedLangs: readonly string[];
	readonly patterns: readonly TextMateRawRule[];
	readonly repository: TextMateRepository;
}

/**
 * Public TextMate grammar bundle for SER-aware Svelte highlighting.
 *
 * @example
 * ```ts
 * await highlighter.loadLanguage(textmate.language);
 * ```
 *
 * @since 3.2.0
 */
export interface TextMateGrammarBundle {
	readonly language: TextMateLanguageRegistration;
	readonly scope_name: string;
	readonly target_scope_name: string;
	readonly injection_selector: string;
}

/**
 * Shiki-ready TextMate injection grammar that adds SER syntax to the stock
 * Svelte grammar without replacing Svelte's own grammar.
 *
 * @example
 * ```ts
 * await highlighter.loadLanguage(textmate_language);
 * ```
 *
 * @since 3.2.0
 */
export const textmate_language: TextMateLanguageRegistration = textmate_language_json;

/**
 * TextMate grammar bundle exported by `svelte-effect-runtime/grammars`.
 *
 * @example
 * ```ts
 * await highlighter.loadLanguage(textmate.language);
 * ```
 *
 * @since 3.2.0
 */
export const textmate: TextMateGrammarBundle = {
	language: textmate_language,
	scope_name: textmate_language.scopeName,
	target_scope_name: "source.svelte",
	injection_selector: textmate_language.injectionSelector,
};

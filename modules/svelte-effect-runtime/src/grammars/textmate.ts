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

const punctuation_begin: TextMateRawRule = {
  name: "punctuation.section.embedded.begin.svelte",
};

const punctuation_end: TextMateRawRule = {
  name: "punctuation.section.embedded.end.svelte",
};

const directive_punctuation: TextMateRawRule = {
  name: "punctuation.definition.tag.ser.svelte",
};

const expression_patterns: readonly TextMateRawRule[] = [
  { include: "#ser-yield-star" },
  { include: "source.ts" },
];

/**
 * Shiki-ready TextMate injection grammar that adds SER syntax to the stock
 * Svelte grammar without replacing Svelte's own grammar.
 *
 * @since 3.2.0
 */
export const textmate_language: TextMateLanguageRegistration = {
  name: "svelte-effect-runtime",
  displayName: "Svelte Effect Runtime",
  scopeName: "source.svelte.ser.injection",
  injectionSelector: "L:source.svelte -comment -string",
  injectTo: ["source.svelte"],
  embeddedLangs: ["typescript"],
  patterns: [
    { include: "#ser-script-effect-attribute" },
    { include: "#ser-declaration-tag" },
    { include: "#ser-const-directive" },
    { include: "#ser-block-directive" },
    { include: "#ser-else-if-directive" },
    { include: "#ser-expression-directive" },
    { include: "#ser-event-attribute" },
    { include: "#ser-yield-expression" },
    { include: "#ser-yield-star" },
  ],
  repository: {
    "ser-script-effect-attribute": {
      match:
        "(<script\\b(?=[^>]*\\s+effect(?:\\s*=|\\s|>|$))[^>]*?)(\\s+)(effect)(?=(?:\\s*=|\\s|>|$))",
      captures: {
        "3": { name: "storage.modifier.effect.ser.svelte" },
      },
    },

    "ser-yield-star": {
      match: "\\byield\\s*(\\*)",
      name: "keyword.control.yield.ser.svelte",
      captures: {
        "1": { name: "keyword.operator.yield.star.ser.svelte" },
      },
    },

    "ser-yield-expression": {
      begin: "(\\{)(?=\\s*yield\\s*\\*)",
      beginCaptures: {
        "1": punctuation_begin,
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.expression.yield.ser.svelte",
      patterns: expression_patterns,
    },

    "ser-declaration-tag": {
      begin: "(\\{)(\\s*)(?=(?:const|let)\\b)",
      beginCaptures: {
        "1": punctuation_begin,
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.declaration.ser.svelte",
      patterns: [
        {
          match: "\\b(?:const|let)\\b",
          name: "storage.type.declaration.ser.svelte",
        },
        ...expression_patterns,
      ],
    },

    "ser-const-directive": {
      begin: "(\\{)(\\s*)(@)(const)\\b",
      beginCaptures: {
        "1": punctuation_begin,
        "3": directive_punctuation,
        "4": { name: "storage.type.declaration.ser.svelte" },
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.directive.const.ser.svelte",
      patterns: expression_patterns,
    },

    "ser-block-directive": {
      begin: "(\\{)(\\s*)(#)(each|await|if|key)\\b",
      beginCaptures: {
        "1": punctuation_begin,
        "3": directive_punctuation,
        "4": { name: "keyword.control.block.ser.svelte" },
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.directive.block.ser.svelte",
      patterns: expression_patterns,
    },

    "ser-else-if-directive": {
      begin: "(\\{)(\\s*)(:)(else\\s+if)\\b",
      beginCaptures: {
        "1": punctuation_begin,
        "3": directive_punctuation,
        "4": { name: "keyword.control.conditional.ser.svelte" },
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.directive.else-if.ser.svelte",
      patterns: expression_patterns,
    },

    "ser-expression-directive": {
      begin: "(\\{)(\\s*)(@)(render|html|debug)\\b",
      beginCaptures: {
        "1": punctuation_begin,
        "3": directive_punctuation,
        "4": { name: "keyword.control.directive.ser.svelte" },
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.directive.expression.ser.svelte",
      patterns: expression_patterns,
    },

    "ser-event-attribute": {
      begin:
        "(\\b(?:on:[A-Za-z_$][\\w$-]*|on[A-Za-z_$][\\w$-]*)\\b)(\\s*=\\s*)(\\{)(?=\\s*yield\\s*\\*)",
      beginCaptures: {
        "1": { name: "entity.other.attribute-name.event.ser.svelte" },
        "3": punctuation_begin,
      },
      end: "(\\})",
      endCaptures: {
        "1": punctuation_end,
      },
      name: "meta.embedded.attribute.event.ser.svelte",
      patterns: expression_patterns,
    },
  },
};

/**
 * TextMate grammar bundle exported by `svelte-effect-runtime/grammars`.
 *
 * @since 3.2.0
 */
export const textmate: TextMateGrammarBundle = {
  language: textmate_language,
  scope_name: textmate_language.scopeName,
  target_scope_name: "source.svelte",
  injection_selector: textmate_language.injectionSelector,
};

/**
 * Line/character position shape used by Svelte language-server document
 * mappers.
 *
 * @example
 * ```ts
 * const position: DocumentPosition = { line: 3, character: 12 };
 * ```
 *
 * @since 2.0.0
 */
export type DocumentPosition = {
  line: number;
  character: number;
};

/**
 * Structural mapper contract implemented by Svelte internals and local mapper
 * adapters.
 *
 * @example
 * ```ts
 * const original = mapper.getOriginalPosition(generated);
 * ```
 *
 * @since 2.0.0
 */
export type Mapper = {
  getOriginalPosition(position: DocumentPosition): DocumentPosition;
  getGeneratedPosition(position: DocumentPosition): DocumentPosition;
  isInGenerated(position: DocumentPosition): boolean;
};

/**
 * Script tag metadata returned by the Svelte language server.
 *
 * @example
 * ```ts
 * const content = tag_info.content;
 * ```
 *
 * @since 2.0.0
 */
export type FragmentTagInfo = {
  content: string;
  [key: string]: unknown;
};

/**
 * Character relocation produced while moving generated script snippets back to
 * their original source regions.
 *
 * @example
 * ```ts
 * const relocation: Relocation = {
 *   originalStart: 0,
 *   originalEnd: 5,
 *   generatedStart: 10,
 *   generatedEnd: 15,
 * };
 * ```
 *
 * @since 2.0.0
 */
export type Relocation = {
  originalStart: number;
  originalEnd: number;
  generatedStart: number;
  generatedEnd: number;
};

/**
 * Transform output shape returned by optional runtime transform calls.
 *
 * @example
 * ```ts
 * const result: TransformResult = { code, map, relocations };
 * ```
 *
 * @since 2.0.0
 */
export type TransformResult = {
  code: string;
  map?: Record<string, unknown>;
  relocations?: Array<Relocation>;
};

/**
 * Transform output shape required before the language server creates a virtual
 * Svelte document.
 *
 * @example
 * ```ts
 * const result: RequiredTransformResult = { code, map: {}, relocations: [] };
 * ```
 *
 * @since 2.0.0
 */
export type RequiredTransformResult = {
  code: string;
  map: Record<string, unknown>;
  relocations?: Array<Relocation>;
};

/**
 * Runtime transform functions loaded by the language-server patch.
 *
 * @example
 * ```ts
 * const markup = transforms.transformEffectMarkup(code, { filename });
 * ```
 *
 * @since 2.0.0
 */
export type TransformSet = {
  transformEffectMarkup: (
    code: string,
    options: { filename: string },
  ) => RequiredTransformResult;
  transformEffectScript: (
    code: string,
    options: { filename: string },
  ) => RequiredTransformResult;
};

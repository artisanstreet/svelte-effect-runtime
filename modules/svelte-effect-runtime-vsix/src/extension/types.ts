/**
 * Strategy used by the VS Code extension to connect to the language server.
 *
 * @example
 * ```ts
 * const mode: ClientMode = "auto";
 * ```
 *
 * @since 2.0.0
 */
export type ClientMode = "auto" | "direct" | "svelteExtension";

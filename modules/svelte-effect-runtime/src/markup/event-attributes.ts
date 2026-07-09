/**
 * Checks whether a Svelte attribute name should be treated as an event handler
 * boundary for markup effect lowering.
 *
 * @example
 * ```ts
 * is_event_attribute_name("onChange");
 * ```
 *
 * @since 3.4.11
 * @param name - Attribute name read from Svelte source or the parsed AST.
 * @returns Whether the attribute is an event-like Svelte handler attribute.
 */
export function is_event_attribute_name(name: string): boolean {
	return /^on(?::[A-Za-z_$][\w$-]*|[A-Za-z_$][\w$-]*)$/i.test(name);
}

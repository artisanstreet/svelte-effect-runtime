/**
 * Checks whether a parsed Svelte attribute has the same event shape that
 * Svelte's compiler recognizes.
 *
 * @example
 * ```ts
 * is_svelte_event_attribute({
 *   type: "Attribute",
 *   name: "onclick",
 *   value: { type: "ExpressionTag" },
 * });
 * ```
 *
 * @since 4.0.0
 * @param attribute - Parsed Svelte attribute with its name and complete value
 *   shape.
 * @returns Whether Svelte treats the attribute as an event attribute.
 */
export function is_svelte_event_attribute(attribute: {
	type: string;
	name?: string;
	value?: unknown;
}): boolean {
	if (attribute.type !== "Attribute" || !attribute.name?.startsWith("on")) {
		return false;
	}

	const value = attribute.value;

	return (
		(value !== true && !Array.isArray(value)) ||
		(Array.isArray(value) && value.length === 1 && value[0]?.type === "ExpressionTag")
	);
}

/**
 * Normalizes an event-like attribute name to Svelte's lowercase DOM event
 * spelling while keeping the legacy directive prefix intact.
 *
 * @example
 * ```ts
 * normalize_event_attribute_name("onChange");
 * ```
 *
 * @since 3.4.11
 * @param name - Event-like attribute name read from Svelte source or the
 *   parsed AST.
 * @returns Lowercase event attribute spelling for DOM-facing Svelte nodes.
 */
export function normalize_event_attribute_name(name: string): string {
	if (name.startsWith("on:")) {
		return `on:${name.slice(3).toLowerCase()}`;
	}

	return name.toLowerCase();
}

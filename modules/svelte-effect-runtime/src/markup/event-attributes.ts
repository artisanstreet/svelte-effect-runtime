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

export function normalize_event_attribute_name(name: string): string {
	if (name.startsWith("on:")) {
		return `on:${name.slice(3).toLowerCase()}`;
	}

	return name.toLowerCase();
}

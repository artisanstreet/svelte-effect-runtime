export { copy_property_descriptors } from "$/internal/descriptors.ts";
import type { NativeMethod } from "./types.ts";

export function has_method<K extends PropertyKey>(
	value: unknown,
	key: K,
): value is Record<K, NativeMethod> {
	const value_type = typeof value;

	return (
		((value_type === "object" && value !== null) || value_type === "function") &&
		typeof (value as Record<PropertyKey, unknown>)[key] === "function"
	);
}

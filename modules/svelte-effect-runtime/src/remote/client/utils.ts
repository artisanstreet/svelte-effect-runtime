export { copy_property_descriptors } from "$/internal/descriptors.ts";
import type { NativeMethod } from "./types.ts";

export function has_method<K extends PropertyKey>(
	value: unknown,
	key: K,
): value is Record<K, NativeMethod> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<PropertyKey, unknown>)[key] === "function"
	);
}

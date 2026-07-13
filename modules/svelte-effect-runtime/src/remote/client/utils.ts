export { copy_property_descriptors } from "$/internal/descriptors.ts";
import type { NativeMethod } from "./types.ts";

/**
 * Checks whether a value has a callable method property.
 *
 * @example
 * ```ts
 * if (has_method(resource, "refresh")) {
 *   resource.refresh();
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @param key - Method key to look up.
 * @returns Whether the value has a function at `key`.
 */
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

const default_excluded_descriptor_keys = new Set<PropertyKey>(["length", "name", "prototype"]);

/**
 * Copies own property descriptors from a native helper to a wrapper while
 * skipping function metadata and any caller-specific keys.
 *
 * @example
 * ```ts
 * copy_property_descriptors(native_remote, wrapped_remote);
 * ```
 *
 * @since 2.0.0
 * @param source - Source object or function whose descriptors should be
 *   mirrored.
 * @param target - Wrapper object or function that receives copied descriptors.
 * @param exclude - Additional property keys that should not be copied.
 * @returns Nothing.
 */
export function copy_property_descriptors(
	source: unknown,
	target: object,
	exclude: ReadonlySet<PropertyKey> = default_excluded_descriptor_keys,
): void {
	if (typeof source !== "object" && typeof source !== "function") {
		return;
	}

	if (source === null) {
		return;
	}

	for (const key of Reflect.ownKeys(source)) {
		if (default_excluded_descriptor_keys.has(key) || exclude.has(key)) {
			continue;
		}

		const descriptor = Object.getOwnPropertyDescriptor(source, key);

		if (!descriptor) {
			continue;
		}

		Object.defineProperty(target, key, descriptor);
	}
}

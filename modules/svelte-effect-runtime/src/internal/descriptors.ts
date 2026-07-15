const default_excluded_descriptor_keys = new Set<PropertyKey>(["length", "name", "prototype"]);

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

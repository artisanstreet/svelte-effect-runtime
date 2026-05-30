import type { NativeMethod } from "./types.ts";

/**
 * Checks whether a value has a callable method property.
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

/**
 * Copies own property descriptors from a native remote helper to an adapter.
 *
 * @since 2.0.0
 * @param source - Source object or function to mirror.
 * @param target - Adapter object receiving descriptors.
 * @param exclude - Property keys that should not be copied.
 * @returns Nothing.
 */
export function copy_property_descriptors(
  source: unknown,
  target: object,
  exclude: ReadonlySet<PropertyKey> = new Set(),
): void {
  if (typeof source !== "object" && typeof source !== "function") {
    return;
  }

  if (source === null) {
    return;
  }

  for (const key of Reflect.ownKeys(source)) {
    if (
      key === "length" ||
      key === "name" ||
      key === "prototype" ||
      exclude.has(key)
    ) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(source, key);

    if (!descriptor) {
      continue;
    }

    Object.defineProperty(target, key, descriptor);
  }
}

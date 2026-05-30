/**
 * Copies descriptors from a native SvelteKit remote helper to a wrapper.
 *
 * @since 2.0.0
 * @param source - Native helper to mirror.
 * @param target - Wrapper receiving descriptors.
 * @returns Nothing.
 */
export function copy_remote_descriptors(source: unknown, target: object): void {
  if (typeof source !== "object" && typeof source !== "function") {
    return;
  }

  if (source === null) {
    return;
  }

  for (const key of Reflect.ownKeys(source)) {
    if (key === "length" || key === "name" || key === "prototype") {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(source, key);

    if (!descriptor) {
      continue;
    }

    Object.defineProperty(target, key, descriptor);
  }
}

/**
 * Encodes dependency arrays into stable cache keys within one dispatcher.
 *
 * @example
 * ```ts
 * const hash_deps = make_dependency_hasher();
 * const key = hash_deps([user_id, filters]);
 * ```
 *
 * @since 4.0.1
 * @param deps - Dependency array to encode for cache lookup.
 * @returns A structured string key whose object and symbol identities remain
 *   stable for the lifetime of the owning dispatcher.
 * @internal
 */
export type DependencyHasher = (deps: readonly unknown[]) => string;

/**
 * Creates a dependency hasher with dispatcher-local identity state.
 *
 * @example
 * ```ts
 * const hash_deps = make_dependency_hasher();
 * const key = hash_deps([user_id, filters]);
 * ```
 *
 * @since 4.0.1
 * @returns A hasher whose object and symbol registries are isolated from every
 *   other dispatcher.
 * @internal
 */
export function make_dependency_hasher(): DependencyHasher {
	const object_dep_ids = new WeakMap<object, number>();
	const symbol_dep_ids = new Map<symbol, number>();

	let next_object_dep_id = 0;
	let next_symbol_dep_id = 0;

	const hash_symbol_dep = (dep: symbol): string => {
		let id = symbol_dep_ids.get(dep);

		if (id === undefined) {
			next_symbol_dep_id += 1;
			id = next_symbol_dep_id;
			symbol_dep_ids.set(dep, id);
		}

		return `y:${id}`;
	};

	const hash_object_dep = (dep: object): string => {
		let id = object_dep_ids.get(dep);

		if (id === undefined) {
			next_object_dep_id += 1;
			id = next_object_dep_id;
			object_dep_ids.set(dep, id);
		}

		return `o:${id}`;
	};

	const hash_dep = (dep: unknown): string | readonly ["s", string] => {
		if (dep === null) {
			return "l:null";
		}

		if (dep === undefined) {
			return "u:undefined";
		}

		const type = typeof dep;

		if (type === "string") {
			return ["s", dep as string];
		}

		if (type === "number") {
			return `n:${Object.is(dep, -0) ? "-0" : String(dep)}`;
		}

		if (type === "bigint") {
			return `b:${dep}`;
		}

		if (type === "boolean") {
			return dep ? "t:true" : "f:false";
		}

		if (type === "symbol") {
			return hash_symbol_dep(dep as symbol);
		}

		return hash_object_dep(dep as object);
	};

	const hash_deps = (deps: readonly unknown[]): string => JSON.stringify(deps.map(hash_dep));

	return hash_deps;
}

const object_dep_ids = new WeakMap<object, number>();
const symbol_dep_ids = new Map<symbol, number>();

let next_object_dep_id = 0;
let next_symbol_dep_id = 0;

/**
 * Builds a deterministic cache key from a dependency array.
 *
 * @example
 * ```ts
 * const key = hash_deps([user_id, filters]);
 * ```
 *
 * @since 2.0.0
 * @param deps - Dependency array to encode for cache lookup.
 * @returns A structured string key suitable for Map lookups.
 * @internal
 */
export function hash_deps(deps: readonly unknown[]): string {
	const parts = deps.map((dep) => {
		if (dep === null) {
			return "l:null";
		}

		if (dep === undefined) {
			return "u:undefined";
		}

		const type = typeof dep;

		if (type === "string") {
			return ["s", dep];
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
	});

	return JSON.stringify(parts);
}

function hash_symbol_dep(dep: symbol): string {
	let id = symbol_dep_ids.get(dep);

	if (id === undefined) {
		next_symbol_dep_id += 1;
		id = next_symbol_dep_id;
		symbol_dep_ids.set(dep, id);
	}

	return `y:${id}`;
}

function hash_object_dep(dep: object): string {
	let id = object_dep_ids.get(dep);

	if (id === undefined) {
		next_object_dep_id += 1;
		id = next_object_dep_id;
		object_dep_ids.set(dep, id);
	}

	return `o:${id}`;
}

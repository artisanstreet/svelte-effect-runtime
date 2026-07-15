/** Assigns stable identities to object dependencies while hashing value dependencies. */
export type DependencyHasher = (deps: readonly unknown[]) => string;

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

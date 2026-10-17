import { getAbortSignal, hydratable } from "svelte";
import { uneval } from "devalue";

/**
 * What the server records for one component Effect. `skip` means the value
 * could not be serialized or the Effect failed, so the client runs it again.
 */
export type HydrationRecord =
	| {
			readonly v: unknown;
	  }
	| {
			readonly skip: true;
	  };

type SvelteHydrationStore = Map<string, unknown>;

type SvelteWindow = {
	readonly __svelte?: { readonly h?: SvelteHydrationStore };
};

const skip_record: HydrationRecord = { skip: true };

/**
 * Builds a key that is identical on the server and the hydrating client: the
 * component instance id from `$props.id()`, the source position with Vite
 * queries removed, and how often that position ran in this instance.
 */
export function make_hydration_key(instance: string, id: string, occurrence: number): string {
	const position = id.replace(/\?[^:]*(?=:\d+:\d+$)/, "");

	return `ser:${instance}:${hash_text(position)}:${occurrence}`;
}

/** Registers a server render's Effect result for the client. Outside a render this does nothing. */
export function record_hydration(key: string, promise: Promise<unknown>): void {
	try {
		hydratable(key, () => promise.then(to_hydration_record, () => skip_record));
	} catch {
		/** No render context or async mode: the client simply runs the Effect. */
	}
}

/**
 * Takes the server's record for a key. Svelte's `hydratable()` only answers
 * during its synchronous hydration pass, which template `await` expressions
 * run after, so the store the server script fills is read directly. Each
 * record is used once; later runs are client updates and execute normally.
 */
export function read_hydration(key: string): Promise<HydrationRecord> | undefined {
	const store = (globalThis as SvelteWindow).__svelte?.h;

	if (!store?.has(key)) {
		return undefined;
	}

	const record = store.get(key);
	store.delete(key);

	return Promise.resolve(record as HydrationRecord | Promise<HydrationRecord>);
}

/** The current derived or effect's abort signal, when one is running. */
export function get_reaction_abort_signal(): AbortSignal | undefined {
	try {
		return getAbortSignal();
	} catch {
		return undefined;
	}
}

function to_hydration_record(value: unknown): HydrationRecord {
	try {
		uneval({ v: value });

		return { v: value };
	} catch {
		return skip_record;
	}
}

function hash_text(text: string): string {
	let hash = 0x811c9dc5;

	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(36);
}

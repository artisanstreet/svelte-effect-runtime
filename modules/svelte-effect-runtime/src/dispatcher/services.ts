import { createContext } from "svelte";
import type { Context } from "effect";

/** Services an ancestor component built with `ProvideLayer`, once they are ready. */
export type ProvidedServices = Promise<Context.Context<never>>;

const [get_provided_services, set_provided, has_provided_services] =
	createContext<ProvidedServices>();

export const set_provided_services = set_provided;

/** The nearest ancestor's provided services. Only answers during component initialisation. */
export function read_provided_services(): ProvidedServices | undefined {
	try {
		return has_provided_services() ? get_provided_services() : undefined;
	} catch {
		return undefined;
	}
}

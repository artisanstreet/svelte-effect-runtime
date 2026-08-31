import { stringify } from "devalue";

export type NativeTransport = Readonly<
	Record<
		string,
		{
			readonly encode: (value: unknown) => false | unknown;
		}
	>
>;

/** Converts available SvelteKit transport hooks into a devalue live snapshot encoder. */
export function make_remote_live_snapshot_encoder(
	transport: NativeTransport | undefined,
): (value: unknown) => string {
	const encoders = Object.fromEntries(
		Object.entries(transport ?? {}).map(([key, transformer]) => [key, transformer.encode]),
	);

	return (value) => stringify(value, encoders);
}

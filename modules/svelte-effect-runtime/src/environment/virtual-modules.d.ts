declare module "$ser/env/private" {
	type Source = typeof import("$app/env/private");

	const environment: {
		readonly [Name in keyof Source]: import("effect").Effect.Effect<Source[Name]>;
	};

	export = environment;
}

declare module "$ser/env/public" {
	type Source = typeof import("$app/env/public");

	const environment: {
		readonly [Name in keyof Source]: import("effect").Effect.Effect<Source[Name]>;
	};

	export = environment;
}

import { Command, Form, Prerender, Query, RequestEvent } from "svelte-effect-runtime";
import { RuntimeLabel } from "$lib/server-runtime";
import { lifecycle_events } from "$lib/lifecycle";
import { Effect, Schema, Stream } from "effect";

const ItemSchema = Schema.Struct({
	name: Schema.NonEmptyString.pipe(Schema.mutableKey),
	items: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				label: Schema.NonEmptyString.pipe(Schema.mutableKey),
			}),
		),
	).pipe(Schema.mutableKey),
});

const KeyedItemSchema = Schema.Struct({
	id: Schema.String,
	label: Schema.NonEmptyString.pipe(Schema.mutableKey),
	name: Schema.NonEmptyString.pipe(Schema.mutableKey),
});

let command_count = 0;
let query_count = 0;

export const GetProfile = Query(Schema.Struct({ id: Schema.String }), ({ id }) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;
		const runtime = yield* RuntimeLabel;

		return {
			id,
			message: `profile:${id}`,
			request_id: event.locals.request_id,
			runtime: runtime.value,
			session: event.cookies.get("session") ?? "none",
		};
	}),
);

export const GetDeduped = Query(Schema.String, (id) =>
	Effect.gen(function* () {
		return { id, invocation: ++query_count };
	}),
);

export const GetBatched = Query.batch(Schema.String, (ids) =>
	Effect.gen(function* () {
		return (id: string, index: number) => `${index}:${ids[index]}:${id}`;
	}),
);

export const GetLive = Query.live(() => Stream.make("live:first"));

export const GetLifecycle = Query.live(() =>
	Stream.make("connected").pipe(
		Stream.concat(Stream.never),
		Stream.ensuring(Effect.sync(() => lifecycle_events.push("finalized"))),
		Stream.tap(() => Effect.sync(() => lifecycle_events.push("started"))),
	),
);

export const GetSerialized = Query(() =>
	Effect.gen(function* () {
		return {
			bigint: 42n,
			bytes: new Uint8Array([1, 2, 3]),
			date: new Date("2024-01-02T03:04:05.000Z"),
			map: new Map([["answer", 42]]),
			set: new Set(["alpha", "beta"]),
		};
	}),
);

export const Increment = Command(Schema.Number, (amount) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		command_count += amount;
		event.cookies.set("command", String(command_count), { path: "/" });

		return `command:${command_count}`;
	}),
);

export const CreateItem = Form(ItemSchema, ({ data, invalid }) =>
	Effect.gen(function* () {
		if (data.items[0]?.label === "blocked") {
			return yield* invalid.items[0]!.label("Blocked labels are rejected.");
		}

		return {
			message: `saved:${data.name}:${data.items[0]?.label ?? "missing"}`,
		};
	}),
);

export const CreateKeyedItem = Form(KeyedItemSchema, ({ data, invalid }) =>
	Effect.gen(function* () {
		if (data.label === "blocked") {
			return yield* invalid.label("Blocked labels are rejected.");
		}

		return {
			message: `saved:${data.id}:${data.name}:${data.label}`,
		};
	}),
);

export const GetSnapshot = Prerender(
	() =>
		Effect.gen(function* () {
			return "snapshot:ready";
		}),
	{ dynamic: true },
);

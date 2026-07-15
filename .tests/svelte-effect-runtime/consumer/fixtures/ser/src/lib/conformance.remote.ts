import {
	GetLiveState,
	NextLiveValue,
	RecordLiveFinalization,
	RecordLiveStart,
} from "$lib/server/live-state.server";
import {
	Command,
	Error as HttpError,
	Form,
	Query,
	Redirect,
	RequestEvent,
} from "svelte-effect-runtime";
import { WaitForGate } from "$lib/server/gates.server";
import { RecordLifecycleEvent } from "$lib/lifecycle";
import { RuntimeLabel } from "$lib/server-runtime";
import { Effect, Schema, Stream } from "effect";
import { requested } from "$app/server";

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

const TransformedItemSchema = Schema.Struct({
	amount: Schema.FiniteFromString.pipe(Schema.mutableKey),
	label: Schema.NonEmptyString.pipe(Schema.mutableKey),
});

let query_count = 0;
let refresh_query_count = 0;
let mutation_value = 0;

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

export const GetSharedLive = Query.live(Schema.String, (key) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const start = yield* RecordLiveStart;

			const state = yield* GetLiveState;
			const updates = Stream.fromEffectRepeat(NextLiveValue(start)).pipe(
				Stream.takeWhile(
					(update): update is Extract<typeof update, { readonly _tag: "Value" }> =>
						update._tag === "Value",
				),
				Stream.map((update) => `${key}:${update.value}`),
			);

			return Stream.make(`${key}:${state.value}`).pipe(
				Stream.concat(updates),
				Stream.ensuring(RecordLiveFinalization(start)),
			);
		}),
	),
);

export const GetLifecycle = Query.live(() =>
	Stream.make("connected").pipe(
		Stream.concat(Stream.tick("100 millis").pipe(Stream.map(() => "connected"))),
		Stream.onStart(RecordLifecycleEvent("started")),
		Stream.ensuring(RecordLifecycleEvent("finalized")),
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

export const GetRefreshable = Query(Schema.String, (key) =>
	Effect.gen(function* () {
		return { key, invocation: ++refresh_query_count };
	}),
);

export const GetSlowQuery = Query(Schema.String, (key) =>
	Effect.gen(function* () {
		yield* WaitForGate("query");

		return `slow:${key}`;
	}),
);

export const GetQueryFailure = Query(Schema.String, (kind) =>
	Effect.gen(function* () {
		return yield* HttpError(409, { message: `query:${kind}:conflict` });
	}),
);

export const GetMutation = Query(() =>
	Effect.gen(function* () {
		return { value: mutation_value };
	}),
);

export const Increment = Command(Schema.Number, (amount) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;
		const command_count = Number(event.cookies.get("command") ?? "0") + amount;

		event.cookies.set("command", String(command_count), { path: "/" });

		return `command:${command_count}`;
	}),
);

export const Mutate = Command(Schema.Number, (amount) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		mutation_value += amount;
		yield* Effect.promise(() => requested(GetMutation as never, 1).refreshAll());

		return {
			method: event.request.method,
			request_id: event.locals.request_id,
			value: mutation_value,
		};
	}),
);

export const SlowCommand = Command(() =>
	Effect.gen(function* () {
		yield* WaitForGate("command");

		return "command:released";
	}),
);

export const RedirectCommand = Command(() =>
	Effect.gen(function* () {
		return yield* Redirect(303, "/redirected?source=command");
	}),
);

export const FailCommand = Command(() =>
	Effect.gen(function* () {
		return yield* HttpError(409, { message: "command:conflict" });
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

export const CreateTransformedItem = Form(TransformedItemSchema, ({ data }) =>
	Effect.gen(function* () {
		if (data.label === "slow") {
			yield* WaitForGate("form");
		}

		if (data.label === "redirect") {
			return yield* Redirect(303, "/redirected?source=form");
		}

		return {
			amount: data.amount,
			amount_type: typeof data.amount,
			message: `transformed:${data.amount}:${data.label}`,
		};
	}),
);

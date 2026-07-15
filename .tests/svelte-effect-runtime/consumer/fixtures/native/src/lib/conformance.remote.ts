import { command, form, getRequestEvent, query, requested } from "$app/server";
import {
	get_live_state,
	next_live_value,
	record_live_finalization,
	record_live_start,
} from "$lib/server/live-state.server";
import { wait_for_gate } from "$lib/server/gates.server";
import { lifecycle_events } from "$lib/lifecycle";
import { error, invalid, redirect } from "@sveltejs/kit";
import { Schema } from "effect";

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

const ItemStandardSchema = Schema.toStandardSchemaV1(ItemSchema);
const KeyedItemSchema = Schema.toStandardSchemaV1(
	Schema.Struct({
		id: Schema.String,
		label: Schema.NonEmptyString.pipe(Schema.mutableKey),
		name: Schema.NonEmptyString.pipe(Schema.mutableKey),
	}),
);

const TransformedItemSchema = Schema.Struct({
	amount: Schema.FiniteFromString.pipe(Schema.mutableKey),
	label: Schema.NonEmptyString.pipe(Schema.mutableKey),
});

const TransformedItemStandardSchema = Schema.toStandardSchemaV1(TransformedItemSchema);

let query_count = 0;
let refresh_query_count = 0;
let mutation_value = 0;

export const GetProfile = query(
	Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
	({ id }) => {
		const event = getRequestEvent();

		return {
			id,
			message: `profile:${id}`,
			request_id: event.locals.request_id,
			runtime: "configured",
			session: event.cookies.get("session") ?? "none",
		};
	},
);

export const GetDeduped = query(Schema.toStandardSchemaV1(Schema.String), (id) => ({
	id,
	invocation: ++query_count,
}));

export const GetBatched = query.batch(
	Schema.toStandardSchemaV1(Schema.String),
	(ids) => (id, index) => `${index}:${ids[index]}:${id}`,
);

export const GetLive = query.live(async function* () {
	yield "live:first";
});

export const GetSharedLive = query.live(
	Schema.toStandardSchemaV1(Schema.String),
	async function* (key) {
		record_live_start();

		try {
			yield `${key}:${get_live_state().value}`;

			while (true) {
				yield `${key}:${await next_live_value()}`;
			}
		} finally {
			record_live_finalization();
		}
	},
);

export const GetLifecycle = query.live(async function* () {
	lifecycle_events.push("started");

	try {
		yield "connected";
		await new Promise(() => {});
	} finally {
		lifecycle_events.push("finalized");
	}
});

export const GetSerialized = query(() => ({
	bigint: 42n,
	bytes: new Uint8Array([1, 2, 3]),
	date: new Date("2024-01-02T03:04:05.000Z"),
	map: new Map([["answer", 42]]),
	set: new Set(["alpha", "beta"]),
}));

export const GetRefreshable = query(Schema.toStandardSchemaV1(Schema.String), (key) => ({
	key,
	invocation: ++refresh_query_count,
}));

export const GetSlowQuery = query(Schema.toStandardSchemaV1(Schema.String), async (key) => {
	await wait_for_gate("query");

	return `slow:${key}`;
});

export const GetQueryFailure = query(Schema.toStandardSchemaV1(Schema.String), (kind) => {
	error(409, { message: `query:${kind}:conflict` });
});

export const GetMutation = query(() => ({ value: mutation_value }));

export const Increment = command(Schema.toStandardSchemaV1(Schema.Number), (amount) => {
	const event = getRequestEvent();
	const command_count = Number(event.cookies.get("command") ?? "0") + amount;

	event.cookies.set("command", String(command_count), { path: "/" });

	return `command:${command_count}`;
});

export const Mutate = command(Schema.toStandardSchemaV1(Schema.Number), async (amount) => {
	const event = getRequestEvent();

	mutation_value += amount;
	await requested(GetMutation, 1).refreshAll();

	return {
		method: event.request.method,
		request_id: event.locals.request_id,
		value: mutation_value,
	};
});

export const SlowCommand = command(async () => {
	await wait_for_gate("command");

	return "command:released";
});

export const RedirectCommand = command(() => redirect(303, "/redirected?source=command"));

export const FailCommand = command(() => error(409, { message: "command:conflict" }));

export const CreateItem = form(ItemStandardSchema, (data, issue) => {
	if (data.items[0]?.label === "blocked") {
		invalid(issue.items[0]!.label("Blocked labels are rejected."));
	}

	return {
		message: `saved:${data.name}:${data.items[0]?.label ?? "missing"}`,
	};
});

export const CreateKeyedItem = form(KeyedItemSchema, (data, issue) => {
	if (data.label === "blocked") {
		invalid(issue.label("Blocked labels are rejected."));
	}

	return {
		message: `saved:${data.id}:${data.name}:${data.label}`,
	};
});

export const CreateTransformedItem = form(TransformedItemStandardSchema, async (data) => {
	if (data.label === "slow") {
		await wait_for_gate("form");
	}

	if (data.label === "redirect") {
		redirect(303, "/redirected?source=form");
	}

	return {
		amount: data.amount,
		amount_type: typeof data.amount,
		message: `transformed:${data.amount}:${data.label}`,
	};
});

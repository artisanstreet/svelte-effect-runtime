import { command, form, getRequestEvent, prerender, query } from "$app/server";
import { lifecycle_events } from "$lib/lifecycle";
import { invalid } from "@sveltejs/kit";
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

let command_count = 0;
let query_count = 0;

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

export const Increment = command(Schema.toStandardSchemaV1(Schema.Number), (amount) => {
	const event = getRequestEvent();

	command_count += amount;
	event.cookies.set("command", String(command_count), { path: "/" });

	return `command:${command_count}`;
});

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

export const GetSnapshot = prerender(() => "snapshot:ready", { dynamic: true });

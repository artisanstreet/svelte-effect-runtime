import type {
	EnvironmentSchemaOutput,
	EffectRemoteCommandCall,
	RemoteFailure,
	RemoteLiveStream,
} from "svelte-effect-runtime";
import { ClientRuntime, DefineEnvVars, Live } from "svelte-effect-runtime";
import { DefineEnvVars as EnvironmentDefineEnvVars } from "svelte-effect-runtime/environment";
import { Effect, Schema, Stream } from "effect";
import {
	Command,
	Form,
	Handler,
	Prerender,
	Query,
	RequestEvent,
	ServerRuntime,
} from "svelte-effect-runtime/server";
import { effect, rewrite_remote_client_exports } from "svelte-effect-runtime/compiler";

type Equal<Left, Right> =
	(<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
		? true
		: false;

type Assert<Type extends true> = Type;

type NativeHandler = (event: { readonly id: string }) => Promise<{ readonly id: string }>;

const GetUser = Query(Schema.String, (id) => Effect.succeed({ id }));
const GetUserIndex = Query.batch(Schema.String, (ids) =>
	Effect.succeed((id, index) => ({ id, index, known: ids.includes(id) })),
);
const WatchUser = Query.live(Schema.String, (id) => Stream.make(id));
const SaveUser = Command(Schema.String, (id) => Effect.succeed({ id, saved: true as const }));
const CreateUser = Form(Schema.Struct({ name: Schema.NonEmptyString }), ({ data }) =>
	Effect.succeed({ name: data.name }),
);
const GetBuildLabel = Prerender(() => Effect.succeed("packed"));
const LoadUser = Handler<NativeHandler>(({ id }) => Effect.succeed({ id }));
const variables = DefineEnvVars({
	PORT: { schema: Schema.NumberFromString },
	PUBLIC_ORIGIN: { public: true, schema: Schema.URLFromString },
});

const get_user_effect: Effect.Effect<
	{ readonly id: string },
	RemoteFailure<never>,
	never
> = GetUser("one");
const get_user_index_effect: Effect.Effect<
	{ readonly id: string; readonly index: number; readonly known: boolean },
	RemoteFailure<never>,
	never
> = GetUserIndex("one");
const watch_user_stream: RemoteLiveStream<string> = WatchUser("one");
const save_user_effect: EffectRemoteCommandCall<{ readonly id: string; readonly saved: true }> =
	SaveUser("one");
const create_user_effect = CreateUser({ name: "Ada" });
const build_label_effect: Effect.Effect<string, RemoteFailure<never>, never> = GetBuildLabel();
const live_status = Live.status(watch_user_stream);
const reconnect_effect: Effect.Effect<void, RemoteFailure<never>, never> = Live.reconnect(
	watch_user_stream,
);
const client_runtime_make: typeof ClientRuntime.make = ClientRuntime.make;
const server_runtime_make: typeof ServerRuntime.make = ServerRuntime.make;
const RequestUrl = Effect.gen(function* () {
	const event = yield* RequestEvent;

	return event.url;
});
const plugin = effect();
const rewrite: typeof rewrite_remote_client_exports = rewrite_remote_client_exports;

type GetUserParameters = Assert<Equal<Parameters<typeof GetUser>, [input: string]>>;
type SaveUserParameters = Assert<Equal<Parameters<typeof SaveUser>, [input: string]>>;
type CreateUserParameters = Assert<
	Equal<Parameters<typeof CreateUser>, [input: { readonly name: string }]>
>;
type LoadUserResult = Assert<Equal<Awaited<ReturnType<typeof LoadUser>>, { readonly id: string }>>;
type PortOutput = Assert<Equal<EnvironmentSchemaOutput<typeof variables.PORT.schema>, number>>;
type PublicOriginOutput = Assert<
	Equal<EnvironmentSchemaOutput<typeof variables.PUBLIC_ORIGIN.schema>, URL>
>;

void get_user_effect;
void get_user_index_effect;
void watch_user_stream;
void save_user_effect;
void create_user_effect;
void RequestUrl;
void build_label_effect;
void live_status;
void reconnect_effect;
void client_runtime_make;
void server_runtime_make;
void plugin;
void rewrite;
void EnvironmentDefineEnvVars;
void variables;
void (undefined as unknown as GetUserParameters);
void (undefined as unknown as SaveUserParameters);
void (undefined as unknown as CreateUserParameters);
void (undefined as unknown as LoadUserResult);
void (undefined as unknown as PortOutput);
void (undefined as unknown as PublicOriginOutput);

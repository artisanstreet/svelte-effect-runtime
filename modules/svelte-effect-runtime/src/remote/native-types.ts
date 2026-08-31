import type { StandardSchemaV1 } from "@sveltejs/kit/internal/types";

/**
 * SvelteKit moved its remote-function types between majors: SvelteKit 2
 * declares them in `@sveltejs/kit`, while SvelteKit 3 (since `3.0.0-next.20`)
 * declares them only in the `$app/server` ambient module, which SvelteKit 2
 * does not re-export types from. Importing from either location therefore
 * breaks the other major, and the shapes cannot be derived from the
 * `$app/server` value exports because their overload sets share a type-arity
 * with incompatible constraints. This module vendors the surface SER needs.
 * The shapes are identical in SvelteKit 2.69+ and 3.0.0-next.25 except
 * `validate`, whose options here form the superset of both majors.
 */

type MaybeArray<T> = T | T[];

type MaybePromise<T> = T | Promise<T>;

type IsAny<T> = 0 extends 1 & T ? true : false;

type DeepPartial<T> = T extends Record<PropertyKey, unknown> | unknown[]
	? {
			[K in keyof T]?: T[K] extends Record<PropertyKey, unknown> | unknown[]
				? DeepPartial<T[K]>
				: T[K];
		}
	: T | undefined;

type WillRecurseIndefinitely<T> = unknown extends T ? true : string extends keyof T ? true : false;

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

type ValueOfUnionKey<T, K extends PropertyKey> = T extends unknown
	? K extends keyof T
		? T[K]
		: never
	: never;

/**
 * Data shape SvelteKit accepts for a remote form submission. Mirrors
 * SvelteKit's `RemoteFormInput`.
 *
 * @since 4.2.5
 */
export interface NativeRemoteFormInput {
	[key: string]: MaybeArray<string | number | boolean | File | NativeRemoteFormInput> | undefined;
}

/**
 * A single validation issue reported for a remote form field. Mirrors
 * SvelteKit's `RemoteFormIssue`.
 *
 * @since 4.2.5
 */
export interface NativeRemoteFormIssue {
	message: string;
	path: Array<string | number>;
}

type InputTypeMap = {
	text: string;
	email: string;
	password: string;
	url: string;
	tel: string;
	search: string;
	number: number;
	range: number;
	date: string;
	"datetime-local": string;
	time: string;
	month: string;
	week: string;
	color: string;
	checkbox: boolean | string[];
	radio: string;
	file: File;
	hidden: string | number | boolean;
	submit: string | number | boolean;
	button: string;
	reset: string;
	image: string;
	select: string;
	"select multiple": string[];
	"file multiple": File[];
};

type NativeRemoteFormFieldType<T> = {
	[K in keyof InputTypeMap]: T extends InputTypeMap[K] ? K : never;
}[keyof InputTypeMap];

type InputElementProps<T extends keyof InputTypeMap> = T extends "checkbox" | "radio"
	? {
			name: string;
			type: T;
			value?: string;
			"aria-invalid": boolean | "false" | "true" | undefined;
			get checked(): boolean;
			set checked(value: boolean);
			readonly defaultChecked?: boolean;
		}
	: T extends "file"
		? {
				name: string;
				type: "file";
				"aria-invalid": boolean | "false" | "true" | undefined;
				get files(): FileList | null;
				set files(v: FileList | null);
			}
		: T extends "select"
			? {
					name: string;
					"aria-invalid": boolean | "false" | "true" | undefined;
					get value(): string;
					set value(v: string);
				}
			: T extends "select multiple"
				? {
						name: string;
						multiple: true;
						"aria-invalid": boolean | "false" | "true" | undefined;
						get value(): string[];
						set value(v: string[]);
					}
				: T extends "text"
					? {
							name: string;
							"aria-invalid": boolean | "false" | "true" | undefined;
							get value(): string | number;
							set value(v: string | number);
							readonly defaultValue?: string | number;
						}
					: {
							name: string;
							type: T;
							"aria-invalid": boolean | "false" | "true" | undefined;
							get value(): string | number;
							set value(v: string | number);
							readonly defaultValue?: string | number;
						};

type NativeRemoteFormFieldMethods<T> = {
	/** The values that will be submitted. */
	value(): DeepPartial<T>;
	/** Set the values that will be submitted. */
	set(input: DeepPartial<T>): DeepPartial<T>;
	/** Whether the field or any nested field has been interacted with since the form was mounted. */
	touched(): boolean;
	/** Whether the field or any nested field has been edited since the form was mounted. */
	dirty(): boolean;
	/** Validation issues, if any. */
	issues(): NativeRemoteFormIssue[] | undefined;
};

type AsArgs<Type extends keyof InputTypeMap, Value> = Type extends "checkbox"
	? Value extends string[]
		? [type: Type, value: Value[number] | (string & {})]
		: Value extends boolean
			? [type: Type] | [type: Type, value: boolean]
			: [type: Type] | [type: Type, value: Value | (string & {})]
	: Type extends "submit" | "hidden"
		? Value extends string
			? [type: Type, value: Value | (string & {})]
			: [type: Type, value: Value]
		: Type extends "radio"
			? [type: Type, value: Value | (string & {})]
			: Type extends "file" | "file multiple"
				? [type: Type]
				: [type: Type] | [type: Type, value: Value | undefined];

type NativeRemoteFormFieldValue = string | string[] | number | boolean | File | File[];

type NativeRemoteFormField<Value extends NativeRemoteFormFieldValue> =
	NativeRemoteFormFieldMethods<Value> & {
		/** Returns spreadable input-element props for the given input type. */
		as<T extends NativeRemoteFormFieldType<Value>>(
			...args: AsArgs<T, Value>
		): InputElementProps<T>;
	};

type NativeRemoteFormFieldContainer<Value> = NativeRemoteFormFieldMethods<Value> & {
	/** Validation issues belonging to this or any of the fields that belong to it, if any. */
	allIssues(): NativeRemoteFormIssue[] | undefined;
};

type UnknownField<Value> = NativeRemoteFormFieldMethods<Value> & {
	/** Validation issues belonging to this or any of the fields that belong to it, if any. */
	allIssues(): NativeRemoteFormIssue[] | undefined;
	/** Returns spreadable input-element props for the given input type. */
	as<T extends NativeRemoteFormFieldType<Value>>(...args: AsArgs<T, Value>): InputElementProps<T>;
} & {
	[key: string | number]: UnknownField<any>;
};

type RecursiveFormFields = NativeRemoteFormFieldContainer<any> & {
	[key: string | number]: UnknownField<any>;
};

type NativeRemoteFormFields<T> =
	WillRecurseIndefinitely<T> extends true
		? RecursiveFormFields
		: NonNullable<T> extends string | number | boolean | File
			? NativeRemoteFormField<Extract<NonNullable<T>, NativeRemoteFormFieldValue>>
			: [NonNullable<T>] extends [string[] | File[]]
				? NativeRemoteFormField<Extract<NonNullable<T>, NativeRemoteFormFieldValue>> & {
						[K in number]: NativeRemoteFormField<
							Extract<NonNullable<T>[number], NativeRemoteFormFieldValue>
						>;
					}
				: [NonNullable<T>] extends [Array<infer U>]
					? NativeRemoteFormFieldContainer<NonNullable<T>> & {
							[K in number]: NativeRemoteFormFields<U>;
						}
					: NativeRemoteFormFieldContainer<T> & {
							[K in KeysOfUnion<T>]-?: NativeRemoteFormFields<ValueOfUnionKey<T, K>>;
						};

type NativeRemoteFormFieldsRoot<Input extends NativeRemoteFormInput | void> =
	IsAny<Input> extends true
		? RecursiveFormFields
		: Input extends void
			? {
					/** Validation issues, if any. */
					issues(): NativeRemoteFormIssue[] | undefined;
					/** Validation issues belonging to this or any of the fields that belong to it, if any. */
					allIssues(): NativeRemoteFormIssue[] | undefined;
				}
			: NativeRemoteFormFields<Input>;

type ExtractId<Input> = Input extends { id: infer Id }
	? Id extends string | number
		? Id
		: string | number
	: string | number;

/**
 * The form instance received inside an `enhance` callback. Mirrors SvelteKit's
 * `RemoteFormEnhanceInstance`.
 *
 * @since 4.2.5
 */
export type NativeRemoteFormEnhanceInstance<
	Input extends NativeRemoteFormInput | void = NativeRemoteFormInput | void,
	Output = unknown,
> = Omit<NativeRemoteForm<Input, Output>, "enhance" | "element"> & {
	readonly element: HTMLFormElement;
};

/**
 * The callback passed to a remote form's `enhance` method. Mirrors SvelteKit's
 * `RemoteFormEnhanceCallback`.
 *
 * @since 4.2.5
 */
export type NativeRemoteFormEnhanceCallback<
	Input extends NativeRemoteFormInput | void = NativeRemoteFormInput | void,
	Output = unknown,
> = (form: NativeRemoteFormEnhanceInstance<Input, Output>) => MaybePromise<void>;

/**
 * SvelteKit's `RemoteForm` surface. `validate` accepts the superset of the
 * SvelteKit 2 (`includeUntouched`) and SvelteKit 3 (`all`) options.
 *
 * @since 4.2.5
 */
export type NativeRemoteForm<Input extends NativeRemoteFormInput | void, Output> = {
	/** Attachment that intercepts the form submission on the client to prevent a full page reload. */
	[attachment: symbol]: (node: HTMLFormElement) => void;
	method: "POST";
	/** The URL to send the form to. */
	action: string;
	/** The `<form>` element this instance is currently attached to, if any. */
	get element(): HTMLFormElement | null;
	/** Submit the currently attached form programmatically. */
	submit(): Promise<boolean> & {
		updates: (...updates: NativeRemoteQueryUpdate[]) => Promise<boolean>;
	};
	/** Influences what happens when the form is submitted. */
	enhance(callback: NativeRemoteFormEnhanceCallback<Input, Output>): {
		method: "POST";
		action: string;
		[attachment: symbol]: (node: HTMLFormElement) => void;
	};
	/** Create an instance of the form for the given `id`. */
	for(id: ExtractId<Input>): Omit<NativeRemoteForm<Input, Output>, "for">;
	/** Preflight checks. */
	preflight(schema: StandardSchemaV1<Input, unknown>): NativeRemoteForm<Input, Output>;
	/** Validate the form contents programmatically. */
	validate(options?: {
		/** SvelteKit 3: also show validation issues of fields that have not been edited and blurred yet. */
		all?: boolean;
		/** SvelteKit 2: also show validation issues of fields that have not been touched yet. */
		includeUntouched?: boolean;
		/** Only run the `preflight` validation. */
		preflightOnly?: boolean;
	}): Promise<void>;
	/** The result of the form submission. */
	get result(): Output | undefined;
	/** The number of pending submissions. */
	get pending(): number;
	/** True if the form has been submitted at least once. */
	get submitted(): boolean;
	/** Access form fields using object notation. */
	fields: NativeRemoteFormFieldsRoot<Input>;
};

/**
 * SvelteKit's `RemoteResource` shape shared by query, live query, and
 * prerender resources.
 *
 * @since 4.2.5
 */
export type NativeRemoteResource<T> = Promise<T> & {
	/** The error in case the query fails. */
	get error(): unknown;
	/** `true` before the first result is available and during refreshes. */
	get loading(): boolean;
} & (
		| {
				/** The current value of the query. Undefined until `ready` is `true`. */
				get current(): undefined;
				ready: false;
		  }
		| {
				/** The current value of the query. Undefined until `ready` is `true`. */
				get current(): T;
				ready: true;
		  }
	);

/**
 * SvelteKit's `RemoteQuery` resource surface.
 *
 * @since 4.2.5
 */
export type NativeRemoteQuery<T> = NativeRemoteResource<T> & {
	/** Update the value of the query without re-fetching it. */
	set(value: T): void;
	/** Re-fetch the query from the server. */
	refresh(): Promise<void>;
	/** Temporarily override a query's value during a single-flight mutation. */
	withOverride(update: (current: T) => T): NativeRemoteQueryOverride;
};

/**
 * SvelteKit's `RemoteLiveQuery` resource surface.
 *
 * @since 4.2.5
 */
export type NativeRemoteLiveQuery<T> = NativeRemoteResource<T> &
	AsyncIterable<T> & {
		/** `true` if the live stream is currently connected. */
		readonly connected: boolean;
		/** `true` once the current live stream iterator is done. */
		readonly done: boolean;
		/** Reconnects the live stream immediately. */
		reconnect(): Promise<void>;
	};

/**
 * SvelteKit's `RemoteQueryFunction`.
 *
 * @since 4.2.5
 */
export type NativeRemoteQueryFunction<Input, Output, _Validated = Input> = (
	arg: undefined extends Input ? Input | void : Input,
) => NativeRemoteQuery<Output>;

/**
 * SvelteKit's `RemoteLiveQueryFunction`.
 *
 * @since 4.2.5
 */
export type NativeRemoteLiveQueryFunction<Input, Output, _Validated = Input> = (
	arg: undefined extends Input ? Input | void : Input,
) => NativeRemoteLiveQuery<Output>;

/**
 * SvelteKit's `RemoteQueryOverride`.
 *
 * @since 4.2.5
 */
export type NativeRemoteQueryOverride = () => void;

/**
 * Update selection accepted by SvelteKit's command and form `updates(...)`
 * methods. Mirrors SvelteKit's `RemoteQueryUpdate`.
 *
 * @since 4.2.5
 */
export type NativeRemoteQueryUpdate =
	| NativeRemoteQuery<any>
	| NativeRemoteLiveQuery<any>
	| NativeRemoteQueryFunction<any, any>
	| NativeRemoteLiveQueryFunction<any, any>
	| NativeRemoteQueryOverride;

import type {
	DispatcherEvent,
	Dispose,
	MarkupPromiseEvent,
	MarkupRunEvent,
	MarkupValueEvent,
	PromiseOptions,
	ValueOptions,
} from "./types.ts";
import {
	RuntimeAlreadyInitializedError,
	DispatcherDisposedError,
	ScopeDisposedError,
} from "$/errors.ts";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { InterruptFiber, WatchFiberExit } from "./fibers.ts";
import { ComponentScope } from "./scope.ts";
import type { Fiber as FiberType } from "effect/Fiber";
import { createSubscriber } from "svelte/reactivity";
import { make_dependency_hasher } from "./deps.ts";
import { isRedirect } from "@sveltejs/kit";
import { Code } from "./types.ts";

export { Code } from "./types.ts";
export type { Dispose, PromiseOptions, ValueOptions } from "./types.ts";

type ValueCell<A> =
	| {
			readonly status: "pending";
			readonly fiber: FiberType<unknown, unknown>;
	  }
	| {
			readonly status: "success";
			readonly value: A;
	  }
	| {
			readonly status: "failure";
			readonly error: unknown;
	  };

export class Dispatcher {
	#runtime: ManagedRuntimeType<unknown, unknown>;
	#fibers = new Map<string, FiberType<unknown, unknown>>();
	#value_cells = new Map<string, ValueCell<unknown>>();
	#notify_value_cells = (): void => {};
	#subscribe_value_cells = createSubscriber((update) => {
		this.#notify_value_cells = update;

		return () => {
			if (this.#notify_value_cells !== update) {
				return;
			}

			this.#notify_value_cells = (): void => {};
		};
	});
	#promise_values = new Map<string, Promise<unknown>>();
	#value_ids = new Map<string, string>();
	#promise_ids = new Map<string, string>();
	#scope_ids = new WeakMap<ComponentScope, string>();
	#hash_deps = make_dependency_hasher();
	#disposed = false;
	#next_fiber_id = 0;
	#next_scope_id = 0;
	#root_scope = Scope.makeUnsafe();
	#component_scopes = new Set<ComponentScope>();
	/**
	 * The component scope that effect execution currently enters. Set by
	 * generated code via {@link with_scope}; `undefined` outside components.
	 */
	#current_scope: ComponentScope | undefined = undefined;

	static make<R = never>(layer?: Layer.Layer<R>): Dispatcher {
		if (current_dispatcher) {
			throw new RuntimeAlreadyInitializedError("ClientRuntime");
		}

		const runtime = ManagedRuntime.make(layer ?? (Layer.empty as unknown as Layer.Layer<R>));

		const dispatcher = new Dispatcher(runtime as ManagedRuntimeType<unknown, unknown>);
		current_dispatcher = dispatcher;

		return dispatcher;
	}

	constructor(runtime?: ManagedRuntimeType<unknown, unknown>) {
		this.#runtime =
			runtime ??
			(ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntimeType<unknown, unknown>);
	}

	/**
	 * Begin a component-owned Effect scope. Pass the returned scope to
	 * {@link run_scoped} so the work is interrupted and finalized when the
	 * component is destroyed. Disposal is idempotent.
	 */
	begin_scope(): ComponentScope {
		const scope = ComponentScope.fork(this.#root_scope, (disposed) => {
			this.#component_scopes.delete(disposed);
		});

		this.#component_scopes.add(scope);

		return scope;
	}

	/**
	 * Runs `fn` with `scope` as the current component scope. While active,
	 * every effect path ({@link promise}, {@link run}, {@link value}) forks
	 * its work into `scope` so disposing the scope interrupts it and runs its
	 * finalizers. A disposed scope falls back to unscoped execution.
	 */
	with_scope<T>(scope: ComponentScope, fn: () => T): T {
		if (scope.disposed) {
			return fn();
		}

		const previous = this.#current_scope;
		this.#current_scope = scope;

		try {
			return fn();
		} finally {
			this.#current_scope = previous;
		}
	}

	/**
	 * Forks an effect into a reactive-run scope and starts it. The run scope is
	 * a child of the component scope, so rerun cleanup closes only that run
	 * while component disposal remains a backstop. Returns an idempotent handle
	 * that closes the run scope and all work forked into it.
	 *
	 * Throws {@link ScopeDisposedError} when the scope was already disposed
	 * and {@link DispatcherDisposedError} when the dispatcher was shut down.
	 */
	run_scoped<A, E, R>(scope: ComponentScope, effect: Effect.Effect<A, E, R>): Dispose {
		if (this.#disposed) {
			return () => {};
		}

		if (scope.disposed || !this.#component_scopes.has(scope)) {
			throw new ScopeDisposedError();
		}

		const run = scope.fork_run_in(effect);
		let disposed = false;

		this.#runtime.runFork(
			Effect.flatMap(run.fork_effect, (fiber) => {
				return Effect.flatMap(Fiber.await(fiber), (exit) => {
					return Exit.isFailure(exit) ? run.close_effect(exit) : Effect.void;
				});
			}) as Effect.Effect<unknown, unknown, unknown>,
		);

		return (): void => {
			if (disposed) {
				return;
			}

			disposed = true;
			this.#runtime.runFork(
				run.close_effect(Exit.void) as Effect.Effect<unknown, unknown, unknown>,
			);
		};
	}

	/**
	 * Disposes a component scope owned by this dispatcher, interrupting its
	 * bound work and running its finalizers. Idempotent. Rejects scopes owned
	 * by another dispatcher with {@link ScopeDisposedError}.
	 */
	dispose_scope(scope: ComponentScope): void {
		if (!this.#component_scopes.has(scope)) {
			if (scope.disposed) {
				return;
			}

			throw new ScopeDisposedError();
		}

		const scope_id = this.#scope_ids.get(scope);

		if (scope_id !== undefined) {
			this.#scope_ids.delete(scope);
			this.#clear_scope_cache(scope_id);
		}

		scope.dispose();
		this.#runtime.runFork(scope.close_effect as Effect.Effect<unknown, unknown, unknown>);
	}

	emit<A, F>(event: MarkupValueEvent<A, F>): A | F;
	emit<A>(event: MarkupPromiseEvent<A>): Promise<A>;
	emit<A>(event: MarkupRunEvent<A>): Promise<A>;
	emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A>;
	emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A> {
		switch (event.type) {
			case Code.Markup.Value:
				return this.#emit_markup_value(event);

			case Code.Markup.Promise:
				return this.#emit_markup_promise(event);

			case Code.Markup.Run:
				return this.#emit_markup_run(event);
		}
	}

	fork<A, E, R>(effect: Effect.Effect<A, E, R>): Dispose {
		if (this.#disposed) {
			return () => {};
		}

		const fiber = this.#runtime.runFork(effect as Effect.Effect<unknown, unknown, unknown>);
		const key = `fork:${this.#next_fiber_id}`;

		this.#next_fiber_id += 1;
		this.#fibers.set(key, fiber);
		this.#runtime.runFork(
			WatchFiberExit({
				fiber,
				on_complete: () => this.#fibers.delete(key),
			}),
		);

		let disposed = false;

		return (): void => {
			if (disposed) {
				return;
			}

			disposed = true;
			this.#runtime.runFork(InterruptFiber(fiber));
		};
	}

	value<A>(options: ValueOptions<A>): A {
		if (this.#disposed) {
			return options.fallback;
		}

		const scope_id = this.#scope_id(this.#current_scope);
		const cache_id = this.#make_scoped_id(scope_id, options.id);
		const cache_key = this.#make_value_cache_key(cache_id, options.deps);
		const old_key = this.#value_ids.get(cache_id);

		this.#subscribe_value_cells();

		const cell = this.#value_cells.get(cache_key);

		if (old_key !== undefined && old_key !== cache_key) {
			this.#interrupt_cached_fiber(old_key);
			this.#delete_value_cell(old_key);
		}

		this.#value_ids.set(cache_id, cache_key);

		if (this.#should_start_value_fiber(cache_key, cell)) {
			this.#start_value_fiber(cache_key, options);
		}

		if (cell?.status === "success") {
			return cell.value as A;
		}

		if (cell?.status === "failure") {
			throw cell.error;
		}

		return options.fallback;
	}

	promise<A>(options: PromiseOptions<A>): Promise<A> {
		if (this.#disposed) {
			return Promise.reject(new DispatcherDisposedError());
		}

		const scope_id = this.#scope_id(this.#current_scope);
		const cache_id = this.#make_scoped_id(scope_id, options.id);
		const cache_key = this.#make_promise_cache_key(cache_id, options.deps);
		const old_key = this.#promise_ids.get(cache_id);

		if (old_key !== undefined && old_key !== cache_key) {
			this.#interrupt_cached_fiber(old_key);
			this.#promise_values.delete(old_key);
		}

		this.#promise_ids.set(cache_id, cache_key);

		const existing = this.#promise_values.get(cache_key);

		if (existing) {
			return existing as Promise<A>;
		}

		const promise = this.#start_promise_fiber(cache_key, options, cache_id);

		this.#promise_values.set(cache_key, promise);

		return promise;
	}

	run<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
		if (this.#disposed) {
			return Promise.reject(new DispatcherDisposedError());
		}

		const scoped_effect = Effect.gen(function* () {
			const result = yield* Effect.exit(effect);

			if (Exit.isSuccess(result)) {
				return result.value;
			}

			if (Cause.hasInterruptsOnly(result.cause)) {
				return undefined as A;
			}

			const error = Cause.squash(result.cause);

			if (isRedirect(error)) {
				return undefined as A;
			}

			/**
			 * Surface the failure without reporting it. Both the scoped and the
			 * unscoped path funnel through `interpreted_program`, which reports
			 * once, so reporting here would raise every failure twice.
			 */
			return yield* Effect.fail(error);
		});

		const scope = this.#current_scope;
		const materialized_program = scope
			? Effect.flatMap(scope.fork_in(scoped_effect), (fiber) => Fiber.await(fiber))
			: Effect.exit(scoped_effect);
		const interpreted_program = Effect.gen(function* () {
			const result = yield* materialized_program;

			if (Exit.isSuccess(result)) {
				return result.value;
			}

			if (Cause.hasInterruptsOnly(result.cause)) {
				return undefined as A;
			}

			const error = Cause.squash(result.cause);

			if (isRedirect(error)) {
				return undefined as A;
			}

			yield* Effect.sync(() => {
				queueMicrotask(() => {
					throw error;
				});
			});

			return yield* Effect.fail(error);
		});

		return this.#runtime.runPromise(interpreted_program as Effect.Effect<A, unknown, unknown>);
	}

	#emit_markup_value<A, F>(event: MarkupValueEvent<A, F>): A | F {
		if (this.#is_server_render()) {
			return event.fallback;
		}

		return this.value<A | F>({
			id: event.id,
			deps: event.deps,
			fallback: event.fallback,
			factory: event.fn,
		});
	}

	#emit_markup_promise<A>(event: MarkupPromiseEvent<A>): Promise<A> {
		if (this.#is_server_render()) {
			if (event.options?.ssr === "pending") {
				return new Promise<A>(() => {});
			}

			if ("ssr_fallback" in event) {
				return Promise.resolve(event.ssr_fallback as A);
			}
		}

		return this.promise({
			id: event.id,
			deps: event.deps,
			factory: event.fn,
		});
	}

	#emit_markup_run<A>(event: MarkupRunEvent<A>): Promise<A> {
		const Program = Effect.gen(event.fn);

		return this.run(Program);
	}

	dispose(): void {
		this.#disposed = true;

		for (const scope of this.#component_scopes) {
			scope.dispose();
		}

		this.#component_scopes.clear();
		this.#runtime.runFork(
			Scope.close(this.#root_scope, Exit.void) as Effect.Effect<unknown, unknown, unknown>,
		);

		for (const fiber of this.#fibers.values()) {
			this.#runtime.runFork(InterruptFiber(fiber));
		}

		this.#fibers.clear();
		this.#clear_value_cells();
		this.#promise_values.clear();
		this.#value_ids.clear();
		this.#promise_ids.clear();

		void this.#runtime.dispose().catch((error: unknown) => {
			queueMicrotask(() => {
				throw error;
			});
		});
	}

	/**
	 * Read-only snapshot of the value/promise cache keys. Diagnostic surface
	 * for leak regression tests; not part of the runtime contract.
	 */
	inspect_cache(): { value_cells: readonly string[]; promise_values: readonly string[] } {
		return {
			value_cells: [...this.#value_cells.keys()],
			promise_values: [...this.#promise_values.keys()],
		};
	}

	#make_value_cache_key(id: string, deps: readonly unknown[]): string {
		return `value:${id}::${this.#hash_deps(deps)}`;
	}

	#make_promise_cache_key(id: string, deps: readonly unknown[]): string {
		return `promise:${id}::${this.#hash_deps(deps)}`;
	}

	#is_server_render(): boolean {
		return typeof document === "undefined";
	}

	#scope_id(scope: ComponentScope | undefined): string {
		if (!scope || scope.disposed) {
			return "global";
		}

		const existing = this.#scope_ids.get(scope);

		if (existing) {
			return existing;
		}

		const next = String(this.#next_scope_id);
		this.#next_scope_id += 1;
		this.#scope_ids.set(scope, next);

		return next;
	}

	#clear_scope_cache(scope_id: string): void {
		const value_prefix = `${scope_id}|`;
		const promise_prefix = `${scope_id}|`;

		for (const [cache_id, cache_key] of this.#value_ids) {
			if (!cache_id.startsWith(value_prefix)) {
				continue;
			}

			this.#value_ids.delete(cache_id);
			this.#interrupt_cached_fiber(cache_key);
			this.#delete_value_cell(cache_key);
		}

		for (const [cache_id, cache_key] of this.#promise_ids) {
			if (!cache_id.startsWith(promise_prefix)) {
				continue;
			}

			this.#promise_ids.delete(cache_id);
			this.#promise_values.delete(cache_key);
			this.#interrupt_cached_fiber(cache_key);
		}

		/**
		 * value() and promise() evict a superseded key eagerly, so the id maps
		 * above normally cover everything. Sweep the caches themselves as a
		 * backstop so unmounting releases any entry the hot path missed.
		 */
		const value_key_prefix = `value:${scope_id}|`;
		const promise_key_prefix = `promise:${scope_id}|`;

		for (const cache_key of [...this.#value_cells.keys()]) {
			if (!cache_key.startsWith(value_key_prefix)) {
				continue;
			}

			this.#interrupt_cached_fiber(cache_key);
			this.#delete_value_cell(cache_key);
		}

		for (const cache_key of [...this.#promise_values.keys()]) {
			if (!cache_key.startsWith(promise_key_prefix)) {
				continue;
			}

			this.#interrupt_cached_fiber(cache_key);
			this.#promise_values.delete(cache_key);
		}
	}

	#make_scoped_id(scope_id: string, id: string): string {
		return `${scope_id}|${id}`;
	}

	#interrupt_cached_fiber(cache_key: string): FiberType<unknown, unknown> | undefined {
		const old_fiber = this.#fibers.get(cache_key);

		if (!old_fiber) {
			return undefined;
		}

		this.#runtime.runFork(InterruptFiber(old_fiber));
		this.#fibers.delete(cache_key);

		return old_fiber;
	}

	#should_start_value_fiber(cache_key: string, cell: ValueCell<unknown> | undefined): boolean {
		return !this.#disposed && !this.#fibers.has(cache_key) && cell === undefined;
	}

	#start_value_fiber<A>(cache_key: string, options: ValueOptions<A>): void {
		const Program = Effect.gen(function* () {
			const result = yield* Effect.gen(options.factory);

			return result;
		});
		const scope = this.#current_scope;

		if (!scope) {
			const fiber = this.#runtime.runFork(
				Program as Effect.Effect<unknown, unknown, unknown>,
			);

			this.#fibers.set(cache_key, fiber);

			queueMicrotask(() => {
				if (!this.#is_current_fiber(cache_key, fiber)) {
					return;
				}

				if (this.#value_cells.has(cache_key)) {
					return;
				}

				this.#set_value_cell(cache_key, {
					status: "pending",
					fiber,
				});
			});

			this.#runtime.runFork(
				WatchFiberExit({
					fiber,
					surface_failure: false,
					on_complete: () => this.#complete_fiber(cache_key, fiber),
					on_success: (value) => this.#publish_value_success(cache_key, fiber, value),
					on_failure: (error) => this.#publish_value_failure(cache_key, fiber, error),
				}),
			);

			return;
		}

		let launch_fiber: FiberType<unknown, unknown> | undefined;
		let forked_fiber: FiberType<unknown, unknown> | undefined;

		const launched = this.#runtime.runFork(
			Effect.flatMap(scope.fork_in(Program), (scoped_fiber) => {
				forked_fiber = scoped_fiber;

				/**
				 * This continuation can run synchronously inside `runFork`,
				 * before `launch_fiber` is assigned. In that case nothing can
				 * have superseded the launch yet and the caller below records
				 * the scoped fiber itself. An asynchronous continuation takes
				 * over tracking only while its launch fiber is still current;
				 * a superseded launch interrupts the orphaned scoped fiber.
				 */
				if (launch_fiber !== undefined) {
					if (!this.#is_current_fiber(cache_key, launch_fiber)) {
						return InterruptFiber(scoped_fiber);
					}

					this.#fibers.set(cache_key, scoped_fiber);
				}

				queueMicrotask(() => {
					if (!this.#is_current_fiber(cache_key, scoped_fiber)) {
						return;
					}

					this.#runtime.runFork(
						WatchFiberExit({
							fiber: scoped_fiber,
							surface_failure: false,
							on_complete: () => this.#complete_fiber(cache_key, scoped_fiber),
							on_success: (value) =>
								this.#publish_value_success(cache_key, scoped_fiber, value),
							on_failure: (error) =>
								this.#publish_value_failure(cache_key, scoped_fiber, error),
						}),
					);

					if (this.#value_cells.has(cache_key)) {
						return;
					}

					this.#set_value_cell(cache_key, {
						status: "pending",
						fiber: scoped_fiber,
					});
				});

				return Effect.asVoid(Fiber.await(scoped_fiber));
			}) as Effect.Effect<unknown, unknown, unknown>,
		);

		launch_fiber = launched;
		this.#fibers.set(cache_key, forked_fiber ?? launched);
	}

	#start_promise_fiber<A>(
		cache_key: string,
		options: PromiseOptions<A>,
		cache_id: string,
	): Promise<A> {
		const Program = Effect.gen(function* () {
			const result = yield* Effect.gen(options.factory);

			return result;
		});
		const scope = this.#current_scope;

		/** Generator bodies passed to `Effect.gen` carry their own `this`. */
		const dispatcher = this;

		if (!scope) {
			const fiber = this.#runtime.runFork(
				Program as Effect.Effect<unknown, unknown, unknown>,
			);
			const ReleaseFiber = Effect.sync(() => {
				if (!this.#is_current_fiber(cache_key, fiber)) {
					return;
				}

				this.#fibers.delete(cache_key);
				this.#promise_values.delete(cache_key);

				if (this.#promise_ids.get(cache_id) === cache_key) {
					this.#promise_ids.delete(cache_id);
				}
			});
			const AwaitFiber = Effect.gen(function* () {
				const exit = yield* Fiber.await(fiber);

				yield* ReleaseFiber;

				if (Exit.isSuccess(exit)) {
					return exit.value as A;
				}

				return yield* Effect.fail(Cause.squash(exit.cause));
			});

			this.#fibers.set(cache_key, fiber);
			this.#promise_values.set(cache_key, this.#runtime.runPromise(AwaitFiber));

			return this.#promise_values.get(cache_key) as Promise<A>;
		}

		const promise = this.#runtime.runPromise(
			Effect.gen(function* () {
				const scoped_fiber = yield* scope.fork_in(Program);

				dispatcher.#fibers.set(cache_key, scoped_fiber);
				dispatcher.#runtime.runFork(
					WatchFiberExit({
						fiber: scoped_fiber,
						/**
						 * The promise this call returns already rejects with the
						 * failure, so surfacing it again would hand a handled
						 * rejection back as an uncaught error.
						 */
						surface_failure: false,
						on_complete: () => {
							if (!dispatcher.#is_current_fiber(cache_key, scoped_fiber)) {
								return;
							}

							dispatcher.#fibers.delete(cache_key);
							dispatcher.#promise_values.delete(cache_key);

							if (dispatcher.#promise_ids.get(cache_id) === cache_key) {
								dispatcher.#promise_ids.delete(cache_id);
							}
						},
					}),
				);

				const exit = yield* Fiber.await(scoped_fiber);

				if (Exit.isSuccess(exit)) {
					return exit.value as A;
				}

				return yield* Effect.fail(Cause.squash(exit.cause));
			}),
		);

		this.#promise_values.set(cache_key, promise);

		return promise;
	}

	#complete_fiber(cache_key: string, fiber: FiberType<unknown, unknown>): void {
		if (!this.#is_current_fiber(cache_key, fiber)) {
			return;
		}

		this.#fibers.delete(cache_key);
	}

	#publish_value_success<A>(
		cache_key: string,
		fiber: FiberType<unknown, unknown>,
		value: A,
	): void {
		if (!this.#is_current_fiber(cache_key, fiber)) {
			return;
		}

		this.#set_value_cell(cache_key, {
			status: "success",
			value,
		});
	}

	#publish_value_failure(
		cache_key: string,
		fiber: FiberType<unknown, unknown>,
		error: unknown,
	): void {
		if (!this.#is_current_fiber(cache_key, fiber)) {
			return;
		}

		this.#set_value_cell(cache_key, {
			status: "failure",
			error,
		});
	}

	#set_value_cell(cache_key: string, cell: ValueCell<unknown>): void {
		this.#value_cells.set(cache_key, cell);
		this.#notify_value_cells();
	}

	#delete_value_cell(cache_key: string): void {
		const deleted = this.#value_cells.delete(cache_key);

		if (!deleted) {
			return;
		}

		this.#notify_value_cells();
	}

	#clear_value_cells(): void {
		if (this.#value_cells.size === 0) {
			return;
		}

		this.#value_cells.clear();
		this.#notify_value_cells();
	}

	#is_current_fiber(cache_key: string, fiber: FiberType<unknown, unknown>): boolean {
		return !this.#disposed && this.#fibers.get(cache_key) === fiber;
	}
}

let current_dispatcher: Dispatcher | null = null;

export function get_dispatcher(): Dispatcher {
	current_dispatcher ??= new Dispatcher();

	return current_dispatcher;
}

export function reset_dispatcher(): void {
	current_dispatcher?.dispose();
	current_dispatcher = null;
}

/**
 * Lazily-created component scope used by generated component code.
 *
 * The holder is created synchronously during component init (before any
 * top-level `await`, where `onDestroy` is not yet available), and the scope
 * itself is materialized on first use. Disposal is registered separately
 * through `onDestroy` during component initialisation, so the scope is
 * reliably closed on unmount.
 *
 * @since 4.1.0
 */
export class ComponentScopeRef {
	readonly #get_dispatcher: () => Dispatcher;
	#scope: ComponentScope | undefined;
	#disposed = false;

	constructor(get_dispatcher_fn: () => Dispatcher) {
		this.#get_dispatcher = get_dispatcher_fn;
	}

	/** The component scope, creating it on first access. */
	get scope(): ComponentScope {
		if (this.#disposed) {
			throw new ScopeDisposedError();
		}

		this.#scope ??= this.#get_dispatcher().begin_scope();

		return this.#scope;
	}

	/** Disposes the scope if it was created. Idempotent. */
	dispose(): void {
		this.#disposed = true;

		const scope = this.#scope;
		this.#scope = undefined;

		if (scope && !scope.disposed) {
			this.#get_dispatcher().dispose_scope(scope);
		}
	}
}

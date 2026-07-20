import { Effect, Exit, Scope } from "effect";
import type { Fiber } from "effect";

/**
 * A component-owned Effect scope.
 *
 * A `ComponentScope` wraps a `Scope.Closeable` forked from the dispatcher's
 * root scope. Work is forked into the scope with `Effect.forkIn`, so closing
 * the scope interrupts that work and runs its finalizers. The generated
 * component teardown disposes the scope on destroy. Disposal is idempotent.
 *
 * @since 3.1.0
 */
export class ComponentScope {
	#scope: Scope.Closeable;
	#disposed = false;
	readonly #on_dispose: (scope: ComponentScope) => void;

	private constructor(scope: Scope.Closeable, on_dispose: (scope: ComponentScope) => void) {
		this.#scope = scope;
		this.#on_dispose = on_dispose;
	}

	/** Forks a child scope from the given root and returns it wrapped. */
	static fork(
		root: Scope.Closeable,
		on_dispose: (scope: ComponentScope) => void,
	): ComponentScope {
		return new ComponentScope(Scope.forkUnsafe(root), on_dispose);
	}

	/** The underlying closeable scope used to bind Effect work. */
	get underlying(): Scope.Closeable {
		return this.#scope;
	}

	/** Whether this scope has already been disposed. */
	get disposed(): boolean {
		return this.#disposed;
	}

	/**
	 * Forks an effect into this scope. The fiber becomes a child of the scope,
	 * so disposing the scope interrupts it and runs its finalizers. The scope
	 * is provided ambiently so `Effect.forkIn` registers the fiber as a child.
	 */
	fork_in<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Fiber.Fiber<A, E>, never, R> {
		return Effect.provideService(
			Effect.forkIn(effect, this.#scope),
			Scope.Scope,
			this.#scope,
		) as Effect.Effect<Fiber.Fiber<A, E>, never, R>;
	}

	/** Effect that closes the scope. Must be run by the owning dispatcher. */
	get close_effect(): Effect.Effect<void> {
		return Scope.close(this.#scope, Exit.void);
	}

	/**
	 * Marks the scope disposed and detaches it from the dispatcher. The caller
	 * is responsible for running {@link close_effect} to run finalizers.
	 * Idempotent.
	 */
	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#on_dispose(this);
	}
}

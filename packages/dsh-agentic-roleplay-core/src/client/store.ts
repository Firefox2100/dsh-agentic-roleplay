/**
 * Plugin-owned observable state stores.
 *
 * The harness Client store package is not a module a plugin may load (see the
 * practices in `docs/docs/specifications/dsh-api-contract.md`); the slot system
 * only asks for the bare `getSnapshot`/`subscribe` pair, so the controllers and
 * pages own their snapshots here instead. The shapes below are structural twins
 * of the shell's store contract: `hooks` sources are read through the shell's
 * selector hooks, and a `store` registration is created by the shell per
 * registration x scope.
 */

/** Minimal observable snapshot source: one stable reference plus change notifications. */
export interface ObservableSnapshot<T> {
  /** Read the cached snapshot reference. */
  getSnapshot(): T
  /**
   * Subscribe to snapshot invalidation.
   * @param fn - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(fn: () => void): () => void
}

/** Writable snapshot store; writes replace the snapshot and notify subscribers. */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /** Replace the state wholesale. */
  set(next: T): void
  /** Mutate a copy of the state and publish it as the next snapshot. */
  update(mutator: (draft: T) => void): void
}

/** Action declaration table: the store's complete write set, as draft mutators. */
export type ActionsDecl<T> = Record<string, (draft: T, ...params: any[]) => void>

/** Draft-stripped callback form of an actions table. */
export type BakedActions<T, A extends ActionsDecl<T>> = {
  [K in keyof A]: A[K] extends (draft: T, ...params: infer P) => void ? (...params: P) => void : never
}

/** Store declaration: a fresh-state factory and its actions. */
export interface StoreSpec<T, A extends ActionsDecl<T>> {
  /** Builds a fresh initial state for every instance. */
  init: () => T
  /** Declaration completeness marker; the plugin stores nothing in `localStorage`. */
  persist?: string
  /** The write set. */
  actions: A
}

/** Live store instance: snapshot source plus the baked write set. */
export interface StoreInstance<T, A extends ActionsDecl<T>> {
  /**
   * The baked write set. The open index signature keeps the instance assignable
   * to the shell's type-erased `StoreInstance<any, any>` at the registration
   * boundary (the shell compares parameters contravariantly).
   */
  readonly actions: BakedActions<T, A> & Record<string, (...params: any[]) => void>
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  /** Nothing is persisted, so there is nothing to drop. */
  clearPersisted(): void
}

/** Store handle: the declaration plus its instance factory. */
export interface StoreHandle<T, A extends ActionsDecl<T>> {
  readonly spec: StoreSpec<T, A>
  create(scopeKey?: string): StoreInstance<T, A>
}

/** Deep copy of plain state so mutators never touch a published snapshot. */
function cloneState<T>(value: T): T {
  const withClone = globalThis as { structuredClone?: <V>(input: V) => V }
  if (typeof withClone.structuredClone === 'function') {
    try {
      return withClone.structuredClone(value)
    } catch {
      // Functions, class instances and the like: fall through to the JSON copy.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Create a snapshot store.
 * @param init - initial state.
 * @returns the store.
 */
export function createSnapshotStore<T>(init: T): SnapshotStore<T> {
  let snapshot = init
  const listeners = new Set<() => void>()
  const publish = (next: T): void => {
    snapshot = next
    // Copy first: a listener may unsubscribe while this dispatch is running.
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    set: (next) => { publish(next) },
    update: (mutator) => {
      const draft = cloneState(snapshot)
      mutator(draft)
      publish(draft)
    },
  }
}

/**
 * Declare a store: initial state plus the write set as draft mutators.
 * @param spec - the declaration.
 * @returns the handle the slot registration consumes.
 */
export function defineStore<T, A extends ActionsDecl<T>>(spec: StoreSpec<T, A>): StoreHandle<T, A> {
  return {
    spec,
    create: (): StoreInstance<T, A> => {
      const store = createSnapshotStore(spec.init())
      const actions = {} as Record<string, (...params: never[]) => void>
      for (const [name, action] of Object.entries(spec.actions)) {
        actions[name] = (...params: never[]) => {
          store.update((draft) => { (action as (draft: T, ...rest: never[]) => void)(draft, ...params) })
        }
      }
      return {
        actions: actions as BakedActions<T, A>,
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        clearPersisted: () => { /* nothing is persisted */ },
      }
    },
  }
}

/**
 * One job at a time per key. Everything asked for a key runs after what was asked before it, and a failure does not stop
 * the work that follows: the next caller is told about its own failure, not the previous one. The key is forgotten once
 * nothing is waiting, so a host that has seen many sessions does not keep them all.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  /** Runs `work` after the work asked for `key` before it, and resolves with its result. */
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(key) ?? Promise.resolve()).then(work, work)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return run
  }

  /** How many keys have work waiting or running; for tests and diagnostics. */
  get pending(): number {
    return this.tails.size
  }
}

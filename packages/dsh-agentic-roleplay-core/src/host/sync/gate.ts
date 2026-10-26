import { UnitLockedError } from './errors.ts'

/**
 * Which units are being synced. A locked unit is neither written nor read until it is released, so rclone never sees a half-written
 * unit and the app never sees a half-downloaded one.
 */
export class UnitGate {
  private readonly held = new Map<string, Promise<void>>()

  isLocked(unit: string): boolean {
    return this.held.has(unit)
  }

  get any(): boolean {
    return this.held.size > 0
  }

  /** @throws {UnitLockedError} when the unit is being synced. */
  assertFree(unit: string): void {
    if (this.held.has(unit)) throw new UnitLockedError(`"${unit}" is being synced; try again when it is done`)
  }

  /** Resolves once the unit is free, at once when it is. */
  async whenFree(unit: string): Promise<void> {
    while (this.held.has(unit)) await this.held.get(unit)
  }

  /** Locks a unit while `work` runs. @throws {UnitLockedError} when it is locked already. */
  async hold<T>(unit: string, work: () => Promise<T>): Promise<T> {
    this.assertFree(unit)
    let release!: () => void
    this.held.set(unit, new Promise<void>((resolve) => { release = resolve }))
    try {
      return await work()
    } finally {
      this.held.delete(unit)
      release()
    }
  }
}

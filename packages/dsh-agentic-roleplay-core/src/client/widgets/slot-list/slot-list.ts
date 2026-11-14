import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '../../store.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/**
 * The label of a slot entry, which is either text or a thunk re-evaluated whenever the language changes. DSH exposes the same one-line rule as `resolveSlotLabel`, but reading it would make
 * the client load a Harness module at run time.
 */
const labelOf = (label: string | (() => string) | undefined): string | undefined => (typeof label === 'function' ? label() : label)

export interface ListedEntry {
  id: string
  label: string
}

/**
 * The entries registered into a list slot, ordered, with their current labels.
 * Labels are functions of the active language, so the list is rebuilt when either the registrations or the language change.
 */
export function createSlotList(ctx: Context, slot: 'roleplay.page' | 'roleplay.reference.section'): { store: SnapshotStore<readonly ListedEntry[]>; start: () => () => void } {
  const store = createSnapshotStore<readonly ListedEntry[]>([])
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot(slot)
      .map(({ options }) => ({
        id: options.id as string,
        order: options.order ?? 0,
        label: labelOf(options.label) ?? (options.id as string),
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }): ListedEntry => ({ id, label }))
    const previous = store.getSnapshot()
    if (previous.length === next.length && previous.every((entry, index) => entry.id === next[index]?.id && entry.label === next[index]?.label)) return
    store.set(next)
  }
  return {
    store,
    start: () => {
      sync()
      const disposers = [ctx.slots.subscribe(slot, sync), ctx.locale.subscribe(sync)]
      return () => { for (const dispose of disposers) dispose() }
    },
  }
}

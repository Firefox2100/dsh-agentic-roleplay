import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './slot-contract.ts'

export interface PageMetadata {
  id: string
  label: string
}

/**
 * Pages registered into `roleplay.page`, ordered, with their current labels.
 * Labels are functions of the active language, so the list is rebuilt when
 * either the registrations or the language change.
 */
export function createPagesSource(ctx: Context): { store: SnapshotStore<readonly PageMetadata[]>; start: () => () => void } {
  const store = createSnapshotStore<readonly PageMetadata[]>([])
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot('roleplay.page')
      .map(({ options }) => ({
        id: options.id as string,
        order: options.order ?? 0,
        label: resolveSlotLabel(options.label) ?? (options.id as string),
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }): PageMetadata => ({ id, label }))
    const previous = store.getSnapshot()
    if (previous.length === next.length && previous.every((page, index) =>
      page.id === next[index]?.id && page.label === next[index]?.label)) return
    store.set(next)
  }
  return {
    store,
    start: () => {
      sync()
      const disposers = [ctx.slots.subscribe('roleplay.page', sync), ctx.locale.subscribe(sync)]
      return () => { for (const dispose of disposers) dispose() }
    },
  }
}

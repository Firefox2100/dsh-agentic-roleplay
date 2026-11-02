import type { Context } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSlotList, type ListedEntry } from '../widgets/slot-list/slot-list.ts'
import type {} from './slot-contract.ts'

export type PageMetadata = ListedEntry

/** Pages registered into `roleplay.page`, ordered, with their current labels. */
export function createPagesSource(ctx: Context): { store: SnapshotStore<readonly PageMetadata[]>; start: () => () => void } {
  return createSlotList(ctx, 'roleplay.page')
}

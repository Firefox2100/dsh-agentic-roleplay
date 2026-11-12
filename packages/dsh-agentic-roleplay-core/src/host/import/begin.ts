import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { importPhase, startRepair } from './run-import.ts'
import { importNotice } from './tools.ts'
import type { TextOf } from './run.ts'

/** What the authoring chats know of the imports they are running: the chats whose turn is an import turn, and how often each was sent back. */
export class ImportState {
  readonly importing = new Set<string>()
  readonly objections = new Map<string, number>()
  readonly repairs = new Map<string, number>()
}

export type ImportBegin = { ok: true; message: string } | { ok: false; reason: string }

/**
 * Makes the next turn of a world's authoring chat an import turn and gives what the chat is told to start it: the procedure of the step the import has reached, then what the person asked.
 * The `/import-st` command and the plugin's own start of an import both begin here.
 */
export async function beginImport(deps: { worlds: WorldCatalog; text: (worldId: string | undefined) => TextOf; state: ImportState }, chat: string, request: string): Promise<ImportBegin> {
  const worldId = authoredWorldOf(chat)
  const record = worldId === undefined ? undefined : await deps.worlds.find(worldId)
  if (record === undefined) return { ok: false, reason: 'an import runs in the authoring chat of a world' }
  const phase = await importPhase(record.directory)
  if (phase === undefined) return { ok: false, reason: 'no card is waiting to be imported in this world' }
  if (phase !== 'done') { deps.state.importing.add(chat); deps.state.objections.delete(chat); deps.state.repairs.delete(chat) }
  if (phase === 'repair') await startRepair(record.directory)
  const notice = importNotice(phase, deps.text(worldId))
  return { ok: true, message: request.trim() === '' ? notice : `${notice}\n\n${request.trim()}` }
}

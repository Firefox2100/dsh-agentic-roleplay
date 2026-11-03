import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, sessionFolder, type RoleplayState } from '@dsh-agentic-roleplay/state'
import { readOpening } from '../agent/history.ts'
import { readTimeline } from '../timeline/file.ts'
import { transcriptJson, transcriptMarkdown, type TranscriptOptions } from '../../shared/transcript.ts'
import { folderName } from './session-archive.ts'
import { SessionNotFoundError } from './errors.ts'

export type TranscriptFormat = 'markdown' | 'json'

export interface TranscriptDeps {
  state: Pick<RoleplayState, 'openSession'>
  sessionsDir: () => string
}

/**
 * The played story as a file for the person: the turns on the way the story went, or every turn including those set aside; plain, or with headings,
 * rulings, rolls and checkpoints.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export function transcriptOfSession(deps: TranscriptDeps, id: string, format: TranscriptFormat, options: Pick<TranscriptOptions, 'scope' | 'annotated'>): { file: string; mediaType: string; text: string } {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const folder = sessionFolder(directory, id)
  const name = deps.state.openSession(directory, id).metadata.get().name
  const opening = readOpening(folder)
  const all: TranscriptOptions = { title: name, ...(opening === undefined ? {} : { opening }), ...options }
  const timeline = readTimeline(folder)
  const base = folderName(name) || 'story'
  if (format === 'json') return { file: `${base}.json`, mediaType: 'application/json; charset=utf-8', text: `${JSON.stringify(transcriptJson(timeline, all), null, 2)}\n` }
  return { file: `${base}.md`, mediaType: 'text/markdown; charset=utf-8', text: transcriptMarkdown(timeline, all) }
}

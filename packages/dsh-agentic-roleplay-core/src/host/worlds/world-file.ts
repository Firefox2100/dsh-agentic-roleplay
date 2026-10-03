import type { WorldAuthor } from '../../shared/worlds.ts'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const WORLD_FILE_NAME = 'world.json'

/**
 * The fields of `world.json` the roleplay UI reads. The file follows the
 * world-simulation-engine export format; everything else in it is ignored.
 */
export interface WorldFile {
  /** Stable identity of the world; absent in a file that has never been indexed. */
  id?: string
  name: string
  description: string
  /** From `metadata.tags`. */
  tags: string[]
  author?: WorldAuthor
  /** Id of a row in `media/manifest.jsonl`. */
  coverMediaId?: string
  /** What the story opens with: shown as the first message of a new session, before the player says anything. */
  opening?: OpeningSegment[]
}

/** One part of an opening: narration, or a line spoken by one of the world's characters (by the character's id). */
export type OpeningSegment =
  | { type: 'narration'; text: string }
  | { type: 'utterance'; character: string; text: string }

/** `opening_message` is plain text (one narration), or a list of parts in the order the player reads them. */
function readOpening(reader: Reader): OpeningSegment[] | undefined {
  const value = reader.raw('opening_message')
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() === '' ? undefined : [{ type: 'narration', text: value.trim() }]
  if (!Array.isArray(value)) {
    reader.fail('opening_message', 'must be text or a list of parts')
    return undefined
  }
  const parts: OpeningSegment[] = []
  for (const part of reader.objects('opening_message')) {
    const type = part.oneOf('type', ['narration', 'utterance'] as const, 'narration')
    const text = part.string('text', { required: true })?.trim()
    if (text === undefined || text === '') continue
    if (type === 'narration') {
      parts.push({ type, text })
      continue
    }
    const character = part.string('character', { required: true })
    if (character !== undefined) parts.push({ type, character, text })
  }
  return parts.length === 0 ? undefined : parts
}

function readAuthor(reader: Reader | undefined): WorldAuthor | undefined {
  if (reader === undefined) return undefined
  const name = reader.string('name', { required: true })
  const url = reader.string('url')
  return name === undefined ? undefined : { name, ...(url === undefined ? {} : { url }) }
}

export function parseWorldFile(text: string): ParseResult<WorldFile> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }

  const id = readIdentifier(reader)
  const name = reader.string('name', { required: true })
  const description = reader.text('description')
  const tags = reader.object('metadata')?.strings('tags') ?? []
  const author = readAuthor(reader.object('author'))
  const coverMediaId = reader.string('cover_media_id')
  const opening = readOpening(reader)
  if (name === undefined || issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    value: {
      ...(id === undefined ? {} : { id }),
      name,
      description,
      tags,
      ...(author === undefined ? {} : { author }),
      ...(coverMediaId === undefined ? {} : { coverMediaId }),
      ...(opening === undefined ? {} : { opening }),
    },
  }
}

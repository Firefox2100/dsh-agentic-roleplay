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
    },
  }
}

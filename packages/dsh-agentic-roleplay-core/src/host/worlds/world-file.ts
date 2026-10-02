import type { WorldAuthor } from '../../shared/worlds.ts'

export const WORLD_FILE_NAME = 'world.json'

/**
 * The fields of `world.json` the roleplay UI reads. The file follows the
 * world-simulation-engine export format; everything else in it is ignored.
 */
export interface WorldFile {
  name: string
  description: string
  /** From `metadata.tags`. */
  tags: string[]
  author?: WorldAuthor
  /** Id of a row in `media/manifest.jsonl`. */
  coverMediaId?: string
}

export class WorldFileError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A missing field and an explicit `null` mean the same thing in the export format. */
function optionalString(data: Record<string, unknown>, field: string, label = field): string | undefined {
  const value = data[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new WorldFileError(`"${label}" must be a string`)
  return value
}

function parseAuthor(value: unknown): WorldAuthor | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new WorldFileError('"author" must be an object')
  const name = optionalString(value, 'name', 'author.name')?.trim()
  if (name === undefined || name === '') throw new WorldFileError('"author.name" is required')
  const url = optionalString(value, 'url', 'author.url')?.trim()
  return { name, ...(url === undefined || url === '' ? {} : { url }) }
}

/**
 * Validate the content of a `world.json`.
 * @throws {WorldFileError} describing the first invalid field.
 */
export function parseWorldFile(text: string): WorldFile {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch (error) {
    throw new WorldFileError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(data)) throw new WorldFileError('expected a JSON object')

  const name = optionalString(data, 'name')?.trim()
  if (name === undefined || name === '') throw new WorldFileError('"name" is required')

  const metadata = data.metadata ?? {}
  if (!isRecord(metadata)) throw new WorldFileError('"metadata" must be an object')
  const rawTags = metadata.tags ?? []
  if (!Array.isArray(rawTags) || rawTags.some(tag => typeof tag !== 'string')) {
    throw new WorldFileError('"metadata.tags" must be an array of strings')
  }
  const tags = [...new Set((rawTags as string[]).map(tag => tag.trim()).filter(tag => tag !== ''))]

  const author = parseAuthor(data.author)
  const coverMediaId = optionalString(data, 'cover_media_id')?.trim()
  return {
    name,
    description: optionalString(data, 'description')?.trim() ?? '',
    tags,
    ...(author === undefined ? {} : { author }),
    ...(coverMediaId === undefined || coverMediaId === '' ? {} : { coverMediaId }),
  }
}

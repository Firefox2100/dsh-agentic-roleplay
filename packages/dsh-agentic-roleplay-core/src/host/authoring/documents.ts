import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ParseResult } from '../validation.ts'
import { formatIssue } from '../validation.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { subfolders } from '../folders.ts'
import { CHARACTERS_DIR } from '../characters/load.ts'
import { CHARACTER_FILE_NAME, parseCharacterFile } from '../characters/character-file.ts'
import { LOCATIONS_DIR } from '../locations/load.ts'
import { LOCATION_FILE_NAME, parseLocationFile } from '../locations/location-file.ts'
import { ITEMS_DIR } from '../items/load.ts'
import { ITEM_FILE_NAME, parseItemFile } from '../items/item-file.ts'
import { FACTIONS_DIR } from '../factions/load.ts'
import { FACTION_FILE_NAME, parseFactionFile } from '../factions/faction-file.ts'
import { LORE_DIR } from '../lore/load.ts'
import { LORE_FILE_NAME, parseLoreFile } from '../lore/lore-file.ts'
import type { EditableWorld } from '../worlds/world-editor.ts'

export const AUTHORED_ENTITY_KINDS = ['character', 'location', 'item', 'faction', 'lore'] as const
export type AuthoredEntityKind = typeof AUTHORED_ENTITY_KINDS[number]

type EntityDefinition = { id: string }
type Parser = (text: string, fallback: string) => ParseResult<EntityDefinition>

const formats: Record<AuthoredEntityKind, { directory: string; file: string; parse: Parser }> = {
  character: { directory: CHARACTERS_DIR, file: CHARACTER_FILE_NAME, parse: parseCharacterFile },
  location: { directory: LOCATIONS_DIR, file: LOCATION_FILE_NAME, parse: parseLocationFile },
  item: { directory: ITEMS_DIR, file: ITEM_FILE_NAME, parse: parseItemFile },
  faction: { directory: FACTIONS_DIR, file: FACTION_FILE_NAME, parse: parseFactionFile },
  lore: { directory: LORE_DIR, file: LORE_FILE_NAME, parse: parseLoreFile },
}

function validNewKey(key: string): boolean {
  return key.length > 0 && key.length <= 100 && key !== '.' && key !== '..' && !key.includes('/') && !key.includes('\\') && !key.includes('\0')
}

async function find(world: EditableWorld, kind: AuthoredEntityKind, key: string): Promise<{ folder: string; file: string } | undefined> {
  const format = formats[kind]
  const root = join(world.directory, format.directory)
  for (const folder of await subfolders(root)) {
    const file = join(root, folder, format.file)
    try {
      const parsed = format.parse(await readFile(file, 'utf8'), folder)
      if (parsed.ok && parsed.value.id === key) return { folder, file }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}

function serializeDocument(kind: AuthoredEntityKind, key: string, value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['document must be a JSON object'])
  const document = { ...(value as Record<string, unknown>), id: key }
  const text = `${JSON.stringify(document, null, 2)}\n`
  const parsed = formats[kind].parse(text, key)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  return text
}

async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const mode = await stat(file).then(value => value.mode)
    await writeFile(temporary, text, { mode })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function readAuthoredEntityDocument(world: EditableWorld, kind: AuthoredEntityKind, key: string): Promise<unknown> {
  const found = await find(world, kind, key)
  if (found === undefined) throw new InvalidEditProblems([`there is no ${kind} "${key}"`])
  return JSON.parse((await readFile(found.file, 'utf8')).replace(/^﻿/, '')) as unknown
}

export async function createAuthoredEntity(world: EditableWorld, kind: AuthoredEntityKind, key: string, document: unknown): Promise<void> {
  if (!validNewKey(key)) throw new InvalidEditProblems(['key must be a non-empty file-safe id of at most 100 characters'])
  if (await find(world, kind, key) !== undefined) throw new InvalidEditProblems([`the ${kind} "${key}" already exists`])
  const format = formats[kind]
  const root = join(world.directory, format.directory)
  const folder = join(root, key)
  const text = serializeDocument(kind, key, document)
  await mkdir(root, { recursive: true })
  await mkdir(folder, { recursive: false })
  try {
    await writeFile(join(folder, format.file), text, { flag: 'wx' })
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
}

export async function replaceAuthoredEntity(world: EditableWorld, kind: AuthoredEntityKind, key: string, document: unknown): Promise<void> {
  const found = await find(world, kind, key)
  if (found === undefined) throw new InvalidEditProblems([`there is no ${kind} "${key}"`])
  await replaceFile(found.file, serializeDocument(kind, key, document))
}

/** Deletions remain recoverable without making the trash visible to the world loaders. */
export async function deleteAuthoredEntity(world: EditableWorld, kind: AuthoredEntityKind, key: string): Promise<string> {
  const found = await find(world, kind, key)
  if (found === undefined) throw new InvalidEditProblems([`there is no ${kind} "${key}"`])
  const trash = join(world.directory, '.trash', formats[kind].directory)
  await mkdir(trash, { recursive: true })
  const destination = join(trash, `${found.folder}-${Date.now()}-${randomUUID()}`)
  await rename(dirname(found.file), destination)
  return destination
}

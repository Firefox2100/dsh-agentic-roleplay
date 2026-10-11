import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CharacterDefinition, LocationDefinition } from 'dsh-roleplay-model'
import { AVATARS_FOLDER, AVATARS_WORLD_ID } from '../../shared/avatars.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { createAuthoredEntity, deleteAuthoredEntity, readAuthoredEntityDocument } from '../authoring/documents.ts'
import { CHARACTERS_DIR, loadCharacters } from '../characters/load.ts'
import { parseCharacterFile } from '../characters/character-file.ts'
import { referenceImagePath } from '../images/storage.ts'
import { slug, uniqueKey } from '../import/run.ts'
import { subfolders } from '../folders.ts'
import type { EditableWorld } from '../worlds/world-editor.ts'

type Json = Record<string, unknown>

const WORLD_FILE = 'world.json'

/** The folder the player avatars live in, with the file that makes it readable as a world of characters only. */
export async function avatarsWorld(rootPath: string): Promise<EditableWorld> {
  const directory = join(rootPath, AVATARS_FOLDER)
  await mkdir(join(directory, CHARACTERS_DIR), { recursive: true })
  const file = join(directory, WORLD_FILE)
  if (!existsSync(file)) await writeFile(file, `${JSON.stringify({ id: AVATARS_WORLD_ID, name: 'Player avatars' }, null, 2)}\n`, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  return { id: AVATARS_WORLD_ID, directory }
}

/** Makes a new avatar with the name and nothing else; it can be played from the start. @returns its key. */
export async function createAvatar(avatars: EditableWorld, name: string): Promise<string> {
  const trimmed = name.trim()
  if (trimmed === '') throw new InvalidEditProblems(['the avatar needs a name'])
  const taken = new Set(await subfolders(join(avatars.directory, CHARACTERS_DIR)))
  const key = uniqueKey(slug(trimmed, 'avatar'), taken)
  await createAuthoredEntity(avatars, 'character', key, { name: trimmed, role: 'playable', tier: 'principal', kind: 'person', summary: '' })
  return key
}

export async function deleteAvatar(avatars: EditableWorld, key: string): Promise<void> {
  await deleteAuthoredEntity(avatars, 'character', key)
}

export interface Placement {
  /** Ids the avatar's relationships may point to: the others of the world, and the avatars brought with it. */
  known: ReadonlySet<string>
  /** Where it starts: the place of the world, or none for a world without places. */
  place: { location: string; feature?: string; position?: string } | undefined
}

/**
 * An avatar document as a character of a world. An avatar is made without any world, so what points into one is dropped: the way it knows
 * places and things, its day, and the world's own variables; its relationships stay for those who are there. It is playable and starts at `place`.
 */
export function adaptAvatar(document: Json, id: string, placement: Placement): Json {
  const adapted: Json = { ...document, id, role: 'playable' }
  delete adapted['knowledge']
  delete adapted['routine']
  delete adapted['variables']
  if (Array.isArray(adapted['relationships'])) {
    const kept = (adapted['relationships'] as Json[]).filter(relation => typeof relation['to'] === 'string' && relation['to'] !== id && placement.known.has(relation['to']))
    if (kept.length === 0) delete adapted['relationships']
    else adapted['relationships'] = kept
  }
  const start = { ...(typeof adapted['start'] === 'object' && adapted['start'] !== null ? adapted['start'] as Json : {}) }
  delete start['location']
  delete start['position']
  delete start['feature']
  if (placement.place !== undefined) {
    start['location'] = placement.place.location
    if (placement.place.position !== undefined) start['position'] = placement.place.position
    if (placement.place.feature !== undefined) start['feature'] = placement.place.feature
  }
  adapted['start'] = start
  return adapted
}

/** Where an avatar starts by default: with the playable characters of the world when they have a place, else in the world's first place. */
export function defaultPlace(characters: readonly CharacterDefinition[], locations: readonly LocationDefinition[]): Placement['place'] {
  const playing = characters.find(character => character.role === 'playable' && character.start.place !== undefined)?.start.place
  if (playing !== undefined) return { location: playing.location, ...(playing.feature === undefined ? {} : { feature: playing.feature }), ...(playing.position === undefined ? {} : { position: playing.position }) }
  const first = locations[0]
  return first === undefined ? undefined : { location: first.id }
}

async function documentsOf(avatars: EditableWorld, keys: readonly string[]): Promise<{ key: string; document: Json }[]> {
  const unique = [...new Set(keys)]
  return await Promise.all(unique.map(async key => ({ key, document: await readAuthoredEntityDocument(avatars, 'character', key) as Json })))
}

/** Adapts each avatar to a world with these characters: unique ids, and the document as the world will read it. */
export async function broughtAvatars(avatars: EditableWorld, keys: readonly string[], existing: readonly CharacterDefinition[], locations: readonly LocationDefinition[]): Promise<{ from: string; id: string; document: Json }[]> {
  const documents = await documentsOf(avatars, keys)
  const taken = new Set(existing.map(character => character.id))
  const ids = documents.map(({ key }) => uniqueKey(key, taken))
  const known = new Set([...existing.map(character => character.id), ...ids])
  const place = defaultPlace(existing, locations)
  return documents.map(({ key, document }, index) => {
    const id = ids[index]!
    const adapted = adaptAvatar(document, id, { known, place })
    const parsed = parseCharacterFile(JSON.stringify(adapted), id)
    if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(issue => `${key}: ${issue.path} ${issue.message}`))
    return { from: key, id, document: adapted }
  })
}

/** The portrait of an avatar, copied to where a world or a session keeps the portraits of its characters. */
export async function copyPortrait(avatars: EditableWorld, key: string, document: Json, target: string, id: string): Promise<void> {
  const globalId = typeof (document['visual_identity'] as Json | undefined)?.['global_id'] === 'string' ? (document['visual_identity'] as Json)['global_id'] as string : undefined
  const subject = (localId: string) => ({ kind: 'character' as const, localId, ...(globalId === undefined ? {} : { globalId }) })
  const from = referenceImagePath(avatars.directory, subject(key))
  if (!existsSync(from)) return
  const to = referenceImagePath(target, subject(id))
  if (existsSync(to)) return
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/** Adds avatars to a world's own files as characters. @returns the ids they have there. */
export async function addAvatarsToWorld(avatars: EditableWorld, world: EditableWorld, keys: readonly string[], locations: readonly LocationDefinition[]): Promise<string[]> {
  const { characters, problems } = await loadCharacters(world.directory)
  if (problems.length > 0) throw new InvalidEditProblems(problems.map(problem => problem.message))
  const brought = await broughtAvatars(avatars, keys, characters, locations)
  for (const { from, id, document } of brought) {
    await createAuthoredEntity(world, 'character', id, document)
    await copyPortrait(avatars, from, document, world.directory, id)
  }
  return brought.map(entry => entry.id)
}


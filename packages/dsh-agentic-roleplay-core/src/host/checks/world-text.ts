import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ENTITY_FOLDERS } from '../worlds/entity-folders.ts'
import { PROMPTS_FOLDER, listFiles } from '../prompts/library.ts'
import { WORLD_FILE_NAME } from '../worlds/world-file.ts'
import { subfolders } from '../folders.ts'

/** Every string a document holds, joined: what the world says in it, without the structure around it. */
const stringsOf = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(stringsOf) : typeof value === 'object' && value !== null ? Object.values(value).flatMap(stringsOf) : [])

export interface NamedThing {
  /** `characters/clara`: the folder of the thing. */
  where: string
  kind: 'characters' | 'locations' | 'factions' | 'items'
  names: string[]
  /** A character the player may play. */
  playable: boolean
}

/** Fields that say what a document is or point at another document, not what the world says: a model comparing prose with a card is not shown them. */
const STRUCTURE = new Set(['id', 'role', 'tier', 'kind', 'scope', 'type', 'status', 'control', 'known_by', 'related', 'subjects', 'sources', 'to', 'location', 'parent', 'held_by', 'owner', 'members', 'knowledge', 'relationships', 'exits', 'start', 'visual_identity', 'routine', 'variables'])

/** What a document says in words, one `field: text` line each, without the structure around it. */
function proseOf(value: unknown, field = ''): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [field === '' ? value : `${field}: ${value}`]
  if (Array.isArray(value)) return value.flatMap(entry => proseOf(entry, field))
  if (typeof value === 'object' && value !== null) return Object.entries(value).filter(([key]) => !STRUCTURE.has(key)).flatMap(([key, entry]) => proseOf(entry, key))
  return []
}

export interface WorldText {
  /** What each part of the world says, by `characters/clara`, `lore/founding`, `world.json`, `prompts/en/roleplay/style`. */
  texts: Map<string, string>
  /** The same parts as prose lines (`personality: Dry.`), for a model to read. */
  prose: Map<string, string>
  /** What each part is about, for a model told what to compare: `character Mara`, `place The Inn`, `background The founding`. */
  subjects: Map<string, string>
  names: NamedThing[]
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')) as unknown } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** What the files of a world say, read afresh, for comparing with a card. A file that does not read is left out: the consistency kit names it. */
export async function readWorldText(directory: string): Promise<WorldText> {
  const texts = new Map<string, string>()
  const prose = new Map<string, string>()
  const subjects = new Map<string, string>()
  const names: NamedThing[] = []
  const KIND = { characters: 'character', locations: 'place', factions: 'organisation', items: 'thing', lore: 'background entry' } as const
  for (const { directory: folder, file } of ENTITY_FOLDERS) {
    for (const id of await subfolders(join(directory, folder))) {
      const document = await readJson(join(directory, folder, id, file)).catch(() => undefined) as Record<string, unknown> | undefined
      if (document === undefined || typeof document !== 'object') continue
      texts.set(`${folder}/${id}`, stringsOf(document).join('\n'))
      prose.set(`${folder}/${id}`, proseOf(document).join('\n'))
      const label = document[folder === 'lore' ? 'title' : 'name']
      subjects.set(`${folder}/${id}`, `${KIND[folder as keyof typeof KIND]}${typeof label === 'string' ? ` ${label}` : ''}`)
      if (folder !== 'lore') {
        const own = [document['name'], ...(Array.isArray(document['aliases']) ? document['aliases'] : [])].filter((name): name is string => typeof name === 'string' && name.trim() !== '')
        names.push({ where: `${folder}/${id}`, kind: folder as NamedThing['kind'], names: own, playable: document['role'] === 'playable' })
      }
    }
  }
  const info = await readJson(join(directory, WORLD_FILE_NAME)).catch(() => undefined)
  // each field of the world's own file is a text of its own, so a piece made into the description is not diluted by the name, the tags and the rest
  if (typeof info === 'object' && info !== null) {
    for (const [field, value] of Object.entries(info)) {
      const text = stringsOf(value).join('\n')
      if (text.trim() !== '') { texts.set(`${WORLD_FILE_NAME}#${field}`, text); prose.set(`${WORLD_FILE_NAME}#${field}`, text); subjects.set(`${WORLD_FILE_NAME}#${field}`, `the world's ${field}`) }
    }
  }
  const prompts = join(directory, PROMPTS_FOLDER)
  for (const language of await readdir(prompts).catch(() => [] as string[])) {
    for (const id of listFiles(join(prompts, language))) texts.set(`${PROMPTS_FOLDER}/${language}/${id}`, await readFile(join(prompts, language, `${id}.md`), 'utf8'))
  }
  return { texts, prose, subjects, names }
}

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type DocumentKind = 'world' | 'calendar' | 'variables' | 'triggers' | 'plots' | 'character' | 'location' | 'item' | 'faction' | 'lore'

/**
 * The fields of each kind of file that are words for a reader, as paths with `[]` for a list. Everything else (ids, references, times, tokens, enumerations, image prompts)
 * is never translated: a field that is not named here stays as it is.
 */
interface ProseFields {
  /** What a thing is called: translated once for the whole world, so every mention agrees. */
  names: readonly string[]
  text: readonly string[]
}

const rooted = (roots: readonly string[], paths: readonly string[]): string[] => roots.flatMap(root => paths.map(path => `${root}${path}`))
const INTENT = ['.name', '.description', '.plan[]', '.open_threads[]', '.constraints[]']

const FIELDS: Record<DocumentKind, ProseFields> = {
  world: {
    names: ['name'],
    text: ['description', 'rules[]', 'metadata.tags[]', 'opening_message', 'opening_message[].text', 'alternate_openings[].title', 'alternate_openings[].text'],
  },
  calendar: { names: ['holidays[].name'], text: [] },
  variables: { names: [], text: rooted(['[]', 'variables[]'], ['.name', '.description', '.bands[].label']) },
  triggers: { names: [], text: rooted(['[]', 'triggers[]'], ['.name', '.announce.text', '.effects[].text', '.effects[].edit.events[].text']) },
  plots: {
    names: [],
    text: [
      'plots[].name', 'plots[].premise', 'plots[].themes[]', 'plots[].stakes[]', 'plots[].resolutions[]',
      ...['hooks', 'developments'].flatMap(list => [`plots[].${list}[].text`, `plots[].${list}[].prerequisites[]`, `plots[].${list}[].guidance`, `plots[].${list}[].avoid[]`]),
    ],
  },
  character: {
    names: ['name', 'aliases[]'],
    text: [
      'age', 'gender', 'summary', 'personality', 'background', 'appearance', 'speech.style', 'speech.examples[]',
      'start.public_state', 'start.inner_state', 'start.activity', ...INTENT.map(path => `start.intents[]${path}`),
      'relationships[].label', 'relationships[].summary', 'routine[].activity', 'visual_identity.description',
    ],
  },
  location: {
    names: ['name', 'features[].name'],
    text: ['description', 'features[].description', 'exits[].description', 'exits[].note', 'exits[].back_description', 'visual_identity.description'],
  },
  item: { names: ['name'], text: ['description', 'quality', 'visual_identity.description'] },
  faction: {
    names: ['name', 'aliases[]'],
    text: [
      'summary', 'description', 'values[]', 'structure', 'start.public_state', 'start.inner_state', ...INTENT.map(path => `start.goals[]${path}`),
      'members[].role', 'members[].rank', 'relationships[].label', 'relationships[].summary',
    ],
  },
  lore: { names: [], text: ['title', 'summary', 'body'] },
}

export interface Leaf {
  /** Where the string is in its document. */
  path: readonly (string | number)[]
  text: string
  name: boolean
}

type Json = unknown

/** The strings of a document that are words for a reader, in document order; strings with no letters need no translation and are left out. */
export function leavesOf(kind: DocumentKind, document: Json): Leaf[] {
  const fields = FIELDS[kind]
  const names = new Set(fields.names)
  const text = new Set(fields.text)
  const leaves: Leaf[] = []
  const visit = (value: Json, pattern: string, path: readonly (string | number)[]): void => {
    if (typeof value === 'string') {
      const name = names.has(pattern)
      if ((name || text.has(pattern)) && /\p{L}/u.test(value)) leaves.push({ path, text: value, name })
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => { visit(entry, `${pattern}[]`, [...path, index]) })
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) visit(entry, pattern === '' ? key : `${pattern}.${key}`, [...path, key])
    }
  }
  visit(document, '', [])
  return leaves
}

/** Puts `text` where `path` points in the document. */
export function setLeaf(document: Json, path: readonly (string | number)[], text: string): void {
  let at = document as Record<string | number, Json>
  for (const step of path.slice(0, -1)) at = at[step] as Record<string | number, Json>
  at[path[path.length - 1]!] = text
}

export interface WorldDocument {
  /** Path inside the world's folder. */
  file: string
  kind: DocumentKind
  document: Json
}

const ROOT_FILES: readonly [string, DocumentKind][] = [['world.json', 'world'], ['calendar.json', 'calendar'], ['variables.json', 'variables'], ['triggers.json', 'triggers'], ['plots.json', 'plots']]
const ENTITIES: readonly [string, string, DocumentKind][] = [
  ['characters', 'character.json', 'character'], ['locations', 'location.json', 'location'], ['items', 'item.json', 'item'], ['factions', 'faction.json', 'faction'], ['lore', 'lore.json', 'lore'],
]

async function readIfThere(file: string): Promise<Json | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Json
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Every file of a world that holds words for a reader. A file that does not parse stops the read: a world with a broken file is not translated. */
export async function readWorldDocuments(directory: string): Promise<WorldDocument[]> {
  const found: WorldDocument[] = []
  for (const [file, kind] of ROOT_FILES) {
    const document = await readIfThere(join(directory, file))
    if (document !== undefined) found.push({ file, kind, document })
  }
  for (const [folder, name, kind] of ENTITIES) {
    let entries: string[]
    try {
      entries = (await readdir(join(directory, folder), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const file = join(folder, entry, name)
      const document = await readIfThere(join(directory, file))
      if (document !== undefined) found.push({ file, kind, document })
    }
  }
  return found
}

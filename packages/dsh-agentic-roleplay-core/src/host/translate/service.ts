import { InvalidEditProblems } from '../../shared/world-state.ts'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { languageOfDocuments } from './translate-world.ts'
import { readWorldDocuments } from './prose.ts'
import { translateMessage } from './tools.ts'
import type { StoryLanguage } from './language.ts'

export interface TranslationDeps {
  worlds: WorldCatalog
  authoring: { ensure(worldId: string, worldName: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
  text: (id: string, language: string, variables?: Record<string, string | number>) => string
}

async function recordOf(worlds: WorldCatalog, id: string) {
  const record = await worlds.find(id)
  if (record === undefined) throw new WorldNotFoundError(`there is no world with id "${id}"`)
  return record
}

/** The language a world is written in, from the words of its files; nothing when there is too little text to tell. */
export async function worldLanguage(worlds: WorldCatalog, id: string): Promise<StoryLanguage | undefined> {
  return languageOfDocuments(await readWorldDocuments((await recordOf(worlds, id)).directory))
}

export interface StartedTranslation {
  chatSessionId: string
  /** Whether the message that starts the translation was sent; when it was not, the person can ask the chat themselves. */
  started: boolean
  failure?: string
}

/** Opens the authoring chat of a world and asks it to translate the world; the work shows in that chat. */
export async function startTranslation(deps: TranslationDeps, id: string, to: StoryLanguage, title: string, language: string): Promise<StartedTranslation> {
  const record = await recordOf(deps.worlds, id)
  const from = await worldLanguage(deps.worlds, id)
  if (from === undefined) throw new InvalidEditProblems(['there is too little text in this world to tell which language it is written in'])
  if (from === to) throw new InvalidEditProblems([`this world is already written in ${to === 'zh' ? 'Chinese' : 'English'}`])
  const chatSessionId = await deps.authoring.ensure(record.summary.id, record.summary.name, title, language)
  const told: StoryLanguage = language.startsWith('zh') ? 'zh' : 'en'
  try {
    await deps.authoring.send(chatSessionId, translateMessage((key, variables) => deps.text(key, language, variables), to, told))
    return { chatSessionId, started: true }
  } catch (error) {
    return { chatSessionId, started: false, failure: error instanceof Error ? error.message : String(error) }
  }
}

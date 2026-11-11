import { API_PREFIX } from '../../../shared/worlds.ts'
import { answer } from './import-api.ts'

export type StoryLanguage = 'en' | 'zh'

/** The language a world is written in, or nothing when it has too little text to tell. */
export async function worldLanguage(worldId: string, signal?: AbortSignal): Promise<StoryLanguage | undefined> {
  return (await worldLanguages(worldId, signal)).written
}

/** The language a world's words are in, and the language its file says its stories are played in, when it says one. */
export async function worldLanguages(worldId: string, signal?: AbortSignal): Promise<{ written?: StoryLanguage; declared?: string }> {
  const { language, declared } = await answer<{ language: StoryLanguage | null; declared: string | null }>(await fetch(`${API_PREFIX}/worlds/language?id=${encodeURIComponent(worldId)}`, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) }))
  return { ...(language === null ? {} : { written: language }), ...(declared === null ? {} : { declared }) }
}

/** Opens the authoring chat of the world and has it make a translated copy. */
export async function translateWorld(worldId: string, to: StoryLanguage, title: string, language: string): Promise<{ chatSessionId: string; started: boolean; failure?: string }> {
  return await answer(await fetch(`${API_PREFIX}/worlds/translate?id=${encodeURIComponent(worldId)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, title, language }) }))
}

/** The language a story is played in from a tag as written (`zh-CN`, `JA`): its primary subtag, lower case. */
export const playedLanguageOf = (code: string): string => code.trim().toLowerCase().split(/[-_]/)[0] ?? ''

/** The language of the interface or of a setting, as one of the two the plugin writes in. */
export const storyLanguageOf = (code: string): StoryLanguage => (code.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en')

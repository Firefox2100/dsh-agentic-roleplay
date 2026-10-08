import { API_PREFIX } from '../../../shared/worlds.ts'
import { answer, listVoices, post, put, type WorldSource } from '../../world-editor/source.ts'

/** The files of a world, as the editor in the Worlds page reads and edits them. */
export function worldSource(worldId: string): WorldSource {
  const id = encodeURIComponent(worldId)
  return {
    load: async signal => await answer(await fetch(`${API_PREFIX}/worlds/state?id=${id}`, { credentials: 'same-origin', signal })),
    saveCharacter: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/character?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    savePlace: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/place?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveThing: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/thing?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveFaction: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/faction?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveLore: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/lore?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveRelation: async (edit, signal) => await put(`${API_PREFIX}/worlds/state/relation?id=${id}`, edit, signal),
    saveNarrationVoice: async (voice, signal) => await put(`${API_PREFIX}/worlds/state/narration-voice?id=${id}`, { voice }, signal),
    listVoices: async signal => await listVoices(`${API_PREFIX}/speech/voices`, signal),
    generatePortrait: async (key, signal) => await post(`${API_PREFIX}/worlds/state/character/portrait?id=${id}&key=${encodeURIComponent(key)}`, signal),
  }
}

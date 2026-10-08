import { API_PREFIX } from '../../shared/worlds.ts'
import { answer, listVoices, post, put, type WorldSource } from '../world-editor/source.ts'

/** The story of a roleplay session, as the World tab reads and edits it. */
export function sessionSource(session: string): WorldSource {
  const id = encodeURIComponent(session)
  return {
    load: async signal => await answer(await fetch(`${API_PREFIX}/sessions/world?id=${id}`, { credentials: 'same-origin', signal })),
    saveCharacter: async (key, edit, signal) => await put(`${API_PREFIX}/sessions/world/character?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    savePlace: async (key, edit, signal) => await put(`${API_PREFIX}/sessions/world/place?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveThing: async (key, edit, signal) => await put(`${API_PREFIX}/sessions/world/thing?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveFaction: async (key, edit, signal) => await put(`${API_PREFIX}/sessions/world/faction?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveLore: async (key, edit, signal) => await put(`${API_PREFIX}/sessions/world/lore?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    savePlots: async (edit, signal) => await put(`${API_PREFIX}/sessions/world/plots?id=${id}`, edit, signal),
    saveRelation: async (edit, signal) => await put(`${API_PREFIX}/sessions/world/relation?id=${id}`, edit, signal),
    saveNarrationVoice: async (voice, signal) => await put(`${API_PREFIX}/sessions/world/narration-voice?id=${id}`, { voice }, signal),
    listVoices: async signal => await listVoices(`${API_PREFIX}/speech/voices`, signal),
    generatePortrait: async (key, signal) => await post(`${API_PREFIX}/sessions/world/character/portrait?id=${id}&key=${encodeURIComponent(key)}`, signal),
  }
}

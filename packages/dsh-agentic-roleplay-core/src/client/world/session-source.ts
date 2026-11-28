import { API_PREFIX } from '../../shared/worlds.ts'
import type { EditorClaims } from '../../shared/claims.ts'
import { answer, listVoices, post, postFile, put, type WorldSource } from '../world-editor/source.ts'

async function claimsAnswer(response: Response): Promise<EditorClaims> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return await response.json() as EditorClaims
}

/** The story of a roleplay session, as the World tab reads and edits it. */
export function sessionSource(session: string): WorldSource {
  const id = encodeURIComponent(session)
  return {
    gallery: { kind: 'sessions', id: session },
    claims: {
      list: async signal => await claimsAnswer(await fetch(`${API_PREFIX}/sessions/world/claims?id=${id}`, { credentials: 'same-origin', signal })),
      setStatus: async (claim, status, signal) => await claimsAnswer(await fetch(`${API_PREFIX}/sessions/world/claims/status?id=${id}&claim=${claim}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }), signal })),
      remove: async (claim, signal) => await claimsAnswer(await fetch(`${API_PREFIX}/sessions/world/claims?id=${id}&claim=${claim}`, { method: 'DELETE', credentials: 'same-origin', signal })),
    },
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
    uploadPortrait: async (key, file, signal) => await postFile(`${API_PREFIX}/sessions/world/character/portrait/upload?id=${id}&key=${encodeURIComponent(key)}`, file, signal),
    generateImage: async (kind, key, signal) => await post(`${API_PREFIX}/sessions/world/${kind}/image?id=${id}&key=${encodeURIComponent(key)}`, signal),
    uploadImage: async (kind, key, file, signal) => await postFile(`${API_PREFIX}/sessions/world/${kind}/image/upload?id=${id}&key=${encodeURIComponent(key)}`, file, signal),
  }
}

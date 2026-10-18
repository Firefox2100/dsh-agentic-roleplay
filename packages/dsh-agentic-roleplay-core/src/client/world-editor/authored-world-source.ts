import { API_PREFIX } from '../../shared/worlds.ts'
import { answer, listVoices, post, postFile, postJson, put, remove, type WorldSource } from './source.ts'

/** An authored world's files, shared by the catalogue editor and its authoring chat. */
export function worldSource(worldId: string): WorldSource {
  const id = encodeURIComponent(worldId)
  return {
    worldId,
    load: async signal => await answer(await fetch(`${API_PREFIX}/worlds/state?id=${id}`, { credentials: 'same-origin', signal })),
    saveCharacter: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/character?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    savePlace: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/place?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveThing: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/thing?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveFaction: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/faction?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    saveLore: async (key, edit, signal) => await put(`${API_PREFIX}/worlds/state/lore?id=${id}&key=${encodeURIComponent(key)}`, edit, signal),
    addLore: async (title, signal) => await postJson(`${API_PREFIX}/worlds/state/lore?id=${id}`, { title }, signal),
    removeLore: async (key, signal) => await remove(`${API_PREFIX}/worlds/state/lore?id=${id}&key=${encodeURIComponent(key)}`, signal),
    readTrigger: async (key, signal) => {
      const response = await fetch(`${API_PREFIX}/worlds/state/trigger?id=${id}&key=${encodeURIComponent(key)}`, { credentials: 'same-origin', signal })
      if (!response.ok) { const body = await response.json().catch(() => undefined) as { message?: unknown; problems?: unknown } | undefined; throw new Error(Array.isArray(body?.problems) ? body.problems.join('; ') : typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim()) }
      return await response.json() as Record<string, unknown>
    },
    writeTrigger: async (key, document, signal) => await answer(await fetch(`${API_PREFIX}/worlds/state/trigger?id=${id}&key=${encodeURIComponent(key)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document), signal })),
    removeTrigger: async (key, signal) => await remove(`${API_PREFIX}/worlds/state/trigger?id=${id}&key=${encodeURIComponent(key)}`, signal),
    savePlots: async (edit, signal) => await put(`${API_PREFIX}/worlds/state/plots?id=${id}`, edit, signal),
    saveRelation: async (edit, signal) => await put(`${API_PREFIX}/worlds/state/relation?id=${id}`, edit, signal),
    saveNarrationVoice: async (voice, signal) => await put(`${API_PREFIX}/worlds/state/narration-voice?id=${id}`, { voice }, signal),
    listVoices: async signal => await listVoices(`${API_PREFIX}/speech/voices`, signal),
    generatePortrait: async (key, signal) => await post(`${API_PREFIX}/worlds/state/character/portrait?id=${id}&key=${encodeURIComponent(key)}`, signal),
    uploadPortrait: async (key, file, signal) => await postFile(`${API_PREFIX}/worlds/state/character/portrait/upload?id=${id}&key=${encodeURIComponent(key)}`, file, signal),
    generateImage: async (kind, key, signal) => await post(`${API_PREFIX}/worlds/state/${kind}/image?id=${id}&key=${encodeURIComponent(key)}`, signal),
    uploadImage: async (kind, key, file, signal) => await postFile(`${API_PREFIX}/worlds/state/${kind}/image/upload?id=${id}&key=${encodeURIComponent(key)}`, file, signal),
  }
}

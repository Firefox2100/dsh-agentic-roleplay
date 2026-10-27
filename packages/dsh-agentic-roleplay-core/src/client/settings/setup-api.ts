import { API_PREFIX } from '../../shared/worlds.ts'

/** The ids of the plugin rows the profile holds more than once; empty when the profile is as it should be. */
export async function loadRedundantLayers(signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API_PREFIX}/setup`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  const body = await response.json() as { redundantLayers?: unknown }
  return Array.isArray(body.redundantLayers) ? body.redundantLayers.filter((id): id is string => typeof id === 'string') : []
}

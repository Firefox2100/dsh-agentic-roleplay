import type { CardPieceText, CardView } from '../../shared/card-view.ts'
import { API_PREFIX } from '../../shared/worlds.ts'

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof body?.message === 'string' ? body.message : `${response.status} ${response.statusText}`.trim())
  }
  return await response.json() as T
}

const get = (path: string, signal: AbortSignal): Promise<Response> => fetch(`${API_PREFIX}${path}`, { credentials: 'same-origin', signal })

export const loadCard = async (world: string, signal: AbortSignal): Promise<CardView> => await read(await get(`/worlds/card?id=${encodeURIComponent(world)}`, signal))
export const loadPiece = async (world: string, piece: string, signal: AbortSignal): Promise<CardPieceText> => await read(await get(`/worlds/card/piece?id=${encodeURIComponent(world)}&piece=${encodeURIComponent(piece)}`, signal))

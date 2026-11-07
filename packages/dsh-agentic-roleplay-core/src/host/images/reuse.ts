import type { DecisionService } from '@dsh-ai-providers/core'
import type { Embedder } from '../memory/embedding-index.ts'
import { askExtra, noteExtra } from '../decisions/extras.ts'
import type { TurnStore } from '../orchestration/boundaries.ts'
import { listGallery } from './gallery.ts'
import { findImages } from './image-vectors.ts'

/** How many close candidates are put to the decision model, and how much of the moment it is shown. */
const CANDIDATES = 6
const MOMENT_CHARS = 1500

export interface ReuseJob {
  chat: string
  store: TurnStore
  /** The session's folder, where the pictures are. */
  root: string
  /** What the moment is, as the player read it. */
  moment: string
}

/**
 * Looks for a stored picture that shows the moment, before one is made (`decisions.reuse`): the close candidates by words and meaning, each put to the decision model with its description,
 * the first it says fits taken. A picture of the same place at another moment, or with something else in it, is what the decision model is told to refuse. Nothing is found without a
 * decision model; a failure is reported once and a picture is made as before.
 * @returns the path of the picture to show again, if there is one.
 */
export function pictureReuse(deps: { decisions?: () => DecisionService | undefined; embedder?: () => Embedder | undefined; problem?: (message: string) => void }): (job: ReuseJob, signal: AbortSignal) => Promise<string | undefined> {
  const seen = new Map<string, string>()
  return async (job, signal) => {
    const settings = job.store.settings()
    if (settings.decisions.reuse === 'off') return undefined
    const stored = (await listGallery(job.root)).filter(image => image.reusable && image.pending !== true && (image.description ?? '').trim() !== '')
    if (stored.length === 0) return undefined
    const { matches } = await findImages(job.root, stored, { text: job.moment, limit: CANDIDATES }, deps.embedder?.(), signal)
    if (matches.length === 0) return undefined
    const asks = matches.map(({ image }, index) => ({ key: `picture${index}`, instructions: job.store.text('roleplay/decide-reuse', { description: image.description!.trim() }) }))
    const { found, report } = await askExtra(deps.decisions?.(), { moment: job.moment.slice(0, MOMENT_CHARS) }, asks, settings.decisions.gateThreshold, signal)
    noteExtra('reuse', job.chat, job.store, report, seen, deps.problem)
    const first = found[0]
    return first === undefined ? undefined : matches[Number(first.slice('picture'.length))]!.image.path
  }
}

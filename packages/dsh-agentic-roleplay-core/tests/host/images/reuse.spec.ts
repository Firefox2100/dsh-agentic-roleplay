import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DecisionService } from '@dsh-ai-providers/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DecisionSite, SiteReport } from '../../../src/shared/decisions.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { updateImage } from '../../../src/host/images/gallery.ts'
import { addToLibrary } from '../../../src/host/images/library.ts'
import { pictureReuse } from '../../../src/host/images/reuse.ts'

const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC', 'base64')
const GREEN = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQOyEHAAIMAQUtuDZBAAAAAElFTkSuQmCC', 'base64')
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/TG0wpQAAAABJRU5ErkJggg==', 'base64')

let root: string
let recorded: { site: DecisionSite; report: SiteReport }[]
let asked: string[][]
const signal = new AbortController().signal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reuse-'))
  recorded = []
  asked = []
  for (const [name, bytes, description] of [['bar.png', RED, 'A woman leans on the wooden counter of a smoky inn bar beside an open filing cabinet.'], ['square.png', GREEN, 'A stone monument in a crowded town square at dusk with lanterns.'], ['pending.png', BLUE, 'A foggy harbour pier at night.']] as const) {
    const path = await addToLibrary(root, bytes, name)
    if (name !== 'pending.png') await updateImage(root, path, { description })
  }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const store = (reuse: 'off' | 'on'): TurnStore => ({
  settings: () => ({ ...DEFAULT_SETTINGS, decisions: { ...DEFAULT_SETTINGS.decisions, reuse } }),
  text: (_id: string, variables: Record<string, string> = {}) => `Does it show this moment? ${variables['description']}`,
  recordDecisions: (site: DecisionSite, report: SiteReport) => { recorded.push({ site, report }) },
}) as unknown as TurnStore

/** A decision service that says yes to the pictures whose description holds the word. */
const deciding = (word: string): DecisionService => ({
  decide: async (_state: unknown, questions: Record<string, { instructions: string }>) => {
    asked.push(Object.values(questions).map(question => question.instructions))
    return { answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, { type: 'noul', probability: question.instructions.includes(word) ? 0.95 : 0.05 }])), model: 'decide-1' }
  },
}) as unknown as DecisionService

const reuse = (service?: DecisionService, problems: string[] = []) => pictureReuse({ ...service === undefined ? {} : { decisions: () => service }, problem: message => { problems.push(message) } })
const job = (mode: 'off' | 'on', moment = 'Arthur leans on the bar next to the open filing cabinet, watching Clara.') => ({ chat: 'c', store: store(mode), root, moment })

describe('showing a stored picture instead of making one', () => {
  it('does nothing while it is off', async () => {
    expect(await reuse(deciding('counter'))(job('off'), signal)).toBeUndefined()
    expect(asked).toEqual([])
  })

  it('takes the stored picture the decision model says shows the moment', async () => {
    expect(await reuse(deciding('counter'))(job('on'), signal)).toBe('library/bar.png')
    expect(asked[0]!.some(question => question.includes('monument'))).toBe(false)
    expect(recorded.map(entry => entry.site)).toEqual(['reuse'])
  })

  it('takes none when no description fits, and never asks about a picture that is not described yet', async () => {
    expect(await reuse(deciding('never-written'))(job('on', 'Arthur crosses the harbour pier in the fog.'), signal)).toBeUndefined()
    expect(asked.flat().join(' ')).not.toContain('harbour pier')
  })

  it('makes a picture as before, and says so once, when there is no decision model', async () => {
    const problems: string[] = []
    expect(await reuse(undefined, problems)(job('on'), signal)).toBeUndefined()
    expect(recorded[0]!.report.problem).toBeDefined()
  })
})

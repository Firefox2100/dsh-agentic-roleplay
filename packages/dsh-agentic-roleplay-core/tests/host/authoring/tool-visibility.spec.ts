import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupOf, visible, worldFacts, type ToolGroup, type WorldFacts } from '../../../src/host/authoring/tool-visibility.ts'
import { importTools } from '../../../src/host/import/tools.ts'
import { cardTools } from '../../../src/host/import/card-tools.ts'
import { updateTools } from '../../../src/host/import/update-tools.ts'
import { presetTools } from '../../../src/host/import/preset-tools.ts'
import { AuthoredWorldReader, authoredWorldReadTools } from '../../../src/host/authoring/read-tools.ts'
import { authoredWorldWriteTools } from '../../../src/host/authoring/write-tools.ts'
import { AuthoringLanguages } from '../../../src/host/worlds/authoring-language.ts'
import type { ToolHiding } from '../../../src/shared/authoring-settings.ts'

const facts = (over: Partial<WorldFacts> = {}): WorldFacts => ({ card: false, update: false, preset: false, phase: undefined, reviewing: false, ...over })
const GROUPS: ToolGroup[] = ['import', 'card', 'update', 'preset', 'write']
const offered = (hiding: ToolHiding, state: WorldFacts): ToolGroup[] => GROUPS.filter(group => visible(group, hiding, state))

describe('which tools of the authoring chat are offered', () => {
  it('offers everything when hiding is off', () => {
    expect(offered('off', facts())).toEqual(GROUPS)
  })

  it('by default only leaves out the card tools of a world that has no card', () => {
    expect(offered('card', facts())).toEqual(['write'])
    expect(offered('card', facts({ card: true, phase: 'done' }))).toEqual(['import', 'card', 'update', 'preset', 'write'])
    expect(offered('card', facts({ preset: true }))).toEqual(['preset', 'write'])
  })

  it('offers the import tools while a card is imported, and the writing tools only once it is written', () => {
    for (const phase of ['ready', 'surveyed', 'built'] as const) expect(offered('phase', facts({ card: true, phase })), phase).toEqual(['import', 'card', 'preset'])
    expect(offered('phase', facts({ card: true, phase: 'repair' }))).toEqual(['import', 'card', 'preset', 'write'])
  })

  it('keeps the import tools for the review turn after the finish and takes them away when it ends', () => {
    expect(offered('phase', facts({ card: true, phase: 'done', reviewing: true }))).toEqual(['import', 'card', 'preset', 'write'])
    expect(offered('phase', facts({ card: true, phase: 'done' }))).toEqual(['card', 'preset', 'write'])
  })

  it('offers the update tools and the writing tools while a newer card waits, whatever the phase', () => {
    expect(offered('phase', facts({ card: true, update: true, phase: 'done' }))).toEqual(['card', 'update', 'preset', 'write'])
    expect(visible('write', 'phase', facts({ card: true, update: true, phase: 'built' }))).toBe(true)
  })

  it('treats a world with no card as plain whatever the mode', () => {
    expect(offered('phase', facts())).toEqual(['write'])
  })

  it('reads the facts of a world from its import folder', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'visibility-'))
    try {
      expect(await worldFacts(directory)).toEqual(facts())
      await mkdir(join(directory, '.import', 'update'), { recursive: true })
      await writeFile(join(directory, '.import', 'card.json'), '{}')
      await writeFile(join(directory, '.import', 'update', 'card.json'), '{}')
      await writeFile(join(directory, '.import', 'state.json'), JSON.stringify({ phase: 'done', reviewing: true }))
      expect(await worldFacts(directory)).toEqual(facts({ card: true, update: true, phase: 'done', reviewing: true }))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('the groups name the tools that exist', () => {
  it('has every tool of a group registered, and no other tool in it', () => {
    const worlds = {} as never
    const settings = (() => ({})) as never
    const prompting = {} as never
    const reader = new AuthoredWorldReader(worlds)
    const all = [
      ...authoredWorldReadTools(reader), ...authoredWorldWriteTools(reader),
      ...importTools(worlds, settings, prompting), ...cardTools(worlds), ...updateTools(worlds), ...presetTools(worlds, settings, prompting),
    ]
    const grouped = all.filter(tool => groupOf(tool.name) !== undefined).map(tool => `${groupOf(tool.name)}:${tool.name}`)
    expect(grouped.filter(each => each.startsWith('import:')).length).toBe(9)
    expect(grouped.filter(each => each.startsWith('card:')).length).toBe(4)
    expect(grouped.filter(each => each.startsWith('update:')).length).toBe(2)
    expect(grouped.filter(each => each.startsWith('preset:')).length).toBe(1)
    expect(grouped.filter(each => each.startsWith('write:')).length).toBe(9)
    expect(all.filter(tool => tool.name.startsWith('import_') || tool.name.startsWith('card_')).filter(tool => groupOf(tool.name) === undefined).map(tool => tool.name)).toEqual([])
  })
})

describe('the setting that chooses it', () => {
  let folder: string
  beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'hiding-')) })
  afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

  it('defaults to leaving out the card tools of a world without a card, and keeps the language and the conversation beside it', () => {
    const store = new AuthoringLanguages(new Context(), () => folder)
    expect(store.toolHiding('w')).toBe('card')
    store.set('w', 'zh')
    store.change('w', { toolHiding: 'off' })
    store.advance('w')
    expect(store.settings('w')).toEqual({ toolHiding: 'off', keepResultTurns: 2 })
    store.change('w', { keepResultTurns: 0 })
    expect(store.settings('w')).toEqual({ toolHiding: 'off', keepResultTurns: 0 })
    expect(store.get('w')).toBe('zh')
    expect(store.generation('w')).toBe(2)
  })
})

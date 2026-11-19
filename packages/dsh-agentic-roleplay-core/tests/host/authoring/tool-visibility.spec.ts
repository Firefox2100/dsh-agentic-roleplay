import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupOf, registerWithVisibility, visible, worldFacts, type ToolGroup, type WorldFacts } from '../../../src/host/authoring/tool-visibility.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
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
    expect(grouped.filter(each => each.startsWith('write:')).length).toBe(13)
    expect(all.filter(tool => tool.name.startsWith('import_') || tool.name.startsWith('card_')).filter(tool => groupOf(tool.name) === undefined).map(tool => tool.name)).toEqual([])
  })
})

describe('the condition DSH asks for at every step', () => {
  const chat = authoringChatSessionId('harbor')
  const agent = (id: string, origin: 'user' | 'subagent' = 'user') => ({ session: { id, header: { origin } } })
  const made = (hiding: ToolHiding, directory: () => Promise<string | undefined>) => {
    const registered: { name: string; when?: (input: { agent: unknown }) => Promise<boolean> }[] = []
    const ctx = { tools: { register: (tool: { name: string }, options?: { when?: (input: { agent: unknown }) => Promise<boolean> }) => { registered.push(options?.when === undefined ? { name: tool.name } : { name: tool.name, when: options.when }) } } } as never
    registerWithVisibility(ctx, [{ name: 'import_status' }, { name: 'list_worlds' }] as never, { worldDirectory: directory, hiding: () => hiding })
    return registered
  }

  it('offers a tool of a group to a subagent and to a chat that is not an authoring chat', async () => {
    const registered = made('card', async () => '/nowhere')
    const when = registered[0]?.when
    expect(when, 'a tool of a group is offered only when it is of use').toBeDefined()
    expect(await when!({ agent: agent(chat, 'subagent') })).toBe(true)
    expect(await when!({ agent: agent('session-00000000-0000-4000-8000-000000000000') })).toBe(true)
    expect(registered[1]?.when, 'a tool of no group is offered without a condition').toBeUndefined()
  })

  it('offers every tool when the setting is off, and everything of a world that is gone', async () => {
    const off = made('off', async () => undefined)
    expect(await off[0]?.when!({ agent: agent(chat) })).toBe(true)
    const phased = made('phase', async () => undefined)
    expect(await phased[0]?.when!({ agent: agent(chat) })).toBe(true)
  })

  it('follows the import of the world, and reads its facts once for the step rather than once for each tool', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'when-'))
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(1_000)
      const registered = made('card', async () => directory)
      const when = registered[0]!.when!
      expect(await when({ agent: agent(chat) }), 'a world with no card leaves out the import tools').toBe(false)
      await mkdir(join(directory, '.import'), { recursive: true })
      await writeFile(join(directory, '.import', 'card.json'), '{}')
      expect(await when({ agent: agent(chat) }), 'the card that appeared is seen at the next step').toBe(false)
      now.mockReturnValue(1_000 + 400)
      expect(await when({ agent: agent(chat) })).toBe(true)
    } finally {
      now.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('says so when the import folder cannot be looked into', async () => {
    vi.resetModules()
    vi.doMock('node:fs/promises', async importOriginal => {
      const real = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...real,
        stat: async (path: string) => {
          if (path.endsWith('card.json')) {
            const error = new Error(`EACCES: permission denied, stat '${path}'`) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return await real.stat(path)
        },
      }
    })
    try {
      const { worldFacts: fresh } = await import('../../../src/host/authoring/tool-visibility.ts')
      await expect(fresh('/world'), 'a folder that cannot be read is not a folder that is not there').rejects.toThrow(/EACCES/)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
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

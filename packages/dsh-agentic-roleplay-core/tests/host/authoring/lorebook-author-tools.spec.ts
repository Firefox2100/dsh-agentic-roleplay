import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LorebookReader, lorebookApproval, lorebookAuthorTools, pendingTargets } from '../../../src/host/authoring/lorebook-author-tools.ts'
import { createLorebook, lorebookDirectory } from '../../../src/host/lorebooks/lorebooks.ts'
import { loadPreset } from '../../../src/host/presets/presets.ts'
import { lorebookChatSessionId, lorebookOfChat } from '../../../src/shared/lorebook-chat.ts'
import { presetChatSessionId } from '../../../src/shared/preset-chat.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'lorebook-author-')); await createLorebook(root, { name: 'harbor', title: 'Harbor' }) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const prompting = { prompts: () => { throw new Error('no prompts here') }, languages: () => { throw new Error('no languages here') } } as never
const tools = (chat = lorebookChatSessionId('harbor')) => {
  const all = new Map(lorebookAuthorTools(new LorebookReader(() => root), () => { throw new Error('no settings') }, prompting).map(tool => [tool.name, tool]))
  return (name: string, args: Record<string, unknown>) => (all.get(name) as unknown as { execute(args: unknown, exec: unknown): Promise<unknown> }).execute(args, { agent: { session: { id: chat } } })
}
const exec = (name: string, args: Record<string, unknown> = {}, chat = lorebookChatSessionId('harbor')) => ({ name, arguments: args, agent: { session: { id: chat } } }) as never
const entry = { id: 'tides', title: 'Tides', kind: 'geography', scope: 'everyone', body: 'Twice a day.' }

describe('the lorebook chat identity', () => {
  it('round trips a name and refuses chats that are not lorebook chats', () => {
    expect(lorebookOfChat(lorebookChatSessionId('harbor-2'))).toBe('harbor-2')
    expect(lorebookOfChat(presetChatSessionId('noir'))).toBeUndefined()
    expect(lorebookOfChat('session-1')).toBeUndefined()
  })
})

describe('the tools of lorebook authoring', () => {
  it('write an entry, list it without its text, read it back and remove it into the trash', async () => {
    const call = tools()
    await call('write_lorebook_entry', entry)
    expect(await call('list_lorebook_entries', {})).toEqual([{ id: 'tides', title: 'Tides', kind: 'geography', scope: 'everyone', knownBy: [], summary: '', related: [], characters: 12 }])
    expect(await call('read_lorebook_entry', { id: 'tides' })).toMatchObject({ body: 'Twice a day.' })
    expect(await call('read_lorebook_info', {})).toMatchObject({ name: 'harbor', entries: 1, common: 1, waitingGuidance: [] })
    await call('delete_lorebook_entry', { id: 'tides' })
    expect(existsSync(join(lorebookDirectory(root, 'harbor'), '.trash', 'lore'))).toBe(true)
    await expect(call('read_lorebook_entry', { id: 'tides' })).rejects.toThrow('no entry')
  })

  it('refuse an entry a story start would refuse, and a chat that is not the lorebook\'s', async () => {
    const call = tools()
    await expect(call('write_lorebook_entry', { ...entry, kind: 'nonsense' })).rejects.toThrow('must be one')
    await expect(call('write_lorebook_entry', { ...entry, related: ['ghost'] })).rejects.toThrow('not (other) entries')
    await expect(tools(presetChatSessionId('noir'))('list_lorebook_entries', {})).rejects.toThrow('only in a lorebook authoring chat')
    await expect(tools(lorebookChatSessionId('other'))('list_lorebook_entries', {})).rejects.toThrow('no longer exists')
  })

  it('change the title and description', async () => {
    expect(await tools()('write_lorebook_info', { description: 'The harbor.' })).toMatchObject({ summary: { title: 'Harbor', description: 'The harbor.' } })
  })

  it('make a preset of the waiting guidance on top of the shipped prompts, in every language, and clear what waited', async () => {
    const waiting = join(lorebookDirectory(root, 'harbor'), '.import')
    await mkdir(waiting, { recursive: true })
    await writeFile(join(waiting, 'steering.json'), JSON.stringify({ source: 'Harbor book', guidance: { 'roleplay/style': ['Write in the present tense.'], 'roleplay/game-master': ['Never skip a night.'] } }))
    const call = tools()
    expect(await call('read_lorebook_info', {})).toMatchObject({ waitingGuidance: ['roleplay/style', 'roleplay/game-master'] })
    expect(pendingTargets(lorebookDirectory(root, 'harbor'))).toEqual({ ids: ['roleplay/style', 'roleplay/game-master'], rules: true })
    const made = await call('apply_steering', {}) as { preset: string; rules: string[] }
    expect(made).toMatchObject({ preset: 'harbor', rules: ['roleplay/game-master'] })
    const preset = loadPreset(root, 'harbor')
    expect(preset.summary).toMatchObject({ title: 'Harbor book', languages: ['en', 'zh'], rules: ['roleplay/game-master'], problems: [] })
    const style = preset.files.get('en/roleplay/style.md')!
    expect(style.startsWith('Write the narration')).toBe(true)
    expect(style).toContain('Write in the present tense.')
    expect(preset.files.get('en/roleplay/game-master.md')).toContain('${')
    expect(existsSync(join(waiting, 'steering.json'))).toBe(false)
    await expect(call('apply_steering', {})).rejects.toThrow('no guidance waiting')
  })

  it('refuses a name for the preset that is taken, and leaves the guidance waiting', async () => {
    const waiting = join(lorebookDirectory(root, 'harbor'), '.import')
    await mkdir(waiting, { recursive: true })
    await writeFile(join(waiting, 'steering.json'), JSON.stringify({ source: 'B', guidance: { 'roleplay/style': ['Be brief.'] } }))
    const call = tools()
    await call('apply_steering', { preset: 'brief' })
    await expect(call('apply_steering', { preset: 'brief' })).rejects.toThrow('no guidance waiting')
    await writeFile(join(waiting, 'steering.json'), JSON.stringify({ source: 'B', guidance: { 'roleplay/style': ['Be brief.'] } }))
    await expect(call('apply_steering', { preset: 'brief' })).rejects.toThrow('already a preset')
    expect(existsSync(join(waiting, 'steering.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'presets', 'brief', 'preset.json'), 'utf8'))).toMatchObject({ title: 'B' })
  })
})

describe('approving changes to a lorebook', () => {
  const state = (carries: boolean, waiting = { ids: ['roleplay/style'], rules: false }) => ({ carries: () => carries, waiting: () => waiting })

  it('asks for every write and removal in a lorebook chat, and leaves reading alone', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await expect(lorebookApproval(exec('write_lorebook_entry', { id: 'tides' }), next, state(true))).resolves.toMatchObject({ kind: 'ask', reason: 'write lorebook entry “tides”' })
    await expect(lorebookApproval(exec('delete_lorebook_entry', { id: 'tides' }), next, state(true))).resolves.toMatchObject({ kind: 'ask', reason: 'delete lorebook entry “tides”' })
    await expect(lorebookApproval(exec('write_lorebook_info', {}), next, state(true))).resolves.toMatchObject({ kind: 'ask' })
    expect(next).not.toHaveBeenCalled()
    await lorebookApproval(exec('read_lorebook_entry', {}), next, state(true))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('asks before an import adds to entries, and not when the lorebook has none yet', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await expect(lorebookApproval(exec('import_lorebook', {}), next, state(true))).resolves.toMatchObject({ kind: 'ask' })
    await expect(lorebookApproval(exec('import_lorebook', {}), next, state(false))).resolves.toEqual({ kind: 'allow' })
  })

  it('warns when the guidance goes into prompts that hold rules of the game', async () => {
    const next = vi.fn()
    const plain = await lorebookApproval(exec('apply_steering', {}), next, state(true))
    expect(plain).toMatchObject({ kind: 'ask' })
    expect(JSON.stringify(plain)).not.toContain('WARNING')
    const rules = await lorebookApproval(exec('apply_steering', {}), next, state(true, { ids: ['roleplay/style', 'roleplay/game-master'], rules: true }))
    expect(rules).toMatchObject({ kind: 'ask', displayReason: { en: expect.stringContaining('WARNING'), zh: expect.stringContaining('警告') } })
    expect(next).not.toHaveBeenCalled()
  })

  it('does not touch the chats of presets', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await lorebookApproval(exec('write_lorebook_entry', {}, presetChatSessionId('noir')), next, state(true))
    expect(next).toHaveBeenCalledTimes(1)
  })
})

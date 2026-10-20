import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresetReader, presetApproval, presetAuthorTools } from '../../../src/host/authoring/preset-author-tools.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { createPresetFromShipped, presetDirectory } from '../../../src/host/presets/presets.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { presetChatSessionId, presetOfChat } from '../../../src/shared/preset-chat.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'preset-author-')); await createPresetFromShipped(root, { name: 'noir', title: 'Noir' }) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const prompting = { prompts: () => { throw new Error('no prompts here') }, languages: () => { throw new Error('no languages here') } } as never
const tools = (chat = presetChatSessionId('noir')) => {
  const all = new Map(presetAuthorTools(new PresetReader(() => root), () => { throw new Error('no settings') }, prompting).map(tool => [tool.name, tool]))
  return (name: string, args: Record<string, unknown>) => (all.get(name) as unknown as { execute(args: unknown, exec: unknown): Promise<unknown> }).execute(args, { agent: { session: { id: chat } } })
}
const exec = (name: string, args: Record<string, unknown> = {}, chat = presetChatSessionId('noir')) => ({ name, arguments: args, agent: { session: { id: chat } } }) as never

describe('the preset chat identity', () => {
  it('round trips a name and refuses chats that are not preset chats', () => {
    expect(presetOfChat(presetChatSessionId('noir-2'))).toBe('noir-2')
    expect(presetOfChat(authoringChatSessionId('harbor'))).toBeUndefined()
    expect(presetOfChat('session-1')).toBeUndefined()
  })
})

describe('the tools of preset authoring', () => {
  it('start a new preset from the shipped prose prompts and list what it carries', async () => {
    const call = tools()
    const listed = await call('list_preset_prompts', { language: 'en' }) as { id: string; kind: string; carried: boolean }[]
    expect(listed.filter(entry => entry.carried).map(entry => entry.id).sort()).toEqual(['roleplay/character-style', 'roleplay/persona', 'roleplay/style'])
    expect(listed.find(entry => entry.id === 'roleplay/game-master')).toMatchObject({ kind: 'rules', carried: false })
    expect(await call('read_preset_info', {})).toMatchObject({ name: 'noir', title: 'Noir', languages: ['en', 'zh'], problems: [] })
  })

  it('write a prompt, read it back, and move a removed one into the preset\'s trash', async () => {
    const call = tools()
    await call('write_preset_prompt', { id: 'roleplay/style', language: 'en', text: 'Terse and dry.' })
    expect(await call('read_preset_prompt', { id: 'roleplay/style', language: 'en' })).toMatchObject({ carried: true, text: 'Terse and dry.\n' })
    await call('delete_preset_prompt', { id: 'roleplay/style', language: 'en' })
    expect(existsSync(join(presetDirectory(root, 'noir'), 'prompts', 'en', 'roleplay', 'style.md'))).toBe(false)
    expect(await call('read_preset_prompt', { id: 'roleplay/style', language: 'en' })).toMatchObject({ carried: false })
  })

  it('refuse text a story start would refuse and prompts that are not the story\'s', async () => {
    const call = tools()
    await expect(call('write_preset_prompt', { id: 'roleplay/style', language: 'en', text: '  ' })).rejects.toThrow('empty')
    await expect(call('write_preset_prompt', { id: 'roleplay/style', language: 'en', text: 'Uses ${nothing}.' })).rejects.toThrow('${nothing}')
    await expect(call('write_preset_prompt', { id: 'world/author', language: 'en', text: 'x' })).rejects.toThrow('not a prompt of the story')
  })

  it('change the title, description and temperatures, and refuse what is not acceptable without writing', async () => {
    const call = tools()
    await call('write_preset_info', { description: 'Dry.', sampling: { master: 0.9 } })
    expect(JSON.parse(await readFile(join(presetDirectory(root, 'noir'), 'preset.json'), 'utf8'))).toEqual({ title: 'Noir', description: 'Dry.', sampling: { master: 0.9 } })
    await expect(call('write_preset_info', { sampling: { records: 0.1 } })).rejects.toThrow('records')
    await expect(call('write_preset_info', { sampling: { master: 7 } })).rejects.toThrow('0 to 2')
    expect(JSON.parse(await readFile(join(presetDirectory(root, 'noir'), 'preset.json'), 'utf8')).sampling).toEqual({ master: 0.9 })
  })

  it('reach only the preset of their own chat', async () => {
    await expect(tools(authoringChatSessionId('harbor'))('read_preset_info', {})).rejects.toThrow('only in a preset authoring chat')
    await expect(tools(presetChatSessionId('gone'))('read_preset_info', {})).rejects.toThrow('no longer exists')
  })

  it('take an uploaded file only from the import folder', async () => {
    await mkdir(join(presetDirectory(root, 'noir'), '.import'), { recursive: true })
    await writeFile(join(presetDirectory(root, 'noir'), '.import', 'preset.json'), '{}')
    await expect(tools()('import_narration_preset', { file: '../x.json' })).rejects.toThrow('.import/preset.json')
  })
})

describe('the approval gate of preset authoring', () => {
  it('asks for every write and removal in a preset chat, and leaves reading alone', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await expect(presetApproval(exec('write_preset_prompt', { language: 'en', id: 'roleplay/style' }), next, () => true)).resolves.toMatchObject({ kind: 'ask', reason: 'write preset prompt “en/roleplay/style”' })
    await expect(presetApproval(exec('delete_preset_prompt', { language: 'zh', id: 'roleplay/persona' }), next, () => true)).resolves.toMatchObject({ kind: 'ask', reason: 'delete preset prompt “zh/roleplay/persona”' })
    await expect(presetApproval(exec('write_preset_info', { title: 'x' }), next, () => true)).resolves.toMatchObject({ kind: 'ask' })
    expect(next).not.toHaveBeenCalled()
    await presetApproval(exec('read_preset_prompt', {}), next, () => true)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('warns when the prompt is rules of the game, not prose', async () => {
    const next = vi.fn()
    const decision = await presetApproval(exec('write_preset_prompt', { language: 'en', id: 'roleplay/rules' }), next, () => true)
    expect(decision).toMatchObject({ kind: 'ask', displayReason: { en: expect.stringContaining('WARNING') } })
    await tools()('write_preset_prompt', { id: 'roleplay/rules', language: 'en', text: 'Stay in the scene.\n${rules}' })
    expect(next).not.toHaveBeenCalled()
  })

  it('asks before an import replaces prompts, and not when the preset has none yet', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await expect(presetApproval(exec('import_narration_preset', {}), next, () => true)).resolves.toMatchObject({ kind: 'ask' })
    await expect(presetApproval(exec('import_narration_preset', {}), next, () => false)).resolves.toEqual({ kind: 'allow' })
  })

  it('does not touch the chats of worlds', async () => {
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await presetApproval(exec('write_preset_prompt', {}, authoringChatSessionId('harbor')), next, () => true)
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('the prompts of the preset authoring chat', () => {
  it.each(['en', 'zh'])('render in %s with the one value they are given', (language) => {
    expect(shippedText('preset/welcome', language, { preset: 'Noir' })).toContain('Noir')
    expect(shippedText('preset/persona', language)).not.toBe('')
    expect(shippedText('preset/procedure', language)).not.toBe('')
  })
})

describe('the prompts of the lorebook authoring chat', () => {
  it.each(['en', 'zh'])('render in %s with the one value they are given', (language) => {
    expect(shippedText('lorebook/welcome', language, { lorebook: 'Harbor' })).toContain('Harbor')
    expect(shippedText('lorebook/persona', language)).not.toBe('')
    expect(shippedText('lorebook/procedure', language)).not.toBe('')
    expect(shippedText('import/lorebook', language)).not.toBe('')
  })
})

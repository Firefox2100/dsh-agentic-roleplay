import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worldPromptTools } from '../../../src/host/authoring/prompt-tools.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'world-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const tools = () => {
  const reader = { read: () => Promise.resolve({ record: { directory } }) } as never
  const all = new Map(worldPromptTools(reader).map(tool => [tool.name, tool]))
  return (name: string, args: Record<string, unknown>) => (all.get(name) as unknown as { execute(args: unknown, exec: unknown): Promise<unknown> }).execute(args, { agent: { session: { id: 'x' } } })
}
const exec = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: authoringChatSessionId('harbor') } } }) as never

describe('the prompt tools of world authoring', () => {
  it('lists the prompts of the story with their kind and whether the world carries them', async () => {
    const call = tools()
    await call('write_world_prompt', { id: 'roleplay/style', language: 'en', text: 'Write like a noir narrator.' })
    const listed = await call('list_world_prompts', { language: 'en' }) as { id: string; kind: string; carried: boolean }[]
    expect(listed.find(entry => entry.id === 'roleplay/style')).toEqual({ id: 'roleplay/style', kind: 'prose', carried: true })
    expect(listed.find(entry => entry.id === 'roleplay/game-master')).toEqual({ id: 'roleplay/game-master', kind: 'rules', carried: false })
    expect(listed.some(entry => entry.id.startsWith('import/'))).toBe(false)
  })

  it('reads the carried version, or the shipped text when there is none', async () => {
    const call = tools()
    expect(await call('read_world_prompt', { id: 'roleplay/style', language: 'en' })).toMatchObject({ carried: false, text: expect.stringContaining('plain, concrete prose') })
    await call('write_world_prompt', { id: 'roleplay/style', language: 'en', text: 'Noir.' })
    expect(await call('read_world_prompt', { id: 'roleplay/style', language: 'en' })).toMatchObject({ carried: true, text: 'Noir.\n' })
  })

  it('refuses text that session start would refuse, and prompts that are not the story\'s', async () => {
    const call = tools()
    await expect(call('write_world_prompt', { id: 'roleplay/style', language: 'en', text: '  ' })).rejects.toThrow('empty')
    await expect(call('write_world_prompt', { id: 'roleplay/character-style', language: 'en', text: 'Hi ${who}.' })).rejects.toThrow('${who}')
    await expect(call('write_world_prompt', { id: 'roleplay/nothing', language: 'en', text: 'x' })).rejects.toThrow('no prompt')
    await expect(call('write_world_prompt', { id: 'import/classifier', language: 'en', text: 'x' })).rejects.toThrow('not a prompt of the story')
    expect(existsSync(join(directory, 'prompts'))).toBe(false)
  })

  it('moves a deleted prompt into the trash', async () => {
    const call = tools()
    await call('write_world_prompt', { id: 'roleplay/style', language: 'en', text: 'Noir.' })
    await call('delete_world_prompt', { id: 'roleplay/style', language: 'en' })
    expect(existsSync(join(directory, 'prompts', 'en', 'roleplay', 'style.md'))).toBe(false)
    expect((await readdir(join(directory, '.trash', 'prompts', 'en', 'roleplay')))).toHaveLength(1)
    expect(await readFile(join(directory, '.trash', 'prompts', 'en', 'roleplay', (await readdir(join(directory, '.trash', 'prompts', 'en', 'roleplay')))[0]!), 'utf8')).toBe('Noir.\n')
  })
})

describe('the approval of prompt changes', () => {
  it('asks the person for any prompt in an authoring chat', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('write_world_prompt', { id: 'roleplay/game-master', language: 'zh' }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'write authored world prompt “zh/roleplay/game-master”' })
    await expect(authoringApproval(exec('delete_world_prompt', { id: 'roleplay/style', language: 'en' }), next)).resolves.toMatchObject({ kind: 'ask' })
    expect(next).not.toHaveBeenCalled()
  })

  it('lets an import write the prose prompts without asking, and refuses the rules', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('write_world_prompt', { id: 'roleplay/style', language: 'en' }), next, () => Promise.resolve(true))).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('write_world_prompt', { id: 'roleplay/character-rules', language: 'en' }), next, () => Promise.resolve(true))).resolves.toMatchObject({ kind: 'deny' })
    await expect(authoringApproval(exec('delete_world_prompt', { id: 'roleplay/game-master', language: 'en' }), next, () => Promise.resolve(true))).resolves.toMatchObject({ kind: 'deny' })
    expect(next).toHaveBeenCalledTimes(1)
  })
})

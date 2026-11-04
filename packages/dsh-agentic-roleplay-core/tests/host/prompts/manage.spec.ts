import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrary } from '../../../src/host/prompts/library.ts'
import { PromptEditError, PromptManager } from '../../../src/host/prompts/manage.ts'

let root: string
let shipped: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'prompt-manage-'))
  shipped = await mkdtemp(join(tmpdir(), 'prompt-shipped-'))
  for (const language of ['en', 'zh']) await mkdir(join(shipped, language, 'a'), { recursive: true })
  await writeFile(join(shipped, 'en', 'a', 'greet.md'), 'Hello ${name}.\n')
  await writeFile(join(shipped, 'zh', 'a', 'greet.md'), '你好，${name}。\n')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(shipped, { recursive: true, force: true })
})

const make = () => {
  const library = new PromptLibrary(new Context(), { path: root } as never, shipped)
  return { library, manager: new PromptManager(library, () => new Date('2026-11-04T10:00:00Z')) }
}

describe('the prompts of the root', () => {
  it('list every shipped prompt in every language, marking those whose file differs, whoever changed it', async () => {
    const { library, manager } = make()
    library.bootstrap()
    expect(manager.list()).toEqual([{ id: 'a/greet', language: 'en', state: 'default' }, { id: 'a/greet', language: 'zh', state: 'default' }])
    await writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'Hi ${name}.\n')
    expect(manager.list().map(entry => `${entry.language}:${entry.state}`)).toEqual(['en:different', 'zh:default'])
    await writeFile(join(root, 'prompts', 'zh', 'a', 'greet.md'), '你好，${name}。\r\n\r\n')
    expect(manager.list()[1]?.state).toBe('default')
  })

  it('show the file beside the shipped text with the variables it is given, and treat a file that is not there as the shipped one', () => {
    const { manager } = make()
    expect(manager.read('a/greet', 'en')).toEqual({ id: 'a/greet', language: 'en', state: 'default', current: 'Hello ${name}.\n', shipped: 'Hello ${name}.\n', variables: ['name'] })
    expect(() => manager.read('a/none', 'en')).toThrow(PromptEditError)
    expect(() => manager.read('../a/greet', 'en')).toThrow(PromptEditError)
    expect(() => manager.read('a/greet', 'fr')).toThrow(PromptEditError)
  })

  it('save an edit that is used at once, and refuse a text that cannot be the prompt', async () => {
    const { library, manager } = make()
    expect(await manager.write('a/greet', 'en', 'Hi ${name}!')).toEqual({ id: 'a/greet', language: 'en', state: 'different' })
    expect(library.text('a/greet', 'en', { name: 'Ann' })).toBe('Hi Ann!')
    for (const text of ['', '  ', 'Hi ${other}', 'Hi {{user}}']) await expect(manager.write('a/greet', 'en', text)).rejects.toThrow(PromptEditError)
    await expect(manager.write('a/none', 'en', 'x')).rejects.toThrow(PromptEditError)
    expect(library.text('a/greet', 'en', { name: 'Ann' })).toBe('Hi Ann!')
  })

  it('put the shipped text back, keeping the edited file in the trash, and keep nothing when the file was the shipped text', async () => {
    const { manager } = make()
    await manager.write('a/greet', 'en', 'Hi ${name}!')
    expect(await manager.reset('a/greet', 'en')).toMatchObject({ state: 'default' })
    expect(await readFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'utf8')).toBe('Hello ${name}.\n')
    expect(await readFile(join(root, '.trash', 'prompts', '2026-11-04T10-00-00-000Z', 'en', 'a', 'greet.md'), 'utf8')).toBe('Hi ${name}!\n')
    await manager.reset('a/greet', 'en')
    expect(await readdir(join(root, '.trash', 'prompts'))).toHaveLength(1)
  })

  it('are not written while the folder is syncing', async () => {
    const { library, manager } = make()
    library.frozen = () => true
    await expect(manager.write('a/greet', 'en', 'Hi ${name}!')).rejects.toThrow(/being synced/)
  })
})

import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrary, languageOf, shippedPromptsDirectory } from '../../../src/host/prompts/library.ts'

let root: string
let shipped: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'prompts-'))
  shipped = await mkdtemp(join(tmpdir(), 'shipped-'))
  await mkdir(join(shipped, 'en', 'a'), { recursive: true })
  await mkdir(join(shipped, 'zh', 'a'), { recursive: true })
  await writeFile(join(shipped, 'en', 'a', 'greet.md'), 'Hello ${name}.\n')
  await writeFile(join(shipped, 'zh', 'a', 'greet.md'), '你好，${name}。\n')
  await writeFile(join(shipped, 'en', 'a', 'only-en.md'), 'Only English.\n')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(shipped, { recursive: true, force: true })
})

const library = (): PromptLibrary => new PromptLibrary(new Context(), { path: root } as never, shipped)

describe('the prompt library', () => {
  it('copies a prompt that is not in the root when it is needed, in the language asked', async () => {
    expect(library().text('a/greet', 'zh', { name: '小明' })).toBe('你好，小明。')
    expect(await readFile(join(root, 'prompts', 'zh', 'a', 'greet.md'), 'utf8')).toBe('你好，${name}。\n')
  })

  it('uses the file in the root once it is there, so that the person can edit it, and copies it again when it is deleted', async () => {
    const prompts = library()
    prompts.text('a/greet', 'en', { name: 'x' })
    await writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'Edited ${name}')
    expect(prompts.text('a/greet', 'en', { name: 'Ana' })).toBe('Edited Ana')
    await rm(join(root, 'prompts', 'en', 'a', 'greet.md'))
    expect(prompts.text('a/greet', 'en', { name: 'Ana' })).toBe('Hello Ana.')
  })

  it('falls back to English for a language or a prompt the package has none of', async () => {
    const prompts = library()
    expect(prompts.text('a/greet', 'fr', { name: 'Ana' })).toBe('Hello Ana.')
    expect(prompts.text('a/only-en', 'zh-CN')).toBe('Only English.')
    expect(await readdir(join(root, 'prompts', 'en', 'a'))).toContain('only-en.md')
  })

  it('writes everything that ships when asked to bootstrap', async () => {
    library().bootstrap()
    expect((await readdir(join(root, 'prompts', 'zh', 'a'))).sort()).toEqual(['greet.md'])
    expect((await readdir(join(root, 'prompts', 'en', 'a'))).sort()).toEqual(['greet.md', 'only-en.md'])
  })

  it('refuses what cannot be used: a variable without a value, an empty file, a bad id or language', async () => {
    const prompts = library()
    expect(() => prompts.text('a/greet', 'en')).toThrow(/uses \$\{name\}/)
    prompts.text('a/greet', 'en', { name: 'x' })
    await writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), '  \n')
    expect(() => prompts.text('a/greet', 'en', { name: 'x' })).toThrow(/is empty; delete it to restore/)
    expect(() => prompts.text('../x', 'en')).toThrow(/not a prompt id/)
    expect(() => languageOf('x y')).toThrow(/not a language/)
    expect(languageOf('zh-CN')).toBe('zh')
    expect(languageOf(undefined)).toBe('en')
  })
})

describe('the prompts that ship', () => {
  const files = async (language: string, directory = join(shippedPromptsDirectory(), language), prefix = ''): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => (entry.isDirectory() ? await files(language, join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])))).flat().sort()

  it('are the same set in every language, with the same variables', async () => {
    const english = await files('en')
    expect(await files('zh')).toEqual(english)
    const variables = async (language: string, file: string): Promise<string[]> => [...new Set((await readFile(join(shippedPromptsDirectory(), language, file), 'utf8')).match(/\$\{[A-Za-z]+\}/g) ?? [])].sort()
    for (const file of english) expect(await variables('zh', file), file).toEqual(await variables('en', file))
  })
})

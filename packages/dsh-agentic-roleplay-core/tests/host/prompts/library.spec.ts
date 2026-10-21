import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrary, copyWorldPrompts, languageOf, shippedPromptsDirectory } from '../../../src/host/prompts/library.ts'

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

describe('checking the edited files in the root', () => {
  it('finds nothing wrong with the files as shipped, nor with an edit that keeps to the variables', async () => {
    const prompts = library()
    prompts.bootstrap()
    expect(prompts.problems()).toEqual([])
    await writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'Good evening, ${name}, welcome.\n')
    expect(prompts.problems()).toEqual([])
  })

  it('reports every file that is empty, uses a variable it is not given, or holds a variable of DSH, and leaves files nothing reads', async () => {
    const prompts = library()
    prompts.bootstrap()
    await writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'Hello ${nobody}.\n')
    await writeFile(join(root, 'prompts', 'zh', 'a', 'greet.md'), '你好，{{user}}。\n')
    await writeFile(join(root, 'prompts', 'en', 'a', 'only-en.md'), '\n')
    await writeFile(join(root, 'prompts', 'en', 'a', 'mine.md'), 'Not shipped ${anything}.\n')
    const found = prompts.problems().map(problem => [problem.path.slice(root.length), problem.message])
    expect(found).toHaveLength(3)
    expect(found).toContainEqual(['/prompts/en/a/greet.md', expect.stringContaining('${nobody}')])
    expect(found).toContainEqual(['/prompts/zh/a/greet.md', expect.stringContaining('{{')])
    expect(found).toContainEqual(['/prompts/en/a/only-en.md', 'the prompt is empty'])
  })

  it('has nothing to check before the folder exists', () => {
    expect(library().problems()).toEqual([])
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

describe('prompts of a session and of a world', () => {
  const session = '3f2b1c9e-8a47-4d5e-9b1a-0c6d7e8f9a10'
  const folder = (): string => join(root, 'sessions', session)

  it('uses the file of the session in its language, and the root for every prompt it does not carry', async () => {
    const prompts = library()
    await mkdir(join(folder(), 'prompts', 'en', 'a'), { recursive: true })
    await writeFile(join(folder(), 'prompts', 'en', 'a', 'greet.md'), 'Own ${name}.')
    expect(prompts.text('a/greet', 'en', { name: 'Ana' }, session)).toBe('Own Ana.')
    expect(prompts.text('a/greet', 'zh', { name: 'Ana' }, session)).toBe('你好，Ana。')
    expect(prompts.text('a/only-en', 'en', {}, session)).toBe('Only English.')
    expect(prompts.text('a/greet', 'en', { name: 'Ana' })).toBe('Hello Ana.')
  })

  it('refuses an empty file in the session', async () => {
    await mkdir(join(folder(), 'prompts', 'en', 'a'), { recursive: true })
    await writeFile(join(folder(), 'prompts', 'en', 'a', 'greet.md'), '\n')
    expect(() => library().text('a/greet', 'en', { name: 'Ana' }, session)).toThrow('is empty')
  })

  it('drops a line that holds only an optional part given as empty text', () => {
    const prompts = library()
    prompts.text('a/greet', 'en', { name: 'x' })
    return writeFile(join(root, 'prompts', 'en', 'a', 'greet.md'), 'One\n${part}\nTwo').then(() => {
      expect(prompts.text('a/greet', 'en', { part: '' })).toBe('One\nTwo')
      expect(prompts.text('a/greet', 'en', { part: 'Middle' })).toBe('One\nMiddle\nTwo')
    })
  })

  describe('copying the prompts a world carries', () => {
    const world = async (files: Record<string, string>): Promise<string> => {
      const directory = await mkdtemp(join(tmpdir(), 'world-'))
      for (const [path, text] of Object.entries(files)) { await mkdir(join(directory, 'prompts', path, '..'), { recursive: true }); await writeFile(join(directory, 'prompts', path), text) }
      return directory
    }

    it('copies them into the session folder with the same structure', async () => {
      const directory = await world({ 'en/a/greet.md': 'World says ${name}.' })
      expect(copyWorldPrompts(directory, folder(), shipped)).toEqual([])
      expect(await readFile(join(folder(), 'prompts', 'en', 'a', 'greet.md'), 'utf8')).toBe('World says ${name}.')
      await rm(directory, { recursive: true })
    })

    it('copies nothing when a world has no prompts', async () => {
      const directory = await world({})
      expect(copyWorldPrompts(directory, folder(), shipped)).toEqual([])
      await rm(directory, { recursive: true })
    })

    it('reports an unknown prompt, an empty one and a variable the prompt is not given, and copies none of them', async () => {
      const directory = await world({ 'en/a/greet.md': 'Hi ${who}.', 'en/a/nothing.md': 'x', 'en/a/only-en.md': ' \n' })
      const problems = copyWorldPrompts(directory, folder(), shipped)
      expect(problems.map(problem => problem.message).sort()).toEqual(['the prompt is empty', 'there is no prompt "a/nothing"', 'uses ${who}, which the prompt is not given (it is given: name)'])
      await expect(readFile(join(folder(), 'prompts', 'en', 'a', 'only-en.md'), 'utf8')).rejects.toThrow()
      await rm(directory, { recursive: true })
    })
  })
})

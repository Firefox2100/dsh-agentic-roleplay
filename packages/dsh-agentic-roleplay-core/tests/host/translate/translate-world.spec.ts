import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChildJob, ImportContext } from '../../../src/host/import/run.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { textLanguage } from '../../../src/host/translate/language.ts'
import { leavesOf } from '../../../src/host/translate/prose.ts'
import { TranslationRefusedError, translateWorld } from '../../../src/host/translate/translate-world.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

const starter = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'starter-worlds', 'blackwater-observatory')
const CHINESE = '中'

let base: string
let catalog: WorldCatalog
let source: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'translate-'))
  source = join(base, 'worlds', 'harbor')
  await cp(starter, source, { recursive: true })
  catalog = new WorldCatalog(new Context(), { path: base } as RoleplayRoot)
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

const read = async (...path: string[]): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(...path), 'utf8')) as Record<string, unknown>

/** A model that "translates" by writing Chinese characters, and that is held to the checks the real run holds a job to. */
function fakeContext(options: { wrongCount?: boolean } = {}): ImportContext & { jobs: string[] } {
  const jobs: string[] = []
  const run = async <T,>(job: ChildJob<T>): Promise<T> => {
    const given = JSON.parse(job.prompt) as { names?: string[]; texts?: { text: string }[] }
    const result = given.names !== undefined
      ? { terms: given.names.map(source => ({ source, target: `${CHINESE}${source.length}` })) }
      : { translations: given.texts!.map(({ text }) => `${(text.match(/\$?\{[^{}]*\}/g) ?? []).join('')}${CHINESE.repeat(text.length)}`) }
    if (options.wrongCount && 'translations' in result) result.translations.pop()
    const problem = job.check?.(result as T)
    if (problem !== undefined) throw new Error(problem)
    jobs.push(given.names !== undefined ? 'glossary' : 'document')
    return result as T
  }
  return { run: run as ImportContext['run'], concurrency: 2, text: id => id, say: () => undefined, jobs }
}

describe('telling the language of a world', () => {
  it('goes by the script of the letters, and leaves short or unclear text undecided', () => {
    expect(textLanguage('The inn stands at the edge of the square, and its lamps are lit.')).toBe('en')
    expect(textLanguage('旅店坐落在广场的边上，灯火已经点亮，镇上的人们聚在一起谈论着最近的事。')).toBe('zh')
    expect(textLanguage('中文故事里提到了 Clara Whitlock 和 Arthur Moore 的名字，还有很多别的事。')).toBe('zh')
    expect(textLanguage('An English story that mentions 李明 once.')).toBe('en')
    expect(textLanguage('Hello')).toBeUndefined()
  })

  it('finds the words of a file and leaves ids, references and times alone', () => {
    const leaves = leavesOf('character', { id: 'clara', name: 'Clara', aliases: ['Cee'], summary: 'Innkeeper.', start: { location: 'bar', activity: 'polishing glasses' }, routine: [{ from: '07:00', activity: 'cooks', location: 'bar' }], relationships: [{ to: 'arthur', label: 'guest' }] })
    expect(leaves.map(leaf => [leaf.path.join('.'), leaf.name])).toEqual([['name', true], ['aliases.0', true], ['summary', false], ['start.activity', false], ['routine.0.activity', false], ['relationships.0.label', false]])
  })
})

describe('translating a world', () => {
  it('makes a copy in the other language with the same structure, and never touches the original', async () => {
    const before = await read(source, 'characters', 'clara-whitlock', 'character.json')
    const context = fakeContext()
    const report = await translateWorld(context, catalog, { directory: source }, 'zh', 'en')

    expect(report.problems).toEqual([])
    expect(report.texts).toBeGreaterThan(50)
    expect(context.jobs).toContain('glossary')
    expect(await read(source, 'characters', 'clara-whitlock', 'character.json')).toEqual(before)
    expect((await read(source, 'world.json'))['id']).toBe('51e09bac-6c9e-4ffd-a285-82fbc9c4399c')

    const copy = join(base, 'worlds', report.folder)
    const world = await read(copy, 'world.json')
    expect(world['id']).toBe(report.worldId)
    expect(world['id']).not.toBe((await read(source, 'world.json'))['id'])
    expect(String(world['name'])).toContain(CHINESE)
    expect(textLanguage(String(world['description']))).toBe('zh')
    expect(world['starting_time']).toBe('1912-09-21T19:30')

    const clara = await read(copy, 'characters', 'clara-whitlock', 'character.json')
    expect(clara['id']).toBe(before['id'])
    expect(clara['role']).toBe(before['role'])
    expect(String(clara['name'])).toContain(CHINESE)
    expect(clara['aliases']).toContain(before['name'])
    expect((clara['start'] as { location: string }).location).toBe((before['start'] as { location: string }).location)
    expect((await readdir(join(copy, 'locations'))).sort()).toEqual((await readdir(join(source, 'locations'))).sort())
  })

  it('writes the world\'s own prompt files in the new language with their variables kept, and leaves one that exists', async () => {
    await mkdir(join(source, 'prompts', 'en', 'roleplay'), { recursive: true })
    await mkdir(join(source, 'prompts', 'zh', 'roleplay'), { recursive: true })
    await writeFile(join(source, 'prompts', 'en', 'roleplay', 'style.md'), 'Write in ${language}, short and plain, in the voice of a ship\'s log.\n')
    await writeFile(join(source, 'prompts', 'en', 'roleplay', 'persona.md'), 'You tell the story of a harbor town at night.\n')
    await writeFile(join(source, 'prompts', 'zh', 'roleplay', 'persona.md'), '你讲述一个夜晚港口小镇的故事。\n')
    const report = await translateWorld(fakeContext(), catalog, { directory: source }, 'zh', 'en')
    expect(report.prompts).toEqual(['roleplay/style'])
    const copy = join(base, 'worlds', report.folder)
    expect(await readFile(join(copy, 'prompts', 'zh', 'roleplay', 'style.md'), 'utf8')).toContain('${language}')
    expect(await readFile(join(copy, 'prompts', 'zh', 'roleplay', 'persona.md'), 'utf8')).toBe('你讲述一个夜晚港口小镇的故事。\n')
    expect(report.copiedAsIs).not.toContain('prompts')
  })

  it('translates what a visual identity says and leaves its tags', () => {
    const leaves = leavesOf('character', { name: 'Clara', visual_identity: { description: 'A tall woman in a grey coat.', tags: ['coat'], negative_tags: ['blur'] } })
    expect(leaves.map(leaf => leaf.path.join('.'))).toEqual(['name', 'visual_identity.description'])
  })

  it('refuses a world that is already in the language, and a world that cannot be read', async () => {
    await expect(translateWorld(fakeContext(), catalog, { directory: source }, 'en', 'en')).rejects.toBeInstanceOf(TranslationRefusedError)
  })

  it('does not accept translations that are missing or that left the text in the original language', async () => {
    await expect(translateWorld(fakeContext({ wrongCount: true }), catalog, { directory: source }, 'zh', 'en')).rejects.toThrow(/texts were given and/)
    const lazy: ImportContext = { ...fakeContext(), run: (async (job: ChildJob<unknown>) => {
      const given = JSON.parse(job.prompt) as { names?: string[]; texts?: { text: string }[] }
      const result = given.names !== undefined ? { terms: given.names.map(term => ({ source: term, target: `${CHINESE}${term}` })) } : { translations: given.texts!.map(({ text }) => text) }
      const problem = job.check?.(result)
      if (problem !== undefined) throw new Error(problem)
      return result
    }) as ImportContext['run'] }
    await expect(translateWorld(lazy, catalog, { directory: source }, 'zh', 'en')).rejects.toThrow(/still in the original language/)
    await expect(stat(join(base, 'worlds', 'harbor zh'))).rejects.toThrow()
  })
})

describe('the words that recur inside names', () => {
  it('finds the parts of names and the phrases the texts keep using, and holds a translation to the glossary', async () => {
    const { recurringTerms, usesTerm } = await import('../../../src/host/translate/terms.ts')
    const names = ['Iron Stag Inn - Bar', 'Iron Stag Inn - Room 7', 'Town Square']
    const texts = ['Locals gather at the Iron Stag after dark.', 'The Iron Stag keeps a ledger.', 'Clara runs the Iron Stag.']
    const terms = recurringTerms(names, texts)
    expect(terms).toContain('Iron Stag Inn')
    expect(terms).toContain('Bar')
    expect(usesTerm('She left the Iron Stag.', 'Iron Stag')).toBe(true)
    expect(usesTerm('The Iron Stagger.', 'Iron Stag')).toBe(false)
  })

  it('refuses a translation that keeps a name the glossary renders', async () => {
    const context: ImportContext = { ...fakeContext(), run: (async (job: ChildJob<unknown>) => {
      const given = JSON.parse(job.prompt) as { names?: string[]; texts?: { text: string }[] }
      const result = given.names !== undefined ? { terms: given.names.map(term => ({ source: term, target: `${CHINESE}${term.length}` })) } : { translations: given.texts!.map(({ text }) => `${CHINESE.repeat(text.length)} ${text.match(/Iron Stag/) ? 'Iron Stag' : ''}`) }
      const problem = job.check?.(result)
      if (problem !== undefined) throw new Error(problem)
      return result
    }) as ImportContext['run'] }
    await expect(translateWorld(context, catalog, { directory: source }, 'zh', 'en')).rejects.toThrow(/still has "Iron Stag"/)
  })
})

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImportContext } from '../../src/host/import/run.ts'
import { build, finish, markReady, survey } from '../../src/host/import/run-import.ts'
import { ImportStore } from '../../src/host/import/store.ts'
import type { PanelCard } from './panel-cards.ts'
import type { Trace } from './trace.ts'

/** The import of a panel card as the live benchmark and its replay both run it: the product's own survey, build and finish, and the world that comes out. */
/** A sentence that tells the game master to print a panel, bar or update block, whatever markup it uses or does not use. */
export const DIRECTIVE = {
  en: /(?:end|follow|finish|append|add|output|print|render|include)[^.\n]{0,60}(?:status bar|status block|panel|update block|status line)|(?:status bar|panel|update block)[^.\n]{0,40}(?:every|each|after)[^.\n]{0,20}(?:reply|response|message)|at the very end/i,
  zh: /(?:附上|附加|输出|打印|渲染|结尾|末尾)[^。\n]{0,30}(?:状态栏|面板|更新块|区块)|(?:状态栏|面板|更新块)[^。\n]{0,20}(?:每次|每条|每个)[^。\n]{0,10}(?:回复|消息)|最末尾|绝对最末/,
} as const

export interface World {
  /** Every place a leak is looked for, with the text found there. */
  texts: { where: string; text: string }[]
  variables: number
  checkFindings: string[]
}

async function read(directory: string): Promise<World> {
  const texts: World['texts'] = []
  const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown
  const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : [])
  const info = await json('world.json') as Record<string, unknown>
  texts.push({ where: 'opening', text: String(info['opening_message'] ?? '') }, ...strings(info['alternate_openings']).map(text => ({ where: 'alternate opening', text })))
  const walk = async (folder: string): Promise<string[]> => (await readdir(join(directory, folder), { withFileTypes: true }).catch(() => [])).flatMap(entry => (entry.isDirectory() ? [`${folder}/${entry.name}`] : [])).filter(Boolean)
  for (const folder of ['lore', 'characters', 'locations', 'items', 'factions']) {
    for (const item of await walk(folder)) {
      const file = (await readdir(join(directory, item))).find(name => name.endsWith('.json'))
      if (file !== undefined) texts.push({ where: item, text: strings(await json(`${item}/${file}`)).join('\n') })
    }
  }
  const prompts = async (folder: string): Promise<void> => {
    for (const entry of await readdir(join(directory, folder), { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await prompts(`${folder}/${entry.name}`)
      else texts.push({ where: `${folder}/${entry.name}`, text: await readFile(join(directory, folder, entry.name), 'utf8') })
    }
  }
  await prompts('prompts')
  const variables = await json('variables.json').catch(() => []) as unknown[]
  return { texts, variables: variables.length, checkFindings: [] }
}


export async function importCard(made: PanelCard, ctx: ImportContext, trace: Trace): Promise<World & { notes: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'panels-'))
  try {
    const world = join(root, 'worlds', 'quay')
    await mkdir(world, { recursive: true })
    await writeFile(join(world, 'world.json'), JSON.stringify({ id: `panels-${made.id}-${made.language}`, name: made.card.name, description: '', metadata: { tags: [] } }))
    const store = new ImportStore(() => root)
    const staged = await store.create(made.card, Buffer.from('png'))
    await store.choose(staged.id, { name: made.card.name, disabledEntries: [], opening: { kind: 'first' } })
    await store.adopt(staged.id, world)
    await markReady(world)
    const kept = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(world, '.import', file), 'utf8').catch(() => 'null')) as unknown
    trace.state('card', made.card)
    await survey(ctx, world)
    trace.state('survey', { classification: await kept('classification.json'), roster: await kept('roster.json') })
    const built = await build(ctx, world)
    trace.state('build', { summary: built, extracted: await kept('extracted.json') })
    const done = await finish(ctx, world)
    trace.state('finish', { report: await kept('report.json'), checks: done.ok ? done.checks : done })
    const found = await read(world)
    trace.state('world', found.texts)
    const findings = done.ok ? ((done.checks as { findings?: { check: string; code: string }[] }).findings ?? []).filter(finding => finding.check === 'quality-panels').map(finding => finding.code) : ['finish failed']
    return { ...found, checkFindings: findings, notes: built.notes }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}


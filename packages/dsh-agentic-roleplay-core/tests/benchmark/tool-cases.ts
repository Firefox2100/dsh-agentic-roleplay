import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Files, Language } from './language.ts'
import { pick } from './language.ts'
import { authoringProblems, seedWorld } from './authoring-cases.ts'
import type { ToolExpect } from './tool-trace.ts'

/**
 * Requests that test how the world assistant uses its tools and its format guides, not only what it leaves behind: a small change must be made as a small change (the other fields, entries and
 * documents stay as they were), a kind of document is written after its guide was read, and a write that is refused is mended instead of repeated. Each case holds the files (`WorldOracle`) and the calls
 * (`ToolExpect`, read from the assistant's own session log). The vocabulary of both is closed; a new kind needs a case in `tool-cases.spec.ts` first.
 */
export type ToolCaseId = 'edit-background' | 'relabel' | 'one-plot' | 'one-variable' | 'faction' | 'trigger'
export const TOOL_CASES: readonly ToolCaseId[] = ['edit-background', 'relabel', 'one-plot', 'one-variable', 'faction', 'trigger']

export type WorldOracle =
  /** The value at `path` of a JSON file holds one of the words (any case). */
  | { type: 'has'; file: string; path: string[]; any: string[] }
  /** The value at `path` of a JSON file is what the seed had (nothing else was touched). */
  | { type: 'kept'; file: string; path?: string[] }
  /** The list at `path` has this many entries. */
  | { type: 'length'; file: string; path: string[]; n: number }
  /** A file exists. */
  | { type: 'exists'; file: string }
  | { type: 'valid' }

export interface ToolCase {
  id: string
  kind: ToolCaseId
  language: Language
  message: string
  seed: (files: Files) => void
  world: WorldOracle[]
  tools: ToolExpect[]
}

const at = (value: unknown, path: readonly string[]): unknown => path.reduce<unknown>((current, key) => (typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined), value)

const mill = (language: Language) => {
  const p = pick(language)
  return {
    name: p('Hale the Miller', '老葛'), role: 'npc', summary: p('Runs the mill.', '经营磨坊。'), personality: p('Gruff and careful.', '寡言而谨慎。'), background: p('Took over the mill from his father.', '从父亲手里接过磨坊。'),
    start: { location: 'mill' }, relationships: [{ to: 'visitor', label: p('stranger', '陌生人'), summary: '', familiarity: 0.1, trust: 0, affinity: 0, tension: 0 }],
  }
}

/** The seed of these cases: the authoring seed, with the miller written out and a relationship, two tracked values and two plots to leave alone. */
export function toolSeed(language: Language): Files {
  const p = pick(language)
  const files = seedWorld(language)
  files.set('characters/miller/character.json', mill(language))
  files.set('variables.json', [
    { key: 'mood', name: p('Mood', '情绪'), kind: 'number', subject: 'world', visibility: 'public', min: 0, max: 10, default: 5, update: p('Rises with good news, falls with bad.', '好消息使之上升，坏消息使之下降。') },
    { key: 'grain', name: p('Grain', '存粮'), kind: 'number', subject: 'world', visibility: 'public', min: 0, max: 100, default: 50, update: p('Falls as the mill grinds, rises at harvest.', '磨坊开工时下降，收获时上升。') },
  ])
  const plot = (id: string, premise: string) => ({ id, name: id, premise, participants: [], hooks: [{ id: 'h', text: p('A hook.', '一个引子。'), mode: 'opportunity' }], developments: [], resolutions: [p('It ends.', '事情了结。')] })
  files.set('plots.json', [plot('stranger', p('A stranger asks about the mill.', '一个陌生人打听磨坊。')), plot('weir', p('The weir needs mending.', '堰坝需要修补。'))])
  return files
}

export function toolCases(language: Language): ToolCase[] {
  const p = pick(language)
  const make = (kind: ToolCaseId, message: string, world: WorldOracle[], tools: ToolExpect[]): ToolCase => ({ id: `tool-${kind}-${language}`, kind, language, message, seed: () => undefined, world: [...world, { type: 'valid' }], tools })
  const miller = 'characters/miller/character.json'
  return [
    make('edit-background', p('Hale the Miller lost a brother at the weir. Add that to his background.', '老葛的一个兄弟死在堰边。把这件事写进他的背景。'),
      [{ type: 'has', file: miller, path: ['background'], any: [p('brother', '兄弟')] }, { type: 'kept', file: miller, path: ['personality'] }, { type: 'kept', file: miller, path: ['summary'] }, { type: 'kept', file: miller, path: ['start'] }, { type: 'kept', file: miller, path: ['relationships'] }],
      [{ type: 'not-used', tool: 'delete_world_element' }, { type: 'max-failures', n: 3 }]),
    make('relabel', p('The miller no longer sees the visitor as a stranger: change it to old friend.', '老葛不再把过客当陌生人了：把关系改成老朋友。'),
      [{ type: 'length', file: miller, path: ['relationships'], n: 1 }, { type: 'has', file: miller, path: ['relationships'], any: [p('friend', '朋友')] }, { type: 'kept', file: miller, path: ['background'] }],
      [{ type: 'no-churn' }, { type: 'not-used', tool: 'delete_world_element' }, { type: 'max-failures', n: 3 }]),
    make('one-plot', p('Change the premise of the "weir" plot: the weir was not worn out, someone cut it.', '把“weir”这条剧情的前提改一下：堰坝不是自己坏的，是有人弄断的。'),
      [{ type: 'has', file: 'plots.json', path: ['1', 'premise'], any: [p('cut', '弄断')] }, { type: 'kept', file: 'plots.json', path: ['0', 'premise'] }, { type: 'kept', file: 'plots.json', path: ['0', 'id'] }, { type: 'length', file: 'plots.json', path: [], n: 2 }],
      [{ type: 'max-failures', n: 3 }]),
    make('one-variable', p('Grain should also fall whenever the weir is broken.', '堰坝坏了的时候，存粮也应当下降。'),
      [{ type: 'has', file: 'variables.json', path: ['1', 'update'], any: p(['weir', 'broken'], ['堰', '坝', '损', '坏']) }, { type: 'kept', file: 'variables.json', path: ['0', 'update'] }, { type: 'kept', file: 'variables.json', path: ['0', 'default'] }, { type: 'length', file: 'variables.json', path: [], n: 2 }],
      [{ type: 'not-used', tool: 'edit_world_info' }, { type: 'max-failures', n: 3 }]),
    make('faction', p('Add a faction, the Millers\' Guild, which Hale belongs to.', '加一个势力“磨坊行会”，老葛是其中一员。'),
      [{ type: 'exists', file: 'factions' }],
      [{ type: 'guide-first', guide: 'world-factions' }, { type: 'max-failures', n: 3 }]),
    make('trigger', p('When the visitor first reaches the mill, ring the mill bell once and let everyone there hear it.', '过客第一次来到磨坊时，让磨坊的钟响一声，在场的人都能听见。'),
      [{ type: 'exists', file: 'triggers.json' }],
      [{ type: 'guide-first', guide: 'world-triggers' }, { type: 'max-failures', n: 3 }]),
  ].map(entry => ({ ...entry, seed: (files: Files) => { for (const [path, value] of toolSeed(language)) files.set(path, value) } }))
}

const readJson = async (file: string): Promise<unknown> => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as unknown

/** Why the world does not hold what the case expects, comparing with the seed it started from. */
export async function toolWorldProblems(oracles: readonly WorldOracle[], directory: string, seed: Files): Promise<string[]> {
  const problems: string[] = []
  for (const oracle of oracles) {
    if (oracle.type === 'valid') { problems.push(...await authoringProblems([oracle], { directory, seedCharacters: ['visitor', 'miller'], seedTools: undefined })); continue }
    if (oracle.type === 'exists') {
      const found = await readJson(join(directory, oracle.file)).then(() => true, async () => (await import('node:fs/promises')).readdir(join(directory, oracle.file)).then(names => names.length > 0, () => false))
      if (!found) problems.push(`${oracle.file} is not there`)
      continue
    }
    const now = await readJson(join(directory, oracle.file)).catch(() => undefined)
    const was = seed.get(oracle.file)
    switch (oracle.type) {
      case 'has': if (!oracle.any.some(word => JSON.stringify(at(now, oracle.path) ?? '').toLowerCase().includes(word.toLowerCase()))) problems.push(`${oracle.file} ${oracle.path.join('.')} does not mention ${oracle.any.join(' or ')}`); break
      case 'kept': if (JSON.stringify(at(now, oracle.path ?? [])) !== JSON.stringify(at(was, oracle.path ?? []))) problems.push(`${oracle.file} ${(oracle.path ?? []).join('.')} changed`); break
      case 'length': { const list = at(now, oracle.path); if (!Array.isArray(list) || list.length !== oracle.n) problems.push(`${oracle.file} ${oracle.path.join('.')} has ${Array.isArray(list) ? list.length : 'no'} entries, not ${oracle.n}`); break }
    }
  }
  return problems
}

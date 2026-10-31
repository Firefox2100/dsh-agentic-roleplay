import { mapLimit, norm } from '../import/run.ts'
import type { ImportContext } from '../import/run.ts'
import { CheckSkipped, foundBy, type Check, type CheckInput, type Found } from './check.ts'
import { duplicateValues, overlapping } from './consistency.ts'
import { verdictOf } from './judge.ts'
import { loaded } from './loaded.ts'
import { candidates, type Near } from './similar.ts'
import { squashed } from './terms.ts'

/** The most pairs one check asks a model about: past that the world has a different problem than a few doubles. */
const PAIRS_ASKED = 12
/** How close two texts are in meaning before they are asked about: low on purpose, because closeness only picks what to ask (trust and affection are as close as gold and coins). */
const VALUES_CLOSE = 0.55
const THINGS_CLOSE = 0.6
const LORE_CLOSE = 0.6
const TEXT_CHARS = 1200
const QUOTE_LISTED = 6

const yesNo = (key: string) => ({ type: 'object', properties: { reason: { type: 'string' }, [key]: { type: 'boolean' } }, required: ['reason', key], additionalProperties: false }) as never

interface Pair {
  near: Near
  first: string
  second: string
}

/** The pairs a model says yes to, each with the reason the language model gave (the decision model gives none). */
async function asked(model: ImportContext, pairs: readonly Pair[], prompt: string, key: string, extra: Record<string, unknown> = {}): Promise<{ pair: Pair; reason: string }[]> {
  const instructions = model.text(prompt)
  const said = await mapLimit(pairs, model.concurrency, async (pair) => {
    if (model.cancelled?.() === true) return undefined
    let reason = ''
    const verdict = await verdictOf(model, { ...extra, first: pair.first, second: pair.second }, key, instructions, async () => {
      const answer = await model.run<Record<string, unknown> & { reason: string }>({ persona: instructions, prompt: `A:\n${pair.first}\n\nB:\n${pair.second}`, result: yesNo(key), maxTokens: 500 })
      reason = answer.reason
      return answer[key] === true
    })
    return verdict.yes ? { pair, reason } : undefined
  })
  return said.filter(entry => entry !== undefined)
}

const because = (reason: string): string => (reason.trim() === '' ? '' : `: ${reason.trim()}`)

const valueText = (def: { key: string; name: string; description?: string }): string => `${def.name} (${def.key}): ${def.description ?? ''}`.slice(0, TEXT_CHARS)

const sameValue: Check = {
  id: 'duplicate-values-meaning',
  kit: 'consistency',
  mode: 'decision',
  needs: ['model'],
  description: 'Tracked values that are the same thing under different words or languages (the table of duplicate-values does not know them): the closest in meaning are found with the embedding provider and a decision model says whether they are one.',
  async run(input) {
    const model = input.model!
    const { defs } = await loaded.variables(input)
    const known = new Set(duplicateValues(defs).map(([a, b]) => `${a.key}\n${b.key}`))
    const allowed = (a: number, b: number): boolean => overlapping(defs[a]!, defs[b]!) && !known.has(`${defs[a]!.key}\n${defs[b]!.key}`)
    const near = (await candidates(model, input.world.directory, defs.map(valueText), allowed, VALUES_CLOSE, PAIRS_ASKED, 'first')) ?? []
    const said = await asked(model, near.map(entry => ({ near: entry, first: valueText(defs[entry.a]!), second: valueText(defs[entry.b]!) })), 'checks/decide-same-value', 'same')
    return foundBy('duplicate-values-meaning', said.map(({ pair, reason }): Found => {
      const a = defs[pair.near.a]!
      const b = defs[pair.near.b]!
      return { severity: 'warning', code: 'duplicate-value', where: 'variables.json', message: `${a.key} (${a.name}) and ${b.key} (${b.name}) seem to track the same thing for the same ${a.subject}s${because(reason)}`, hint: 'Keep one and remove the other from variables.json and from the files that give it a starting value; which one is right is a choice.' }
    }))
  },
}

interface Thing {
  where: string
  kind: string
  names: string[]
  text: string
}

const KIND_NAME = { characters: 'character', locations: 'place', factions: 'organisation', items: 'thing' } as const

/** Whether one name is inside the other (an "Old Mill" and a "Mill"): such a pair is asked about whatever the embedding says. */
const nested = (a: readonly string[], b: readonly string[]): boolean => a.some(left => b.some(right => left !== right && Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))))

const nearNames: Check = {
  id: 'name-near',
  kit: 'consistency',
  mode: 'decision',
  needs: ['model'],
  description: 'Two characters, places, organisations or things that may be one written twice under different names ("The Mill" and "Old Mill"): found by name and, with an embedding provider, by what the sheets say; a decision model says whether they are one.',
  async run(input) {
    const model = input.model!
    const world = await loaded.text(input)
    const things: Thing[] = world.names.map(thing => ({ where: thing.where, kind: KIND_NAME[thing.kind], names: [...new Set(thing.names.map(norm).filter(name => name !== ''))], text: `${thing.names[0] ?? thing.where}: ${(world.prose.get(thing.where) ?? '').slice(0, TEXT_CHARS)}` }))
    const sameKind = (a: number, b: number): boolean => things[a]!.kind === things[b]!.kind && !things[a]!.names.some(name => things[b]!.names.includes(name))
    const byName: Near[] = []
    for (let a = 0; a < things.length; a++) for (let b = a + 1; b < things.length; b++) if (sameKind(a, b) && nested(things[a]!.names, things[b]!.names)) byName.push({ a, b, score: 1 })
    const byMeaning = await candidates(model, input.world.directory, things.map(thing => thing.text), sameKind, THINGS_CLOSE, PAIRS_ASKED) ?? []
    const seen = new Set(byName.map(entry => `${entry.a}:${entry.b}`))
    const near = [...byName, ...byMeaning.filter(entry => !seen.has(`${entry.a}:${entry.b}`))].slice(0, PAIRS_ASKED)
    const said = await asked(model, near.map(entry => ({ near: entry, first: `${things[entry.a]!.kind} ${things[entry.a]!.text}`, second: `${things[entry.b]!.kind} ${things[entry.b]!.text}` })), 'checks/decide-same-thing', 'same')
    return foundBy('name-near', said.map(({ pair, reason }): Found => {
      const a = things[pair.near.a]!
      const b = things[pair.near.b]!
      return { severity: 'warning', code: 'possible-duplicate', where: a.where, message: `${a.where} and ${b.where} may be the same ${a.kind}, written twice${because(reason)}`, hint: 'Read both. If they are one, keep one and point everything that names the other at it; if they are two, make what tells them apart plain in each. Which stays is a choice.' }
    }))
  },
}

const CONFLICT_SCHEMA = { type: 'object', properties: { reason: { type: 'string' }, conflict: { type: 'boolean' }, first_quote: { type: 'string' }, second_quote: { type: 'string' } }, required: ['reason', 'conflict', 'first_quote', 'second_quote'], additionalProperties: false } as const

interface Conflict { reason: string; conflict: boolean; first_quote: string; second_quote: string }

/** The shortest quote that can state a fact: a word or a title is not one. */
const MIN_QUOTE_CHARS = 10

/** Why a conflict cannot be used: it must quote, from each entry, a statement that rules out the other's, not a title and not the same words twice. */
export function conflictProblem(value: Conflict, first: string, second: string, titles: readonly [string, string] = ['', '']): string | undefined {
  if (!value.conflict) return undefined
  const there = (text: string, quote: string): boolean => squashed(quote) !== '' && squashed(text).includes(squashed(quote))
  const statement = (quote: string, title: string): boolean => squashed(quote).replace(/\s/gu, '').length >= MIN_QUOTE_CHARS && !squashed(title).includes(squashed(quote)) && !squashed(quote).includes(squashed(title) || '\u0000')
  if (!there(first, value.first_quote)) return 'first_quote must be a passage of the first entry, exactly as it is written there'
  if (!there(second, value.second_quote)) return 'second_quote must be a passage of the second entry, exactly as it is written there'
  if (!statement(value.first_quote, titles[0]) || !statement(value.second_quote, titles[1])) return 'each quote must be a statement of fact of its entry (at least a clause long), not a title or a heading'
  if (squashed(value.first_quote).includes(squashed(value.second_quote)) || squashed(value.second_quote).includes(squashed(value.first_quote))) return 'the two quotes are the same words: quote two different statements that cannot both be true'
  return undefined
}

const loreText = (entry: { title: string; summary: string; body: string }): string => `${entry.title}\n${entry.summary}\n${entry.body}`.slice(0, TEXT_CHARS * 2)

const conflicts: Check = {
  id: 'lore-conflict',
  kit: 'consistency',
  mode: 'decision',
  needs: ['model'],
  description: 'Two background entries that say things that cannot both be true at the same time: the closest in meaning are found with the embedding provider, a decision model screens them, and the language model must quote the passage of each that conflicts.',
  async run(input: CheckInput) {
    const model = input.model!
    const { lore } = await loaded.lore(input)
    const apart = (a: number, b: number): boolean => {
      const x = lore[a]!
      const y = lore[b]!
      return (x.endsAt !== undefined && y.startsAt !== undefined && x.endsAt < y.startsAt) || (y.endsAt !== undefined && x.startsAt !== undefined && y.endsAt < x.startsAt)
    }
    const near = await candidates(model, input.world.directory, lore.map(loreText), (a, b) => !apart(a, b), LORE_CLOSE, PAIRS_ASKED)
    if (near === undefined) throw new CheckSkipped('no embedding provider is selected to find which entries to compare')
    const pairs = near.map(entry => ({ near: entry, first: `entry ${lore[entry.a]!.id}:\n${loreText(lore[entry.a]!)}`, second: `entry ${lore[entry.b]!.id}:\n${loreText(lore[entry.b]!)}` }))
    const screened = model.decide === undefined ? pairs : (await asked(model, pairs, 'checks/decide-conflict', 'conflict')).map(entry => entry.pair)
    const instructions = model.text('checks/conflict')
    const found: Found[] = []
    await mapLimit(screened.slice(0, QUOTE_LISTED * 2), model.concurrency, async (pair) => {
      if (model.cancelled?.() === true) return
      const first = loreText(lore[pair.near.a]!)
      const second = loreText(lore[pair.near.b]!)
      try {
        const answer = await model.run<Conflict>({ persona: instructions, prompt: `${pair.first}\n\n${pair.second}`, result: CONFLICT_SCHEMA as never, maxTokens: 800, check: value => conflictProblem(value, first, second, [lore[pair.near.a]!.title, lore[pair.near.b]!.title]) })
        if (!answer.conflict) return
        const a = lore[pair.near.a]!
        const b = lore[pair.near.b]!
        found.push({ severity: 'warning', code: 'lore-conflict', where: `lore/${a.id}`, message: `lore/${a.id} says “${answer.first_quote.trim()}” and lore/${b.id} says “${answer.second_quote.trim()}”${because(answer.reason)}`, hint: 'Read both entries. Keep what the card or the person says is true and correct the other; if both are true at different times, give each its dates.' })
      } catch (error) {
        if (model.cancelled?.() === true) throw error
      }
    })
    return foundBy('lore-conflict', found)
  },
}

export const semanticChecks: readonly Check[] = [sameValue, nearNames, conflicts]

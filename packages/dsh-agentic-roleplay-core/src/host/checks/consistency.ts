import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lintWorld } from '@dsh-agentic-roleplay/state'
import type { VariableDefinitionInput } from 'dsh-roleplay-model'
import { loadCharacters } from '../characters/load.ts'
import { loadFactions } from '../factions/load.ts'
import { loadLore } from '../lore/load.ts'
import { copyWorldPrompts } from '../prompts/library.ts'
import { loadWorldParts } from '../triggers/parts.ts'
import { loadVariables } from '../variables/load.ts'
import { withScratchStory } from '../worlds/scratch.ts'
import { checkWorld } from '../worlds/world-check.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { CheckSkipped, foundBy, type Check, type Found } from './check.ts'


/** Words that name one thing a story tracks; a world that declares two of one group tracks it twice. */
const SYNONYMS: readonly (readonly string[])[] = [
  ['hp', 'health', 'hitpoints', 'healthpoints', 'life', 'vitality'],
  ['mp', 'mana', 'magicpoints', 'magicpower'],
  ['xp', 'exp', 'experience', 'experiencepoints'],
  ['gold', 'money', 'coins', 'cash', 'currency'],
  ['stamina', 'energy', 'endurance'],
  ['sanity', 'san'],
  ['level', 'lvl'],
]

const squash = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The group of meaning a variable's key or name falls in: a synonym group, else the word itself. */
const meanings = (def: VariableDefinitionInput): Set<string> => {
  const found = new Set<string>()
  for (const word of [def.key, def.name].map(squash).filter(word => word !== '')) {
    const group = SYNONYMS.findIndex(names => names.includes(word))
    found.add(group < 0 ? word : `group:${group}`)
  }
  return found
}

const overlapping = (a: VariableDefinitionInput, b: VariableDefinitionInput): boolean => {
  if (a.subject !== b.subject || a.kind !== b.kind) return false
  const left = a.only ?? []
  const right = b.only ?? []
  return left.length === 0 || right.length === 0 || left.some(key => right.includes(key))
}

/** Pairs of tracked values that mean the same thing for the same subjects. */
export function duplicateValues(defs: readonly VariableDefinitionInput[]): [VariableDefinitionInput, VariableDefinitionInput][] {
  const pairs: [VariableDefinitionInput, VariableDefinitionInput][] = []
  for (let i = 0; i < defs.length; i++) {
    const own = meanings(defs[i]!)
    for (let j = i + 1; j < defs.length; j++) {
      if (overlapping(defs[i]!, defs[j]!) && [...meanings(defs[j]!)].some(meaning => own.has(meaning))) pairs.push([defs[i]!, defs[j]!])
    }
  }
  return pairs
}

const asSkip = (error: unknown): never => {
  if (error instanceof InvalidEditProblems) throw new CheckSkipped('other files of the world have problems that come first')
  throw error
}

const validity: Check = {
  id: 'world-valid',
  kit: 'consistency',
  mode: 'code',
  needs: [],
  description: 'Every file of the world reads and everything that refers to something refers to something that is there, as a story start checks it (it names the problems of the first part of the world that has any).',
  async run({ world }) {
    const check = await checkWorld(world)
    const found: Found[] = check.problems.map(problem => ({ severity: 'error', code: 'invalid', where: problem.where, message: problem.message, hint: 'Fix it, then run the check again: the next part of the world may have problems of its own.' }))
    if (check.more > 0) found.push({ severity: 'error', code: 'invalid', where: '(the world)', message: `${check.more} more problems are not listed` })
    return foundBy('world-valid', found)
  },
}

const graph: Check = {
  id: 'world-graph',
  kit: 'consistency',
  mode: 'code',
  needs: [],
  description: 'Places no one can reach or leave, ways with no way back, a lock whose key does not exist, two characters, places or things with one name, characters nobody knows.',
  async run({ world }) {
    if (!(await checkWorld(world)).ok) throw new CheckSkipped('the world has problems that come first (see world-valid)')
    const parts = await loadWorldParts(world.directory).catch(asSkip)
    return foundBy('world-graph', withScratchStory(parts, story => lintWorld(story).map((finding): Found => ({ severity: finding.severity, code: finding.code, where: `${finding.subject.kind}:${finding.subject.key}`, message: finding.message }))))
  },
}

const values: Check = {
  id: 'duplicate-values',
  kit: 'consistency',
  mode: 'code',
  needs: [],
  description: 'Tracked values that mean the same thing for the same subjects (health and hp), which the story would keep twice.',
  async run({ world }) {
    const { defs } = await loadVariables(world.directory)
    return foundBy('duplicate-values', duplicateValues(defs).map(([a, b]): Found => ({
      severity: 'warning',
      code: 'duplicate-value',
      where: 'variables.json',
      message: `${a.key} (${a.name}) and ${b.key} (${b.name}) look like the same tracked value for the same ${a.subject}s`,
      hint: 'Keep one and remove the other from variables.json and from the files that give it a starting value; which one is right is a choice.',
    })))
  },
}

const names: Check = {
  id: 'name-clashes',
  kit: 'consistency',
  mode: 'code',
  needs: [],
  description: 'A character\'s alias that is another character\'s name or alias, two organisations or two lore entries with one name.',
  async run({ world }) {
    const [{ characters }, { factions }, { lore }] = await Promise.all([loadCharacters(world.directory), loadFactions(world.directory), loadLore(world.directory)])
    const found: Found[] = []
    const owners = new Map<string, string>()
    for (const character of characters) {
      const seen = new Set<string>()
      for (const label of [character.name, ...character.aliases]) {
        const word = squash(label)
        if (word === '' || seen.has(word)) continue
        seen.add(word)
        const other = owners.get(word)
        if (other !== undefined && other !== character.id) found.push({ severity: 'warning', code: 'alias-clash', where: `characters/${character.id}`, message: `"${label}" names both ${other} and ${character.id}, so a mention cannot be told apart`, hint: 'Give one of them a name or alias of its own.' })
        else owners.set(word, character.id)
      }
    }
    const twice = (kind: string, entries: readonly { id: string; label: string }[]): void => {
      const seen = new Map<string, string>()
      for (const entry of entries) {
        const word = squash(entry.label)
        const other = seen.get(word)
        if (word !== '' && other !== undefined) found.push({ severity: 'warning', code: 'name-twice', where: `${kind}/${entry.id}`, message: `${kind}/${other} and ${kind}/${entry.id} are both called "${entry.label}"` })
        else seen.set(word, entry.id)
      }
    }
    twice('factions', factions.map(entry => ({ id: entry.id, label: entry.name })))
    twice('lore', lore.map(entry => ({ id: entry.id, label: entry.title })))
    return foundBy('name-clashes', found)
  },
}

const prompts: Check = {
  id: 'world-prompts',
  kit: 'consistency',
  mode: 'code',
  needs: [],
  description: 'The prompts the world carries are prompts the product has, are not empty and use only the variables each is given: a world with a bad one cannot start a story.',
  async run({ world }) {
    const scratch = await mkdtemp(join(tmpdir(), 'world-prompts-'))
    try {
      return foundBy('world-prompts', copyWorldPrompts(world.directory, scratch).map((problem): Found => ({ severity: 'error', code: 'prompt', where: problem.path.slice(world.directory.length + 1) || problem.path, message: problem.message })))
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
}

export const consistencyChecks: readonly Check[] = [validity, graph, values, names, prompts]

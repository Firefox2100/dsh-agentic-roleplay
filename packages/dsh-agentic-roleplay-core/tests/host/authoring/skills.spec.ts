import { describe, expect, it } from 'vitest'
import { Reader } from '../../../src/host/validation.ts'
import { loadShippedSkills, readSkill, type ShippedSkill } from '../../../src/host/authoring/skills.ts'
import { parseCharacterFile } from '../../../src/host/characters/character-file.ts'
import { parseLocationFile } from '../../../src/host/locations/location-file.ts'
import { parseItemFile } from '../../../src/host/items/item-file.ts'
import { parseFactionFile } from '../../../src/host/factions/faction-file.ts'
import { parseLoreFile } from '../../../src/host/lore/lore-file.ts'
import { parseVariablesFile } from '../../../src/host/variables/load.ts'
import { parseDiceFile } from '../../../src/host/dice/load.ts'
import { parseCommandsFile } from '../../../src/host/commands/load.ts'
import { parseCalendarFile } from '../../../src/host/calendar/load.ts'
import { parsePlotsFile } from '../../../src/host/plots/load.ts'
import { parseStartQuestionsEdit } from '../../../src/shared/start-questions.ts'
import { parseWorldInfoEdit } from '../../../src/shared/world-info.ts'
import { WORLD_INFO_FIELDS } from '../../../src/host/authoring/write-tools.ts'
import { parseTriggerDefinition } from '@dsh-agentic-roleplay/state'

const skills = loadShippedSkills()
const skill = (name: string): ShippedSkill => skills.find(each => each.name === name)!
const example = (name: string): string => /```json\n([\s\S]*?)\n```/.exec(skill(name).content)?.[1] ?? ''

type Parse = (text: string, fallback: string) => { ok: boolean }
const ENTITIES: [string, Parse][] = [
  ['world-characters', parseCharacterFile], ['world-places', parseLocationFile], ['world-items', parseItemFile], ['world-factions', parseFactionFile], ['world-lore', parseLoreFile],
]

describe('the format guides the world assistant loads as skills', () => {
  it('are one folder each, named as their folder, with a line for the catalog and a text', () => {
    expect(skills.length).toBeGreaterThanOrEqual(12)
    expect(new Set(skills.map(each => each.name)).size).toBe(skills.length)
    for (const each of skills) {
      expect(each.description.length, each.name).toBeLessThanOrEqual(300)
      expect(each.content.length, each.name).toBeGreaterThan(400)
      expect(each.whenToUse, `${each.name} says when to load it`).toBeDefined()
    }
  })

  it('refuse a file with no front matter or a name that is not kebab-case', () => {
    expect(() => readSkill('no front matter', 'x')).toThrow('no front matter')
    expect(() => readSkill('---\nname: Bad_Name\ndescription: d\n---\nbody', 'x')).toThrow('kebab-case')
    expect(() => readSkill('---\nname: ok\n---\nbody', 'x')).toThrow('no description')
  })

  it.each(ENTITIES)('give %s an example the real parser accepts, with every field read', (name, parse) => {
    const text = example(name)
    expect(text, `${name} has an example`).not.toBe('')
    let ok = false
    const { unread } = Reader.unreadBy(() => { ok = parse(text, 'example').ok })
    expect(ok).toBe(true)
    expect(unread).toEqual([])
  })

  it.each(ENTITIES)('name every top-level field %s reads', (name, parse) => {
    const { read } = Reader.unreadBy(() => { parse('{"name":"x","title":"x"}', 'example') })
    expect(read.length, 'the parser reports the fields it reads').toBeGreaterThan(4)
    const text = skill(name).content
    const missing = read.filter(key => key !== 'id' && !text.includes(`\`${key}\``))
    expect(missing, `fields of ${name} the guide does not name`).toEqual([])
  })

  it('give the start questions and openings of the world-info guide in the form the parser reads, and name every field edit_world_info takes', () => {
    const blocks = [...skill('world-info').content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!) as unknown)
    const problems: string[] = []
    const questions = parseStartQuestionsEdit(blocks[1], problems)
    expect(problems).toEqual([])
    expect(questions?.[0]?.options).toHaveLength(2)
    expect(parseWorldInfoEdit({ openingParts: blocks[0] })).toHaveProperty('openingParts')
    for (const field of WORLD_INFO_FIELDS) expect(skill('world-info').content, field).toContain(`\`${field}\``)
  })

  it('give the whole-world files and plots examples the real parsers accept', () => {
    expect(parseVariablesFile(example('world-variables')).ok).toBe(true)
    expect(parseDiceFile(example('world-dice')).ok).toBe(true)
    expect(parseCommandsFile(example('world-commands')).ok).toBe(true)
    expect(parseCalendarFile(example('world-calendar')).ok).toBe(true)
    expect(parsePlotsFile(example('world-plots')).ok).toBe(true)
  })

  it('give triggers an example the trigger parser accepts', () => {
    const parsed = parseTriggerDefinition(JSON.parse(example('world-triggers')), 'trigger', () => undefined)
    expect('definition' in parsed ? [] : parsed.problems).toEqual([])
  })

  it('tell the assistant where things go, and name every guide the procedure points to', () => {
    const names = skills.map(each => each.name)
    for (const name of ['world-characters', 'world-places', 'world-items', 'world-factions', 'world-lore', 'world-triggers', 'world-plots', 'world-variables', 'world-dice', 'world-commands', 'world-calendar', 'world-info', 'world-where-things-go']) expect(names).toContain(name)
  })
})

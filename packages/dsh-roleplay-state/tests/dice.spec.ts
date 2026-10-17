import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiceCheckDefinition } from 'dsh-roleplay-model'
import { checkProblems, createDiceTools, notationRange, parseNotation, rollCheck, rollNotation, rollPlain, type DiceLink, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

/** A die that shows what it is told to, in order. */
const faces = (...shown: number[]) => { const queue = [...shown]; return () => { const next = queue.shift(); if (next === undefined) throw new Error('the script ran out of faces'); return next } }

const skill: DiceCheckDefinition = {
  key: 'skill', name: 'Skill check', use: 'An uncertain attempt that matters.', dice: '1d20', compare: 'over',
  bands: [{ max: -6, label: 'disaster', result: 'failed', critical: true }, { min: -5, max: -1, label: 'failure', result: 'failed' }, { min: 0, max: 4, label: 'success', result: 'succeeded' }, { min: 5, label: 'brilliant', result: 'succeeded', critical: true }],
}

describe('dice notation', () => {
  it('reads dice, keeps, constants and the percentile die', () => {
    expect(parseNotation('2D6 + 1').text).toBe('2d6+1')
    expect(parseNotation('d%').terms).toEqual([{ sign: 1, count: 1, sides: 100 }])
    expect(parseNotation('4d6kh3').terms[0]).toMatchObject({ keep: { mode: 'kh', n: 3 } })
    expect(notationRange(parseNotation('2d6+1'))).toEqual({ min: 3, max: 13 })
    expect(notationRange(parseNotation('1d8-1d4'))).toEqual({ min: -3, max: 7 })
  })

  it('refuses what is not notation, too many dice and sides', () => {
    for (const bad of ['', 'abc', '5', '2d', '0d6', '101d6', '1d1', '1d1001', '4d6kh4', '4d6kh0']) expect(() => parseNotation(bad), bad).toThrow()
  })

  it('keeps the highest and drops the lowest', () => {
    expect(rollNotation(parseNotation('4d6kh3'), faces(2, 5, 4, 6))).toMatchObject({ faces: [2, 5, 4, 6], kept: [5, 4, 6], total: 15 })
    expect(rollNotation(parseNotation('2d20kl1'), faces(14, 9)).kept).toEqual([9])
    expect(rollNotation(parseNotation('4d6dl1'), faces(2, 5, 4, 6)).total).toBe(15)
    expect(rollNotation(parseNotation('1d8-1d4+2'), faces(5, 3)).total).toBe(4)
  })

  it('rolls plain dice from the system source within range', () => {
    for (let i = 0; i < 200; i += 1) {
      const rolled = rollPlain('2d6')
      expect(rolled.total).toBeGreaterThanOrEqual(2)
      expect(rolled.total).toBeLessThanOrEqual(12)
    }
  })
})

describe('reading a check', () => {
  it('reads the total against a target and finds the band', () => {
    expect(rollCheck(skill, { target: 12 }, faces(12))).toMatchObject({ total: 12, value: 0, readout: { label: 'success', result: 'succeeded', critical: false } })
    expect(rollCheck(skill, { target: 12, bonus: 3 }, faces(15))).toMatchObject({ total: 18, value: 6, readout: { label: 'brilliant', critical: true } })
    expect(rollCheck(skill, { target: 15 }, faces(2)).readout).toMatchObject({ label: 'disaster', result: 'failed' })
  })

  it('needs a target when it is read against one', () => {
    expect(() => rollCheck(skill, {}, faces(10))).toThrow('give one')
  })

  it('reads roll-under and counts successes', () => {
    const under: DiceCheckDefinition = { key: 'pct', name: 'Percentile', use: 'x', dice: 'd100', compare: 'under', bands: [{ max: -1, label: 'miss', result: 'failed' }, { min: 0, label: 'hit', result: 'succeeded' }] }
    expect(rollCheck(under, { target: 60 }, faces(45)).readout.label).toBe('hit')
    expect(rollCheck(under, { target: 60 }, faces(61)).readout.label).toBe('miss')
    const pool: DiceCheckDefinition = { key: 'pool', name: 'Pool', use: 'x', dice: '5d10', reading: 'successes', hit: 8, bands: [{ max: 0, label: 'botch', result: 'failed' }, { min: 1, max: 2, label: 'partial', result: 'partial' }, { min: 3, label: 'success', result: 'succeeded' }] }
    expect(rollCheck(pool, {}, faces(8, 3, 10, 9, 1))).toMatchObject({ total: 3, readout: { label: 'success' } })
    expect(rollCheck(pool, {}, faces(1, 2, 3, 4, 5)).readout.label).toBe('botch')
  })

  it('adds a modifier and refuses bands with a gap', () => {
    expect(rollCheck({ ...skill, compare: 'absolute', bands: [{ label: 'any', result: 'succeeded' }] }, { modifier: 3 }, faces(10)).total).toBe(13)
    expect(() => rollCheck({ ...skill, bands: [{ min: 10, label: 'high', result: 'succeeded' }] }, { target: 0 }, faces(1))).toThrow('gap')
  })

  it('finds what is wrong with a definition', () => {
    expect(checkProblems(skill)).toEqual([])
    expect(checkProblems({ ...skill, dice: 'nope' })[0]).toContain('"dice"')
    expect(checkProblems({ ...skill, bands: [] })).toContain('it needs at least one band')
    expect(checkProblems({ ...skill, compare: 'absolute', bands: [{ min: 5, label: 'x', result: 'failed' }] }).join(' ')).toContain('no band holds 1')
    expect(checkProblems({ ...skill, reading: 'successes' }).join(' ')).toContain('hit')
    expect(checkProblems({ ...skill, key: 'Bad Key' })[0]).toContain('key')
  })
})

describe('the dice tools', () => {
  let store: SessionStore
  let script: () => number
  beforeEach(() => {
    store = memoryStore()
    const { id } = store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [], control: 'agent' }))
    store.variables.define({ key: 'brawn', name: 'Brawn', kind: 'number', subject: 'character', default: 2, min: 0, max: 10, integer: true, visibility: 'public' } as never)
    store.variables.set('brawn', 'character', id, { value: 3 }, 1)
    store.dice.define({ ...skill, key: 'brawny', name: 'Brawn check', modifier: 'brawn', compare: 'over' })
    store.dice.define(skill)
  })
  afterEach(() => { store.close() })

  const tool = (name: string, roller = () => script()) => {
    const link: DiceLink = { session: store as never, turn: 5 }
    return createDiceTools(id => (id === 'agent-1' ? link : undefined), { roller }).find(entry => entry.name === name)!
  }
  const call = async (name: string, args: object) => {
    const found = tool(name)
    const value = await found.execute(args as never, { agent: { session: { id: 'agent-1' } }, signal: new AbortController().signal } as never)
    return { value: value as never as Record<string, unknown>, text: found.output.render(args as never, value as never).map(block => (block.type === 'text' ? block.text : '')).join('') }
  }

  it('rolls a check, adds the character\'s quality, records it and reads the band', async () => {
    script = faces(9)
    const { value, text } = await call('roll_check', { check: 'brawny', reason: 'Alice forces the door', character: 'alice', target: 10 })
    expect(value).toMatchObject({ total: 12, result: 'succeeded', label: 'success' })
    expect(text).toContain('decided by the dice')
    expect(text).toContain("give alice's outcome this result and cite the roll: roll 1")
    expect(store.dice.rolls({ turn: 5 })).toHaveLength(1)
    expect(store.dice.rolls()[0]).toMatchObject({ check: 'brawny', character: 'alice', modifier: 3, total: 12, by: 'agent' })
  })

  it('names what a check needs that is missing', async () => {
    script = faces(9)
    await expect(call('roll_check', { check: 'brawny', reason: 'x', character: 'nobody', target: 10 })).rejects.toThrow('list_characters')
    await expect(call('roll_check', { check: 'skill', reason: 'x', character: 'alice' })).rejects.toThrow('target')
    await expect(call('roll_check', { check: 'nope', reason: 'x', character: 'alice', target: 1 })).rejects.toThrow('list_checks')
  })

  it('rolls plain dice and lists the checks', async () => {
    script = faces(3, 4)
    const { value } = await call('roll_dice', { expression: '2d6+1', reason: 'damage' })
    expect(value).toMatchObject({ total: 8 })
    await expect(call('roll_dice', { expression: 'banana', reason: 'x' })).rejects.toThrow('not dice notation')
    const listed = (await call('list_checks', {})).value as unknown as { key: string }[]
    expect(listed.map(entry => entry.key)).toEqual(['brawny', 'skill'])
  })
})

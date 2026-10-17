import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionStore } from '@dsh-agentic-roleplay/state'
import { describeChecks } from '../../../src/host/dice/describe.ts'
import { loadDice, parseDiceFile } from '../../../src/host/dice/load.ts'
import { populateDice } from '../../../src/host/sessions/populate.ts'
import { rollView } from '../../../src/host/dice/view.ts'
import { translator } from 'dsh-roleplay-model'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dice-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const skill = { key: 'skill', name: 'Skill', use: 'An uncertain attempt that matters.', dice: '1d20', compare: 'over', bands: [{ max: -1, label: 'failure', result: 'failed' }, { min: 0, max: 9, label: 'success', result: 'succeeded' }, { min: 10, label: 'great success', result: 'succeeded', critical: true }] }
const issues = (text: string): string[] => { const result = parseDiceFile(text); return result.ok ? [] : result.issues.map(issue => `${issue.path}: ${issue.message}`) }

describe('the dice checks of a world', () => {
  it('reads checks with their dice, what they are read against and their bands', () => {
    const result = parseDiceFile(JSON.stringify({ checks: [skill] }))
    expect(result).toEqual({ ok: true, value: [{ ...skill, reading: 'total' }] })
    expect(parseDiceFile('{}')).toEqual({ ok: true, value: [] })
  })

  it('tells every problem with where it is, including what the dice cannot read', () => {
    expect(issues(JSON.stringify({ checks: [{ ...skill, dice: 'lots' }, { ...skill, bands: [] }, { key: 'x' }, { ...skill, compare: 'sideways', bands: [{ label: 'a', result: 'maybe' }] }] }))).toEqual(expect.arrayContaining([
      expect.stringContaining('checks[0]'),
      expect.stringContaining('not dice notation'),
      expect.stringContaining('at least one band'),
      expect.stringContaining('checks[2].name: is required'),
      expect.stringContaining('compare: must be one of'),
      expect.stringContaining('result: must be one of'),
      expect.stringContaining('the key "skill" is used by more than one check'),
    ]))
    expect(issues('{ nope')).toHaveLength(1)
  })

  it('has no checks without a file, and reports a file that cannot be read', async () => {
    expect(await loadDice(directory)).toEqual({ checks: [], problems: [] })
    await writeFile(join(directory, 'dice.json'), JSON.stringify({ checks: [{ key: 'x' }] }))
    expect((await loadDice(directory)).problems.length).toBeGreaterThan(0)
  })

  it('is kept with the story, told to the game master in the chat\'s language, and shown to the player as a line', async () => {
    await writeFile(join(directory, 'dice.json'), JSON.stringify({ checks: [skill, { key: 'luck', name: 'Luck', use: 'Pure chance.', dice: 'd100', bands: [{ max: 49, label: 'no', result: 'failed' }, { min: 50, label: 'yes', result: 'succeeded' }] }] }))
    const { checks } = await loadDice(directory)
    const store = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    populateDice(store, checks)
    expect(store.dice.checks().map(check => check.key)).toEqual(['skill', 'luck'])
    expect(describeChecks(store.dice.checks(), translator('en'))).toContain('- skill (Skill): An uncertain attempt that matters. Rolls 1d20. Give a target: the difficulty, the number to meet or beat; set it by how hard the attempt is.')
    expect(describeChecks(store.dice.checks(), translator('zh'))).toContain('需给出 target：难度，即要达到或超过的数字；按这次尝试的难易来定。')
    expect(describeChecks([], translator('en'))).toContain('roll_dice only')
    const roll = store.dice.record({ turn: 1, check: 'skill', expression: '1d20', faces: [14], kept: [14], modifier: 2, target: 10, total: 16, value: 6, readout: { label: 'success', result: 'succeeded', critical: false }, reason: 'Alice forces the door', by: 'agent' })
    expect(rollView(roll).text).toBe('Alice forces the door: 1d20 [14] +2 = 16 / 10 - success')
    store.close()
  })
})

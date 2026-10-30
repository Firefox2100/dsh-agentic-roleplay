import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadTriggers, parseTriggersFile } from '../../../src/host/triggers/load.ts'

const storm = { key: 'storm', name: 'The storm', when: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: 'Thunder rolls over the ridge.' }] }

describe('triggers.json', () => {
  it('keeps a beat for the author whose reason is a sentence (older worlds wrote it so): the sentence goes first in the text and the reason is the usual one', () => {
    const beat = (need: unknown) => ({ ...storm, effects: [{ type: 'beat', dispatch: 'author', need, text: 'A newcomer joins the cult.' }] })
    const parsed = parseTriggersFile(JSON.stringify([beat('arrival'), { ...beat(undefined), key: 'other' }, { ...beat('a person who wants to join'), key: 'older' }]))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.map(trigger => trigger.effects[0])).toEqual([
      { type: 'beat', dispatch: 'author', need: 'arrival', text: 'A newcomer joins the cult.' },
      { type: 'beat', dispatch: 'author', text: 'A newcomer joins the cult.' },
      { type: 'beat', dispatch: 'author', text: 'a person who wants to join. A newcomer joins the cult.' },
    ])
  })

  it('refuses a key that is not lowercase ASCII when the file is read, not only when a story starts', () => {
    const parsed = parseTriggersFile(JSON.stringify([{ ...storm, key: '旅途偶遇' }, { ...storm, key: 'Storm' }]))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues.map(issue => issue.message).join()).toMatch(/lowercase letters, digits, hyphens and underscores/)
  })

  it('is a list of what the world does when something comes true, with defaults for what is left out', () => {
    const parsed = parseTriggersFile(JSON.stringify([storm, { ...storm, key: 'bell', when: { type: 'event', tag: 'theft' }, repeat: true, cooldown_seconds: 60, chance: 0.5, priority: 2 }]))
    expect(parsed).toMatchObject({ ok: true, value: [{ key: 'storm', repeat: false, priority: 0 }, { key: 'bell', repeat: true, cooldownSeconds: 60, chance: 0.5, priority: 2 }] })
  })

  it('reads who knows beforehand and what, and who a cue is for: everyone, named characters or a place', () => {
    const parsed = parseTriggersFile(JSON.stringify([{ ...storm, effects: [{ type: 'cue', audience: 'everyone', text: 'War.' }, { type: 'cue', characters: ['clara'], text: 'Smoke.' }, { type: 'cue', audience: { place: 'bar' }, text: 'Hush.' }], announce: { audience: { characters: ['clara'] }, text: 'The storm is forecast.', from: '1912-10-01T00:00', at: '1912-10-05T21:00' } }]))
    expect(parsed).toMatchObject({ ok: true, value: [{ effects: [{ audience: 'everyone' }, { audience: { characters: ['clara'] } }, { audience: { place: 'bar' } }], announce: { audience: { characters: ['clara'] }, text: 'The storm is forecast.', from: '1912-10-01T00:00', at: '1912-10-05T21:00' } }] })
  })

  it('is reported with where each problem is: not JSON, not a list, a bad condition or effect, a key used twice', () => {
    expect(parseTriggersFile('{nope')).toMatchObject({ ok: false, issues: [{ path: '', message: expect.stringContaining('invalid JSON') }] })
    expect(parseTriggersFile('{}')).toEqual({ ok: false, issues: [{ path: '', message: 'expected a list of triggers' }] })
    const bad = parseTriggersFile(JSON.stringify([{ ...storm, when: { type: 'place', character: 'clara' } }, { ...storm, effects: [{ type: 'beat' }] }, storm, storm]))
    expect(bad).toMatchObject({ ok: false })
    expect('issues' in bad && bad.issues).toEqual(expect.arrayContaining([
      { path: '[0].when.location', message: 'required text' }, { path: '[1].effects[0].text', message: expect.stringContaining('required text') }, { path: '', message: 'the trigger "storm" is defined twice' },
    ]))
  })

  describe('in a world folder', () => {
    let world: string
    beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'triggers-')) })
    afterEach(async () => { await rm(world, { recursive: true, force: true }) })

    it('is read when there, nothing when not, and its problems are reported with the file', async () => {
      expect(await loadTriggers(world)).toEqual({ triggers: [], problems: [] })
      await mkdir(world, { recursive: true })
      await writeFile(join(world, 'triggers.json'), JSON.stringify([storm]))
      expect((await loadTriggers(world)).triggers.map(trigger => trigger.key)).toEqual(['storm'])
      await writeFile(join(world, 'triggers.json'), '[{"name":"X"}]')
      const bad = await loadTriggers(world)
      expect(bad.problems.every(problem => problem.path === join(world, 'triggers.json'))).toBe(true)
      expect(bad.problems.map(problem => problem.message)).toEqual(expect.arrayContaining([expect.stringContaining('[0].key')]))
    })
  })
})

import { describe, expect, it } from 'vitest'
import { occurrenceAt } from '@dsh-agentic-roleplay/state'
import { parseCharacterFile } from '../../src/host/characters/character-file.ts'
import { loadData, worldOfRow } from './framework/index.ts'

/**
 * The offline half of the benchmark of stories that go on while the player is away: the days its layers write are relative to the moment a row starts, so what must hold
 * whatever time of day that is (midnight included) is held here against the product's own reading of a day: the right window at the right minute, no gap in the day, and a
 * goal that falls due after the story began and not before. The rows themselves are played by `rows-live.spec.ts`.
 */
const data = loadData()
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
const MINUTE = 60_000
const STARTS = ['2026-03-10T00:03', '2026-03-10T08:30', '2026-03-10T12:00', '2026-03-10T17:00', '2026-03-10T23:58'].map(text => Date.parse(text))

const row = (id: string) => data.rows.find(entry => entry.id === id)!
const windowsOf = (rowId: string, character: string, now: number): { windows: Parameters<typeof occurrenceAt>[0]; goal?: string } => {
  const composed = worldOfRow(data, row(rowId), now)
  expect(composed.problems).toEqual([])
  const parsed = parseCharacterFile(JSON.stringify(composed.files.get(`characters/${character}/character.json`)), character)
  if (!parsed.ok) throw new Error(`${character}: ${JSON.stringify(parsed)}`)
  const intents = (parsed.value.start as { intents?: { deadline?: string }[] }).intents
  const minutes = (text: string): number => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5))
  const windows = (parsed.value.routine ?? []).map(window => ({ days: [], on: [], start: minutes(window.from), end: minutes(window.to), activity: window.activity, interruptible: window.interruptible, ...window.sleep === true ? { sleep: true } : {} }))
  return { windows: windows as never, ...intents?.[0]?.deadline === undefined ? {} : { goal: intents[0].deadline } }
}
const at = (rowId: string, character: string, start: number, minutes: number) => occurrenceAt(windowsOf(rowId, character, start).windows, start + minutes * MINUTE, zone) as { window: { activity: string; sleep?: boolean } } | undefined

describe.each([['noodle-street', 'zh', 'laozhou', 'chen', 'xiaoyu'], ['pemberton-bakery', 'en', 'dev', 'mags', 'okafor']] as const)('the days the %s away rows write (%s)', (world, language, mover, sleeper, goal) => {
  const prefix = `${world}-away`

  it.each(STARTS)('turns the mover\'s day over three minutes after the row starts, from %#', (start) => {
    const id = `${prefix}-schedule-${language}`
    expect(at(id, mover, start, 1)?.window.activity).not.toBe(at(id, mover, start, 6)?.window.activity)
    expect(at(id, mover, start, 0)?.window.activity).toBe(at(id, mover, start, 2)?.window.activity)
    expect(at(id, mover, start, 6)?.window.activity).toBe(at(id, mover, start, 60)?.window.activity)
  })

  it.each(STARTS)('has the sleeper asleep until the wake time and awake after it, whatever the hour, from %#', (start) => {
    for (const [name, wake] of [['sleep-wake', 3], ['reply', 14]] as const) {
      const id = `${prefix}-${name}-${language}`
      expect(at(id, sleeper, start, wake - 2)?.window.sleep).toBe(true)
      expect(at(id, sleeper, start, wake + 2)?.window.sleep).not.toBe(true)
    }
  })

  it.each(STARTS)('leaves no gap in the day of the characters it writes a day for, from %#', (start) => {
    for (const [name, character] of [['schedule', mover], ['sleep-wake', sleeper], ['due-goal', goal]] as const) {
      for (let offset = 0; offset < 24 * 60; offset += 13) expect(at(`${prefix}-${name}-${language}`, character, start, offset), `${name} ${character} at +${offset} minutes`).toBeDefined()
    }
  })

  it.each(STARTS)('makes the goal fall due after the row starts and well before the wait is over, from %#', (start) => {
    const { goal: deadline } = windowsOf(`${prefix}-due-goal-${language}`, goal, start)
    expect(Date.parse(deadline!)).toBeGreaterThan(start + 2 * MINUTE)
    expect(Date.parse(deadline!)).toBeLessThan(start + 4 * MINUTE)
    expect(at(`${prefix}-due-goal-${language}`, goal, start, 0)?.window.activity).toBe(at(`${prefix}-due-goal-${language}`, goal, start, 600)?.window.activity)
  })
})

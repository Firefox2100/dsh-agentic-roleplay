import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translated, translation, translator } from 'dsh-roleplay-model'
import { describeDuration, describeInstant } from '@dsh-agentic-roleplay/state'
import { describeTime } from '../../src/host/clock/story-clock.ts'

const PACKAGES = resolve(import.meta.dirname, '../../..')

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()

/** Texts chosen at run time among a fixed set, so no call site spells them out. */
const CHOSEN = ['Summary', 'Personality', 'Background', 'Appearance', 'How you speak', 'open', 'locked', 'blocked', 'night', 'morning', 'afternoon', 'evening', 'spring', 'summer', 'autumn', 'winter', 'doubtful', 'likely', 'sure', ', ', '; ', ': ', '.', ' and ']

const used = (): string[] => {
  const found = new Set<string>(CHOSEN)
  for (const package_ of ['dsh-agentic-roleplay-core', 'dsh-roleplay-state']) {
    for (const file of sources(join(PACKAGES, package_, 'src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) found.add(match[1]!.replace(/\\'/g, '\'').replace(/\\n/g, '\n'))
    }
  }
  return [...found]
}

describe('the texts built in code', () => {
  it('have a Chinese text each, with the same placeholders', () => {
    const missing = used().filter(text => translation('zh', text) === undefined)
    expect(missing).toEqual([])
    for (const text of used()) expect(placeholders(translation('zh', text)!), text).toEqual(placeholders(text))
  })

  it('have no Chinese text that no call site asks for', () => {
    const asked = new Set(used())
    expect(translated('zh').filter(text => !asked.has(text))).toEqual([])
  })

  it('are told in English when the language has no text for them, and fill their values', () => {
    expect(translator('en')('{name} waits.', { name: 'Clara' })).toBe('Clara waits.')
    expect(translator('zh')('{name} waits.', { name: 'Clara' })).toBe('Clara waits.')
    expect(translator('zh')('You are {name}.', { name: '克拉拉' })).toBe('你是克拉拉。')
  })
})

describe('time in a language', () => {
  const at = Date.UTC(1912, 8, 21, 19, 30)

  it('is written as a date and a length of time', () => {
    expect(describeInstant(at, 'UTC')).toBe('Saturday 21 September 1912, 19:30')
    expect(describeInstant(at, 'UTC', 'zh')).toBe('1912年9月21日 星期六 19:30')
    expect(describeDuration(3 * 3600_000 + 12 * 60_000)).toBe('3 hours 12 minutes')
    expect(describeDuration(3 * 3600_000 + 12 * 60_000, 'zh')).toBe('3小时12分钟')
    expect(describeDuration(45_000, 'zh')).toBe('45秒')
  })

  it('names the season and the holiday of the day when the world has a calendar', () => {
    const calendar = { hemisphere: 'north' as const, holidays: [{ id: 'festival', name: 'Founder\'s Festival', on: ['09-21'] }] }
    expect(describeTime({ now: at, zone: 'UTC' })).toBe('Saturday 21 September 1912, 19:30 (evening)')
    expect(describeTime({ now: at, zone: 'UTC', calendar })).toBe('Saturday 21 September 1912, 19:30 (evening), autumn; today is Founder\'s Festival')
    expect(describeTime({ now: at, zone: 'UTC', calendar }, 'zh')).toBe('1912年9月21日 星期六 19:30 (傍晚)，秋季；今天是Founder\'s Festival')
  })
})

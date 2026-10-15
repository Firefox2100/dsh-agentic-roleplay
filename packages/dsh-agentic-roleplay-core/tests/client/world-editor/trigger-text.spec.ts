import { describe, expect, it } from 'vitest'
import { describeCondition, describeEffect, namesOf } from '../../../src/client/world-editor/trigger-text.ts'
import { dictionaries, type TriggersLocaleKey } from '../../../src/client/world-editor/triggers-locales.ts'

const world = {
  characters: [{ key: 'clara', name: 'Clara' }, { key: 'arthur', name: 'Arthur' }], places: [{ key: 'bar', name: 'The Bar' }, { key: 'cellar', name: 'The Cellar' }], things: [{ key: 'lantern', name: 'Brass lantern' }],
  triggers: [{ key: 'blackout', name: 'Blackout' }],
} as never
const names = namesOf(world)
const sayIn = (locale: 'en' | 'zh') => (key: TriggersLocaleKey, values: Record<string, string | number> = {}): string => dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
const en = sayIn('en')

describe('a trigger in sentences', () => {
  it('says what a condition waits for, with the names of the world and the keys of what it does not know', () => {
    expect(describeCondition(en, names, { type: 'all', conditions: [
      { type: 'place', character: 'clara', location: 'cellar' },
      { type: 'time', from: '1912-10-05T21:00', window: { from: '22:00', to: '06:00' }, days: ['fri'] },
      { type: 'not', condition: { type: 'item', item: 'lantern', heldBy: 'arthur' } },
      { type: 'variable', variable: 'health', subject: 'arthur', op: 'lt', value: 5 },
      { type: 'fired', trigger: 'blackout' }, { type: 'event', tag: 'fight' }, { type: 'item', item: 'ghost', at: 'bar' },
    ] })).toBe('all of: Clara is in The Cellar; from 1912-10-05 21:00, between 22:00 and 06:00 each day, on fri; not (Brass lantern is held by Arthur); health of Arthur is below 5; “Blackout” has fired; an event tagged “fight” was recorded; ghost is in The Bar')
  })

  it('says what an effect does, to whom, and what it waits on', () => {
    expect(describeEffect(en, names, { type: 'beat', text: 'A bell tolls.' })).toBe('tells the game master: “A bell tolls.”')
    expect(describeEffect(en, names, { type: 'cue', audience: { characters: ['clara', 'arthur'] }, text: 'Smoke.', while: { type: 'place', character: '@self', location: 'bar' } })).toBe('Clara, Arthur notice: “Smoke.” (only while @self is in The Bar)')
    expect(describeEffect(en, names, { type: 'cue', audience: { place: 'cellar' }, text: 'Damp.' })).toBe('whoever is in The Cellar notice: “Damp.”')
    expect(describeEffect(en, names, { type: 'edit', edit: { events: [{}, {}] } })).toBe('changes the story’s records (2 event(s))')
  })

  it('has the same words in both languages', () => {
    expect(Object.keys(dictionaries.zh).sort()).toEqual(Object.keys(dictionaries.en).sort())
    expect(describeEffect(sayIn('zh'), names, { type: 'cue', audience: 'everyone', text: '烟。' })).toBe('所有人察觉：“烟。”')
  })
})

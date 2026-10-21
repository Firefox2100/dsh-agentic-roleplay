import { describe, expect, it } from 'vitest'
import { verbatimEntries } from '../../../src/host/lorebooks/verbatim.ts'

const file = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))

describe('importing a lorebook as it is', () => {
  it('keeps every entry word for word, with its keywords in the summary, and a title made of the text when the entry has none', () => {
    const made = verbatimEntries(file({ name: 'Harbor', entries: [{ comment: 'Tides', key: ['tide', 'sea'], content: '{{user}} reads the tides.' }, { content: 'The harbour closes at night.\nGuards walk it.' }, { comment: 'Off', content: 'Hidden.', disable: true }] }), 'x.json', 'master')
    expect(made.name).toBe('Harbor')
    expect(made.entries).toEqual([
      { id: 'tides', title: 'Tides', kind: 'other', scope: 'listed', knownBy: [], summary: 'Also: tide, sea.', body: 'the player reads the tides.', related: [] },
      { id: 'the-harbour-closes-at-night', title: 'The harbour closes at night.', kind: 'other', scope: 'listed', knownBy: [], summary: '', body: 'The harbour closes at night.\nGuards walk it.', related: [] },
    ])
  })

  it('tells everyone when asked, gives repeated titles their own ids and cuts a very long entry in order', () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}. ${'x'.repeat(900)}`).join('\n\n')
    const made = verbatimEntries(file({ entries: [{ comment: 'Same', content: 'One.' }, { comment: 'Same', content: paragraphs }] }), 'book.json', 'everyone')
    expect(made.name).toBe('book')
    expect(made.entries.map(entry => entry.id)).toEqual(['same', 'same-2', 'same-3'])
    expect(made.entries.every(entry => entry.scope === 'everyone')).toBe(true)
    expect(made.entries.slice(1).map(entry => entry.title)).toEqual(['Same (1)', 'Same (2)'])
    expect(made.entries.slice(1).map(entry => entry.body).join('').replace(/\s+/g, '')).toBe(paragraphs.replace(/\s+/g, ''))
  })
})

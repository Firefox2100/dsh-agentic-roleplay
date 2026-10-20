import { describe, expect, it } from 'vitest'
import { batchesOf, classifyEntries, readLorebook } from '../../../src/host/import/lorebook.ts'

const file = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))

describe('reading a SillyTavern lorebook', () => {
  it('reads the exported form (entries by number), leaves out what is off or empty and keeps keys and macros out of the text', () => {
    const book = readLorebook(file({ name: 'Harbor', entries: { 0: { comment: 'Founding', key: ['harbor', 'founders'], content: '{{user}} knows the harbor was founded by {{char}}.' }, 1: { comment: 'Off', content: 'x', disable: true }, 2: { content: '  ' }, 3: { comment: 'Tides', key: ['tide'], content: 'Twice a day.' } } }), 'x.json')
    expect(book.name).toBe('Harbor')
    expect(book.entries).toEqual([
      { ref: 0, title: 'Founding', keys: ['harbor', 'founders'], text: '[PLAYER] knows the harbor was founded by the character.' },
      { ref: 1, title: 'Tides', keys: ['tide'], text: 'Twice a day.' },
    ])
  })

  it('reads the list form of a book, and the book a card carries', () => {
    expect(readLorebook(file({ name: 'B', entries: [{ keys: ['a'], content: 'One.', enabled: true }, { content: 'Two.', enabled: false }] }), 'b.json').entries).toHaveLength(1)
    expect(readLorebook(file({ data: { character_book: { name: 'Inner', entries: [{ keys: ['k'], content: 'Fact.' }] } } }), 'card.json')).toMatchObject({ name: 'Inner' })
  })

  it('refuses what is not a lorebook, with why', () => {
    expect(() => readLorebook(Buffer.from('nope'), 'a.json')).toThrow('not JSON')
    expect(() => readLorebook(file([]), 'a.json')).toThrow('JSON object')
    expect(() => readLorebook(file({ prompts: [] }), 'a.json')).toThrow('no lorebook')
    expect(() => readLorebook(file({ entries: [{ content: '' }] }), 'a.json')).toThrow('no entries')
  })

  it('groups entries into calls of a few, within a budget of text', () => {
    const entries = Array.from({ length: 10 }, (_, ref) => ({ ref, title: '', keys: [], text: 'x'.repeat(100) }))
    expect(batchesOf(entries).map(batch => batch.length)).toEqual([8, 2])
    expect(batchesOf([{ ref: 0, title: '', keys: [], text: 'x'.repeat(5000) }, { ref: 1, title: '', keys: [], text: 'x'.repeat(2000) }]).map(batch => batch.length)).toEqual([1, 1])
  })
})

describe('sorting the entries of a lorebook', () => {
  const book = { name: 'Harbor', entries: [
    { ref: 0, title: 'Founding', keys: ['harbor'], text: 'The harbor was founded in 1764.' },
    { ref: 1, title: 'Voice', keys: [], text: 'Always write in the present tense.' },
    { ref: 2, title: 'Rite', keys: [], text: 'Only the wardens know the rite.' },
    { ref: 3, title: 'Panel', keys: [], text: 'Show a status box.' },
  ] }
  const decision = (ref: number, extra: object) => ({ ref, role: 'knowledge', title: '', kind: 'other', summary: '', scope: 'everyone', known_by: [], target: '', guidance: '', ...extra })
  const ctx = (answer: unknown, seen: string[] = []) => ({ concurrency: 1, text: () => 'persona', say: () => undefined, run: async (job: { check?: (value: never) => string | undefined }) => { seen.push(job.check?.(answer as never) ?? 'ok'); return answer } }) as never

  it('keeps facts word for word as common knowledge, keeps what an entry says about who knows it, and sets instructions apart', async () => {
    const answer = { entries: [
      decision(0, { kind: 'history', summary: 'When it was founded.' }),
      decision(1, { role: 'steering', target: 'style', guidance: 'Write in the present tense.' }),
      decision(2, { kind: 'custom', title: 'The rite', scope: 'listed', known_by: ['the wardens'] }),
      decision(3, { role: 'skip' }),
    ] }
    const checks: string[] = []
    const result = await classifyEntries(ctx(answer, checks), book)
    expect(checks).toEqual(['ok'])
    expect(result.entries).toEqual([
      { id: 'founding', title: 'Founding', kind: 'history', scope: 'everyone', knownBy: [], summary: 'When it was founded. Also: harbor.', body: 'The harbor was founded in 1764.', related: [] },
      { id: 'the-rite', title: 'The rite', kind: 'custom', scope: 'listed', knownBy: ['the wardens'], summary: '', body: 'Only the wardens know the rite.', related: [] },
    ])
    expect(result.steering).toEqual({ style: ['Write in the present tense.'] })
    expect(result.notes).toEqual(['left out: “Panel”'])
  })

  it('refuses an answer that misses an entry, lists nobody for a listed one, or sends steering nowhere', async () => {
    const check = (entries: unknown[]): Promise<string[]> => { const seen: string[] = []; return classifyEntries(ctx({ entries }, seen), { name: 'B', entries: [book.entries[0]!, book.entries[1]!] }).catch(() => undefined).then(() => seen) }
    expect((await check([decision(0, {})]))[0]).toContain('1 is missing')
    expect((await check([decision(0, { scope: 'listed' }), decision(1, {})]))[0]).toContain('names nobody')
    expect((await check([decision(0, {}), decision(1, { role: 'steering' })]))[0]).toContain('say where it belongs')
    expect((await check([decision(0, {}), decision(0, {}), decision(1, {})]))[0]).toContain('decided twice')
  })
})

import { describe, expect, it } from 'vitest'
import { dropWaiting, lastPlayerAt, queueReply, readAutonomy, recordAsk, recordMessage, takeInbox } from '../../../src/host/sessions/autonomy.ts'

const fake = (created = '2026-01-01T10:00:00.000Z', played?: string) => {
  const values = new Map<string, unknown>()
  return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) }, get: () => ({ createdAt: created, ...played === undefined ? {} : { lastPlayedAt: played } }) } } as never
}

describe('what a story did on its own since the player last wrote', () => {
  it('starts with nothing, counts each message and remembers when a character was last asked', () => {
    const session = fake()
    expect(readAutonomy(session)).toEqual({ unanswered: 0, sent: {}, inbox: [], waiting: [] })
    recordMessage(session, { at: 5, character: 'ann', name: 'Ann', text: 'Hello.' })
    recordMessage(session, { at: 9, character: 'bob', name: 'Bob', text: 'Hi.' })
    recordAsk(session, 'cy', 11)
    expect(readAutonomy(session)).toMatchObject({ unanswered: 2, sent: { ann: 5, bob: 9, cy: 11 }, inbox: [{ at: 5, character: 'ann', name: 'Ann', text: 'Hello.' }, { at: 9, character: 'bob', name: 'Bob', text: 'Hi.' }] })
  })

  it('hands the inbox to the story once, and counts from nothing again when the player writes', () => {
    const session = fake()
    recordMessage(session, { at: 5, character: 'ann', name: 'Ann', text: 'Hello.' })
    expect(takeInbox(session)).toEqual([{ at: 5, character: 'ann', name: 'Ann', text: 'Hello.' }])
    expect(takeInbox(session)).toEqual([])
    expect(readAutonomy(session)).toMatchObject({ unanswered: 0, inbox: [], sent: { ann: 5 } })
  })

  it('keeps only the latest twenty messages', () => {
    const session = fake()
    for (let index = 0; index < 25; index += 1) recordMessage(session, { at: index, character: 'ann', name: 'Ann', text: `m${index}` })
    expect(readAutonomy(session).inbox).toHaveLength(20)
    expect(readAutonomy(session).inbox[0]?.text).toBe('m5')
  })

  it('reads the time the player last played, or when the story began', () => {
    expect(lastPlayerAt(fake('2026-01-01T10:00:00.000Z'))).toBe(Date.parse('2026-01-01T10:00:00.000Z'))
    expect(lastPlayerAt(fake('2026-01-01T10:00:00.000Z', '2026-01-02T08:00:00.000Z'))).toBe(Date.parse('2026-01-02T08:00:00.000Z'))
  })

  it('keeps what was left for each sleeper together, keeps it when a message is written, reads what an older version kept, and drops it once it is done with', () => {
    const session = fake()
    queueReply(session, { character: 'ann', name: 'Ann', situations: ['first'], at: 1 })
    queueReply(session, { character: 'bob', name: 'Bob', situations: ['second'], at: 2 })
    queueReply(session, { character: 'ann', name: 'Ann', situations: ['again', 'first'], at: 3 })
    expect(readAutonomy(session).waiting.map(entry => [entry.character, entry.situations])).toEqual([['bob', ['second']], ['ann', ['first', 'again']]])
    recordMessage(session, { at: 4, character: 'cy', name: 'Cy', text: 'Hi.' })
    expect(readAutonomy(session).waiting).toHaveLength(2)
    dropWaiting(session, ['bob'])
    expect(readAutonomy(session).waiting.map(entry => entry.character)).toEqual(['ann'])
    ;(session as { metadata: { setValue(key: string, value: unknown): void } }).metadata.setValue('autonomy', { unanswered: 0, sent: {}, inbox: [], waiting: [{ character: 'dee', name: 'Dee', situation: 'kept by an older version', at: 5 }] })
    expect(readAutonomy(session).waiting).toEqual([{ character: 'dee', name: 'Dee', situations: ['kept by an older version'], at: 5 }])
  })
})

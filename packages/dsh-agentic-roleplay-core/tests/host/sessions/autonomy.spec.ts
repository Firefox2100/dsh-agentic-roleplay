import { describe, expect, it } from 'vitest'
import { lastPlayerAt, readAutonomy, recordAsk, recordMessage, takeInbox } from '../../../src/host/sessions/autonomy.ts'

const fake = (created = '2026-01-01T10:00:00.000Z', played?: string) => {
  const values = new Map<string, unknown>()
  return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) }, get: () => ({ createdAt: created, ...played === undefined ? {} : { lastPlayedAt: played } }) } } as never
}

describe('what a story did on its own since the player last wrote', () => {
  it('starts with nothing, counts each message and remembers when a character was last asked', () => {
    const session = fake()
    expect(readAutonomy(session)).toEqual({ unanswered: 0, sent: {}, inbox: [] })
    recordMessage(session, { at: 5, character: 'ann', name: 'Ann', text: 'Hello.' })
    recordMessage(session, { at: 9, character: 'bob', name: 'Bob', text: 'Hi.' })
    recordAsk(session, 'cy', 11)
    expect(readAutonomy(session)).toEqual({ unanswered: 2, sent: { ann: 5, bob: 9, cy: 11 }, inbox: [{ at: 5, character: 'ann', name: 'Ann', text: 'Hello.' }, { at: 9, character: 'bob', name: 'Bob', text: 'Hi.' }] })
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
})

import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkMove } from '../../../src/host/orchestration/store.ts'

let session: SessionStore

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'unknown-place', name: 'Unknown place', world: { id: 'w', name: 'W' } })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar' }, { key: 'tower', name: 'Old Tower' }] })
  session.characters.add({ sourceId: 'arthur', name: 'Arthur', aliases: [], kind: 'person', tier: 'principal', role: 'playable', control: 'player', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  session.placements.place('character', session.characters.getBySourceId('arthur')!.id, { locationId: session.locations.getBySourceId('bar')!.id })
})
afterEach(() => { session.close() })

describe('sending a character to a place it has not heard of', () => {
  it('says what to do instead, by the place\'s name, and not that a number is unknown', () => {
    const checked = checkMove(session as never, 'arthur', { location: 'tower', ignoreExits: false })
    expect(checked.ok).toBe(false)
    const [problem] = checked.ok ? [] : checked.problems
    expect(problem).toContain('has not heard of Old Tower')
    expect(problem).toContain('get_character lists them')
    expect(problem).not.toMatch(/place \d/)
  })
})

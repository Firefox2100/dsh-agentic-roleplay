import { describe, expect, it } from 'vitest'
import type { RecordsView } from '@dsh-agentic-roleplay/state'
import { compareStates, type StateSide } from '../../../src/host/timeline/compare.ts'

const view = (data: Partial<RecordsView>): RecordsView => ({ factions: [], faction_relationships: [], characters: [], events: [], beliefs: [], open_threads: [], items: [], variable_defs: [], variables: [], engagements: [], relationships: [], knowledge: [], ...data })
const character = (key: string, location: string | null, activity = 'waiting'): RecordsView['characters'][number] => ({ character: key, name: key.toUpperCase(), controlled_by: 'an agent', public_state: '', inner_state: '', activity, location, position: '', goals: [] })
const side = (label: string, data: Partial<RecordsView>, turns = 1, now = '2030-01-01T00:00:00.000Z'): StateSide => ({ label, turns, now, view: view(data) })

describe('the difference between two states of a story', () => {
  it('lists what moved, what changed hands, what was tracked, which threads opened or closed, and the time', () => {
    const first = side('turn 1', {
      characters: [character('ana', 'quay'), character('bo', 'quay', 'asleep')],
      items: [{ key: 'key', name: 'Key', quantity: 1, quality: '', state: null, hidden: false, notable: true, owner: null, holder: 'carried by ana' }],
      variables: [{ variable: 'alarm', subject: 'world', about: '', value: 1, described: '', baseline: null, visibility: 'public' }],
      open_threads: [{ id: 1, text: 'Find the ledger', opened_turn: 1 }],
      relationships: [{ from: 'ana', to: 'bo', label: 'friend', summary: '', familiarity: 0.5, trust: 0.5, affinity: 0.5, tension: 0.1, updated_turn: 1 }],
    })
    const second = side('turn 3', {
      characters: [character('ana', 'tower'), character('bo', 'quay', 'asleep')],
      items: [{ key: 'key', name: 'Key', quantity: 1, quality: '', state: null, hidden: false, notable: true, owner: null, holder: 'carried by bo' }],
      variables: [{ variable: 'alarm', subject: 'world', about: '', value: 3, described: '', baseline: null, visibility: 'public' }],
      open_threads: [{ id: 2, text: 'Reach the tower', opened_turn: 3 }],
      relationships: [{ from: 'ana', to: 'bo', label: 'friend', summary: '', familiarity: 0.5, trust: 0.2, affinity: 0.5, tension: 0.1, updated_turn: 3 }],
    }, 3, '2030-01-01T06:00:00.000Z')
    const { changes, a, b } = compareStates(first, second)
    expect([a, b]).toEqual(['turn 1', 'turn 3'])
    expect(changes).toEqual(expect.arrayContaining([
      { area: 'time', subject: 'story time', a: '2030-01-01T00:00:00.000Z', b: '2030-01-01T06:00:00.000Z' },
      { area: 'turns', subject: 'turns played', a: '1', b: '3' },
      { area: 'position', subject: 'ANA', a: 'quay', b: 'tower' },
      { area: 'item', subject: 'Key', a: 'carried by ana', b: 'carried by bo' },
      { area: 'variable', subject: 'alarm of world', a: '1', b: '3' },
      { area: 'thread', subject: 'open thread', a: 'Find the ledger' },
      { area: 'thread', subject: 'open thread', b: 'Reach the tower' },
      { area: 'relationship', subject: 'ana to bo', a: 'friend (trust 0.5, affinity 0.5, tension 0.1)', b: 'friend (trust 0.2, affinity 0.5, tension 0.1)' },
    ]))
    expect(changes.find(change => change.subject === 'BO')).toBeUndefined()
  })

  it('finds nothing between a state and itself', () => {
    const same = side('now', { characters: [character('ana', 'quay')] })
    expect(compareStates(same, same).changes).toEqual([])
  })
})

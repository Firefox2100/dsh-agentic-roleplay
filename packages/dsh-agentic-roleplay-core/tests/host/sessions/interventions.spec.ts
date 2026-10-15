import { describe, expect, it } from 'vitest'
import { readInterventions } from '../../../src/host/sessions/interventions.ts'

const notes = [
  { id: 1, triggerId: 1, kind: 'beat', text: 'A bell rings.', characterIds: [], turn: 2, status: 'done' },
  { id: 2, triggerId: 1, kind: 'cue', text: 'Look at the door.', characterIds: [7, 8], turn: 3, status: 'pending' },
  { id: 3, triggerId: 9, kind: 'cue', text: 'Ignore the draught.', characterIds: [7], turn: 3, status: 'lapsed' },
  { id: 4, triggerId: 1, kind: 'cue', text: 'Smell {item:smoke}.', characterIds: [7], turn: 4, status: 'lapsed' },
] as const

const session = {
  triggers: { notes: () => notes, get: (id: number) => (id === 1 ? { key: 'bell' } : undefined) },
  characters: { get: (id: number) => (id === 7 ? { name: 'Clara' } : undefined) },
  metadata: { getValue: () => [{ note: 4, reason: 'what it was waiting on no longer holds' }] },
} as unknown as Parameters<typeof readInterventions>[0]

describe('what the triggers delivered', () => {
  it('tells what became of each beat and cue, and who a cue was for', () => {
    expect(readInterventions(session)).toEqual([
      { turn: 2, kind: 'beat', text: 'A bell rings.', trigger: 'bell', characters: [], status: 'taken' },
      { turn: 3, kind: 'cue', text: 'Look at the door.', trigger: 'bell', characters: ['Clara'], status: 'waiting' },
      { turn: 3, kind: 'cue', text: 'Ignore the draught.', trigger: '', characters: ['Clara'], status: 'lapsed' },
      { turn: 4, kind: 'cue', text: 'Smell {item:smoke}.', trigger: 'bell', characters: ['Clara'], status: 'withdrawn', reason: 'what it was waiting on no longer holds' },
    ])
  })
})

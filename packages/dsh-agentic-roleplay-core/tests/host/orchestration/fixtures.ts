import type { Character, CharacterState } from 'dsh-roleplay-model'
import type { CastMember, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import type { CharacterAction } from '../../../src/host/orchestration/protocol.ts'
import type { RunCharacter } from '../../../src/host/orchestration/turn-engine.ts'

export function member(key: string, name: string, control: Character['control'] = 'agent', state?: Partial<CharacterState>): CastMember {
  const character: Character = {
    id: key.length as Character['id'], sourceId: key, name, aliases: [], kind: 'person', tier: 'principal',
    role: control === 'player' ? 'playable' : 'npc', summary: `${name} summary`, personality: '', background: '', appearance: '',
    speech: { style: '', examples: [] }, control, createdAt: '2026-01-01T00:00:00.000Z',
  }
  return { key, character: { ...character, id: hash(key) as Character['id'] }, ...(state === undefined ? {} : { state: state as CharacterState }) }
}

function hash(key: string): number {
  return [...key].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) % 100000
}

export const arthur = member('arthur', 'Arthur', 'player')
export const alice = member('alice', 'Alice')
export const bob = member('bob', 'Bob')
export const carol = member('carol', 'Carol')
export const dan = member('dan', 'Dan')

export interface FakeStore extends TurnStore {
  commits: { character: number; patch: Record<string, unknown> }[][]
  /** How many turns were counted as played. */
  completed: number
  /** What the chat's settings allow; change it to change the settings the engine reads. */
  maxRounds: number
}

export function fakeStore(cast: CastMember[], maxRounds = 3): FakeStore {
  const commits: FakeStore['commits'] = []
  const store: FakeStore = {
    commits,
    completed: 0,
    maxRounds,
    cast: () => cast,
    settings: () => ({ maxRounds: store.maxRounds }),
    commit: (updates) => { commits.push(updates.map(update => ({ character: update.character as number, patch: { ...update.patch } }))) },
    completeTurn: () => { store.completed += 1 },
  }
  return store
}

/** Answers each character from a table, and records every request it receives. */
export function scriptedRunner(answers: Record<string, CharacterAction | CharacterAction[] | Error>) {
  const requests: Parameters<RunCharacter>[0][] = []
  const run: RunCharacter = (request) => {
    requests.push(request)
    const answer = answers[request.member.key]
    if (answer === undefined) return Promise.reject(new Error(`no answer scripted for ${request.member.key}`))
    if (answer instanceof Error) return Promise.reject(answer)
    if (Array.isArray(answer)) {
      const next = answer.shift()
      return next === undefined ? Promise.reject(new Error('answers exhausted')) : Promise.resolve(next)
    }
    return Promise.resolve(answer)
  }
  return { run, requests }
}

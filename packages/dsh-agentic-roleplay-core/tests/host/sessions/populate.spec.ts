import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, type Session } from 'dsh-roleplay-state'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import { populateCharacters } from '../../../src/host/sessions/populate.ts'

let dir: string
let state: RoleplayState
let session: Session

function definition(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    id: 'eleanor-graves',
    name: 'Eleanor Graves',
    aliases: ['the Mayor'],
    age: '42',
    pronouns: 'she/her',
    kind: 'person',
    tier: 'principal',
    role: 'npc',
    summary: 'Mayor of Blackwater Ridge.',
    personality: 'Calculating.',
    background: '',
    appearance: 'Sharp features.',
    speech: { style: 'Formal.', examples: ['Let us not make a scene.'] },
    start: {
      publicState: 'Greeting guests.',
      innerState: 'Wondering.',
      activity: 'managing appearances',
      emotion: {
        baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
        immediate: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
      },
      intents: [{
        type: 'agenda', name: 'Contain the scandal', description: '', status: 'active', horizon: 'day',
        priority: 0.8, urgency: 0.6, plan: ['Charm the visitor'], openThreads: [], constraints: [],
      }],
    },
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'populate-'))
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  session = state.createSession(join(dir, 'sessions'), { name: 'S', world: { id: 'w', name: 'W' } })
})
afterEach(async () => {
  state.deleteSession(join(dir, 'sessions'), session.metadata.get().id)
  await rm(dir, { recursive: true, force: true })
})

describe('populateCharacters', () => {
  it('stores each character with its start state and intents, linked to the world file by id', () => {
    populateCharacters(session, [definition(), definition({ id: 'clara', name: 'Clara', aliases: [], start: { publicState: '', innerState: '', activity: '', intents: [] } })], 'clara')
    const [eleanor, clara] = session.characters.list()
    expect(eleanor).toMatchObject({ sourceId: 'eleanor-graves', name: 'Eleanor Graves', aliases: ['the Mayor'], pronouns: 'she/her', role: 'npc' })
    expect(eleanor).not.toHaveProperty('start')
    expect(session.characterStates.get(eleanor?.id ?? 0)).toMatchObject({
      publicState: 'Greeting guests.', innerState: 'Wondering.', activity: 'managing appearances', version: 1,
      emotion: { baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 } },
    })
    expect(session.intents.list(eleanor?.id ?? 0).map(intent => intent.name)).toEqual(['Contain the scandal'])
    expect(clara).toMatchObject({ sourceId: 'clara', name: 'Clara' })
    expect(session.characterStates.get(clara?.id ?? 0)).not.toHaveProperty('emotion')
    expect(session.intents.list(clara?.id ?? 0)).toEqual([])
  })

  it('gives the player the chosen character and the agent everyone else', () => {
    populateCharacters(session, [
      definition({ id: 'a', name: 'A', role: 'playable' }),
      definition({ id: 'b', name: 'B', role: 'playable' }),
      definition({ id: 'c', name: 'C' }),
    ], 'b')
    expect(session.characters.list().map(character => [character.name, character.control])).toEqual([
      ['A', 'agent'], ['B', 'player'], ['C', 'agent'],
    ])
    expect(session.characters.list({ control: 'player' })).toHaveLength(1)
  })

  it('leaves everyone to the agent when the player\'s character is not in the cast', () => {
    populateCharacters(session, [definition()], 'nobody')
    expect(session.characters.list().map(character => character.control)).toEqual(['agent'])
  })

  it('does nothing for an empty cast', () => {
    populateCharacters(session, [], 'x')
    expect(session.characters.list()).toEqual([])
  })
})

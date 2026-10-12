import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { castSummary } from '../../../src/host/orchestration/defaults.ts'
import { alice, arthur, bob, withRanking } from './fixtures.ts'

let story: SessionStore

beforeEach(() => {
  story = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  for (const { character } of [alice, bob]) {
    const { id: _id, createdAt: _createdAt, ...fields } = character
    story.characters.add(fields)
  }
  for (const [turn, text] of [[3, 'Carol sang by the river.'], [3, 'The cook burned the soup.'], [4, 'Dan counted the coins twice.'], [4, 'The mayor gave a long speech.']] as const) event(turn, text)
  story.summaries.add({ level: 'digest', text: 'Earlier.', fromTurn: 1, toTurn: 5 })
})
afterEach(() => { story.close() })

function event(turn: number, text: string, tags: string[] = []) {
  return story.edit({
    turn, events: [{ turn, round: 1, text, importance: 3, tags, involves: [], perceivedBy: [] }],
  }, { seal: true }).eventIds[0]!
}

const scene = (input: string, queryVector?: readonly number[]) => castSummary.scene({ cast: [arthur, alice, bob], turn: 6, input, story: withRanking(story), ...(queryVector === undefined ? {} : { queryVector }) })

describe('the scene the game master is told', () => {
  it('reminds it of folded events that match the player\'s move by words', () => {
    event(1, 'Bob hid the brass key under the floor.', ['key'])
    event(2, 'The band played a march.')
    const text = scene('I look for the brass key')
    expect(text).toContain('(turn 1) Bob hid the brass key under the floor.')
    expect(text).not.toContain('march')
  })

  it('also reminds it of what means the same, through the stored vectors, when the vector of the move is given', () => {
    event(1, 'Bob hid the brass key under the floor.')
    event(2, 'The band played a march.')
    story.recallIndex.store('m', story.recallIndex.pending(100).map(item => ({ id: item.id, vector: /key/.test(item.text) ? [1, 0] : [0, 1] })))
    expect(scene('Where did he stash the thing that opens the vault?')).not.toContain('brass key')
    expect(scene('Where did he stash the thing that opens the vault?', [1, 0.05])).toContain('(turn 1) Bob hid the brass key under the floor.')
  })

  it('leaves out events that are not folded yet, since the conversation still has them', () => {
    event(7, 'Bob hid the brass key under the floor.')
    expect(scene('the brass key')).not.toContain('brass key under')
  })
})

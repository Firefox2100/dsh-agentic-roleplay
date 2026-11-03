import { describe, expect, it } from 'vitest'
import { RollReplay, type RollPolicy } from '../../../src/host/dice/replay.ts'

const draw = (replay: RollReplay, chat: string, count: number): number[] => Array.from({ length: count }, () => replay.roller(chat)(20))

describe('dice that fall the same way when a turn is played again', () => {
  it('give the same numbers in the same order to a turn played again from the same place, and other numbers from another place', () => {
    const replay = new RollReplay(() => 'keep')
    replay.begin('chat', 'story', 'n1')
    const first = draw(replay, 'chat', 12)
    replay.begin('chat', 'story', 'n1')
    expect(draw(replay, 'chat', 12)).toEqual(first)
    replay.begin('chat', 'story', 'n2')
    expect(draw(replay, 'chat', 12)).not.toEqual(first)
    replay.begin('chat', 'other story', 'n1')
    expect(draw(replay, 'chat', 12)).not.toEqual(first)
    expect(first.every(value => value >= 1 && value <= 20)).toBe(true)
  })

  it('are the system\'s own when the story rerolls, and outside a turn', () => {
    let policy: RollPolicy = 'reroll'
    const replay = new RollReplay(() => policy)
    replay.begin('chat', 'story', null)
    const rerolled = [draw(replay, 'chat', 40), (replay.begin('chat', 'story', null), draw(replay, 'chat', 40))]
    expect(rerolled[0]).not.toEqual(rerolled[1])
    policy = 'keep'
    const outside = replay.roller('nobody')(6)
    expect(outside).toBeGreaterThanOrEqual(1)
    expect(outside).toBeLessThanOrEqual(6)
  })

  it('follow the setting of the moment', () => {
    let policy: RollPolicy = 'keep'
    const replay = new RollReplay(() => policy)
    replay.begin('chat', 'story', 'n1')
    const kept = draw(replay, 'chat', 5)
    policy = 'reroll'
    replay.begin('chat', 'story', 'n1')
    expect(draw(replay, 'chat', 30)).not.toEqual(draw(replay, 'chat', 30))
    policy = 'keep'
    replay.begin('chat', 'story', 'n1')
    expect(draw(replay, 'chat', 5)).toEqual(kept)
  })
})

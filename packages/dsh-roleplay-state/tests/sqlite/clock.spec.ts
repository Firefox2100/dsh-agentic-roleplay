import { describe, expect, it } from 'vitest'
import { ConflictError, InvalidValueError, NotFoundError } from '../../src/index.ts'
import { memoryStore } from '../helpers.ts'

const noon = Date.UTC(1912, 9, 4, 12)

describe('the story clock', () => {
  it('is not started until it is, and starts once', () => {
    const { clock } = memoryStore()
    expect(clock.get()).toBeUndefined()
    expect(clock.start('simulated', noon)).toEqual({ mode: 'simulated', now: noon })
    expect(clock.get()).toEqual({ mode: 'simulated', now: noon })
    expect(() => clock.start('real', noon)).toThrow(ConflictError)
    expect(clock.log()).toEqual([{ id: 1, turn: 0, round: 0, kind: 'start', from: noon, to: noon, reason: '' }])
  })

  it('moves forward and keeps each step with where in the story it was', () => {
    const { clock } = memoryStore()
    clock.start('simulated', noon)
    clock.advance({ to: noon + 60_000, turn: 1, round: 1, kind: 'elapsed' })
    clock.advance({ to: noon + 3_660_000, turn: 1, round: 1, kind: 'skip', reason: 'waited for the ferry' })
    expect(clock.get()?.now).toBe(noon + 3_660_000)
    expect(clock.log({ turn: 1 }).map(step => [step.kind, step.from, step.to, step.reason])).toEqual([
      ['elapsed', noon, noon + 60_000, ''],
      ['skip', noon + 60_000, noon + 3_660_000, 'waited for the ferry'],
    ])
    expect(clock.log({ kind: 'skip' })).toHaveLength(1)
    expect(clock.log({ fromTurn: 2 })).toEqual([])
  })

  it('never goes back by advancing, nor to what is not an instant, nor before it is started', () => {
    const { clock } = memoryStore()
    expect(() => clock.advance({ to: noon, turn: 1, round: 1, kind: 'elapsed' })).toThrow(NotFoundError)
    clock.start('simulated', noon)
    expect(() => clock.advance({ to: noon - 1, turn: 1, round: 1, kind: 'elapsed' })).toThrow(InvalidValueError)
    expect(() => clock.advance({ to: 1.5, turn: 1, round: 1, kind: 'elapsed' })).toThrow(InvalidValueError)
    expect(clock.advance({ to: noon, turn: 1, round: 1, kind: 'elapsed' })).toMatchObject({ from: noon, to: noon })
  })

  it('changes mode by setting the time, in either direction, and says so', () => {
    const { clock } = memoryStore()
    clock.start('simulated', noon)
    const back = clock.resync('real', noon - 86_400_000, 4, 'followed the wall clock')
    expect(back).toMatchObject({ kind: 'resync', from: noon, to: noon - 86_400_000, turn: 4, round: 0 })
    expect(clock.get()).toEqual({ mode: 'real', now: noon - 86_400_000 })
  })

  it('tells when a round began, from the steps of the round, and not from a skip', () => {
    const { clock } = memoryStore()
    clock.start('simulated', noon)
    clock.advance({ to: noon + 120_000, turn: 2, round: 0, kind: 'skip' })
    clock.advance({ to: noon + 180_000, turn: 2, round: 1, kind: 'elapsed' })
    clock.advance({ to: noon + 240_000, turn: 2, round: 2, kind: 'real' })
    expect(clock.at(2, 1)).toBe(noon + 120_000)
    expect(clock.at(2, 2)).toBe(noon + 180_000)
    expect(clock.at(2, 0)).toBeUndefined()
    expect(clock.at(9, 1)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { parseRoll } from '../../src/shared/roll.ts'

describe('the player rolling before an action', () => {
  it('reads the notation and the reason', () => {
    expect(parseRoll('/roll 2d6+1 pick the lock')).toEqual({ expression: '2d6+1', reason: 'pick the lock' })
    expect(parseRoll('  /ROLL d100')).toEqual({ expression: 'd100', reason: '' })
    expect(parseRoll('/roll')).toEqual({ expression: '', reason: '' })
  })

  it('leaves everything else alone', () => {
    expect(parseRoll('I roll the barrel')).toBeUndefined()
    expect(parseRoll('/rolling stone')).toBeUndefined()
    expect(parseRoll('/ooc something')).toBeUndefined()
  })
})

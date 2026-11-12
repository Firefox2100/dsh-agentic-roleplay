import { describe, expect, it } from 'vitest'
import { rollArguments } from '../../src/shared/roll.ts'

describe('the player rolling before an action', () => {
  it('reads the notation and the reason typed after /roll', () => {
    expect(rollArguments(' 2d6+1 pick the lock')).toEqual({ expression: '2d6+1', reason: 'pick the lock' })
    expect(rollArguments('   d100')).toEqual({ expression: 'd100', reason: '' })
    expect(rollArguments('')).toEqual({ expression: '', reason: '' })
  })
})

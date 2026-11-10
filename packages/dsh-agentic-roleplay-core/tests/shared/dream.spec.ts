import { describe, expect, it } from 'vitest'
import { parseDream } from '../../src/shared/dream.ts'

describe('the dream in a message', () => {
  it('reads whose dream, or nobody in particular', () => {
    expect(parseDream('/dream')).toEqual({ who: '' })
    expect(parseDream('  /DREAM Clara ')).toEqual({ who: 'Clara' })
    expect(parseDream('/dream 陈姨')).toEqual({ who: '陈姨' })
  })

  it('is nothing for any other message', () => {
    expect(parseDream('I dream of the sea')).toBeUndefined()
    expect(parseDream('/dreams')).toBeUndefined()
    expect(parseDream('/wait 2 hours')).toBeUndefined()
  })
})

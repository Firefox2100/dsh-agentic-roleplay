import { describe, expect, it } from 'vitest'
import { parseWait } from '../../src/shared/wait.ts'

describe('the wait in a message', () => {
  it('reads a time and the reason after it, in units of either language', () => {
    expect(parseWait('/wait 2 hours')).toEqual({ minutes: 120, reason: '' })
    expect(parseWait('/wait 30m until the ferry')).toEqual({ minutes: 30, reason: 'until the ferry' })
    expect(parseWait('  /WAIT 1.5h  for dawn')).toEqual({ minutes: 90, reason: 'for dawn' })
    expect(parseWait('/wait 3天')).toEqual({ minutes: 4320, reason: '' })
    expect(parseWait('/wait 45分钟 等渡船')).toEqual({ minutes: 45, reason: '等渡船' })
    expect(parseWait('/wait 2 days')).toEqual({ minutes: 2880, reason: '' })
  })

  it('says there is no usable time when it is missing, unknown, zero or absurd', () => {
    expect(parseWait('/wait')).toEqual({ minutes: undefined, reason: '' })
    expect(parseWait('/wait a while')).toEqual({ minutes: undefined, reason: 'a while' })
    expect(parseWait('/wait 5 parsecs')).toEqual({ minutes: undefined, reason: '5 parsecs' })
    expect(parseWait('/wait 0 hours')?.minutes).toBeUndefined()
    expect(parseWait('/wait 999 days')?.minutes).toBeUndefined()
  })

  it('is not read from other messages', () => {
    expect(parseWait('I wait here')).toBeUndefined()
    expect(parseWait('/waiter')).toBeUndefined()
    expect(parseWait('please /wait 2h')).toBeUndefined()
  })
})

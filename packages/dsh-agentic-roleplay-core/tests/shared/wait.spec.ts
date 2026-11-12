import { describe, expect, it } from 'vitest'
import { waitArguments } from '../../src/shared/wait.ts'

describe('the wait typed after /wait', () => {
  it('reads a time and the reason after it, in units of either language', () => {
    expect(waitArguments(' 2 hours')).toEqual({ minutes: 120, reason: '' })
    expect(waitArguments(' 30m until the ferry')).toEqual({ minutes: 30, reason: 'until the ferry' })
    expect(waitArguments('   1.5h  for dawn')).toEqual({ minutes: 90, reason: 'for dawn' })
    expect(waitArguments(' 3天')).toEqual({ minutes: 4320, reason: '' })
    expect(waitArguments(' 45分钟 等渡船')).toEqual({ minutes: 45, reason: '等渡船' })
    expect(waitArguments(' 2 days')).toEqual({ minutes: 2880, reason: '' })
  })

  it('says there is no usable time when it is missing, unknown, zero or absurd', () => {
    expect(waitArguments('')).toEqual({ minutes: undefined, reason: '' })
    expect(waitArguments(' a while')).toEqual({ minutes: undefined, reason: 'a while' })
    expect(waitArguments(' 5 parsecs')).toEqual({ minutes: undefined, reason: '5 parsecs' })
    expect(waitArguments(' 0 hours').minutes).toBeUndefined()
    expect(waitArguments(' 999 days').minutes).toBeUndefined()
  })
})

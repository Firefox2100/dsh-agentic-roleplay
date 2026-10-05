import { describe, expect, it } from 'vitest'
import { withdrawnKeys } from '../../../src/client/transcript/withdrawn.ts'

describe('the rows of the transcript that belong to turns the story is not at', () => {
  const nodes = [
    { key: '13:input-a', anchorSeq: 10 }, { key: '12:turn-process1', anchorSeq: 12 }, { key: '18:roleplay-narrationX', anchorSeq: 18 },
    { key: '13:input-b', anchorSeq: 20 }, { key: '9:turn-tail2', anchorSeq: 29 }, { key: '13:input-c', anchorSeq: 40 }, { key: 'no-seq' },
  ]

  it('are the rows anchored inside a withdrawn stretch of the log, whatever kind they are', () => {
    expect(withdrawnKeys(nodes, [{ from: 10, to: 19 }])).toEqual(['13:input-a', '12:turn-process1', '18:roleplay-narrationX'])
    expect(withdrawnKeys(nodes, [{ from: 20, to: 29 }, { from: 40, to: Number.MAX_SAFE_INTEGER }])).toEqual(['13:input-b', '9:turn-tail2', '13:input-c'])
  })

  it('are none when nothing was withdrawn', () => {
    expect(withdrawnKeys(nodes, [])).toEqual([])
    expect(withdrawnKeys(nodes, [{ from: 100, to: 200 }])).toEqual([])
  })
})

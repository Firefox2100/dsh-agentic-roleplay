import { describe, expect, it } from 'vitest'
import { langfuseTarget, reportScores, scoresOf } from './langfuse-scores.ts'

const verdict = (type: string, held: boolean | undefined) => ({ where: 'story', expectation: { type }, held }) as never

describe('the benchmark scores in Langfuse', () => {
  it('scores the row and each kind of expectation, leaving out what could not be judged', () => {
    const scores = scoresOf([verdict('speaks', true), verdict('speaks', false), verdict('no-repeats', true), verdict('turns', undefined)])
    expect(scores).toEqual([
      { name: 'bench.row', value: 2 / 3, comment: '2 of 3 expectations held' },
      { name: 'bench.speaks', value: 0.5, comment: '1 of 2' },
      { name: 'bench.no-repeats', value: 1, comment: '1 of 1' },
    ])
    expect(scoresOf([verdict('turns', undefined)])).toEqual([])
  })

  it('needs the host and both keys in the environment', () => {
    expect(langfuseTarget({})).toBeUndefined()
    expect(langfuseTarget({ BENCH_LANGFUSE_HOST: 'http://lf/', BENCH_LANGFUSE_PUBLIC_KEY: 'pk' })).toBeUndefined()
    expect(langfuseTarget({ BENCH_LANGFUSE_HOST: 'http://lf/', BENCH_LANGFUSE_PUBLIC_KEY: 'pk', BENCH_LANGFUSE_SECRET_KEY: 'sk' })).toEqual({ host: 'http://lf', authorization: `Basic ${Buffer.from('pk:sk').toString('base64')}` })
  })

  it('sends nothing without a target', async () => {
    const calls: string[] = []
    expect(await reportScores('s', 'row', [verdict('speaks', true)], ((url: string) => { calls.push(url); return Promise.resolve(new Response('{}')) }) as never)).toBeUndefined()
    expect(calls).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { resetVectors, vectorStatus } from '../../../src/host/sessions/vectors.ts'

describe('the vectors of a session', () => {
  it('are reported with the model that made them, or as none', () => {
    const none = { recallIndex: { vectors: { available: true }, info: () => undefined, pending: () => [1, 2, 3], reset: () => undefined } }
    expect(vectorStatus(none)).toEqual({ available: true, embedded: 0, pending: 3 })
    const some = { recallIndex: { vectors: { available: true }, info: () => ({ model: 'bge-m3', dimensions: 1024, embedded: 30, pending: 2 }), pending: () => [], reset: () => undefined } }
    expect(vectorStatus(some)).toEqual({ available: true, model: 'bge-m3', dimensions: 1024, embedded: 30, pending: 2 })
  })

  it('are forgotten through the index', () => {
    let calls = 0
    resetVectors({ recallIndex: { vectors: { available: true }, info: () => undefined, pending: () => [], reset: () => { calls += 1 } } })
    expect(calls).toBe(1)
  })
})

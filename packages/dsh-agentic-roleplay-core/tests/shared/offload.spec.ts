import { describe, expect, it } from 'vitest'
import { conflictsOf, offloadOf, offloadProblem } from '../../src/shared/offload.ts'

describe('the offload setting', () => {
  it('keeps what is meant and drops the rest', () => {
    const config = offloadOf({ models: { image: { route: ' r ', model: 'm' }, main: { route: 'x', model: 'y' }, bogus: { route: 'a', model: 'b' }, speech: {} }, groups: [['image', 'main', 'image'], ['image'], ['nope', 'speech'], 'x'] })
    expect(config).toEqual({ models: { image: { route: 'r', model: 'm' } }, groups: [['main', 'image']] })
  })

  it('is empty for anything else', () => {
    expect(offloadOf(undefined)).toEqual({ models: {}, groups: [] })
    expect(offloadOf('text')).toEqual({ models: {}, groups: [] })
  })

  it('finds the roles that exclude one another', () => {
    const config = offloadOf({ groups: [['main', 'image'], ['image', 'embedding']] })
    expect(conflictsOf(config, 'image').sort()).toEqual(['embedding', 'main'])
    expect(conflictsOf(config, 'main')).toEqual(['image'])
    expect(conflictsOf(config, 'speech')).toEqual([])
  })

  it('asks for the place of every served role in a group, and not of the story model', () => {
    expect(offloadProblem(offloadOf({ groups: [['main', 'image']] }))).toEqual({ role: 'image', missing: 'route' })
    expect(offloadProblem(offloadOf({ groups: [['main', 'image']], models: { image: { route: 'r', model: '' } } }))).toEqual({ role: 'image', missing: 'model' })
    expect(offloadProblem(offloadOf({ groups: [['main', 'image']], models: { image: { route: 'r', model: 'm' } } }))).toBeUndefined()
  })
})

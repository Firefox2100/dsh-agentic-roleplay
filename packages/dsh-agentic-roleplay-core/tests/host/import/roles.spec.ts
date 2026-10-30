import { describe, expect, it } from 'vitest'
import { ROLES, ROLE_TABLE, isGeneratorOnly, isLeftOut, kindOfRole, mainRole, mayHoldGuidance, playsRole, statesWorldFacts } from '../../../src/host/import/roles.ts'

const of = (...roles: (typeof ROLES)[number][]) => ({ roles })

describe('what the import makes of a role', () => {
  it('is said for every role in one table', () => {
    expect(Object.keys(ROLE_TABLE).sort()).toEqual([...ROLES].sort())
    expect(ROLES.filter(role => kindOfRole(role) !== undefined)).toEqual(['character', 'player', 'speech', 'place', 'faction', 'thing'])
    expect(ROLES.filter(role => ROLE_TABLE[role].leftOut)).toEqual(['instruction', 'template', 'irrelevant'])
  })

  it('tells a piece that is left out from one that is carried, and a piece of guidance only from a piece that also states facts', () => {
    expect(isLeftOut(of('instruction'))).toBe(true)
    expect(isLeftOut(of('instruction', 'world'))).toBe(false)
    expect(isGeneratorOnly(of('generator'))).toBe(true)
    expect(isGeneratorOnly(of('generator', 'template'))).toBe(true)
    expect(isGeneratorOnly(of('generator', 'world'))).toBe(false)
    expect(isGeneratorOnly(of('world'))).toBe(false)
  })

  it('has facts for the lore from world pieces that are not rules or guidance, and guidance searched in the pieces that can hold it', () => {
    expect(statesWorldFacts(of('world'))).toBe(true)
    expect(statesWorldFacts(of('world', 'instruction'))).toBe(false)
    expect(statesWorldFacts(of('world', 'generator'))).toBe(false)
    expect(mayHoldGuidance(of('world'))).toBe(true)
    expect(mayHoldGuidance(of('speech'))).toBe(false)
    expect(mayHoldGuidance(of('template', 'irrelevant'))).toBe(false)
    expect(mayHoldGuidance(of('generator', 'world'))).toBe(false)
    expect(mayHoldGuidance(of('character', 'speech'))).toBe(true)
    expect(playsRole(of('place', 'scenario'), 'scenario')).toBe(true)
    expect(mainRole(of('place', 'scenario'))).toBe('place')
    expect(mainRole(of())).toBeUndefined()
  })
})

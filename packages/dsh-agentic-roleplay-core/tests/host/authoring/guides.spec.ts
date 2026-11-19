import { describe, expect, it } from 'vitest'
import { guideOf } from '../../../src/host/authoring/guides.ts'

const named = (name: string, args: object = {}) => ({ name, arguments: args })

describe('the format guide a world-writing tool needs', () => {
  it('names the guide for the kind of document each tool writes', () => {
    expect(guideOf(named('update_world_element', { kind: 'character' }))).toBe('world-characters')
    expect(guideOf(named('create_world_element', { kind: 'location' }))).toBe('world-places')
    expect(guideOf(named('replace_world_element', { kind: 'lore' }))).toBe('world-lore')
    expect(guideOf(named('write_world_file', { kind: 'variables' }))).toBe('world-variables')
    expect(guideOf(named('update_world_file', { kind: 'calendar' }))).toBe('world-calendar')
    expect(guideOf(named('write_world_trigger'))).toBe('world-triggers')
    expect(guideOf(named('update_world_trigger'))).toBe('world-triggers')
    expect(guideOf(named('replace_world_plots'))).toBe('world-plots')
    expect(guideOf(named('update_world_plot'))).toBe('world-plots')
    expect(guideOf(named('edit_world_info'))).toBe('world-info')
    expect(guideOf(named('reshape_opening'))).toBe('world-info')
  })

  it('names nothing for a tool no guide covers, or for a kind the tool does not take', () => {
    expect(guideOf(named('look_at_the_weather'))).toBeUndefined()
    expect(guideOf(named('update_world_element'))).toBeUndefined()
    expect(guideOf(named('update_world_element', { kind: 7 }))).toBeUndefined()
    expect(guideOf(named('update_world_plot', { kind: 'character' }))).toBe('world-plots')
  })
})

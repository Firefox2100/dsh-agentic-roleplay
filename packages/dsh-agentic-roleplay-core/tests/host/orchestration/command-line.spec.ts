import { describe, expect, it } from 'vitest'
import { commandBringsPeopleIn } from '../../../src/host/orchestration/hooks.ts'

const store = (triggers: unknown[]) => ({ story: { triggers: { list: () => triggers } } }) as never
const recruit = { word: 'recruit', key: 'recruit', description: 'Bring someone in.' }
const waitingOn = (flag: string, effect: object) => ({ key: 'k', condition: { type: 'variable', variable: flag, op: 'eq', value: true }, effects: [effect] })

describe('who brings people in when a command is used', () => {
  it('is the world when a trigger that has the author make a person waits on the command\'s flag, and the game master otherwise', () => {
    expect(commandBringsPeopleIn(store([waitingOn('command_recruit', { type: 'beat', dispatch: 'author', text: 'x' })]), recruit)).toBe(true)
    expect(commandBringsPeopleIn(store([waitingOn('command_recruit', { type: 'beat', text: 'x' })]), recruit)).toBe(false)
    expect(commandBringsPeopleIn(store([waitingOn('command_other', { type: 'beat', dispatch: 'author', text: 'x' })]), recruit)).toBe(false)
    expect(commandBringsPeopleIn(store([]), recruit)).toBe(false)
  })
})

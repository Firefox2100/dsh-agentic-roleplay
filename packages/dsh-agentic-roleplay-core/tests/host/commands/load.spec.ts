import { describe, expect, it } from 'vitest'
import { parseCommandsFile } from '../../../src/host/commands/load.ts'

describe('the words a world may give its own slash commands', () => {
  it.each(['ooc', 'ask', 'roll', 'wait', 'dream', 'WAIT'])('refuses /%s, which the game itself uses', (word) => {
    const result = parseCommandsFile(JSON.stringify({ commands: [{ word, description: 'x' }] }))
    expect(result.ok).toBe(false)
  })

  it('accepts a word the game does not use', () => {
    expect(parseCommandsFile(JSON.stringify({ commands: [{ word: 'recruit', description: 'x' }] })).ok).toBe(true)
  })
})

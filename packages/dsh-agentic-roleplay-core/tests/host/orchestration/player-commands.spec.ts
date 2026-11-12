import { describe, expect, it, vi } from 'vitest'
import { PlayerIntents, playerCommands, worldCommands } from '../../../src/host/orchestration/player-commands.ts'

describe('what the commands of the players ask', () => {
  it('is taken by the turn that the command\'s message begins, once, and by no other turn', () => {
    const intents = new PlayerIntents()
    intents.intend('m1', { kind: 'dream', who: 'Clara' })
    expect(intents.take(['other', 'm1'])).toEqual({ kind: 'dream', who: 'Clara' })
    expect(intents.take(['m1'])).toBeUndefined()
    expect(intents.take(['never'])).toBeUndefined()
  })

  it('is bounded, so a message that never begins a turn is forgotten in the end', () => {
    const intents = new PlayerIntents()
    for (let index = 0; index < 500; index += 1) intents.intend(`m${index}`, { kind: 'world', word: 'x' })
    expect(intents.take(['m0'])).toBeUndefined()
    expect(intents.take(['m499'])).toEqual({ kind: 'world', word: 'x' })
  })
})

describe('the commands every roleplay chat has', () => {
  const gameMaster = () => { const followup = vi.fn(); return { agent: { session: { id: 'session-0e6827af-624f-4436-9df8-79f8655d796a', header: {} }, followup }, followup } }
  const run = (name: string, rawInput: string, who = gameMaster(), intents = new PlayerIntents()) => ({ result: playerCommands(intents).find(spec => spec.name === name)!.handler({ agent: who.agent as never, rawInput, signal: new AbortController().signal }) as { kind: string; text?: string }, who, intents })
  const sent = (who: ReturnType<typeof gameMaster>) => who.followup.mock.calls[0]![0] as { id: string; content: { text: string }[]; source: { kind: string } }

  it('are the five that work in every world, each with a description and a hint', () => {
    expect(playerCommands(new PlayerIntents()).map(spec => spec.name)).toEqual(['ooc', 'ask', 'roll', 'wait', 'dream'])
    for (const spec of playerCommands(new PlayerIntents())) {
      expect(spec.description !== '' && spec.hint !== '').toBe(true)
      expect(spec.recordInput).toBe(false)
    }
  })

  it('send the typed line to the game master as the player\'s own message, and say what it asks by that message', () => {
    const done = run('ooc', ' Claire goes backstage')
    expect(done.result).toEqual({ kind: 'success' })
    expect(sent(done.who).content[0]!.text).toBe('/ooc Claire goes backstage')
    expect(sent(done.who).source.kind).toBe('user')
    expect(done.intents.take([String(sent(done.who).id)])).toEqual({ kind: 'ooc', request: 'Claire goes backstage', question: false })
    const asked = run('ask', ' who is at the bar?')
    expect(asked.intents.take([String(sent(asked.who).id)])).toEqual({ kind: 'ooc', request: 'who is at the bar?', question: true })
    const rolled = run('roll', ' 2d6+1 pick the lock')
    expect(rolled.intents.take([String(sent(rolled.who).id)])).toEqual({ kind: 'roll', expression: '2d6+1', reason: 'pick the lock' })
    const waited = run('wait', ' 2 hours until dawn')
    expect(waited.intents.take([String(sent(waited.who).id)])).toEqual({ kind: 'wait', minutes: 120, reason: 'until dawn' })
    const dreamed = run('dream', ' Clara ')
    expect(dreamed.intents.take([String(sent(dreamed.who).id)])).toEqual({ kind: 'dream', who: 'Clara' })
  })

  it('refuse at once what cannot be played, and send nothing', () => {
    for (const [name, rawInput] of [['ooc', ''], ['ask', '  '], ['roll', ''], ['wait', ' a while']] as const) {
      const done = run(name, rawInput)
      expect(done.result.kind).toBe('error')
      expect(done.who.followup).not.toHaveBeenCalled()
    }
    const elsewhere = run('ooc', ' x', { agent: { session: { id: 'session-abc', header: {} }, followup: vi.fn() }, followup: vi.fn() } as never)
    expect(elsewhere.result.kind).toBe('error')
  })
})

describe('the commands of a world', () => {
  it('are offered under their word, or under the key of their flag when the word is not a name DSH takes', () => {
    const specs = worldCommands(new PlayerIntents(), [{ word: 'recruit', key: 'recruit', description: 'Bring someone in.' }, { word: '招募', key: 'zhaomu', description: '招人' }, { word: 'sing_2', key: 'sing', description: 'Sing.' }])
    expect(specs.map(spec => spec.name)).toEqual(['recruit', 'zhaomu', 'sing_2'])
    expect(specs[1]!.description).toBe('/招募: 招人')
    expect(specs[0]!.description).toBe('Bring someone in.')
    expect(specs.every(spec => spec.recordInput === false)).toBe(true)
  })
})

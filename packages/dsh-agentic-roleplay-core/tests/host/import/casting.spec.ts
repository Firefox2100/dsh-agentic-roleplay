import { describe, expect, it } from 'vitest'
import { castingDocuments, namedAsCommand } from '../../../src/host/import/casting.ts'
import { parseCommandsFile } from '../../../src/host/commands/load.ts'
import { parseTriggersFile } from '../../../src/host/triggers/load.ts'

const mechanism = (over: Record<string, unknown> = {}) => ({ name: 'New follower', command: 'recruit', happens: '', need: 'arrival', text: 'A new follower: [draw]', options: ['a lost traveller', 'a rival spy'], ...over })

describe('what a card says about making people up', () => {
  it('becomes a command, the flag its trigger waits on, and a beat for the world author with the drawn options', () => {
    const made = castingDocuments({ commands: [{ word: 'Recruit', description: 'Bring someone in.' }], mechanisms: [mechanism()] }, ['Type /recruit to bring a follower in.'])
    expect(made.notes).toEqual([])
    expect(made.commands).toEqual([{ word: 'recruit', key: 'recruit', description: 'Bring someone in.' }])
    expect(made.triggers[0]).toMatchObject({ key: 'new_follower', repeat: true, when: { type: 'variable', variable: 'command_recruit', op: 'eq', value: true }, effects: [{ type: 'beat', dispatch: 'author', need: 'arrival', draw: ['a lost traveller', 'a rival spy'] }] })
    expect(parseTriggersFile(JSON.stringify(made.triggers)).ok).toBe(true)
    expect(parseCommandsFile(JSON.stringify({ commands: made.commands })).ok).toBe(true)
  })

  it('waits on a judged happening when the card names no command, and puts [draw] where the options go, or takes it out when there are none', () => {
    const made = castingDocuments({ commands: [], mechanisms: [mechanism({ command: '', happens: 'The player\'s character brings a stranger in', text: 'A stranger', options: ['a thief'] }), mechanism({ name: 'Plain', command: '', happens: 'A guest arrives', text: 'A guest [draw]', options: [] })] }, [])
    expect(made.triggers[0]).toMatchObject({ when: { type: 'judged', text: 'The player\'s character brings a stranger in' }, effects: [{ text: 'A stranger [draw]', draw: ['a thief'] }] })
    expect(made.triggers[1]!['effects']).toEqual([{ type: 'beat', dispatch: 'author', need: 'arrival', text: 'A guest' }])
  })

  it('leaves out a mechanism with nothing to start it, keeps the commands only a trigger uses, and keys a command in another script', () => {
    const made = castingDocuments({
      commands: [{ word: '招募', description: '带人进来' }, { word: 'unused', description: 'x' }],
      mechanisms: [mechanism({ command: '招募' }), mechanism({ name: 'Orphan', command: '', happens: '' })],
    }, ['输入【招募】可以带人进来。'])
    expect(made.triggers).toHaveLength(1)
    expect(made.notes.join()).toMatch(/Orphan.*no reason to start/)
    expect(made.commands.map(command => command.word)).toEqual(['招募'])
    expect(made.commands[0]!.key).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})

describe('which words are commands', () => {
  it('are those the passages name after a slash or alone in brackets or quotes, and not a word that only turns up in a sentence', () => {
    const passages = ['Type /recruit to bring a follower in. Use 【招募】 or "gather" at any time. A chance meeting on the road happens often.']
    expect(['recruit', '招募', 'gather', 'meeting', 'road', 'recru'].map(word => namedAsCommand(word, passages))).toEqual([true, true, true, false, false, false])
  })

  it('leaves a command the card never named out, and a mechanism that used it waits on a judged happening instead', () => {
    const made = castingDocuments({ commands: [{ word: 'chance meeting', description: 'x' }], mechanisms: [mechanism({ command: 'chance meeting', happens: '', name: 'Chance meeting' })] }, ['A chance meeting on the road happens often.'])
    expect(made.commands).toEqual([])
    expect(made.triggers[0]).toMatchObject({ when: { type: 'judged', text: 'Chance meeting' } })
  })
})

describe('the keys of casting triggers', () => {
  it('are ASCII: the name\'s own letters, else the number of the mechanism', () => {
    const made = castingDocuments({ commands: [], mechanisms: [mechanism({ name: '旅途偶遇', command: '', happens: 'x' }), mechanism({ name: 'New Follower!', command: '', happens: 'y' }), mechanism({ name: '游玩', command: '', happens: 'z' })] }, [])
    expect(made.triggers.map(trigger => trigger['key'])).toEqual(['casting_1', 'new_follower', 'casting_3'])
    expect(made.notes).toEqual([])
  })
})

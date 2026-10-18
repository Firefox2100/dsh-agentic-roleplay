import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportCardError } from '../../../src/host/import/card.ts'
import { extractStyleFrom } from '../../../src/host/import/extract.ts'
import { readPreset } from '../../../src/host/import/preset.ts'
import { uploadPreset } from '../../../src/host/import/upload-preset.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { fakeContext } from '../../support/jobs.ts'

const file = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))

describe('reading a narration preset', () => {
  it('takes the prompts in the order the preset sends them, without markers, empty or switched-off ones', () => {
    const preset = readPreset(file({
      name: 'Slow burn',
      prompts: [
        { identifier: 'main', name: 'Main', content: 'Write in the second person.' },
        { identifier: 'chatHistory', name: 'History', marker: true },
        { identifier: 'off', name: 'Off', content: 'Never used.' },
        { identifier: 'empty', name: 'Empty', content: '  ' },
        { identifier: 'style', name: 'Style', content: 'Keep scenes short.' },
      ],
      prompt_order: [{ character_id: 1, order: [{ identifier: 'main' }] }, { character_id: 2, order: [{ identifier: 'style' }, { identifier: 'chatHistory' }, { identifier: 'main' }, { identifier: 'off', enabled: false }, { identifier: 'empty' }] }],
    }), 'x.json')
    expect(preset).toEqual({ name: 'Slow burn', pieces: ['[Style]\nKeep scenes short.', '[Main]\nWrite in the second person.'] })
  })

  it('takes every prompt that is on when there is no order, and the fixed keys of the older layout', () => {
    expect(readPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }, { identifier: 'b', content: 'Two.', enabled: false }] }), 'plain.json')).toEqual({ name: 'plain', pieces: ['One.'] })
    expect(readPreset(file({ preset_name: 'Old', main_prompt: 'Write well.', jailbreak_prompt: 'Stay in character.', temperature: 1 }), 'o.json')).toEqual({ name: 'Old', pieces: ['[main_prompt]\nWrite well.', '[jailbreak_prompt]\nStay in character.'] })
  })

  it('refuses what is not a preset, with why', () => {
    expect(() => readPreset(Buffer.from('nope'), 'x')).toThrow(ImportCardError)
    expect(() => readPreset(file([1]), 'x')).toThrow('must be a JSON object')
    expect(() => readPreset(file({ prompts: [{ identifier: 'a', content: '' }] }), 'x')).toThrow('holds no instructions')
  })
})

describe('what a preset becomes', () => {
  it('is the prose prompts of the world, from the preset\'s pieces, with what was left out noted', async () => {
    const context = fakeContext(() => ({ narration: 'Write in the second person, in short scenes.', characters: 'Stay in character.', left_out: ['a dice format'] }))
    const made = await extractStyleFrom(context, 'Slow burn', ['[Main]\nWrite in the second person.'])
    expect(made.prompts.map(entry => entry.id)).toEqual(['roleplay/style', 'roleplay/character-style'])
    expect(made.notes).toEqual(['instructions not carried: a dice format'])
    expect(context.asked[0]!.prompt).toContain('Slow burn')
  })

  it('is nothing for a preset with no pieces, and the failure noted when the model cannot', async () => {
    expect(await extractStyleFrom(fakeContext(() => ({})), 'x', [])).toEqual({ prompts: [], notes: [] })
    const failed = await extractStyleFrom(fakeContext(() => { throw new Error('no answer') }), 'x', ['p'])
    expect(failed.prompts).toEqual([])
    expect(failed.notes[0]).toContain('no answer')
  })
})

describe('applying an uploaded preset', () => {
  let directory: string
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'preset-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
  const worlds = (found = true) => ({ find: async () => (found ? { directory, summary: { id: 'w', name: 'World' } } : undefined) }) as never

  it('keeps the file in the world\'s import folder and has the authoring chat apply it', async () => {
    const sent: string[] = []
    const authoring = { ensure: async () => 'world-author-w', send: async (_chat: string, text: string) => { sent.push(text) } }
    const result = await uploadPreset({ worlds: worlds(), authoring }, 'w', file({ name: 'P', prompts: [{ identifier: 'a', content: 'One.' }] }), 'p.json', 'en')
    expect(result).toEqual({ chatSessionId: 'world-author-w', preset: 'P', started: true })
    expect(sent[0]).toContain('import_preset')
    expect((await readFile(join(directory, '.import', 'preset.json'), 'utf8'))).toContain('One.')
  })

  it('writes nothing for a file that is not a preset or a world that is not there, and says when the message was not sent', async () => {
    const authoring = { ensure: async () => 'c', send: async () => { throw new Error('busy') } }
    await expect(uploadPreset({ worlds: worlds(), authoring }, 'w', Buffer.from('x'), 'p.json')).rejects.toThrow(ImportCardError)
    await expect(stat(join(directory, '.import'))).rejects.toThrow()
    await expect(uploadPreset({ worlds: worlds(false), authoring }, 'w', file({}), 'p.json')).rejects.toThrow(WorldNotFoundError)
    const result = await uploadPreset({ worlds: worlds(), authoring }, 'w', file({ prompts: [{ identifier: 'a', content: 'One.' }] }), 'p.json')
    expect(result).toMatchObject({ started: false, failure: 'busy' })
  })

  it('is put to the person before the world\'s prompts are replaced', async () => {
    const exec = { name: 'import_preset', arguments: {}, agent: { session: { id: 'world-author-w' } } } as never
    await expect(authoringApproval(exec, () => Promise.resolve({ kind: 'allow' } as never))).resolves.toMatchObject({ kind: 'ask' })
  })
})

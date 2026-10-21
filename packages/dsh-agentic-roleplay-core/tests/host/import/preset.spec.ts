import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportCardError } from '../../../src/host/import/card.ts'
import { extractStyleFrom } from '../../../src/host/import/extract.ts'
import { previewPreset, readPreset, selectPrompts } from '../../../src/host/import/preset.ts'
import { applyPresetVerbatim, uploadPreset } from '../../../src/host/import/upload-preset.ts'
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
    expect(preset).toEqual({ name: 'Slow burn', pieces: ['[Style]\nKeep scenes short.', '[Main]\nWrite in the second person.'], sampling: {} })
  })

  it('takes every prompt that is on when there is no order, and the fixed keys of the older layout', () => {
    expect(readPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }, { identifier: 'b', content: 'Two.', enabled: false }] }), 'plain.json')).toEqual({ name: 'plain', pieces: ['One.'], sampling: {} })
    expect(readPreset(file({ preset_name: 'Old', main_prompt: 'Write well.', jailbreak_prompt: 'Stay in character.', temperature: 1 }), 'o.json')).toEqual({ name: 'Old', pieces: ['[main_prompt]\nWrite well.', '[jailbreak_prompt]\nStay in character.'], sampling: { master: 1, characters: 1 } })
  })

  it('plays the variable macros, so that a text holds what it will say, and leaves out comments and prefills', () => {
    const preset = readPreset(file({
      prompts: [
        { identifier: 'vars', role: 'system', content: '{{setvar::words::at least 900}}{{setvar::wrap::Keep {{getvar::words}} words.}}{{// a note for the editor}}{{trim}}' },
        { identifier: 'use', role: 'user', content: 'Length: {{getvar::wrap}} Say {{random::yes::no}} to {{user}}. {{getvar::unset}}' },
        { identifier: 'fill', role: 'model', content: 'Sure, here it is:' },
        { identifier: 'odd', role: 'user', content: '{{unknown::x}} done' },
      ],
      prompt_order: [{ character_id: 1, order: ['vars', 'use', 'fill', 'odd'].map(identifier => ({ identifier, enabled: true })) }],
    }), 'm.json')
    expect(preset.pieces).toEqual(['Length: Keep at least 900 words. Say yes / no to [PLAYER].', '{{unknown::x}} done'])
  })

  it('carries the sampling a preset asks, leaving out what only restates the server\'s default or is out of range', () => {
    const preset = readPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }], temperature: 0.9, top_p: 0.95, top_k: 0, min_p: 0, frequency_penalty: 0.2, presence_penalty: 0, repetition_penalty: 1, openai_max_tokens: 900 }), 'x.json')
    expect(preset.sampling).toEqual({ master: 0.9, characters: 0.9, topP: 0.95, frequencyPenalty: 0.2 })
    expect(readPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }], temperature: 7, top_p: 1 }), 'x.json').sampling).toEqual({})
  })

  it('offers every prompt in the order it is sent, switched off ones included, and says which cannot be carried', () => {
    const preview = previewPreset(file({
      name: 'Bank',
      prompts: [
        { identifier: 'vars', name: 'Vars', role: 'system', content: '{{setvar::k::v}}' },
        { identifier: 'a', name: 'Alpha', role: 'user', content: 'Write short.' },
        { identifier: 'b', name: 'Beta', role: 'user', content: 'Write long.' },
        { identifier: 'fill', name: 'Fill', role: 'model', content: 'Sure:' },
        { identifier: 'hist', name: 'History', marker: true },
        { identifier: 'stray', name: 'Stray', content: 'Not in the order.' },
      ],
      prompt_order: [{ character_id: 1, order: [{ identifier: 'vars', enabled: true }, { identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }, { identifier: 'fill', enabled: true }, { identifier: 'hist', enabled: true }] }],
    }), 'x.json')
    expect(preview.name).toBe('Bank')
    expect(preview.items.map(item => [item.id, item.enabled, item.usable, item.note])).toEqual([['vars', true, true, 'variables'], ['a', true, true, undefined], ['b', false, true, undefined], ['fill', false, false, 'prefill']])
    expect(preview.items[1]).toMatchObject({ title: 'Alpha', detail: 'user', text: 'Write short.', chars: 12 })
  })

  it('counts the scripts of the tool that wrote it, which nothing here runs', () => {
    const preview = previewPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }], extensions: { regex_scripts: [{}, {}, {}], tavern_helper: { scripts: [{}], variables: {} } } }), 'x.json')
    expect(preview.ignored).toEqual({ regexScripts: 3, scripts: 1 })
    expect(previewPreset(file({ prompts: [{ identifier: 'a', content: 'One.' }] }), 'x.json').ignored).toEqual({})
  })

  it('makes a file in which only the chosen prompts exist, so the others cannot be seen, even by the macros', () => {
    const source = file({
      prompts: [{ identifier: 'vars', content: '{{setvar::n::900}}' }, { identifier: 'a', name: 'Alpha', content: 'Write {{getvar::n}} words.' }, { identifier: 'b', name: 'Beta', content: 'Write long.' }],
      prompt_order: [{ character_id: 1, order: [{ identifier: 'vars', enabled: true }, { identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }] }],
      temperature: 0.8,
    })
    expect(readPreset(selectPrompts(source, ['a', 'b'], false), 'x').pieces).toEqual(['[Alpha]\nWrite  words.', '[Beta]\nWrite long.'])
    expect(readPreset(selectPrompts(source, ['vars', 'a'], true), 'x')).toMatchObject({ pieces: ['[Alpha]\nWrite 900 words.'], sampling: { master: 0.8 } })
    expect(readPreset(selectPrompts(source, ['a'], false), 'x').sampling).toEqual({})
    expect(() => selectPrompts(source, ['nope'], false)).toThrow('no prompt "nope"')
    expect(() => selectPrompts(source, [], false)).toThrow('choose at least one')
  })

  it('refuses what is not a preset, with why', () => {
    expect(() => readPreset(Buffer.from('nope'), 'x')).toThrow(ImportCardError)
    expect(() => readPreset(file([1]), 'x')).toThrow('must be a JSON object')
    expect(() => readPreset(file({ prompts: [{ identifier: 'a', content: '' }] }), 'x')).toThrow('holds no instructions')
  })
})

describe('what a preset becomes', () => {
  it('is the prose prompts of the world, from the preset\'s pieces, with what was left out noted', async () => {
    const context = fakeContext(() => ({ narration: 'Write in the second person, in short scenes.', characters: 'Stay in character.', left_out: ['a dice format'], persona_names: [] }))
    const made = await extractStyleFrom(context, 'Slow burn', ['[Main]\nWrite in the second person.'])
    expect(made.prompts.map(entry => entry.id)).toEqual(['roleplay/style', 'roleplay/character-style'])
    expect(made.notes).toEqual(['instructions not carried: a dice format'])
    expect(context.asked[0]!.prompt).toContain('Slow burn')
  })

  it('refuses a style that names the persona the instructions give the AI', async () => {
    const named = fakeContext(() => ({ narration: 'Write as Mirelle would, in short scenes.', characters: '', left_out: [], persona_names: ['Mirelle'] }))
    const made = await extractStyleFrom(named, 'Slow burn', ['You are Mirelle, a writer.'])
    expect(made.prompts).toEqual([])
    expect(made.notes[0]).toContain('persona name "Mirelle"')
    const clean = fakeContext(() => ({ narration: 'Write in short scenes.', characters: '', left_out: [], persona_names: ['Mirelle'] }))
    expect((await extractStyleFrom(clean, 'Slow burn', ['You are Mirelle.'])).prompts).toHaveLength(1)
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

  describe('without the assistant', () => {
    const PRESET = { name: 'Quiet', temperature: 0.6, prompts: [{ identifier: 'a', name: 'Voice', content: 'Speak softly.' }, { identifier: 'b', name: 'Pace', content: 'Go slowly.' }] }
    const withWorld = async () => {
      await writeFile(join(directory, 'world.json'), JSON.stringify({ id: 'w', name: 'World' }))
      return { find: async () => ({ directory, summary: { id: 'w', name: 'World' } }), list: async () => ({}) } as never
    }

    it('writes the chosen prompts as the narration style in every language, and the sampling, with no chat', async () => {
      const worlds = await withWorld()
      expect(await applyPresetVerbatim({ worlds }, 'w', file(PRESET), 'q.json')).toEqual({ preset: 'Quiet', replaced: false })
      for (const language of ['en', 'zh']) expect(await readFile(join(directory, 'prompts', language, 'roleplay', 'style.md'), 'utf8')).toBe('[Voice]\nSpeak softly.\n\n[Pace]\nGo slowly.\n')
      expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8'))).toMatchObject({ sampling: { master: 0.6, characters: 0.6 } })
    })

    it('keeps the style the world had in its trash before putting the new one in', async () => {
      const worlds = await withWorld()
      await mkdir(join(directory, 'prompts', 'en', 'roleplay'), { recursive: true })
      await writeFile(join(directory, 'prompts', 'en', 'roleplay', 'style.md'), 'My own style.\n')
      expect(await applyPresetVerbatim({ worlds }, 'w', file(PRESET), 'q.json')).toMatchObject({ replaced: true })
      expect(await readFile(join(directory, 'prompts', 'en', 'roleplay', 'style.md'), 'utf8')).toContain('Speak softly.')
      const trashed = await readdir(join(directory, '.trash'), { recursive: true })
      expect(trashed.some(entry => /style\.\d+\.md$/.test(entry))).toBe(true)
    })

    it('refuses a world that is not there and a file that is not a preset, changing nothing', async () => {
      await expect(applyPresetVerbatim({ worlds: worlds(false) }, 'w', file(PRESET), 'q.json')).rejects.toThrow(WorldNotFoundError)
      await expect(applyPresetVerbatim({ worlds: await withWorld() }, 'w', Buffer.from('x'), 'q.json')).rejects.toThrow(ImportCardError)
      await expect(stat(join(directory, 'prompts'))).rejects.toThrow()
    })
  })
})

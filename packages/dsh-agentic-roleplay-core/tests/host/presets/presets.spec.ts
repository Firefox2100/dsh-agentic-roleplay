import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyPreset, inheritPreset, presetStatus, recordPreset, switchPreset } from '../../../src/host/presets/apply.ts'
import { PresetBusyError, Presets } from '../../../src/host/presets/service.ts'
import { createPresetFromShipped, deletePreset, listPresets, loadPreset, presetDirectory, reservePreset, savePresetFromWorld, updatePresetInfo } from '../../../src/host/presets/presets.ts'

let root: string
let story: string

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}
const preset = (name: string, files: Record<string, string>, header: unknown = {}) => Promise.all([
  write(join(presetDirectory(root, name), 'preset.json'), JSON.stringify(header)),
  ...Object.entries(files).map(([path, text]) => write(join(presetDirectory(root, name), 'prompts', path), text)),
])

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'presets-'))
  story = join(root, 'sessions', 'one')
  await mkdir(story, { recursive: true })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('reading the library', () => {
  it('lists presets with their languages, prompts and temperatures', async () => {
    await preset('noir', { 'en/roleplay/style.md': 'Terse.', 'zh/roleplay/style.md': '简短。' }, { title: 'Noir', description: 'Dry.', sampling: { characters: 0.9 } })
    const [entry] = listPresets(root)
    expect(entry?.summary).toMatchObject({ name: 'noir', title: 'Noir', description: 'Dry.', languages: ['en', 'zh'], prompts: ['roleplay/style'], rules: [], sampling: { characters: 0.9 }, problems: [] })
  })

  it('reports prompts that are not the story\'s, unknown variables, other sampling keys and empty presets as problems', async () => {
    await preset('bad', { 'en/elsewhere/rules.md': 'x', 'en/roleplay/style.md': 'Uses ${nothing}.' }, { sampling: { records: 0.5, master: 5 } })
    await preset('empty', {})
    const problems = Object.fromEntries(listPresets(root).map(entry => [entry.summary.name, entry.summary.problems.join('\n')]))
    expect(problems['bad']).toContain('not a prompt of the story')
    expect(problems['bad']).toContain('${nothing}')
    expect(problems['bad']).toContain('sampling.records')
    expect(problems['bad']).toContain('sampling.master must be a number')
    expect(problems['empty']).toContain('carries no prompts')
  })

  it('carries rules prompts, and says which prompts they are', async () => {
    await preset('house', { 'en/roleplay/style.md': 'Terse.', 'en/roleplay/rules.md': 'Never leave the scene.\n${rules}' })
    expect(listPresets(root)[0]?.summary).toMatchObject({ prompts: ['roleplay/rules', 'roleplay/style'], rules: ['roleplay/rules'], problems: [] })
  })

  it('refuses a name that is not one, and a preset that is not there', () => {
    expect(() => loadPreset(root, '../x')).toThrow('not a usable preset name')
    expect(() => loadPreset(root, 'nothing')).toThrow('no preset "nothing"')
  })
})

describe('making and removing presets', () => {
  it('makes a preset from the prose prompts of a world and refuses to overwrite', async () => {
    const world = join(root, 'worlds', 'w')
    await write(join(world, 'prompts', 'en', 'roleplay', 'style.md'), 'Lyrical.')
    await write(join(world, 'prompts', 'en', 'roleplay', 'rules.md'), 'Not carried.')
    const made = await savePresetFromWorld(root, world, { name: 'lyric', title: 'Lyric' })
    expect(made.summary).toMatchObject({ title: 'Lyric', prompts: ['roleplay/style'] })
    expect(existsSync(join(presetDirectory(root, 'lyric'), 'prompts', 'en', 'roleplay', 'rules.md'))).toBe(false)
    await expect(savePresetFromWorld(root, world, { name: 'lyric' })).rejects.toThrow('already a preset')
    expect(await readdir(join(root, '.install'))).toEqual([])
  })

  it('refuses a world with no prose prompts', async () => {
    await mkdir(join(root, 'worlds', 'plain'), { recursive: true })
    await expect(savePresetFromWorld(root, join(root, 'worlds', 'plain'), { name: 'none' })).rejects.toThrow('no prose prompts')
  })

  it('moves a removed preset to the trash', async () => {
    await preset('old', { 'en/roleplay/style.md': 'x' })
    const aside = await deletePreset(root, 'old', () => 5)
    expect(aside).toBe(join(root, '.trash', 'presets', 'old-5'))
    expect(existsSync(presetDirectory(root, 'old'))).toBe(false)
  })
})

describe('a preset in a story', () => {
  const style = (folder: string) => readFile(join(folder, 'prompts', 'en', 'roleplay', 'style.md'), 'utf8')

  it('is copied, recorded, and compared with the library', async () => {
    await preset('noir', { 'en/roleplay/style.md': 'Terse.' })
    copyPreset(loadPreset(root, 'noir'), story)
    recordPreset(story, loadPreset(root, 'noir'))
    expect(await style(story)).toBe('Terse.')
    expect(presetStatus(root, story).applied).toMatchObject({ name: 'noir', state: 'current', files: ['en/roleplay/style.md'] })

    await preset('noir', { 'en/roleplay/style.md': 'Terser.' })
    expect(presetStatus(root, story).applied?.state).toBe('changed')

    await writeFile(join(story, 'prompts', 'en', 'roleplay', 'style.md'), 'Mine.')
    expect(presetStatus(root, story).applied?.state).toBe('edited')

    await rm(presetDirectory(root, 'noir'), { recursive: true })
    await writeFile(join(story, 'prompts', 'en', 'roleplay', 'style.md'), 'Terse.')
    expect(presetStatus(root, story).applied?.state).toBe('missing')
  })

  it('does not count a prompt the world replaced as the preset\'s', async () => {
    await preset('noir', { 'en/roleplay/style.md': 'Terse.', 'en/roleplay/persona.md': 'Narrator.' })
    await write(join(story, 'prompts', 'en', 'roleplay', 'style.md'), 'The world\'s own.')
    const loaded = loadPreset(root, 'noir')
    await write(join(story, 'prompts', 'en', 'roleplay', 'persona.md'), 'Narrator.')
    recordPreset(story, loaded)
    expect(presetStatus(root, story).applied?.files).toEqual(['en/roleplay/persona.md'])
  })

  it('switches: old copies go to the trash, the new preset is put in, and none takes it out', async () => {
    await preset('a', { 'en/roleplay/style.md': 'A.', 'en/roleplay/persona.md': 'Persona A.' })
    await preset('b', { 'en/roleplay/style.md': 'B.' })
    switchPreset(root, story, 'a', () => 1)
    const moved = switchPreset(root, story, 'b', () => 2)
    expect(moved.sort()).toEqual(['en/roleplay/persona.md', 'en/roleplay/style.md'])
    expect(await style(story)).toBe('B.')
    expect(existsSync(join(story, 'prompts', 'en', 'roleplay', 'persona.md'))).toBe(false)
    expect(await readFile(join(story, '.trash', 'prompts', '2', 'en', 'roleplay', 'persona.md'), 'utf8')).toBe('Persona A.')
    expect(presetStatus(root, story).applied?.name).toBe('b')

    switchPreset(root, story, undefined, () => 3)
    expect(existsSync(join(story, 'prompts', 'en', 'roleplay', 'style.md'))).toBe(false)
    expect(presetStatus(root, story).applied).toBeUndefined()
  })

  it('changes nothing when the preset to switch to has problems', async () => {
    await preset('a', { 'en/roleplay/style.md': 'A.' })
    await preset('bad', { 'en/elsewhere/rules.md': 'x' })
    switchPreset(root, story, 'a')
    expect(() => switchPreset(root, story, 'bad')).toThrow('has problems')
    expect(await style(story)).toBe('A.')
  })

  it('is inherited by a branch', async () => {
    await preset('a', { 'en/roleplay/style.md': 'A.' })
    switchPreset(root, story, 'a')
    const branch = join(root, 'sessions', 'two')
    await mkdir(branch, { recursive: true })
    inheritPreset(story, branch)
    expect(await readFile(join(branch, 'preset.json'), 'utf8')).toContain('"name": "a"')
  })
})

describe('making and describing presets', () => {
  it('starts a preset from the shipped prose prompts of every language, and refuses a taken name', async () => {
    const made = await createPresetFromShipped(root, { name: 'base', title: ' Base ', description: 'Plain.', sampling: { master: 0.8 } })
    expect(made.summary).toMatchObject({ name: 'base', title: 'Base', description: 'Plain.', languages: ['en', 'zh'], prompts: ['roleplay/character-style', 'roleplay/persona', 'roleplay/style'], sampling: { master: 0.8 }, problems: [] })
    await expect(createPresetFromShipped(root, { name: 'base' })).rejects.toThrow('already a preset')
    await expect(createPresetFromShipped(root, { name: 'hot', sampling: { master: 9 } })).rejects.toThrow('0 to 2')
    expect(existsSync(presetDirectory(root, 'hot'))).toBe(false)
  })

  it('changes the information a preset gives and keeps what the change leaves out', async () => {
    await createPresetFromShipped(root, { name: 'base', title: 'Base', sampling: { characters: 0.7 } })
    await updatePresetInfo(root, 'base', { description: 'Now described.' })
    expect((await updatePresetInfo(root, 'base', { sampling: { master: 1 } })).summary).toMatchObject({ title: 'Base', description: 'Now described.', sampling: { master: 1 } })
    expect((await updatePresetInfo(root, 'base', { title: '', sampling: {} })).summary).toMatchObject({ title: 'base', sampling: {} })
    await expect(updatePresetInfo(root, 'base', { sampling: { records: 1 } as never })).rejects.toThrow('records')
    await expect(updatePresetInfo(root, 'gone', { title: 'x' })).rejects.toThrow('no preset')
  })

  it('reserves an empty preset for an import, which reads as having no prompts until it is filled', async () => {
    await reservePreset(root, 'incoming', 'Imported')
    expect(loadPreset(root, 'incoming').summary).toMatchObject({ title: 'Imported', problems: ['the preset carries no prompts'] })
    await expect(reservePreset(root, 'incoming', 'again')).rejects.toThrow('already a preset')
  })
})

describe('the preset service', () => {
  const authoring = () => {
    const sent: string[] = []
    return { sent, port: { ensure: (name: string, title: string, language?: string) => Promise.resolve(`chat-${name}-${title}-${language ?? '-'}`), send: (chat: string, text: string) => { sent.push(`${chat}: ${text}`); return Promise.resolve() } } }
  }
  const service = (port: ReturnType<typeof authoring>['port']) => new Presets({ root: () => root, worldDirectory: () => Promise.resolve(undefined), authoring: port, importMessage: () => 'go', maxUploadBytes: 1000, playing: () => false })
  const stPreset = Buffer.from(JSON.stringify({ prompts: [{ identifier: 'main', content: 'Write in the second person.' }], prompt_order: [] }))

  it('makes a preset from the shipped prompts when no world is given, and edits one prompt at a time', async () => {
    const presets = service(authoring().port)
    expect((await presets.create({ name: 'base' })).problems).toEqual([])
    expect((await presets.writePrompt('base', 'en', 'roleplay/style', 'Terse.')).problems).toEqual([])
    expect(presets.read('base').prompts['en/roleplay/style']).toBe('Terse.\n')
    await presets.writePrompt('base', 'en', 'roleplay/style', undefined)
    expect(presets.read('base').prompts['en/roleplay/style']).toBeUndefined()
    await expect(presets.writePrompt('base', 'en', 'world/author', 'x')).rejects.toThrow('not a prompt of the story')
    await expect(presets.writePrompt('gone', 'en', 'roleplay/style', 'x')).rejects.toThrow('no preset')
  })

  it('opens the authoring chat of a preset under its title', async () => {
    const presets = service(authoring().port)
    await presets.create({ name: 'base', title: 'Base' })
    expect(await presets.author('base', 'zh')).toEqual({ chatSessionId: 'chat-base-Base-zh' })
  })

  it('keeps an uploaded preset in a new library entry and tells its chat to turn it into prompts', async () => {
    const { sent, port } = authoring()
    const result = await service(port).importFile('st', stPreset, 'en')
    expect(result).toMatchObject({ name: 'st', started: true })
    expect(sent).toEqual([`${result.chatSessionId}: go`])
    expect(JSON.parse(await readFile(join(presetDirectory(root, 'st'), '.import', 'preset.json'), 'utf8'))).toHaveProperty('prompts')
    expect(loadPreset(root, 'st').summary.problems).toEqual(['the preset carries no prompts'])
  })

  it('says so when the chat could not be told, and refuses a file that is not a preset or a taken name without leaving anything behind', async () => {
    const failing = { ensure: () => Promise.resolve('chat'), send: () => Promise.reject(new Error('busy')) }
    expect(await service(failing).importFile('st', stPreset)).toMatchObject({ started: false, failure: 'busy' })
    await expect(service(authoring().port).importFile('st', stPreset)).rejects.toThrow('already a preset')
    await expect(service(authoring().port).importFile('plain', Buffer.from('nope'))).rejects.toThrow('not JSON')
    expect(existsSync(presetDirectory(root, 'plain'))).toBe(false)
  })

  it('does not change the preset of a story while one of its turns is being played', async () => {
    const id = '3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c'
    await mkdir(join(root, 'sessions', id), { recursive: true })
    await writeFile(join(root, 'sessions', id, 'session.sqlite'), '')
    let playing = true
    const presets = new Presets({ root: () => root, worldDirectory: () => Promise.resolve(undefined), authoring: authoring().port, importMessage: () => 'go', maxUploadBytes: 1000, playing: () => playing })
    await presets.create({ name: 'base' })
    expect(() => presets.apply(id, 'base')).toThrow(PresetBusyError)
    playing = false
    expect(presets.apply(id, 'base').files).toEqual([])
    expect(existsSync(join(root, 'sessions', id, 'preset.json'))).toBe(true)
  })
})

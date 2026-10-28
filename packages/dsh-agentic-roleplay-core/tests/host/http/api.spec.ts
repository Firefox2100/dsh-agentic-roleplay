import { emptyStats } from '../../../src/shared/decisions.ts'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from '../../../src/host/http/api.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { DEFAULT_SETTINGS, SETTINGS_SPEC } from '../../../src/shared/settings.ts'
import { InvalidSettingsError } from '../../../src/host/sessions/settings.ts'
import { ImportCardError } from '../../../src/host/import/card.ts'
import { ImportNotFoundError } from '../../../src/host/import/store.ts'
import type { ImportPreview } from '../../../src/shared/import-card.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { AgentUnavailableError, ReflectionRefusedError, SessionArchivedError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../../../src/host/sessions/errors.ts'
import { TimelineError } from '../../../src/host/timeline/service.ts'
import type { StartSessionRequest } from '../../../src/shared/sessions.ts'
import { WorldFolderExistsError } from '../../../src/host/worlds/create-world.ts'
import { UnknownStarterError } from '../../../src/host/worlds/starter.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { API_PREFIX } from '../../../src/shared/worlds.ts'
import { CatalogueError } from '../../../src/host/catalogue/errors.ts'
import { RcloneError, SyncRefusedError, UnitLockedError } from '../../../src/host/sync/errors.ts'
import type { PresetApi } from '../../../src/host/presets/routes.ts'
import type { LorebookApi } from '../../../src/host/lorebooks/routes.ts'
import { LorebookBusyError } from '../../../src/host/lorebooks/service.ts'

let base: string
let server: Server
let origin: string
let allowed = true
let startedWith: StartSessionRequest | undefined
let startError: Error | undefined
let charactersError: Error | undefined
let deleted: string | undefined
let deletedEverywhere: boolean | undefined
let lockedUnit: string | undefined
let syncError: Error | undefined
let syncCalls: string[]
let deleteError: Error | undefined
let said: string[]
let opened: string | undefined
let openError: Error | undefined
let settingsError: Error | undefined
let notesError: Error | undefined
let decisionsError: Error | undefined
let timelineError: Error | undefined
let archiveError: Error | undefined
let importError: Error | undefined
let importCalls: string[] = []
const preview: ImportPreview = { id: 'i1', hasAvatar: false, choices: { name: 'Card', disabledEntries: [], opening: { kind: 'first' } }, card: { sourceSpec: 'chara_card_v3', name: 'Card', description: '', personality: '', scenario: '', firstMessage: 'Hello', alternateGreetings: [], messageExample: '', creatorNotes: '', systemPrompt: '', postHistoryInstructions: '', tags: [], creator: '', characterVersion: '', ignored: { scripts: 0, extensions: [] } } }
let catalogueCalls: string[] = []
let presetCalls: string[] = []
const summary = { name: 'noir', title: 'Noir', description: '', languages: ['en'], prompts: ['roleplay/style'], rules: [], sampling: {}, problems: [] }
const presetApi: PresetApi = {
  list: () => [summary],
  read: (name) => { if (name !== 'noir') throw new Error(`there is no preset "${name}"`); return { summary, prompts: { 'en/roleplay/style': 'Terse.' } } },
  create: (request) => { presetCalls.push(`create ${JSON.stringify(request)}`); return Promise.resolve(summary) },
  updateInfo: (name, change) => { presetCalls.push(`info ${name} ${JSON.stringify(change)}`); return Promise.resolve(summary) },
  writePrompt: (name, language, id, text) => { presetCalls.push(`prompt ${name} ${language} ${id} ${String(text)}`); return Promise.resolve(summary) },
  rulesPrompts: (name, language) => (name === 'gone' ? (() => { throw new Error('there is no preset "gone"') })() : [`${language}-game-master`]),
  promptText: (name, language, id) => `${name} ${language} ${id}`,
  author: (name, language) => { presetCalls.push(`author ${name} ${language ?? '-'}`); return Promise.resolve({ chatSessionId: `preset-author-${name}` }) },
  importFile: (name, file, language) => { presetCalls.push(`import ${name} ${file.length} ${language ?? '-'}`); return Promise.resolve({ name, chatSessionId: `preset-author-${name}`, started: true }) },
  importVerbatim: (request) => { presetCalls.push(`verbatim ${JSON.stringify(request)}`); return Promise.resolve({ name: request.name ?? 'made' }) },
  importStaged: (request) => { presetCalls.push(`staged ${JSON.stringify(request)}`); return Promise.resolve({ name: request.name ?? 'made', chatSessionId: 'preset-author-made', started: true }) },
  maxUploadBytes: 1024,
  remove: (name) => { presetCalls.push(`remove ${name}`); return Promise.resolve() },
  status: (id) => { if (id !== 'sess') throw new SessionNotFoundError(`no session "${id}"`); return { available: [summary] } },
  apply: (id, name) => { presetCalls.push(`apply ${id} ${String(name)}`); return { files: [] } },
}
let lorebookCalls: string[] = []
const bookSummary = { name: 'harbor', title: 'Harbor', description: '', entries: 1, common: 1, problems: [] }
const lorebookApi: LorebookApi = {
  list: () => Promise.resolve([bookSummary]),
  read: (name) => { if (name !== 'harbor') return Promise.reject(new Error(`there is no lorebook "${name}"`)); return Promise.resolve({ summary: bookSummary, entries: [] }) },
  create: (request) => { lorebookCalls.push(`create ${JSON.stringify(request)}`); return Promise.resolve(bookSummary) },
  updateInfo: (name, change) => { lorebookCalls.push(`info ${name} ${JSON.stringify(change)}`); return Promise.resolve(bookSummary) },
  writeEntry: (name, entry) => { lorebookCalls.push(`entry ${name} ${JSON.stringify(entry)}`); return Promise.resolve(bookSummary) },
  removeEntry: (name, id) => { lorebookCalls.push(`remove entry ${name} ${id}`); return Promise.resolve(bookSummary) },
  remove: (name) => { lorebookCalls.push(`remove ${name}`); return Promise.resolve() },
  author: (name, language) => { lorebookCalls.push(`author ${name} ${language ?? '-'}`); return Promise.resolve({ chatSessionId: `lorebook-author-${name}` }) },
  importFile: (name, file, language) => { lorebookCalls.push(`import ${name} ${file.length} ${language ?? '-'}`); return Promise.resolve({ name, chatSessionId: `lorebook-author-${name}`, started: true }) },
  importVerbatim: (request) => { lorebookCalls.push(`verbatim ${JSON.stringify(request)}`); return Promise.resolve({ name: request.name ?? 'made', entries: request.enabled.length }) },
  importStaged: (request) => { lorebookCalls.push(`staged ${JSON.stringify(request)}`); return Promise.resolve({ name: request.name ?? 'made', chatSessionId: 'lorebook-author-made', started: true }) },
  maxUploadBytes: 1024,
  status: (id) => { if (id !== 'sess') throw new SessionNotFoundError(`no session "${id}"`); return Promise.resolve({ applied: [], available: [bookSummary] }) },
  addToStory: (id, name) => { lorebookCalls.push(`story add ${id} ${name}`); if (id === 'busy') throw new LorebookBusyError('a turn is being played'); return Promise.resolve({ entries: 1, notes: [] }) },
  removeFromStory: (id, name) => { lorebookCalls.push(`story remove ${id} ${name}`); return { removed: 1 } },
}
let catalogueError: Error | undefined
const catalogue = {
  sources: async () => [{ name: 'Home', baseUrl: 'http://localhost:9798', hasKey: true, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY', keySource: 'file' }],
  describeKey: async (ref: string) => { catalogueCalls.push(`key ${ref}`); if (catalogueError !== undefined) throw catalogueError; return { ref, configured: true, writable: true, source: 'file' } },
  keepKey: async (ref: string, value: string) => { catalogueCalls.push(`keep ${ref} ${value === '' ? '-' : 'value'}`); if (catalogueError !== undefined) throw catalogueError; return { ref, configured: value !== '', writable: true } },
  worlds: async (name: string, query: unknown) => { catalogueCalls.push(`worlds ${name} ${JSON.stringify(query)}`); if (catalogueError !== undefined) throw catalogueError; return { items: [], withKey: true } },
  world: async (name: string, id: string) => { catalogueCalls.push(`world ${name} ${id}`); if (catalogueError !== undefined) throw catalogueError; return { id } },
  cover: async (name: string, id: string) => { catalogueCalls.push(`cover ${name} ${id}`); if (catalogueError !== undefined) throw catalogueError; return { type: 'image/png', body: Buffer.from('png') } },
  install: async (request: unknown) => { catalogueCalls.push(`install ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { world: { id: 'w' }, packs: [] } },
  updates: async (name: string) => { catalogueCalls.push(`updates ${name}`); if (catalogueError !== undefined) throw catalogueError; return { updates: [], problems: [] } },
  convert: async (request: unknown) => { catalogueCalls.push(`convert ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { worldId: 'w', chatSessionId: 'c', started: true } },
  convertLorebook: async (request: unknown) => { catalogueCalls.push(`lorebook ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { name: 'b', chatSessionId: 'c', started: true } },
  stage: async (request: unknown) => { catalogueCalls.push(`stage ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { id: 'st', kind: 'preset', name: 'p', items: [] } },
  stageCard: async (request: unknown) => { catalogueCalls.push(`card ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { id: 'cd1', hasAvatar: false, choices: { name: 'Ann', disabledEntries: [], opening: { kind: 'first' } }, card: {} } },
  convertStaged: async (request: unknown) => { catalogueCalls.push(`staged ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { worldId: 'w', chatSessionId: 'c', started: true } },
  convertPreset: async (request: unknown) => { catalogueCalls.push(`preset ${JSON.stringify(request)}`); if (catalogueError !== undefined) throw catalogueError; return { name: 'p', chatSessionId: 'c', started: true } },
}
let editorError: Error | undefined
let edited: string[] = []
let archived: string[] = []
let moved: [string, string] | undefined
let writtenSettings: unknown
const started = { id: 'session-id', chatSessionId: 'session-session-id', name: 'Harbor', worldId: 'harbor', worldName: 'Harbor', characterCount: 2 }
const listed = { directory: '/root/sessions', sessions: [{ id: 'session-id', chatSessionId: 'session-session-id', name: 'Harbor', worldId: 'harbor', worldName: 'Harbor', createdAt: '2026-01-01T00:00:00.000Z', turns: 0 }], problems: [] }
const cast = { characters: [{ id: 'arthur', name: 'Arthur', summary: '', role: 'playable' as const, tier: 'principal' as const, kind: 'person' as const }], openings: [], startingTime: '', timeZone: '', problems: [] }

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'api-'))
  allowed = true
  startedWith = undefined
  startError = undefined
  charactersError = undefined
  deleted = undefined
  lockedUnit = undefined
  syncError = undefined
  syncCalls = []
  deleteError = undefined
  opened = undefined
  said = []
  openError = undefined
  settingsError = undefined
  notesError = undefined
  timelineError = undefined
  moved = undefined
  archiveError = undefined
  importError = undefined
  importCalls = []
  editorError = undefined
  catalogueCalls = []
  presetCalls = []
  catalogueError = undefined
  edited = []
  archived = []
  writtenSettings = undefined
  const folder = join(base, 'worlds', 'harbor')
  await mkdir(join(folder, 'media', 'files'), { recursive: true })
  await writeFile(join(folder, 'world.json'), JSON.stringify({ id: 'harbor', name: 'Harbor', metadata: { tags: ['noir'] }, cover_media_id: 'm' }))
  await writeFile(join(folder, 'media', 'manifest.jsonl'), '{"id":"m","file":"media/files/m.png"}\n')
  await writeFile(join(folder, 'media', 'files', 'm.png'), 'png-bytes')
  await writeFile(join(base, 'worlds', 'secret.png'), 'secret')

  const worlds = new WorldCatalog(new Context(), { path: base } as RoleplayRoot)
  const handler = createApiHandler({
    catalogue: catalogue as never,
    speech: { voices: async () => [{ id: 'clara', name: 'Clara' }], speak: async () => ({ bytes: new Uint8Array([1, 2]), mediaType: 'audio/mpeg' }), streaming: () => true },
    sync: {
      status: async () => { if (syncError !== undefined) throw syncError; return { running: false, units: [] } },
      run: async (units?: readonly string[]) => { if (syncError !== undefined) throw syncError; syncCalls.push(`run ${units?.join(',') ?? 'all'}`); return { units: [] } },
      resolve: async (unit: string, side: string) => { if (syncError !== undefined) throw syncError; syncCalls.push(`resolve ${unit} ${side}`); return unit === 'gone' ? undefined : { id: unit, kind: 'world', state: 'synced' } },
      forget: (unit: string) => { if (syncError !== undefined) throw syncError; syncCalls.push(`forget ${unit}`) },
      restore: (unit: string) => { if (syncError !== undefined) throw syncError; syncCalls.push(`restore ${unit}`) },
      password: {
        describe: async (reference?: string) => { syncCalls.push(`describe ${reference ?? 'default'}`); return { configured: true, writable: true, ref: reference ?? 'ROLEPLAY_SYNC_RCLONE_PASSWORD' } },
        keep: async (value: string, reference?: string) => { if (syncError !== undefined) throw syncError; syncCalls.push(`password ${reference ?? 'default'} ${value === '' ? 'clear' : 'set'}`); return { configured: value !== '', writable: true, ref: reference ?? 'ROLEPLAY_SYNC_RCLONE_PASSWORD' } },
      },
    } as never,
    anyLocked: () => lockedUnit !== undefined,
    locked: async url => (url.searchParams.get('id') === 'harbor' ? lockedUnit : undefined),
    presets: presetApi,
    lorebooks: lorebookApi,
    packs: { worldPacks: () => Promise.resolve([]), preview: () => Promise.reject(new Error('no preview here')), status: () => Promise.resolve({ setting: '', problems: [], available: [] }), sync: () => Promise.resolve({ updated: [], added: [], unchanged: [] }), history: () => [], describe: () => ({ pack: null, problems: [] }), view: () => ({ unchanged: true }), file: id => (id === 'sess' ? { kind: 'page', body: '<p>hi</p>', mediaType: 'text/html; charset=utf-8' } : undefined), sessionOfFrame: key => (key === 'good' ? 'sess' : undefined), storage: () => null, availability: () => ({ tab: false }) },
    worlds,
    avatars: { create: async () => 'new', remove: async () => undefined, addToWorld: async () => [] },
    starter: { list: async () => [{ folder: 'sample', name: 'Sample', description: '', tags: [], installed: false }], add: async (folder) => { if (folder === 'nothing') throw new UnknownStarterError('no such starter'); if (folder === 'have') throw new WorldFolderExistsError('you have it'); return { id: folder, name: 'Sample', description: '', tags: [] } } },
    createWorld: async ({ folder, name }) => ({ id: folder, name, description: '', tags: [] }),
    authorWorld: async worldId => {
      if (worldId === 'missing') throw new WorldNotFoundError('missing world')
      return { chatSessionId: `world-author-${worldId}` }
    },
    translation: {
      language: async id => { if (id === 'missing') throw new WorldNotFoundError('missing world'); return id === 'harbor' ? 'en' : undefined },
      start: async (id, to) => { if (id === 'harbor' && to === 'en') throw new InvalidEditProblems(['this world is already written in English']); return { chatSessionId: `world-author-${id}`, started: true } },
    },
    worldCharacters: async () => {
      if (charactersError !== undefined) throw charactersError
      return cast
    },
    importer: {
      maxUploadBytes: 1024,
      upload: (file, name) => { importCalls.push(`upload ${file.length} ${name}`); if (importError !== undefined) return Promise.reject(importError); return Promise.resolve(preview) },
      read: (id) => { importCalls.push(`read ${id}`); if (importError !== undefined) return Promise.reject(importError); return Promise.resolve(preview) },
      choose: (id, choices) => { importCalls.push(`choose ${id} ${JSON.stringify(choices)}`); if (importError !== undefined) return Promise.reject(importError); return Promise.resolve(preview) },
      discard: (id) => { importCalls.push(`discard ${id}`); return Promise.resolve() },
      start: (id, choices, _language, update) => { importCalls.push(`start ${id} ${choices.name}${update === undefined ? '' : ` update ${update}`}`); return Promise.resolve({ worldId: 'w', chatSessionId: 'world-author-w', started: true }) },
      picture: () => Promise.reject(new Error('no picture')),
      updateStatus: (worldId) => (worldId === 'missing' ? Promise.reject(new WorldNotFoundError('missing world')) : Promise.resolve({ fromCard: true, revertible: true, waiting: false })),
      revertUpdate: (worldId) => { importCalls.push(`revert ${worldId}`); return importError === undefined ? Promise.resolve({ keptIn: '.trash/update-1' }) : Promise.reject(importError) },
      stage: (kind, file, name) => { importCalls.push(`stage ${kind} ${file.length} ${name}`); if (importError !== undefined) throw importError; return { id: 'st1', kind, name: 'N', items: [{ id: 'a', title: 'A', detail: '', text: 't', chars: 1, enabled: true, usable: true }] } },
      discardStaged: (id) => { importCalls.push(`discard ${id}`) },
      applyStagedVerbatim: (worldId, choice) => { importCalls.push(`verbatim ${worldId} ${JSON.stringify(choice)}`); return Promise.resolve({ preset: 'P', replaced: false }) },
      uploadStaged: (worldId, choice, language) => { importCalls.push(`staged ${worldId} ${JSON.stringify(choice)} ${language ?? '-'}`); return Promise.resolve({ chatSessionId: `world-author-${worldId}`, preset: 'P', started: true }) },
      uploadPreset: (worldId, file, name, language) => { importCalls.push(`preset ${worldId} ${file.length} ${name} ${language ?? '-'}`); if (importError !== undefined) return Promise.reject(importError); return Promise.resolve({ chatSessionId: `world-author-${worldId}`, preset: 'P', started: true }) },
    },
    worldFiles: {
      info: (worldId) => Promise.resolve({ name: worldId, description: '', tags: [], rules: [], opening: '', openingParts: false, authorName: '', authorUrl: '', timeZone: '', startingTime: '', version: '', preset: '', lorebooks: [], alternateOpenings: [], sampling: {}, tools: {} }),
      editInfo: (worldId, edit) => { if (edit.timeZone === 'bad') return Promise.reject(new InvalidEditProblems(['time_zone is not a time zone'])); return Promise.resolve({ name: edit.name ?? worldId, description: '', tags: edit.tags ?? [], rules: [], opening: '', openingParts: false, authorName: '', authorUrl: '', timeZone: '', startingTime: '', version: '', preset: '', lorebooks: [], alternateOpenings: [], sampling: {}, tools: {} }) },
      dice: () => Promise.resolve({ checks: [] }),
      editDice: (_world, dice) => (dice.checks.some(check => check.key === '') ? Promise.reject(new InvalidEditProblems(['checks[0].key is required'])) : Promise.resolve(dice)),
      calendar: () => Promise.resolve({ hemisphere: 'north', holidays: [] }),
      editCalendar: (_world, calendar) => (calendar.holidays.some(holiday => holiday.id === '') ? Promise.reject(new InvalidEditProblems(['holidays[0].id is required'])) : Promise.resolve(calendar)),
      routines: () => Promise.resolve({ characters: [], places: [] }),
      editRoutine: (_world, key) => (key === 'nobody' ? Promise.reject(new InvalidEditProblems(['there is no character "nobody"'])) : Promise.resolve({ characters: [], places: [] })),
      variables: () => Promise.resolve([]),
      editVariables: (_world, declarations) => Promise.resolve(declarations),
      prompts: () => Promise.resolve([{ id: 'roleplay/style', kind: 'prose', carried: false }]),
      readPrompt: (_world, language, prompt) => (prompt === 'roleplay/nope' ? Promise.reject(new Error('there is no prompt "roleplay/nope"')) : Promise.resolve({ id: prompt, language, carried: false, text: 'Write plainly.' })),
      writePrompt: (_world, _language, _prompt, text) => (text === '' ? Promise.reject(new Error('empty')) : Promise.resolve()),
      deletePrompt: () => Promise.resolve(),
      gallery: () => Promise.resolve({ images: [], failures: {} }),
      galleryFile: () => Promise.reject(new Error('there is no such image')),
      uploadImage: (_world, name) => Promise.resolve(`library/${name}`),
      updateImage: () => Promise.reject(new Error('there is no such image')),
    },
    worldEditor: {
      read: (worldId) => {
        if (editorError !== undefined) return Promise.reject(editorError)
        return Promise.resolve({ characters: [], places: [{ key: worldId, name: 'Bar', description: '', features: [] }], things: [], factions: [], relations: [], plots: [] })
      },
      editCharacter: (worldId, key, edit) => {
        if (editorError !== undefined) return Promise.reject(editorError)
        edited.push(`${worldId} ${key} ${JSON.stringify(edit)}`)
        return Promise.resolve({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] })
      },
      editPlace: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editThing: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editFaction: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editLore: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      addLore: async (_world, title) => { if (title.trim() === '') throw new InvalidEditProblems(['the entry needs a title']); edited.push(`add lore ${title}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      removeLore: async (_world, key) => { edited.push(`remove lore ${key}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      editPlots: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editRelation: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editNarrationVoice: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      generatePortrait: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      portraitFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
      readPackFile: async (_id: string, pack: string, path: string) => { if (path === 'gone.html') throw new InvalidEditProblems([`the pack "${pack}" has no file "gone.html"`]); return `<p>${pack}/${path}</p>` },
      writePackFile: async (id: string, pack: string, path: string, text: string) => { if (path.endsWith('.png')) throw new InvalidEditProblems(['not a text file of a pack']); edited.push(`pack ${id} ${pack} ${path} ${text}`); return [{ file: 'pack.json', message: 'has no surfaces' }] },
      deletePackFile: async (id: string, pack: string, path: string) => { edited.push(`delete pack file ${id} ${pack} ${path}`); return [] },
      createPack: async (id: string, pack: string, name: string) => { edited.push(`new pack ${id} ${pack} ${name}`); return [] },
      readTrigger: async (_id: string, key: string) => { if (key === 'gone') throw new InvalidEditProblems(['there is no trigger "gone"']); return { key, name: 'Knock' } },
      writeTrigger: async (id: string, key: string, document: unknown) => { if ((document as { name?: unknown }).name === undefined) throw new InvalidEditProblems(['name is required']); edited.push(`trigger ${id} ${key} ${JSON.stringify(document)}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      removeTrigger: async (id: string, key: string) => { edited.push(`remove trigger ${id} ${key}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      generateEntityImage: async (id: string, kind: string, key: string) => { edited.push(`image ${id} ${kind} ${key}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      entityImageFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
      uploadEntityImage: async (...args: unknown[]) => { if (args[3] instanceof Uint8Array && args[3][0] === 0xff) throw new InvalidEditProblems(['the picture must be a PNG picture: convert it first']); edited.push(`image ${String(args[0])} ${String(args[1])} ${String(args[2])} ${(args[3] as Uint8Array).length} ${String(args[4])}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      uploadPortrait: async (...args: unknown[]) => { if (args[2] instanceof Uint8Array && args[2][0] === 0xff) throw new InvalidEditProblems(['the portrait must be a PNG picture: convert it first']); edited.push(`portrait ${String(args[0])} ${String(args[1])} ${(args[2] as Uint8Array).length} ${String(args[3])}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
    },
    sessions: {
      list: () => listed,
      gallery: async () => ({ images: [], failures: {} }),
      galleryFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6, mediaType: 'image/png' }),
      uploadImage: async (_id, name) => `library/${name}`,
      updateImage: async (_id, path) => ({ path, purpose: 'uploaded', origin: 'uploaded', reusable: true, createdAt: 'now', tags: [], subjects: [] }),
      editCharacter: (id, key, edit) => {
        if (archiveError !== undefined) throw archiveError
        edited.push(`${id} ${key} ${JSON.stringify(edit)}`)
        return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] }
      },
      editPlace: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editThing: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editFaction: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editLore: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editPlots: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editRelation: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      editNarrationVoice: () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      generatePortrait: async () => ({ characters: [], places: [], things: [], factions: [], relations: [], plots: [] }),
      portraitFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
      generateEntityImage: async (id: string, kind: string, key: string) => { edited.push(`image ${id} ${kind} ${key}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      entityImageFile: async () => ({ file: join(base, 'worlds', 'secret.png'), size: 6 }),
      uploadEntityImage: async (...args: unknown[]) => { if (args[3] instanceof Uint8Array && args[3].length === 0) throw new InvalidEditProblems(['the picture must be a PNG picture: convert it first']); edited.push(`image ${String(args[0])} ${String(args[1])} ${String(args[2])} ${(args[3] as Uint8Array).length} ${String(args[4])}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      uploadPortrait: async (...args: unknown[]) => { if (args[2] instanceof Uint8Array && args[2].length === 0) throw new InvalidEditProblems(['the portrait must be a PNG picture: convert it first']); edited.push(`portrait ${String(args[0])} ${String(args[1])} ${(args[2] as Uint8Array).length} ${String(args[3])}`); return { characters: [], places: [], things: [], factions: [], relations: [], plots: [] } },
      start: async (request) => {
        startedWith = request
        if (startError !== undefined) throw startError
        return started
      },
      open: (id) => {
        if (openError !== undefined) return Promise.reject(openError)
        opened = id
        return Promise.resolve({ id, chatSessionId: `session-${id}` })
      },
      send: (id, text) => { said.push(`${id}: ${text}`); return Promise.resolve() },
      readSettings: () => {
        if (settingsError !== undefined) throw settingsError
        return { settings: DEFAULT_SETTINGS, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0, activity: [], usage: [], interventions: [], vectors: { available: true, embedded: 0, pending: 0 }, reflection: { running: false } }
      },
      writeSettings: (_id, value) => {
        if (settingsError !== undefined) throw settingsError
        writtenSettings = value
        return { settings: { ...DEFAULT_SETTINGS, maxRounds: (value as { maxRounds: number }).maxRounds }, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0, activity: [], usage: [], interventions: [], vectors: { available: true, embedded: 0, pending: 0 }, reflection: { running: false } }
      },
      timeline: (id) => {
        if (timelineError !== undefined) throw timelineError
        return { head: 'n2', path: [{ id: 'n1', turn: 1, player: `from ${id}`, restorable: true, alternatives: ['n1'] }], forward: [], canStart: true, withdrawn: [] }
      },
      moveTimeline: (id, to) => {
        if (timelineError !== undefined) return Promise.reject(timelineError)
        moved = [id, to]
        return Promise.resolve(to === 'start' ? { draft: 'the first message' } : {})
      },
      decisions: (id) => {
        if (decisionsError !== undefined) throw decisionsError
        const stats = emptyStats('then')
        stats.sites.triggers = { ...stats.sites.triggers, runs: 1, items: 2, agreed: 2, decisionMs: 5, llmMs: 90 }
        return { available: true, provider: 'typesafe', model: id, stats }
      },
      notes: (id) => {
        if (notesError !== undefined) throw notesError
        return [{ kind: 'suggestions', turn: 2, lines: [`from ${id}`] }]
      },
      activityRun: (id, run) => {
        if (id !== 'abc') throw new SessionNotFoundError(`no session "${id}"`)
        if (run === 'bad') throw new RangeError('"bad" is not a run')
        return run === 'kept' ? { persona: 'p', prompt: 'q', calls: [], result: '{}' } : undefined
      },
      imageStatus: id => Promise.resolve({ node: 'n2', mode: 'manual', state: 'absent', images: [], message: id }),
      generateImage: () => Promise.resolve({ node: 'n2', mode: 'manual', state: 'generating', images: [] }),
      imageFile: () => Promise.resolve({ file: join(base, 'worlds', 'harbor', 'media', 'files', 'm.png'), size: 9 }),
      world: (id) => {
        if (archiveError !== undefined) throw archiveError
        return { characters: [{ key: id, name: 'Clara', aliases: [], role: 'npc', tier: 'principal', kind: 'person', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, state: { publicState: '', innerState: '', activity: '' }, goals: [] }], places: [], things: [], factions: [], relations: [], plots: [] }
      },
      doctor: (id, title, language) => { if (archiveError !== undefined) return Promise.reject(archiveError); archived.push(`doctor ${id} ${title} ${language}`); return Promise.resolve({ chatSessionId: `doctor-${id}` }) },
      reflect: (id) => { if (archiveError !== undefined) return Promise.reject(archiveError); archived.push(`reflect ${id}`); return Promise.resolve() },
      resetVectors: (id) => { if (archiveError !== undefined) throw archiveError; archived.push(`reset ${id}`) },
      rename: (id, name) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`rename ${id} ${name}`)
        return Promise.resolve()
      },
      archive: (id) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`archive ${id}`)
        return Promise.resolve()
      },
      restore: (id) => {
        if (archiveError !== undefined) return Promise.reject(archiveError)
        archived.push(`restore ${id}`)
        return Promise.resolve()
      },
      delete: (id, everywhere) => {
        if (deleteError !== undefined) return Promise.reject(deleteError)
        deleted = id
        deletedEverywhere = everywhere
        return Promise.resolve()
      },
    },
    connection: { requestRejection: () => (allowed ? undefined : 401) },
  })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${API_PREFIX}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(base, { recursive: true, force: true })
})

describe('roleplay API', () => {
  it('refuses to touch a unit while it is being synced, and still answers about the sync itself', async () => {
    lockedUnit = 'worlds/harbor'
    const refused = await fetch(`${origin}/worlds/info?id=harbor`)
    expect(refused.status).toBe(423)
    expect((await fetch(`${origin}/worlds/info?id=other`)).status).not.toBe(423)
    expect((await fetch(`${origin}/sync/status`)).status).toBe(200)
    lockedUnit = undefined
  })

  describe('sync operations', () => {
    const json = (path: string, body: unknown): Promise<Response> => fetch(`${origin}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })

    it('runs all or selected units and resolves a conflict choice', async () => {
      expect((await json('/sync/run', {})).status).toBe(200)
      expect((await json('/sync/run', { units: ['worlds/harbor', 'prompts'] })).status).toBe(200)
      expect(await (await json('/sync/resolve', { unit: 'worlds/harbor', side: 'local' })).json()).toMatchObject({ id: 'worlds/harbor', state: 'synced' })
      expect(await (await json('/sync/resolve', { unit: 'gone', side: 'remote' })).json()).toBeNull()
      expect(syncCalls).toEqual(['run all', 'run worlds/harbor,prompts', 'resolve worlds/harbor local', 'resolve gone remote'])
    })

    it('validates run and conflict-choice bodies before touching sync state', async () => {
      expect((await json('/sync/run', { units: 'worlds/harbor' })).status).toBe(400)
      expect((await json('/sync/run', { units: ['worlds/harbor', 2] })).status).toBe(400)
      expect((await json('/sync/resolve', { unit: 2, side: 'local' })).status).toBe(400)
      expect((await json('/sync/resolve', { unit: 'worlds/harbor', side: 'either' })).status).toBe(400)
      expect(syncCalls).toEqual([])
    })

    it('forgets and restores a locally removed unit', async () => {
      expect((await json('/sync/forget', { unit: 'worlds/harbor' })).status).toBe(200)
      expect((await json('/sync/restore', { unit: 'worlds/harbor' })).status).toBe(200)
      expect((await json('/sync/forget', {})).status).toBe(400)
      expect((await json('/sync/restore', { unit: 3 })).status).toBe(400)
      expect(syncCalls).toEqual(['forget worlds/harbor', 'restore worlds/harbor'])
    })

    it('maps locked, refused, and rclone failures to their public status codes', async () => {
      syncError = new UnitLockedError('worlds/harbor')
      expect((await fetch(`${origin}/sync/status`)).status).toBe(423)
      syncError = new SyncRefusedError('sync is off')
      expect((await json('/sync/run', {})).status).toBe(409)
      syncError = new RcloneError('remote unavailable', 1)
      expect((await json('/sync/forget', { unit: 'worlds/harbor' })).status).toBe(502)
    })

    it('reads, stores, and clears the configured rclone password by credential reference', async () => {
      expect(await (await fetch(`${origin}/sync/password`)).json()).toMatchObject({ configured: true, ref: 'ROLEPLAY_SYNC_RCLONE_PASSWORD' })
      expect(await (await fetch(`${origin}/sync/password?ref=MY_SYNC_KEY`)).json()).toMatchObject({ ref: 'MY_SYNC_KEY' })
      const put = (body: unknown) => fetch(`${origin}/sync/password`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect((await put({ ref: 'MY_SYNC_KEY', value: 'secret' })).status).toBe(200)
      expect((await put({ value: '' })).status).toBe(200)
      expect(syncCalls).toEqual(['describe default', 'describe MY_SYNC_KEY', 'password MY_SYNC_KEY set', 'password default clear'])
    })

    it('rejects invalid password requests and reports a credential store refusal', async () => {
      expect((await fetch(`${origin}/sync/password?ref=9%20bad`)).status).toBe(400)
      const put = (body: unknown) => fetch(`${origin}/sync/password`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect((await put({ value: 3 })).status).toBe(400)
      expect((await put({ ref: '9 bad', value: 'secret' })).status).toBe(400)
      syncError = new SyncRefusedError('the credential file is read-only')
      expect((await put({ value: 'secret' })).status).toBe(409)
    })
  })

  it('serves the files a sandboxed frame loads by the key in their address without a login, and everything else only with one', async () => {
    allowed = false
    expect((await fetch(`${origin}/sessions/interface/frame/good/hud.html`)).status).toBe(200)
    expect((await fetch(`${origin}/sessions/interface/frame/wrong/hud.html`)).status).toBe(404)
    expect((await fetch(`${origin}/sessions/interface/frame/good`)).status).toBe(404)
    expect((await fetch(`${origin}/sessions/interface/pack/sess/hud.html`)).status).toBe(401)
    expect((await fetch(`${origin}/sessions/interface?id=sess`)).status).toBe(401)
    expect((await fetch(`${origin}/sessions/interface/frame/good/hud.html`, { method: 'POST' })).status).toBe(401)
    allowed = true
    expect((await fetch(`${origin}/sessions/interface/pack/sess/hud.html`)).status).toBe(200)
  })

  it('lists voices and returns synthesized audio', async () => {
    expect(await (await fetch(`${origin}/speech/capabilities`)).json()).toEqual({ streaming: true })
    const voices = await fetch(`${origin}/speech/voices`)
    expect(await voices.json()).toEqual([{ id: 'clara', name: 'Clara' }])
    const audio = await fetch(`${origin}/speech/synthesize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts: [{ text: 'Hello.', voice: 'clara' }] }) })
    expect(audio.headers.get('content-type')).toBe('audio/mpeg')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  })

  it('lists worlds', async () => {
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(200)
    const body = await response.json() as { directory: string; worlds: { id: string; name: string; coverVersion?: string }[] }
    expect(body.directory).toBe(join(base, 'worlds'))
    expect(body.worlds).toMatchObject([{ id: 'harbor', name: 'Harbor', tags: ['noir'] }])
    expect(body.worlds[0]?.coverVersion).toBeTruthy()
  })

  it('reads and changes what a world says about itself, with the problems of a refused change', async () => {
    expect(await (await fetch(`${origin}/worlds/info?id=harbor`)).json()).toMatchObject({ name: 'harbor' })
    const put = (body: unknown) => fetch(`${origin}/worlds/info?id=harbor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(await (await put({ tags: ['a'] })).json()).toMatchObject({ tags: ['a'] })
    const refused = await put({ timeZone: 'bad' })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ problems: ['time_zone is not a time zone'] })
    expect((await put({ name: '' })).status).toBe(422)
  })

  it('serves a world\'s prompts and takes its own versions', async () => {
    expect(await (await fetch(`${origin}/worlds/prompts?id=harbor&language=en`)).json()).toEqual([{ id: 'roleplay/style', kind: 'prose', carried: false }])
    expect(await (await fetch(`${origin}/worlds/prompts/item?id=harbor&language=en&prompt=roleplay/style`)).json()).toMatchObject({ text: 'Write plainly.' })
    expect((await fetch(`${origin}/worlds/prompts/item?id=harbor&language=en&prompt=roleplay/nope`)).status).toBe(422)
    const put = (text: unknown) => fetch(`${origin}/worlds/prompts/item?id=harbor&language=en&prompt=roleplay/style`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    expect((await put('Be brief.')).status).toBe(200)
    expect((await put('')).status).toBe(422)
    expect((await put(3)).status).toBe(400)
    expect((await fetch(`${origin}/worlds/prompts/item?id=harbor&language=en&prompt=roleplay/style`, { method: 'DELETE' })).status).toBe(200)
  })

  it('serves a world\'s pictures like a session\'s', async () => {
    expect(await (await fetch(`${origin}/worlds/gallery?id=harbor`)).json()).toEqual({ images: [], failures: {} })
    const upload = await fetch(`${origin}/worlds/gallery/upload?id=harbor&name=dock.png`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([1, 2, 3]) })
    expect(await upload.json()).toEqual({ path: 'library/dock.png' })
    expect((await fetch(`${origin}/worlds/gallery?id=harbor&path=x`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reusable: 'yes' }) })).status).toBe(400)
    expect((await fetch(`${origin}/worlds/gallery/file?id=harbor&path=x`)).status).toBe(404)
  })

  it('reads and replaces the calendar of a world', async () => {
    expect(await (await fetch(`${origin}/worlds/calendar?id=harbor`)).json()).toEqual({ hemisphere: 'north', holidays: [] })
    const put = (body: unknown) => fetch(`${origin}/worlds/calendar?id=harbor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(await (await put({ hemisphere: 'south', holidays: [{ id: 'fair', name: 'Fair', on: ['09-28'] }] })).json()).toEqual({ hemisphere: 'south', holidays: [{ id: 'fair', name: 'Fair', on: ['09-28'] }] })
    expect((await put({ hemisphere: 'south', holidays: [{ id: '', name: 'Fair', on: [] }] })).status).toBe(422)
    expect((await put({ hemisphere: 'moon', holidays: [] })).status).toBe(422)
  })

  it('says which language a world is written in, and asks for its translation', async () => {
    const known = await fetch(`${origin}/worlds/language?id=harbor`)
    expect(await known.json()).toEqual({ language: 'en' })
    expect(await (await fetch(`${origin}/worlds/language?id=other`)).json()).toEqual({ language: null })
    expect((await fetch(`${origin}/worlds/language?id=missing`)).status).toBe(404)
    const ask = (id: string, body: object) => fetch(`${origin}/worlds/translate?id=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(await (await ask('other', { to: 'zh', title: 'Translating' })).json()).toEqual({ chatSessionId: 'world-author-other', started: true })
    expect((await ask('harbor', { to: 'en', title: 'Translating' })).status).toBe(422)
    expect((await ask('harbor', { to: 'fr', title: 'Translating' })).status).toBe(400)
    expect((await ask('harbor', { to: 'zh' })).status).toBe(400)
  })

  it('opens a dedicated authoring chat for a world', async () => {
    const opened = await fetch(`${origin}/worlds/authoring?id=harbor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Authoring Harbor' }) })
    expect(opened.status).toBe(200)
    expect(await opened.json()).toEqual({ chatSessionId: 'world-author-harbor' })

    const missing = await fetch(`${origin}/worlds/authoring?id=missing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Missing' }) })
    expect(missing.status).toBe(404)
  })

  it('re-enumerates on POST refresh', async () => {
    await fetch(`${origin}/worlds`)
    const folder = join(base, 'worlds', 'later')
    await mkdir(folder)
    await writeFile(join(folder, 'world.json'), '{"id":"later","name":"Later"}')
    const cached = await (await fetch(`${origin}/worlds`)).json() as { worlds: unknown[] }
    expect(cached.worlds).toHaveLength(1)
    const refreshed = await (await fetch(`${origin}/worlds/refresh`, { method: 'POST' })).json() as { worlds: unknown[] }
    expect(refreshed.worlds).toHaveLength(2)
  })

  it('serves a cover with a long-lived cache only for its current version', async () => {
    const { worlds } = await (await fetch(`${origin}/worlds`)).json() as { worlds: { coverVersion: string }[] }
    const version = worlds[0]?.coverVersion ?? ''
    const current = await fetch(`${origin}/worlds/cover?id=harbor&v=${version}`)
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/png')
    expect(current.headers.get('cache-control')).toContain('immutable')
    expect(await current.text()).toBe('png-bytes')
    const stale = await fetch(`${origin}/worlds/cover?id=harbor&v=old`)
    expect(stale.headers.get('cache-control')).toBe('no-cache')
    await stale.arrayBuffer()
  })

  it('does not serve covers for unknown ids or paths', async () => {
    for (const id of ['missing', '../secret.png', '', 'harbor/../../secret.png']) {
      const response = await fetch(`${origin}/worlds/cover?id=${encodeURIComponent(id)}`)
      expect(response.status).toBe(404)
      await response.arrayBuffer()
    }
  })

  it('refuses unauthenticated requests', async () => {
    allowed = false
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(401)
    await response.arrayBuffer()
  })

  it('rejects unknown routes and wrong methods', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404)
    const wrong = await fetch(`${origin}/worlds`, { method: 'DELETE' })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET, POST')
    expect((await fetch(`${origin}/worlds/refresh`)).status).toBe(405)
  })

  describe('uploading a portrait', () => {
    const upload = (path: string, body: Uint8Array) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'x-file-name': encodeURIComponent('clara face.png') }, body })

    it('hands the bytes and the name to the world or the session, and says why a picture is refused', async () => {
      expect((await upload('/worlds/state/character/portrait/upload?id=w&key=clara', new Uint8Array([1, 2, 3]))).status).toBe(200)
      expect((await upload('/sessions/world/character/portrait/upload?id=abc&key=clara', new Uint8Array([1, 2]))).status).toBe(200)
      expect(edited).toEqual(['portrait w clara 3 clara face.png', 'portrait abc clara 2 clara face.png'])
      expect((await upload('/worlds/state/character/portrait/upload?id=w&key=clara', new Uint8Array([0xff]))).status).toBe(422)
      expect((await fetch(`${origin}/worlds/state/character/portrait/upload?id=w&key=clara`)).status).toBe(405)
    })
  })

  describe('the interface packs of a world', () => {
    const call = (method: string, query: string, body?: unknown) => fetch(`${origin}/worlds/interface/file?${query}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

    it('have their text files read, written and removed, and a new pack made, with what is wrong with the pack answered', async () => {
      expect(await (await call('GET', 'id=w&pack=atlas&path=hud.html')).json()).toEqual({ text: '<p>atlas/hud.html</p>' })
      expect((await call('GET', 'id=w&pack=atlas&path=gone.html')).status).toBe(422)
      const written = await call('PUT', 'id=w&pack=atlas&path=hud.html', { text: '<b>hi</b>' })
      expect(await written.json()).toEqual({ problems: [{ file: 'pack.json', message: 'has no surfaces' }] })
      expect((await call('PUT', 'id=w&pack=atlas&path=map.png', { text: 'x' })).status).toBe(422)
      expect((await call('PUT', 'id=w&pack=atlas&path=hud.html', { text: 5 })).status).toBe(422)
      expect((await call('DELETE', 'id=w&pack=atlas&path=hud.html')).status).toBe(200)
      expect((await fetch(`${origin}/worlds/interface/pack?id=w&pack=atlas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Atlas' }) })).status).toBe(201)
      expect(edited).toEqual(['pack w atlas hud.html <b>hi</b>', 'delete pack file w atlas hud.html', 'new pack w atlas Atlas'])
    })
  })

  describe('the lorebook library', () => {
    const send = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
    beforeEach(() => { lorebookCalls = [] })

    it('lists, reads, makes, changes and removes lorebooks', async () => {
      expect(await (await send('GET', '/lorebooks')).json()).toEqual([bookSummary])
      expect((await send('GET', '/lorebooks/item?name=gone')).status).toBe(422)
      expect((await send('POST', '/lorebooks', { name: 'harbor', title: 'Harbor' })).status).toBe(201)
      expect((await send('POST', '/lorebooks', { title: 'x' })).status).toBe(400)
      expect((await send('PUT', '/lorebooks/item?name=harbor', { description: 'Town.' })).status).toBe(200)
      expect((await send('PUT', '/lorebooks/item?name=harbor', { description: 5 })).status).toBe(400)
      expect((await send('DELETE', '/lorebooks/item?name=harbor')).status).toBe(204)
      expect(lorebookCalls).toEqual(['create {"name":"harbor","title":"Harbor"}', 'info harbor {"description":"Town."}', 'remove harbor'])
    })

    it('writes and removes an entry, and says what is wrong with one', async () => {
      const entry = { title: 'Tides', kind: 'geography', scope: 'everyone', body: 'Twice a day.' }
      expect((await send('PUT', '/lorebooks/entry?name=harbor&id=tides', entry)).status).toBe(200)
      expect((await send('PUT', '/lorebooks/entry?name=harbor&id=tides', { ...entry, kind: 'nonsense' })).status).toBe(400)
      expect((await send('PUT', '/lorebooks/entry?name=harbor&id=tides', { ...entry, scope: 'some' })).status).toBe(400)
      expect((await send('PUT', '/lorebooks/entry?name=harbor&id=tides', { ...entry, knownBy: 'Ann' })).status).toBe(400)
      expect((await send('DELETE', '/lorebooks/entry?name=harbor&id=tides')).status).toBe(200)
      expect(lorebookCalls).toEqual(['entry harbor {"id":"tides","title":"Tides","kind":"geography","scope":"everyone","knownBy":[],"summary":"","body":"Twice a day.","related":[]}', 'remove entry harbor tides'])
    })

    it('shows, adds to and removes from the lorebooks of a story', async () => {
      expect(await (await send('GET', '/sessions/lorebooks?id=sess')).json()).toEqual({ applied: [], available: [bookSummary] })
      expect((await send('GET', '/sessions/lorebooks?id=gone')).status).toBe(404)
      expect(await (await send('POST', '/sessions/lorebooks?id=sess', { name: 'harbor' })).json()).toEqual({ entries: 1, notes: [] })
      expect((await send('POST', '/sessions/lorebooks?id=sess', {})).status).toBe(400)
      expect((await send('POST', '/sessions/lorebooks?id=busy', { name: 'harbor' })).status).toBe(409)
      expect(await (await send('DELETE', '/sessions/lorebooks?id=sess&name=harbor')).json()).toEqual({ removed: 1 })
      expect(lorebookCalls).toEqual(['story add sess harbor', 'story add busy harbor', 'story remove sess harbor'])
    })

    it('opens the authoring chat and takes an uploaded lorebook', async () => {
      expect(await (await send('POST', '/lorebooks/authoring?name=harbor', { language: 'zh' })).json()).toEqual({ chatSessionId: 'lorebook-author-harbor' })
      expect((await fetch(`${origin}/lorebooks/import?name=harbor&language=en`, { method: 'POST', body: new Uint8Array([1, 2, 3]) })).status).toBe(200)
      expect(lorebookCalls).toEqual(['author harbor zh', 'import harbor 3 en'])
    })
  })

  describe('the preset library', () => {
    const send = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

    it('lists, reads, makes from a world, and removes presets', async () => {
      expect(await (await send('GET', '/presets')).json()).toEqual([summary])
      expect((await (await send('GET', '/presets/item?name=noir')).json() as { prompts: unknown }).prompts).toEqual({ 'en/roleplay/style': 'Terse.' })
      expect((await send('GET', '/presets/item?name=gone')).status).toBe(422)
      expect((await send('POST', '/presets', { name: 'noir', fromWorld: 'harbor', sampling: { master: 0.5 } })).status).toBe(201)
      expect((await send('POST', '/presets', { name: 'plain' })).status).toBe(201)
      expect((await send('POST', '/presets', { name: 'noir', fromWorld: 5 })).status).toBe(400)
      expect((await send('POST', '/presets', { name: 'noir', fromWorld: 'harbor', sampling: { master: 'hot' } })).status).toBe(400)
      expect((await send('DELETE', '/presets/item?name=noir')).status).toBe(204)
      expect(presetCalls).toEqual(['create {"name":"noir","fromWorld":"harbor","sampling":{"master":0.5}}', 'create {"name":"plain","sampling":{}}', 'remove noir'])
    })

    it('changes what a preset says and the text of its prompts, opens its authoring chat and takes an upload', async () => {
      expect((await send('PUT', '/presets/item?name=noir', { title: 'Noir', sampling: { master: 0.9 } })).status).toBe(200)
      expect((await send('PUT', '/presets/item?name=noir', { title: 4 })).status).toBe(400)
      expect(await (await send('GET', '/presets/prompts?name=noir&language=en')).json()).toEqual(['en-game-master'])
      expect((await send('GET', '/presets/prompts?name=gone&language=en')).status).toBe(422)
      expect(await (await send('GET', '/presets/prompt?name=noir&language=en&id=roleplay/game-master')).json()).toEqual({ text: 'noir en roleplay/game-master' })
      expect((await send('PUT', '/presets/prompt?name=noir&language=en&id=roleplay/style', { text: 'Terse.' })).status).toBe(200)
      expect((await send('PUT', '/presets/prompt?name=noir&language=en&id=roleplay/style', { text: ' ' })).status).toBe(400)
      expect((await send('PUT', '/presets/prompt?name=noir&language=1&id=roleplay/style', { text: 'x' })).status).toBe(422)
      expect((await send('DELETE', '/presets/prompt?name=noir&language=zh&id=roleplay/style')).status).toBe(200)
      expect(await (await send('POST', '/presets/authoring?name=noir', { language: 'zh' })).json()).toEqual({ chatSessionId: 'preset-author-noir' })
      expect((await fetch(`${origin}/presets/import?name=st&language=en`, { method: 'POST', body: new Uint8Array(10) })).status).toBe(200)
      expect(presetCalls).toEqual(['info noir {"title":"Noir","sampling":{"master":0.9}}', 'prompt noir en roleplay/style Terse.', 'prompt noir zh roleplay/style undefined', 'author noir zh', 'import st 10 en'])
    })

    it('reports and changes the preset of a story, and answers an unknown story with 404', async () => {
      expect(await (await send('GET', '/sessions/preset?id=sess')).json()).toEqual({ available: [summary] })
      expect((await send('GET', '/sessions/preset?id=nope')).status).toBe(404)
      expect((await send('POST', '/sessions/preset?id=sess', { name: 'noir' })).status).toBe(200)
      expect((await send('POST', '/sessions/preset?id=sess', {})).status).toBe(200)
      expect((await send('POST', '/sessions/preset?id=sess', { name: 5 })).status).toBe(400)
      expect(presetCalls).toEqual(['apply sess noir', 'apply sess undefined'])
    })
  })

  describe('the triggers of a world', () => {
    const send = (method: string, query: string, body?: unknown) => fetch(`${origin}/worlds/state/trigger?${query}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

    it('are read, written and removed by key, and the reasons a document is refused are given', async () => {
      expect(await (await send('GET', 'id=w&key=knock')).json()).toEqual({ key: 'knock', name: 'Knock' })
      expect((await send('GET', 'id=w&key=gone')).status).toBe(422)
      expect((await send('PUT', 'id=w&key=knock', { name: 'Knock', when: { type: 'event', tag: 'door' } })).status).toBe(200)
      const refused = await send('PUT', 'id=w&key=knock', { when: {} })
      expect(refused.status).toBe(422)
      expect((await refused.json() as { problems: string[] }).problems).toEqual(['name is required'])
      expect((await send('DELETE', 'id=w&key=knock')).status).toBe(200)
      expect(edited).toEqual(['trigger w knock {"name":"Knock","when":{"type":"event","tag":"door"}}', 'remove trigger w knock'])
    })
  })

  describe('the pictures of places and things', () => {
    const upload = (path: string, body: Uint8Array) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'x-file-name': encodeURIComponent('inn.png') }, body })

    it('are made, brought and read for a world and for a session, by kind', async () => {
      expect((await fetch(`${origin}/worlds/state/place/image?id=w&key=inn`, { method: 'POST' })).status).toBe(200)
      expect((await fetch(`${origin}/sessions/world/thing/image?id=abc&key=lamp`, { method: 'POST' })).status).toBe(200)
      expect((await upload('/worlds/state/thing/image/upload?id=w&key=lamp', new Uint8Array([1, 2, 3]))).status).toBe(200)
      expect((await upload('/worlds/state/place/image/upload?id=w&key=inn', new Uint8Array([0xff]))).status).toBe(422)
      expect(edited).toEqual(['image w place inn', 'image abc thing lamp', 'image w thing lamp 3 inn.png'])
      expect((await fetch(`${origin}/worlds/state/place/image/upload?id=w&key=inn`)).status).toBe(405)
    })
  })

  describe('the catalogues', () => {
    const post = (body: unknown) => fetch(`${origin}/catalogue/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('lists the configured catalogues without any key', async () => {
      expect(await (await fetch(`${origin}/catalogue/sources`)).json()).toEqual([{ name: 'Home', baseUrl: 'http://localhost:9798', hasKey: true, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY', keySource: 'file' }])
    })

    it('describes and keeps a key in the credential store, and never answers with it', async () => {
      expect(await (await fetch(`${origin}/catalogue/key?ref=MY_KEY`)).json()).toEqual({ ref: 'MY_KEY', configured: true, writable: true, source: 'file' })
      const put = (body: unknown) => fetch(`${origin}/catalogue/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const kept = await put({ ref: 'MY_KEY', value: 'sk-secret' })
      expect(await kept.json()).toEqual({ ref: 'MY_KEY', configured: true, writable: true })
      expect(await (await put({ ref: 'MY_KEY', value: '' })).json()).toEqual({ ref: 'MY_KEY', configured: false, writable: true })
      expect((await put({ ref: 'MY_KEY' })).status).toBe(400)
      catalogueError = new CatalogueError('this profile has no credential store', 'unavailable')
      expect((await put({ ref: 'MY_KEY', value: 'x' })).status).toBe(503)
      expect(catalogueCalls.filter(call => call.startsWith('keep'))).toEqual(['keep MY_KEY value', 'keep MY_KEY -', 'keep MY_KEY value'])
    })

    it('browses and shows worlds, and serves a cover, for the named catalogue', async () => {
      expect(await (await fetch(`${origin}/catalogue/worlds?source=Home&search=fog&offset=24&sort=popular`)).json()).toEqual({ items: [], withKey: true })
      expect(await (await fetch(`${origin}/catalogue/world?source=Home&id=w1`)).json()).toEqual({ id: 'w1' })
      const cover = await fetch(`${origin}/catalogue/cover?source=Home&id=w1`)
      expect(cover.headers.get('content-type')).toBe('image/png')
      expect(cover.headers.get('cache-control')).toBe('private, no-cache')
      expect(Buffer.from(await cover.arrayBuffer()).toString()).toBe('png')
      expect(catalogueCalls).toEqual(['worlds Home {"kind":"world","search":"fog","offset":24,"sort":"popular"}', 'world Home w1', 'cover Home w1'])
    })

    it('installs from an address, with the checksum when given', async () => {
      const response = await post({ url: 'https://x.example/w.zip', sha256: 'ab' })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ world: { id: 'w' }, packs: [] })
      expect(catalogueCalls).toEqual(['install {"url":"https://x.example/w.zip","sha256":"ab"}'])
      expect((await post({ url: 3 })).status).toBe(400)
      expect((await post({ url: 'x', sha256: 3 })).status).toBe(400)
    })

    it('passes how to treat a world the person has, and refuses anything else', async () => {
      await post({ url: 'https://x.example/w.zip', mode: 'update', overwriteChanges: true })
      expect(catalogueCalls).toEqual(['install {"url":"https://x.example/w.zip","mode":"update","overwriteChanges":true}'])
      expect((await post({ url: 'x', mode: 'merge' })).status).toBe(400)
      expect((await post({ url: 'x', overwriteChanges: 'yes' })).status).toBe(400)
    })

    it('says what the person can decide when a conflict has a reason', async () => {
      catalogueError = new CatalogueError('you changed "Harbor" since you installed it', 'conflict', { reason: 'modified', changes: ['changed: notes.txt'] })
      const response = await post({ url: 'https://x.example/w.zip', mode: 'update' })
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ message: 'you changed "Harbor" since you installed it', reason: 'modified', changes: ['changed: notes.txt'] })
    })

    it('checks for updates and converts a card for the named catalogue', async () => {
      expect(await (await fetch(`${origin}/catalogue/updates?source=Home`)).json()).toEqual({ updates: [], problems: [] })
      const convert = (body: unknown) => fetch(`${origin}/catalogue/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const response = await convert({ source: 'Home', versionId: 'v1', language: 'zh' })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ worldId: 'w', chatSessionId: 'c', started: true })
      expect(catalogueCalls).toEqual(['updates Home', 'convert {"source":"Home","versionId":"v1","language":"zh"}'])
      expect((await convert({ source: 'Home' })).status).toBe(400)
      const imported = await fetch(`${origin}/catalogue/convert/preset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v2', title: 'Noir' }) })
      expect(imported.status).toBe(201)
      expect(await imported.json()).toEqual({ name: 'p', chatSessionId: 'c', started: true })
      expect(catalogueCalls.at(-1)).toBe('preset {"source":"Home","versionId":"v2","title":"Noir"}')
      const stagedRelease = await fetch(`${origin}/catalogue/stage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v2', kind: 'preset' }) })
      expect(stagedRelease.status).toBe(200)
      expect(catalogueCalls.at(-1)).toBe('stage {"source":"Home","versionId":"v2","kind":"preset"}')
      expect((await fetch(`${origin}/catalogue/stage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v2', kind: 'card' }) })).status).toBe(400)
      const card = await fetch(`${origin}/catalogue/stage/card`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v1' }) })
      expect((await card.json() as { id: string }).id).toBe('cd1')
      expect(catalogueCalls.at(-1)).toBe('card {"source":"Home","versionId":"v1"}')
      expect((await fetch(`${origin}/catalogue/stage/card`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home' }) })).status).toBe(400)
      const made = await fetch(`${origin}/catalogue/convert/staged`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v1', id: 'cd1', language: 'zh', choices: { name: 'Mine', disabledEntries: ['3'], opening: { kind: 'none' } } }) })
      expect(made.status).toBe(201)
      expect(await made.json()).toEqual({ worldId: 'w', chatSessionId: 'c', started: true })
      expect(catalogueCalls.at(-1)).toBe('staged {"source":"Home","versionId":"v1","id":"cd1","choices":{"name":"Mine","disabledEntries":["3"],"opening":{"kind":"none"}},"language":"zh"}')
      await fetch(`${origin}/catalogue/convert/staged`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v1', id: 'cd1', update: 'w1', choices: { name: 'Mine', disabledEntries: [], opening: { kind: 'none' } } }) })
      expect(catalogueCalls.at(-1)).toBe('staged {"source":"Home","versionId":"v1","id":"cd1","choices":{"name":"Mine","disabledEntries":[],"opening":{"kind":"none"}},"update":"w1"}')
      expect((await fetch(`${origin}/catalogue/convert/staged`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v1', id: 'cd1', choices: { name: '' } }) })).status).toBeGreaterThanOrEqual(400)
      const book = await fetch(`${origin}/catalogue/convert/lorebook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'Home', versionId: 'v3', title: 'Harbor' }) })
      expect(book.status).toBe(201)
      expect(catalogueCalls.at(-1)).toBe('lorebook {"source":"Home","versionId":"v3","title":"Harbor"}')
    })

    it('answers with the status that says whose fault a failure is', async () => {
      for (const [failure, status] of [['input', 400], ['unknown', 404], ['upstream', 502], ['invalid', 422], ['conflict', 409]] as const) {
        catalogueError = new CatalogueError(`because ${failure}`, failure)
        const response = await post({ url: 'https://x.example/w.zip' })
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ message: `because ${failure}` })
        expect((await fetch(`${origin}/catalogue/worlds?source=Home`)).status).toBe(status)
      }
      catalogueError = new Error('unrelated')
      expect((await post({ url: 'https://x.example/w.zip' })).status).toBe(500)
    })
  })

  describe('the starter worlds', () => {
    it('lists the worlds the package ships', async () => {
      expect(await (await fetch(`${origin}/worlds/starter`)).json()).toEqual([{ folder: 'sample', name: 'Sample', description: '', tags: [], installed: false }])
    })

    it('adds one, and says why it cannot', async () => {
      const post = (body: unknown) => fetch(`${origin}/worlds/starter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const added = await post({ folder: 'sample' })
      expect(added.status).toBe(201)
      expect(await added.json()).toMatchObject({ id: 'sample', name: 'Sample' })
      expect((await post({ folder: 'nothing' })).status).toBe(404)
      expect((await post({ folder: 'have' })).status).toBe(409)
      expect((await post({ folder: 3 })).status).toBe(400)
    })
  })

  describe('the characters of a world', () => {
    it('lists them', async () => {
      const response = await fetch(`${origin}/worlds/characters?id=harbor`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(cast)
    })

    it('answers 404 for an unknown world', async () => {
      charactersError = new WorldNotFoundError('there is no world with id "nope"')
      expect((await fetch(`${origin}/worlds/characters?id=nope`)).status).toBe(404)
    })

    it('is refused without authentication', async () => {
      allowed = false
      expect((await fetch(`${origin}/worlds/characters?id=harbor`)).status).toBe(401)
    })
  })

  describe('listing sessions', () => {
    it('lists them', async () => {
      const response = await fetch(`${origin}/sessions`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(listed)
    })

    it('is refused without authentication', async () => {
      allowed = false
      expect((await fetch(`${origin}/sessions`)).status).toBe(401)
    })
  })

  describe('starting a session', () => {
    const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }): Promise<Response> =>
      fetch(`${origin}/sessions`, { method: 'POST', headers, body })
    const valid = '{"worldId":"harbor","playerCharacterId":"arthur"}'

    it('starts one for the world and character named in the body', async () => {
      const response = await post(valid)
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(started)
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur' })
    })

    it('passes on the name when one is given', async () => {
      await post('{"worldId":"harbor","playerCharacterId":"arthur","name":"Night one"}')
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur', name: 'Night one' })
    })

    it('passes on the preset and the lorebooks chosen, including none', async () => {
      await post('{"worldId":"harbor","playerCharacterId":"arthur","preset":"noir","lorebooks":["harbor-notes"]}')
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur', preset: 'noir', lorebooks: ['harbor-notes'] })
      await post('{"worldId":"harbor","playerCharacterId":"arthur","lorebooks":[]}')
      expect(startedWith).toEqual({ worldId: 'harbor', playerCharacterId: 'arthur', lorebooks: [] })
    })

    it.each([
      ['a body without a world', '{"playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a blank world id', '{"worldId":"  ","playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a world id that is not text', '{"worldId":3,"playerCharacterId":"a"}', 400, '"worldId" is required'],
      ['a body without a character', '{"worldId":"harbor"}', 400, '"playerCharacterId" or "playerAvatar" is required'],
      ['a name that is not text', '{"worldId":"harbor","playerCharacterId":"a","name":3}', 400, '"name" must be a string'],
      ['lorebooks that are not a list of names', '{"worldId":"harbor","playerCharacterId":"a","lorebooks":"x"}', 400, '"lorebooks" must be a list'],
      ['invalid JSON', '{', 400, 'not valid JSON'],
      ['a body that is not an object', '[]', 400, 'must be a JSON object'],
    ])('rejects %s', async (_label, body, status, message) => {
      const response = await post(body)
      expect(response.status).toBe(status)
      expect(((await response.json()) as { message: string }).message).toContain(message)
      expect(startedWith).toBeUndefined()
    })

    it('rejects a body that is not declared as JSON, or is too large', async () => {
      expect((await post(valid, { 'content-type': 'text/plain' })).status).toBe(415)
      expect((await post(JSON.stringify({ worldId: 'x'.repeat(20_000), playerCharacterId: 'a' }))).status).toBe(413)
      expect(startedWith).toBeUndefined()
    })

    it('answers 404 for an unknown world', async () => {
      startError = new WorldNotFoundError('there is no world with id "nope"')
      const response = await post(valid)
      expect(response.status).toBe(404)
      expect(((await response.json()) as { message: string }).message).toContain('no world')
    })

    it('answers 422 for a character or name that is not acceptable', async () => {
      startError = new InvalidStartError('Clara cannot be played')
      const response = await post(valid)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ message: 'Clara cannot be played' })
    })

    it('answers 422, with the problems, for a world that cannot be played', async () => {
      startError = new InvalidWorldError('the characters have 1 problem(s)', [{ path: '/w/c.json', message: 'name: is required' }])
      const response = await post(valid)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        message: 'the characters have 1 problem(s)',
        problems: [{ path: '/w/c.json', message: 'name: is required' }],
      })
    })

    it('answers 503 when the chat cannot be created for lack of services', async () => {
      startError = new AgentUnavailableError('this DSH profile has no session services')
      const response = await post(valid)
      expect(response.status).toBe(503)
      expect(((await response.json()) as { message: string }).message).toContain('no session services')
    })

    it('answers 500 for any other failure', async () => {
      startError = new Error('disk full')
      const response = await post(valid)
      expect(response.status).toBe(500)
      expect(((await response.json()) as { message: string }).message).toBe('disk full')
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await post(valid)).status).toBe(401)
      allowed = true
      const wrong = await fetch(`${origin}/sessions`, { method: 'PUT' })
      expect(wrong.status).toBe(405)
      expect(wrong.headers.get('allow')).toBe('GET, POST')
      expect(startedWith).toBeUndefined()
    })
  })

  describe('deleting a session', () => {
    const remove = (id: string): Promise<Response> => fetch(`${origin}/sessions/item?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

    it('deletes the session named in the query', async () => {
      const response = await remove('session-id')
      expect(response.status).toBe(204)
      expect(deleted).toBe('session-id')
    })

    it('deletes from the sync remote as well only when asked to', async () => {
      await remove('session-id')
      expect(deletedEverywhere).toBe(false)
      await fetch(`${origin}/sessions/item?id=session-id&everywhere=true`, { method: 'DELETE' })
      expect(deletedEverywhere).toBe(true)
    })

    it('says why the remote could not be reached: 409 when sync refuses, 502 when rclone fails', async () => {
      deleteError = new SyncRefusedError('a sync is running')
      expect((await remove('session-id')).status).toBe(409)
      deleteError = new RcloneError('no route to the remote', 1)
      expect((await remove('session-id')).status).toBe(502)
    })

    it('answers 404 for a session that does not exist', async () => {
      deleteError = new SessionNotFoundError('no session "x"')
      const response = await remove('x')
      expect(response.status).toBe(404)
      expect(((await response.json()) as { message: string }).message).toBe('no session "x"')
    })

    it('answers 503 when the chat services are missing', async () => {
      deleteError = new AgentUnavailableError('no services')
      expect((await remove('session-id')).status).toBe(503)
    })

    it('answers 500 for any other failure', async () => {
      deleteError = new Error('locked')
      expect((await remove('session-id')).status).toBe(500)
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await remove('session-id')).status).toBe(401)
      allowed = true
      expect((await fetch(`${origin}/sessions/item?id=x`, { method: 'POST' })).status).toBe(405)
      expect(deleted).toBeUndefined()
    })
  })

  describe('opening a session', () => {
    const open = (id: string): Promise<Response> => fetch(`${origin}/sessions/open?id=${encodeURIComponent(id)}`, { method: 'POST' })

    it('answers with the chat to open', async () => {
      const response = await open('session-id')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'session-id', chatSessionId: 'session-session-id' })
      expect(opened).toBe('session-id')
    })

    it('answers 404 for an unknown session and 503 without chat services', async () => {
      openError = new SessionNotFoundError('no session "x"')
      expect((await open('x')).status).toBe(404)
      openError = new AgentUnavailableError('no services')
      expect((await open('x')).status).toBe(503)
    })

    it('is refused without authentication, and rejects other methods', async () => {
      allowed = false
      expect((await open('session-id')).status).toBe(401)
      allowed = true
      expect((await fetch(`${origin}/sessions/open?id=x`)).status).toBe(405)
      expect(opened).toBeUndefined()
    })
  })

  describe('putting a session away', () => {
    it('is done and undone by POST, and answers 404 for an unknown session and 503 without the session services; an archived session cannot be opened', async () => {
      expect((await fetch(`${origin}/sessions/archive?id=abc`, { method: 'POST' })).status).toBe(204)
      expect((await fetch(`${origin}/sessions/restore?id=abc`, { method: 'POST' })).status).toBe(204)
      expect(archived).toEqual(['archive abc', 'restore abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/archive?id=x`, { method: 'POST' })).status).toBe(404)
      expect((await fetch(`${origin}/sessions/restore?id=x`, { method: 'POST' })).status).toBe(404)
      archiveError = new AgentUnavailableError('no session services')
      expect((await fetch(`${origin}/sessions/archive?id=x`, { method: 'POST' })).status).toBe(503)
      archiveError = undefined
      openError = new SessionArchivedError('the session is put away')
      const opened = await fetch(`${origin}/sessions/open?id=abc`, { method: 'POST' })
      expect(opened.status).toBe(409)
      expect(await opened.json()).toEqual({ message: 'the session is put away' })
      expect((await fetch(`${origin}/sessions/archive?id=abc`)).status).toBe(405)
    })
  })

  describe('saying something in a session', () => {
    const say = (body: unknown): Promise<Response> => fetch(`${origin}/sessions/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('opens the chat, queues the words as the player\'s and answers 202; empty or missing text is refused', async () => {
      const response = await say({ id: 'abc', text: 'I wait.' })
      expect(response.status).toBe(202)
      expect(opened).toBe('abc')
      expect(said).toEqual(['abc: I wait.'])
      expect((await say({ id: 'abc', text: ' ' })).status).toBe(400)
      expect((await say({ text: 'x' })).status).toBe(400)
      expect((await fetch(`${origin}/sessions/message`)).status).toBe(405)
    })
  })

  describe('the world of a session', () => {
    it('is read as the characters it has now, and a session there is not is 404', async () => {
      const found = await fetch(`${origin}/sessions/world?id=abc`)
      expect(found.status).toBe(200)
      expect(((await found.json()) as { characters: { key: string }[] }).characters.map(character => character.key)).toEqual(['abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/world?id=x`)).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/world?id=abc`, { method: 'POST' })).status).toBe(405)
    })
  })

  describe('editing a character', () => {
    const put = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('in a session: reads the edit, answers the world as it stands, 422 with the problems when it is not acceptable, 404 for an unknown session', async () => {
      const done = await put('/sessions/world/character?id=abc&key=clara', { name: 'Clara W', place: { location: 'bar', position: 'by the till' }, goals: [{ ref: '1', priority: 0.5 }] })
      expect(done.status).toBe(200)
      expect(edited).toEqual(['abc clara {"name":"Clara W","place":{"location":"bar","position":"by the till"},"goals":[{"ref":"1","priority":0.5}]}'])
      const refused = await put('/sessions/world/character?id=abc&key=clara', { name: '  ', role: 'wizard', unknown: 1 })
      expect(refused.status).toBe(422)
      expect(((await refused.json()) as { problems: string[] }).problems).toEqual(expect.arrayContaining(['name cannot be blank', 'role must be one of: playable, npc', 'unknown is not something that can be edited']))
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await put('/sessions/world/character?id=x&key=clara', { name: 'x' })).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/world/character?id=abc&key=clara`)).status).toBe(405)
    })

    it('the days and variables of a world are read and replaced; shapes that are wrong and files that would not be valid are 422', async () => {
      const send = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect((await fetch(`${origin}/worlds/routines?id=harbor`)).status).toBe(200)
      expect((await send('/worlds/routines/item?id=harbor&key=clara', { windows: [{ from: '07:00', to: '08:00', activity: 'x' }] })).status).toBe(200)
      expect((await send('/worlds/routines/item?id=harbor&key=nobody', { windows: [] })).status).toBe(422)
      expect((await send('/worlds/routines/item?id=harbor&key=clara', { windows: 3 })).status).toBe(422)
      expect(await (await fetch(`${origin}/worlds/variables?id=harbor`)).json()).toEqual([])
      expect((await send('/worlds/variables?id=harbor', { variables: [{ key: 'k', name: 'K', kind: 'flag', subject: 'world', visibility: 'public' }] })).status).toBe(200)
      expect((await send('/worlds/variables?id=harbor', { variables: [{ key: 'k', name: 'K', kind: 'bad', subject: 'world', visibility: 'public' }] })).status).toBe(422)
    })

    it('lore entries of a world are added by title and removed by key; a blank title is refused', async () => {
      const post = (body: unknown) => fetch(`${origin}/worlds/state/lore?id=harbor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      edited.length = 0
      expect((await post({ title: 'The tide laws' })).status).toBe(200)
      expect((await post({ title: '  ' })).status).toBe(422)
      expect((await post({})).status).toBe(422)
      expect((await fetch(`${origin}/worlds/state/lore?id=harbor&key=tide-laws`, { method: 'DELETE' })).status).toBe(200)
      expect(edited).toEqual(['add lore The tide laws', 'remove lore tide-laws'])
    })

    it('in a world: is read and edited by the id of the world, 404 for a world there is not, 422 when the files would not be valid', async () => {
      expect(await (await fetch(`${origin}/worlds/state?id=harbor`)).json()).toEqual({ characters: [], places: [{ key: 'harbor', name: 'Bar', description: '', features: [] }], things: [], factions: [], relations: [], plots: [] })
      expect((await put('/worlds/state/character?id=harbor&key=clara', { summary: 'Innkeeper' })).status).toBe(200)
      expect(edited).toEqual(['harbor clara {"summary":"Innkeeper"}'])
      editorError = new InvalidEditProblems(['there is no place "moon"'])
      const refused = await put('/worlds/state/character?id=harbor&key=clara', { summary: 'x' })
      expect(refused.status).toBe(422)
      expect(((await refused.json()) as { problems: string[] }).problems).toEqual(['there is no place "moon"'])
      editorError = new WorldNotFoundError('no world')
      expect((await fetch(`${origin}/worlds/state?id=nowhere`)).status).toBe(404)
    })
  })

  describe('importing a card', () => {
    const post = (path: string, body: string | Uint8Array, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, { method: 'POST', headers, body })
    const put = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('takes the card as the body of an upload, with its file name, and answers what the card holds and what is chosen to begin with', async () => {
      const response = await post('/worlds/import/card', new Uint8Array([1, 2, 3]), { 'x-file-name': encodeURIComponent('我的 card.png'), 'content-type': 'image/png' })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 'i1', choices: { name: 'Card' } })
      expect(importCalls).toEqual(['upload 3 我的 card.png'])
    })

    it('takes a narration preset for a world, and refuses one that is not a preset with the reason', async () => {
      const sent = await post('/worlds/import/preset?id=w1&language=zh', new Uint8Array([1, 2]), { 'x-file-name': encodeURIComponent('narrator.json') })
      expect(await sent.json()).toEqual({ chatSessionId: 'world-author-w1', preset: 'P', started: true })
      expect(importCalls).toEqual(['preset w1 2 narrator.json zh'])
      importError = new ImportCardError('the file is not a preset')
      expect((await post('/worlds/import/preset?id=w1', new Uint8Array([1]))).status).toBe(422)
    })

    it('stages a preset or a lorebook for choosing, and applies a choice to a world, a library preset or a library lorebook', async () => {
      const staged = await post('/import/stage?kind=preset', new Uint8Array([1, 2, 3]), { 'x-file-name': encodeURIComponent('bank.json') })
      expect(await staged.json()).toMatchObject({ id: 'st1', kind: 'preset', name: 'N' })
      expect((await post('/import/stage?kind=card', new Uint8Array([1]))).status).toBe(400)
      importError = new ImportCardError('the file is not a preset')
      expect((await post('/import/stage?kind=lorebook', new Uint8Array([1]))).status).toBe(422)
      importError = undefined
      const json = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect((await json('/worlds/import/preset/staged', { worldId: 'w1', id: 'st1', enabled: ['a'], language: 'zh' })).status).toBe(200)
      expect((await json('/worlds/import/preset/staged', { id: 'st1', enabled: ['a'] })).status).toBe(400)
      expect((await json('/worlds/import/preset/staged', { worldId: 'w1', id: 'st1', enabled: 'a' })).status).toBe(400)
      expect(await (await json('/worlds/import/preset/verbatim', { worldId: 'w1', id: 'st1', enabled: ['a'] })).json()).toEqual({ preset: 'P', replaced: false })
      expect((await json('/worlds/import/preset/verbatim', { id: 'st1', enabled: ['a'] })).status).toBe(400)
      expect((await json('/presets/import/staged', { id: 'st1', enabled: ['a', 'b'], sampling: false, name: 'mine', language: 'en' })).status).toBe(200)
      expect((await json('/presets/import/staged', { id: 'st1', enabled: [], title: 7 })).status).toBe(400)
      expect(await (await json('/presets/import/verbatim', { id: 'st1', enabled: ['a'], name: 'raw' })).json()).toEqual({ name: 'raw' })
      expect((await json('/presets/import/verbatim', { id: 'st1', enabled: ['a'], name: 3 })).status).toBe(400)
      expect(presetCalls.at(-1)).toBe('verbatim {"id":"st1","enabled":["a"],"sampling":true,"name":"raw"}')
      expect((await json('/lorebooks/import/staged', { id: 'st2', enabled: ['0'], title: 'Harbor' })).status).toBe(200)
      const verbatim = await json('/lorebooks/import/verbatim', { id: 'st2', enabled: ['0', '1'], knownBy: 'master', name: 'raw' })
      expect(await verbatim.json()).toEqual({ name: 'raw', entries: 2 })
      expect((await json('/lorebooks/import/verbatim', { id: 'st2', enabled: ['0'], knownBy: 'nobody' })).status).toBe(400)
      expect((await json('/lorebooks/import/verbatim', { id: 'st2', enabled: ['0'], knownBy: 'everyone', name: 3 })).status).toBe(400)
      expect(importCalls).toEqual(['stage preset 3 bank.json', 'stage lorebook 1 lorebook', 'staged w1 {"id":"st1","enabled":["a"],"sampling":true} zh', 'verbatim w1 {"id":"st1","enabled":["a"],"sampling":true}'])
      expect(presetCalls.at(-2)).toBe('staged {"id":"st1","enabled":["a","b"],"sampling":false,"name":"mine","language":"en"}')
      expect(lorebookCalls.at(-1)).toBe('verbatim {"id":"st2","enabled":["0","1"],"sampling":true,"knownBy":"master","name":"raw"}')
      expect(lorebookCalls.at(-2)).toBe('staged {"id":"st2","enabled":["0"],"sampling":true,"title":"Harbor"}')
    })

    it('refuses an upload that is too large without reading it, an empty one, and a file that is not a card, with the reason', async () => {
      expect((await post('/worlds/import/card', new Uint8Array(2048))).status).toBe(413)
      expect((await post('/worlds/import/card', new Uint8Array(0))).status).toBe(400)
      importError = new ImportCardError('x.png is a PNG picture with no character card in it')
      const refused = await post('/worlds/import/card', new Uint8Array([1]))
      expect(refused.status).toBe(422)
      expect(await refused.json()).toEqual({ message: 'x.png is a PNG picture with no character card in it' })
    })

    it('starts the update of a named world instead of a new one', async () => {
      const choices = { name: 'New world', disabledEntries: [], opening: { kind: 'none' } }
      await post('/worlds/import/start?id=i2', JSON.stringify({ ...choices, update: 'w9' }), { 'content-type': 'application/json' })
      await post('/worlds/import/start?id=i3', JSON.stringify({ ...choices, update: '  ' }), { 'content-type': 'application/json' })
      expect(importCalls).toEqual(['start i2 New world update w9', 'start i3 New world'])
    })

    it('says whether a world can be updated from a card and undoes the last update, with 404 for a world that is gone and 422 when there is nothing to undo', async () => {
      expect(await (await fetch(`${origin}/worlds/import/update?id=w1`)).json()).toEqual({ fromCard: true, revertible: true, waiting: false })
      expect((await fetch(`${origin}/worlds/import/update?id=missing`)).status).toBe(404)
      const undone = await fetch(`${origin}/worlds/import/update?id=w1`, { method: 'DELETE' })
      expect(await undone.json()).toEqual({ keptIn: '.trash/update-1' })
      expect(importCalls).toEqual(['revert w1'])
      importError = new InvalidEditProblems(['there is no card update to undo in this world'])
      expect((await fetch(`${origin}/worlds/import/update?id=w1`, { method: 'DELETE' })).status).toBe(422)
    })

    it('reads, chooses, starts and discards an import by its id, and says 404 for one that is gone and 422 for choices that cannot be used', async () => {
      expect((await fetch(`${origin}/worlds/import?id=i1`)).status).toBe(200)
      const choices = { name: 'New world', disabledEntries: ['entry:1'], opening: { kind: 'alternate', index: 0 } }
      expect((await put('/worlds/import/choices?id=i1', choices)).status).toBe(200)
      const started = await post('/worlds/import/start?id=i1', JSON.stringify(choices), { 'content-type': 'application/json' })
      expect(await started.json()).toEqual({ worldId: 'w', chatSessionId: 'world-author-w', started: true })
      expect((await fetch(`${origin}/worlds/import?id=i1`, { method: 'DELETE' })).status).toBe(204)
      expect(importCalls).toEqual(['read i1', `choose i1 ${JSON.stringify(choices)}`, 'start i1 New world', 'discard i1'])
      expect((await put('/worlds/import/choices?id=i1', { name: 4 })).status).toBe(422)
      importError = new ImportNotFoundError('there is no import "i1"')
      expect((await fetch(`${origin}/worlds/import?id=i1`)).status).toBe(404)
      expect((await fetch(`${origin}/worlds/import/picture?id=i1`)).status).toBe(404)
    })
  })

  describe('asking the characters to reflect', () => {
    it('is a POST that is accepted and runs behind; an unknown session is 404, a refusal is 409', async () => {
      expect((await fetch(`${origin}/sessions/reflect?id=abc`, { method: 'POST' })).status).toBe(202)
      expect(archived).toEqual(['reflect abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/reflect?id=x`, { method: 'POST' })).status).toBe(404)
      archiveError = new ReflectionRefusedError('a turn is being played')
      const refused = await fetch(`${origin}/sessions/reflect?id=abc`, { method: 'POST' })
      expect(refused.status).toBe(409)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/reflect?id=abc`)).status).toBe(405)
    })
  })

  describe('opening the session doctor', () => {
    it('is a POST with a title that answers with the chat; an unknown session is 404, a missing title 400', async () => {
      const post = (id: string, body: unknown) => fetch(`${origin}/sessions/doctor?id=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const opened = await post('abc', { title: 'Doctor', language: 'zh' })
      expect(opened.status).toBe(200)
      expect(await opened.json()).toEqual({ chatSessionId: 'doctor-abc' })
      expect(archived).toEqual(['doctor abc Doctor zh'])
      expect((await post('abc', {})).status).toBe(400)
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await post('x', { title: 'Doctor' })).status).toBe(404)
      archiveError = undefined
    })
  })

  describe('forgetting the vectors of a session', () => {
    it('is a POST that answers with nothing; an unknown session is 404', async () => {
      expect((await fetch(`${origin}/sessions/vectors/reset?id=abc`, { method: 'POST' })).status).toBe(204)
      expect(archived).toEqual(['reset abc'])
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await fetch(`${origin}/sessions/vectors/reset?id=x`, { method: 'POST' })).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/vectors/reset?id=abc`)).status).toBe(405)
    })
  })

  describe('naming a session', () => {
    const rename = (body: unknown, id = 'abc') => fetch(`${origin}/sessions/rename?id=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    it('is a POST with the name; a missing name is 400, a name that is not acceptable 422, an unknown session 404', async () => {
      expect((await rename({ name: 'Night 2' })).status).toBe(204)
      expect(archived).toEqual(['rename abc Night 2'])
      expect((await rename({})).status).toBe(400)
      archiveError = new InvalidStartError('the session needs a name')
      expect((await rename({ name: ' ' })).status).toBe(422)
      archiveError = new SessionNotFoundError('no session "x"')
      expect((await rename({ name: 'x' }, 'x')).status).toBe(404)
      archiveError = undefined
      expect((await fetch(`${origin}/sessions/rename?id=abc`)).status).toBe(405)
    })
  })

  describe('the turns of a session', () => {
    const url = (path = '') => `${origin}/sessions/timeline${path}?id=abc`

    it('are told as they stand, and the story is taken to one of them or to the start, with what the player said offered back', async () => {
      const view = await fetch(url())
      expect(view.status).toBe(200)
      expect(await view.json()).toMatchObject({ head: 'n2', path: [{ id: 'n1', player: 'from abc' }] })
      const forward = await fetch(`${url('/move')}&to=n1`, { method: 'POST' })
      expect(forward.status).toBe(200)
      expect(await forward.json()).toEqual({})
      expect(moved).toEqual(['abc', 'n1'])
      expect(await (await fetch(`${url('/move')}&to=start`, { method: 'POST' })).json()).toEqual({ draft: 'the first message' })
    })

    it('answer 404 for an unknown session, 503 without the orchestration and 409 when the story cannot be taken there; need authentication and the right method', async () => {
      timelineError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      expect((await fetch(`${url('/move')}&to=n1`, { method: 'POST' })).status).toBe(404)
      timelineError = new AgentUnavailableError('no orchestration')
      expect((await fetch(url())).status).toBe(503)
      timelineError = new TimelineError('the state of the story at that turn was not kept')
      const refused = await fetch(`${url('/move')}&to=n1`, { method: 'POST' })
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ message: 'the state of the story at that turn was not kept' })
      timelineError = undefined
      expect((await fetch(`${url('/move')}&to=n1`)).status).toBe(405)
      allowed = false
      expect((await fetch(url())).status).toBe(401)
    })
  })

  describe('the decisions of a session', () => {
    const url = () => `${origin}/sessions/decisions?id=abc`

    it('say whether a decision service is there and how the decision model has done in the story', async () => {
      const response = await fetch(url())
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ available: true, provider: 'typesafe', model: 'abc', stats: { sites: { triggers: { runs: 1, agreed: 2 } } } })
    })

    it('answer 404 for an unknown session, 401 without authentication and allow only GET', async () => {
      decisionsError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      decisionsError = undefined
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      expect((await fetch(url(), { method: 'POST' })).status).toBe(405)
    })
  })

  describe('the notes of a session', () => {
    const url = () => `${origin}/sessions/notes?id=abc`

    it('are the lines the host made for the player after the last turn', async () => {
      const response = await fetch(url())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([{ kind: 'suggestions', turn: 2, lines: ['from abc'] }])
    })

    it('answer 404 for an unknown session, 401 without authentication and allow only GET', async () => {
      notesError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      notesError = undefined
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      expect((await fetch(url(), { method: 'POST' })).status).toBe(405)
    })
  })

  describe('what a helper run was told and did', () => {
    const url = (run: string, id = 'abc') => `${origin}/sessions/activity/run?id=${id}&run=${run}`

    it('is served when kept, and answers 404 when it was not or the session is unknown, and 400 for a bad run id', async () => {
      const kept = await fetch(url('kept'))
      expect(kept.status).toBe(200)
      expect(await kept.json()).toEqual({ persona: 'p', prompt: 'q', calls: [], result: '{}' })
      expect((await fetch(url('gone'))).status).toBe(404)
      expect((await fetch(url('kept', 'x'))).status).toBe(404)
      expect((await fetch(url('bad'))).status).toBe(400)
    })

    it('needs authentication and allows only GET', async () => {
      expect((await fetch(url('kept'), { method: 'POST' })).status).toBe(405)
      allowed = false
      expect((await fetch(url('kept'))).status).toBe(401)
      allowed = true
    })
  })

  describe('scene images', () => {
    const url = () => `${origin}/sessions/images?id=abc&node=n2`

    it('reports status, starts generation and serves the immutable PNG', async () => {
      const status = await fetch(url())
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ node: 'n2', mode: 'manual', state: 'absent', images: [], message: 'abc' })
      const started = await fetch(url(), { method: 'POST' })
      expect(started.status).toBe(202)
      expect(await started.json()).toMatchObject({ node: 'n2', state: 'generating' })
      const image = await fetch(`${origin}/sessions/images/file?id=abc&node=n2&serial=1`)
      expect(image.status).toBe(200)
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(image.headers.get('cache-control')).toContain('immutable')
      expect(await image.text()).toBe('png-bytes')
    })

    it('requires authentication and the declared methods', async () => {
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      expect((await fetch(url(), { method: 'DELETE' })).status).toBe(405)
    })
  })

  describe('the settings of a session', () => {
    const url = (id = 'session-id') => `${origin}/sessions/settings?id=${encodeURIComponent(id)}`
    const put = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => fetch(url(), { method: 'PUT', headers, body })

    it('are read, with the bounds', async () => {
      const response = await fetch(url())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ settings: DEFAULT_SETTINGS, bounds: SETTINGS_SPEC, pendingRecords: 0, pendingConsolidation: 0, activity: [], usage: [], interventions: [], vectors: { available: true, embedded: 0, pending: 0 }, reflection: { running: false } })
    })

    it('are replaced by the body', async () => {
      const response = await put('{"maxRounds":6}')
      expect(response.status).toBe(200)
      expect(((await response.json()) as { settings: { maxRounds: number } }).settings.maxRounds).toBe(6)
      expect(writtenSettings).toEqual({ maxRounds: 6 })
    })

    it('answer 404 for an unknown session and 422, with the problems, for settings that are not acceptable', async () => {
      settingsError = new SessionNotFoundError('no session "x"')
      expect((await fetch(url())).status).toBe(404)
      expect((await put('{"maxRounds":1}')).status).toBe(404)
      settingsError = new InvalidSettingsError(['"maxRounds" must be a whole number from 1 to 10'])
      const response = await put('{"maxRounds":99}')
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ message: expect.stringContaining('not acceptable'), problems: ['"maxRounds" must be a whole number from 1 to 10'] })
      expect((await fetch(url())).status).toBe(422)
    })

    it('reject a body that is not declared as JSON, are refused without authentication and allow no other method', async () => {
      expect((await put('{"maxRounds":2}', { 'content-type': 'text/plain' })).status).toBe(415)
      allowed = false
      expect((await fetch(url())).status).toBe(401)
      allowed = true
      const wrong = await fetch(url(), { method: 'POST' })
      expect(wrong.status).toBe(405)
      expect(wrong.headers.get('allow')).toBe('GET, PUT')
    })
  })
})

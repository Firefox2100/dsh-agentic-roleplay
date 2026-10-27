import type { ExternalTool } from '../../shared/tools.ts'
import { parseDiceEdit, type DiceDocument } from '../../shared/world-dice.ts'
import { parseCalendarEdit, parseRoutineEdit, parseVariablesEdit, type CalendarDocument, type VariableDeclaration, type WorldRoutines } from '../../shared/world-daily.ts'
import type { RoutineDefinition } from 'dsh-roleplay-model'
import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { RunDetail } from '../../shared/activity.ts'
import type { PackProblem } from '../../shared/interface-pack.ts'
import type { Note } from '../../shared/notes.ts'
import type { DecisionsPayload } from '../../shared/decisions.ts'
import type { SceneImageStatus } from '../../shared/images.ts'
import { languageOf } from '../prompts/library.ts'
import { InvalidEditProblems, parseCharacterEdit, parseFactionEdit, parseLoreEdit, parsePlaceEdit, parseRelationEdit, parseThingEdit, type CharacterEdit, type FactionEdit, type LoreEdit, type PlaceEdit, type PlotsEdit, type RelationChange, type ThingEdit, type WorldState } from '../../shared/world-state.ts'
import type { TimelineView } from '../../shared/timeline.ts'
import type { SpeechAudio, SpeechPart } from '../speech/service.ts'
import type { TtsVoice } from '@dsh-ai-providers/core'
import { TimelineError } from '../timeline/service.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import type { OpenedSession, SessionsPayload, StartedSession, StartSessionRequest, WorldCharactersPayload } from '../../shared/sessions.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { parseWorldInfoEdit, type WorldInfo, type WorldInfoEdit } from '../../shared/world-info.ts'
import type { WorldPromptEntry } from '../prompts/world-prompts.ts'
import { InvalidSettingsError } from '../sessions/settings.ts'
import { AgentUnavailableError, ReflectionRefusedError, SessionArchivedError, InvalidStartError, InvalidWorldError, SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
import type { GalleryImage } from '../../shared/gallery.ts'
import type { ImageUpdate } from '../images/gallery.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { WorldFolderExistsError } from '../worlds/create-world.ts'
import { UnknownStarterError } from '../worlds/starter.ts'
import type { Catalogue } from '../catalogue/service.ts'
import { CatalogueError, type CatalogueFailure } from '../catalogue/errors.ts'
import { readBinaryBody, readJsonBody } from './body.ts'
import { ImportCardError } from '../import/card.ts'
import { ImportNotFoundError, parseChoices } from '../import/store.ts'
import type { ImportChoices, ImportPreview } from '../../shared/import-card.ts'
import type { SelectionChoice, SelectionKind, SelectionPreview } from '../../shared/import-selection.ts'
import { parseSelectionChoice } from '../import/staging.ts'
import { HttpError, sendError, sendJson } from './respond.ts'
import { presetRoutes } from '../presets/routes.ts'
import type { PresetApi } from '../presets/routes.ts'
import { lorebookRoutes } from '../lorebooks/routes.ts'
import { RcloneError, SyncRefusedError } from '../sync/errors.ts'
import { failure as syncFailure, syncRoutes, type SyncApi } from '../sync/routes.ts'
import type { LorebookApi } from '../lorebooks/routes.ts'
import { FRAME_FILES, PACK_FILES, interfaceRoutes, sendPackFile, type InterfaceApi } from '../interface/routes.ts'

/** The slice of DSH's connection service this API relies on for browser authentication. */
export interface ApiConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

export interface ApiDeps {
  /** Worlds held by the catalogues the person configured. */
  catalogue: Catalogue
  /** The tools other plugins registered for everyone, which a story can give to an agent. */
  externalTools?(): ExternalTool[]
  /** The bundle layers of single packages selected beside the `all` layer. */
  redundantLayers?(): string[]
  worlds: WorldCatalog
  createWorld(input: { folder: string; name: string; preset?: string }): Promise<import('../../shared/worlds.ts').WorldSummary>
  /** The worlds the package ships, and adding one to the person's worlds. */
  starter: { list(): Promise<import('../../shared/starter.ts').StarterWorld[]>; add(folder: string): Promise<import('../../shared/worlds.ts').WorldSummary> }
  authorWorld(worldId: string, title: string, language?: string): Promise<{ chatSessionId: string }>
  translation: {
    language(worldId: string): Promise<'en' | 'zh' | undefined>
    start(worldId: string, to: 'en' | 'zh', title: string, language: string): Promise<{ chatSessionId: string; started: boolean; failure?: string }>
  }
  worldCharacters(worldId: string): Promise<WorldCharactersPayload>
  /** The characters and places of a world's files, as the editor shows them. */
  /** Character cards uploaded to become worlds. */
  importer: {
    maxUploadBytes: number
    upload(file: Buffer, name: string): Promise<ImportPreview>
    read(id: string): Promise<ImportPreview>
    choose(id: string, choices: ImportChoices): Promise<ImportPreview>
    discard(id: string): Promise<void>
    start(id: string, choices: ImportChoices, language?: string): Promise<{ worldId: string; chatSessionId: string; started: boolean; failure?: string }>
    picture(id: string): Promise<{ file: string; size: number }>
    uploadPreset(worldId: string, file: Buffer, name: string, language?: string): Promise<{ chatSessionId: string; preset: string; started: boolean; failure?: string }>
    /** Keeps a preset or a lorebook while the person chooses what of it is imported. */
    stage(kind: SelectionKind, file: Buffer, name: string): SelectionPreview
    discardStaged(id: string): void
    applyStagedVerbatim(worldId: string, choice: SelectionChoice): Promise<{ preset: string; replaced: boolean }>
    uploadStaged(worldId: string, choice: SelectionChoice, language?: string): Promise<{ chatSessionId: string; preset: string; started: boolean; failure?: string }>
  }
  avatars: {
    create(name: string): Promise<string>
    remove(key: string): Promise<void>
    addToWorld(worldId: string, keys: string[]): Promise<string[]>
  }
  /** What a world carries beside its cast: its own fields, its prompts and its pictures. */
  worldFiles: {
    info(worldId: string): Promise<WorldInfo>
    editInfo(worldId: string, edit: WorldInfoEdit): Promise<WorldInfo>
    routines(worldId: string): Promise<WorldRoutines>
    editRoutine(worldId: string, key: string, windows: RoutineDefinition[]): Promise<WorldRoutines>
    variables(worldId: string): Promise<VariableDeclaration[]>
    dice(worldId: string): Promise<DiceDocument>
    editDice(worldId: string, dice: DiceDocument): Promise<DiceDocument>
    calendar(worldId: string): Promise<CalendarDocument>
    editCalendar(worldId: string, calendar: CalendarDocument): Promise<CalendarDocument>
    editVariables(worldId: string, declarations: VariableDeclaration[]): Promise<VariableDeclaration[]>
    prompts(worldId: string, language: string): Promise<WorldPromptEntry[]>
    readPrompt(worldId: string, language: string, prompt: string): Promise<{ id: string; language: string; carried: boolean; text: string }>
    writePrompt(worldId: string, language: string, prompt: string, text: string): Promise<void>
    deletePrompt(worldId: string, language: string, prompt: string): Promise<void>
    gallery(worldId: string): Promise<{ images: GalleryImage[]; failures: Record<string, string> }>
    galleryFile(worldId: string, path: string): Promise<{ file: string; size: number; mediaType: string }>
    uploadImage(worldId: string, name: string, bytes: Uint8Array): Promise<string>
    updateImage(worldId: string, path: string, update: ImageUpdate): Promise<GalleryImage>
  }
  worldEditor: {
    read(worldId: string): Promise<WorldState>
    editCharacter(worldId: string, key: string, edit: CharacterEdit): Promise<WorldState>
    editPlace(worldId: string, key: string, edit: PlaceEdit): Promise<WorldState>
    editThing(worldId: string, key: string, edit: ThingEdit): Promise<WorldState>
    editFaction(worldId: string, key: string, edit: FactionEdit): Promise<WorldState>
    editLore(worldId: string, key: string, edit: LoreEdit): Promise<WorldState>
    addLore(worldId: string, title: string): Promise<WorldState>
    removeLore(worldId: string, key: string): Promise<WorldState>
    readPackFile(worldId: string, pack: string, path: string): Promise<string>
    writePackFile(worldId: string, pack: string, path: string, text: string): Promise<PackProblem[]>
    deletePackFile(worldId: string, pack: string, path: string): Promise<PackProblem[]>
    createPack(worldId: string, pack: string, name: string): Promise<PackProblem[]>
    readTrigger(worldId: string, key: string): Promise<Record<string, unknown>>
    writeTrigger(worldId: string, key: string, document: unknown): Promise<WorldState>
    removeTrigger(worldId: string, key: string): Promise<WorldState>
    editPlots(worldId: string, edit: PlotsEdit): Promise<WorldState>
    editRelation(worldId: string, edit: RelationChange): Promise<WorldState>
    editNarrationVoice(worldId: string, voice: string): Promise<WorldState>
    generatePortrait(worldId: string, key: string): Promise<WorldState>
    portraitFile(worldId: string, key: string): Promise<{ file: string; size: number }>
    uploadPortrait(worldId: string, key: string, png: Uint8Array, originalName?: string): Promise<WorldState>
    generateEntityImage(worldId: string, kind: 'place' | 'thing', key: string): Promise<WorldState>
    entityImageFile(worldId: string, kind: 'place' | 'thing', key: string): Promise<{ file: string; size: number }>
    uploadEntityImage(worldId: string, kind: 'place' | 'thing', key: string, png: Uint8Array, originalName?: string): Promise<WorldState>
  }
  sessions: {
    list(): SessionsPayload
    start(request: StartSessionRequest): Promise<StartedSession>
    open(id: string, rebuild?: boolean): Promise<OpenedSession>
    /** Says something in a session's chat as the player would; scripts use it to play. */
    send(id: string, text: string): Promise<void>
    /** The images of a session with what their files say. */
    gallery(id: string): Promise<{ images: GalleryImage[]; failures: Record<string, string> }>
    galleryFile(id: string, path: string): Promise<{ file: string; size: number; mediaType: string }>
    /** Adds a picture the person brought to the session's library; it is described in the background. @returns its path. */
    uploadImage(id: string, name: string, bytes: Uint8Array): Promise<string>
    updateImage(id: string, path: string, update: ImageUpdate): Promise<GalleryImage>
    /** `everywhere` also deletes the session from the sync remote, for every device. */
    delete(id: string, everywhere?: boolean): Promise<void>
    archive(id: string): Promise<void>
    restore(id: string): Promise<void>
    rename(id: string, name: string): Promise<void>
    /** What a helper run was told and did, when the session kept it. @throws {SessionNotFoundError} */
    activityRun(id: string, run: string): RunDetail | undefined
    /** Starts the characters sorting what they took in into what they believe; it runs in the background. @throws {SessionNotFoundError} @throws {ReflectionRefusedError} */
    reflect(id: string): Promise<void>
    doctor(id: string, title: string, language: string): Promise<{ chatSessionId: string }>
    /** Forgets the session's stored search vectors. */
    resetVectors(id: string): void
    world(id: string): WorldState
    editCharacter(id: string, key: string, edit: CharacterEdit): WorldState
    editPlace(id: string, key: string, edit: PlaceEdit): WorldState
    editThing(id: string, key: string, edit: ThingEdit): WorldState
    editFaction(id: string, key: string, edit: FactionEdit): WorldState
    editLore(id: string, key: string, edit: LoreEdit): WorldState
    editPlots(id: string, edit: PlotsEdit): WorldState
    editRelation(id: string, edit: RelationChange): WorldState
    editNarrationVoice(id: string, voice: string): WorldState
    generatePortrait(id: string, key: string): Promise<WorldState>
    portraitFile(id: string, key: string): Promise<{ file: string; size: number }>
    uploadPortrait(id: string, key: string, png: Uint8Array, originalName?: string): Promise<WorldState>
    generateEntityImage(id: string, kind: 'place' | 'thing', key: string): Promise<WorldState>
    entityImageFile(id: string, kind: 'place' | 'thing', key: string): Promise<{ file: string; size: number }>
    uploadEntityImage(id: string, kind: 'place' | 'thing', key: string, png: Uint8Array, originalName?: string): Promise<WorldState>
    readSettings(id: string): SettingsPayload
    writeSettings(id: string, value: unknown): SettingsPayload
    notes(id: string): Note[]
    decisions(id: string): DecisionsPayload
    timeline(id: string): TimelineView
    moveTimeline(id: string, to: string): Promise<{ draft?: string }>
    imageStatus(id: string, node: string): Promise<SceneImageStatus>
    generateImage(id: string, node: string): Promise<SceneImageStatus>
    imageFile(id: string, node: string, serial: number): Promise<{ file: string; size: number }>
  }
  /** Interface packs: the pack a story uses, what it may be shown, and its files. */
  packs: InterfaceApi
  /** The preset library and the presets of stories. */
  presets: PresetApi
  /** The lorebook library. */
  lorebooks: LorebookApi
  /** Syncing with other devices. */
  sync: SyncApi
  /** The unit a request touches while it is being synced, or nothing; only asked while some unit is locked. */
  locked?(url: URL): Promise<string | undefined>
  /** Whether any unit is locked. */
  anyLocked?(): boolean
  connection: ApiConnection
  speech: { voices(): Promise<TtsVoice[]>; speak(parts: SpeechPart[]): Promise<SpeechAudio>; streaming(): boolean }
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** The largest picture that can be added to a gallery. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** The changes to a picture's metadata a body asks for, or what is wrong with it. */
function imageUpdateOf(body: Record<string, unknown>): ImageUpdate | string {
  const update: ImageUpdate = {}
  if (body['reusable'] !== undefined) { if (typeof body['reusable'] !== 'boolean') return 'reusable must be true or false'; update.reusable = body['reusable'] }
  if (body['description'] !== undefined) { if (typeof body['description'] !== 'string') return 'description must be text'; update.description = body['description'].trim() }
  if (body['tags'] !== undefined) { if (!Array.isArray(body['tags']) || !body['tags'].every(tag => typeof tag === 'string')) return 'tags must be a list of text'; update.tags = (body['tags'] as string[]).map(tag => tag.trim()).filter(tag => tag !== '') }
  return update
}

async function sendImage(res: ServerResponse, image: { file: string; size: number; mediaType?: string }): Promise<void> {
  res.statusCode = 200
  res.setHeader('content-type', image.mediaType ?? 'image/png')
  res.setHeader('content-length', image.size)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  await pipeline(createReadStream(image.file), res)
}

const CATALOGUE_STATUS: Record<CatalogueFailure, number> = { input: 400, unknown: 404, upstream: 502, invalid: 422, conflict: 409, unavailable: 503 }

/** A catalogue failure with the status that says whose fault it is; anything else is not ours to describe. */
function catalogueFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof CatalogueError) return error.detail === undefined ? sendError(res, CATALOGUE_STATUS[error.failure], error.message) : sendJson(res, CATALOGUE_STATUS[error.failure], { message: error.message, ...error.detail })
  throw error
}

/** The status an import failure is shown with: what is wrong with the card or the choices is the person's to fix. */
function importFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof ImportCardError) return sendError(res, 422, error.message)
  if (error instanceof ImportNotFoundError) return sendError(res, 404, error.message)
  if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
  if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
  throw error
}

/** Build the request handler mounted at `/${API_PREFIX}`. */
/** The language a client says it is using, or nothing when it says none. */
function languageField(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InvalidEditProblems(['language must be text'])
  try { return languageOf(value) } catch (error) { throw new InvalidEditProblems([error instanceof Error ? error.message : String(error)]) }
}

export function createApiHandler({ catalogue, worlds, createWorld, starter, authorWorld, translation, worldCharacters, importer, avatars, worldFiles, worldEditor, sessions, packs, presets, lorebooks, sync, locked, anyLocked, connection, speech, externalTools, redundantLayers }: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const routes: Record<string, Partial<Record<string, Route>>> = {
    '/speech/capabilities': { GET: async (_req, res) => { sendJson(res, 200, { streaming: speech.streaming() }) } },
    '/speech/voices': { GET: async (_req, res) => { sendJson(res, 200, await speech.voices()) } },
    '/speech/synthesize': { POST: async (req, res) => { const body = await readJsonBody(req) as { parts?: unknown }; if (!Array.isArray(body.parts)) return sendError(res, 400, 'parts must be a list'); const parts = body.parts.filter((part): part is SpeechPart => typeof part === 'object' && part !== null && typeof (part as SpeechPart).text === 'string'); if (parts.length !== body.parts.length) return sendError(res, 400, 'each speech part needs text'); const audio = await speech.speak(parts); res.statusCode = 200; res.setHeader('content-type', audio.mediaType); res.setHeader('content-length', audio.bytes.length); res.end(audio.bytes) } },
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
      POST: async (req, res) => { try { const body = await readJsonBody(req) as { folder?: unknown; name?: unknown; preset?: unknown }; if (typeof body.folder !== 'string' || typeof body.name !== 'string') return sendError(res, 400, 'folder and name must be text'); if (body.preset !== undefined && typeof body.preset !== 'string') return sendError(res, 400, 'preset must be text'); sendJson(res, 201, await createWorld({ folder: body.folder, name: body.name, ...(body.preset === undefined ? {} : { preset: body.preset }) })) } catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); if (error instanceof WorldFolderExistsError) return sendError(res, 409, error.message); throw error } },
    },
    '/catalogue/sources': { GET: async (_req, res) => { try { sendJson(res, 200, await catalogue.sources()) } catch (error) { return catalogueFailure(res, error) } } },
    '/catalogue/key': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.describeKey(url.searchParams.get('ref') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
      PUT: async (req, res) => {
        const { ref, value } = await readJsonBody(req)
        if (typeof ref !== 'string' || typeof value !== 'string') return sendError(res, 400, '"ref" and "value" must be text')
        try { sendJson(res, 200, await catalogue.keepKey(ref, value)) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/worlds': {
      GET: async (_req, res, url) => {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'recent'
        try { sendJson(res, 200, await catalogue.worlds(url.searchParams.get('source') ?? '', { kind: (['card', 'preset', 'lorebook'] as const).find(entry => entry === url.searchParams.get('kind')) ?? 'world', search: url.searchParams.get('search') ?? '', offset: Number.isFinite(offset) ? offset : 0, sort })) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/world': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.world(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
    },
    '/catalogue/cover': {
      GET: async (_req, res, url) => {
        try {
          const cover = await catalogue.cover(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '')
          res.statusCode = 200
          res.setHeader('content-type', cover.type)
          res.setHeader('content-length', cover.body.length)
          res.setHeader('x-content-type-options', 'nosniff')
          res.setHeader('cache-control', 'private, no-cache')
          res.end(cover.body)
        } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/updates': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await catalogue.updates(url.searchParams.get('source') ?? '')) } catch (error) { return catalogueFailure(res, error) } },
    },
    '/catalogue/install': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { url?: unknown; sha256?: unknown; mode?: unknown; overwriteChanges?: unknown }
        if (typeof body.url !== 'string') return sendError(res, 400, 'url must be text')
        if (body.sha256 !== undefined && typeof body.sha256 !== 'string') return sendError(res, 400, 'sha256 must be text')
        if (body.mode !== undefined && body.mode !== 'new' && body.mode !== 'update' && body.mode !== 'copy') return sendError(res, 400, 'mode must be new, update or copy')
        if (body.overwriteChanges !== undefined && typeof body.overwriteChanges !== 'boolean') return sendError(res, 400, 'overwriteChanges must be true or false')
        try { sendJson(res, 201, await catalogue.install({ url: body.url, ...(body.sha256 === undefined ? {} : { sha256: body.sha256 }), ...(body.mode === undefined ? {} : { mode: body.mode }), ...(body.overwriteChanges === undefined ? {} : { overwriteChanges: body.overwriteChanges }) })) } catch (error) { return catalogueFailure(res, error) }
      },
    },
    '/catalogue/convert': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convert({ source: body.source, versionId: body.versionId, ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/stage/card': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        try { sendJson(res, 200, await catalogue.stageCard({ source: body.source, versionId: body.versionId })) }
        catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/staged': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; id?: unknown; choices?: unknown; language?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string' || typeof body.id !== 'string') return sendError(res, 400, 'source, versionId and id must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convertStaged({ source: body.source, versionId: body.versionId, id: body.id, choices: parseChoices(body.choices), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/preset': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown; title?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.title !== undefined && typeof body.title !== 'string') return sendError(res, 400, 'title must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convertPreset({ source: body.source, versionId: body.versionId, ...(body.title === undefined ? {} : { title: body.title }), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/stage': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; kind?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.kind !== 'preset' && body.kind !== 'lorebook') return sendError(res, 400, 'kind must be preset or lorebook')
        try { sendJson(res, 200, await catalogue.stage({ source: body.source, versionId: body.versionId, kind: body.kind })) }
        catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/catalogue/convert/lorebook': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { source?: unknown; versionId?: unknown; language?: unknown; title?: unknown }
        if (typeof body.source !== 'string' || typeof body.versionId !== 'string') return sendError(res, 400, 'source and versionId must be text')
        if (body.title !== undefined && typeof body.title !== 'string') return sendError(res, 400, 'title must be text')
        try {
          const language = languageField(body.language)
          sendJson(res, 201, await catalogue.convertLorebook({ source: body.source, versionId: body.versionId, ...(body.title === undefined ? {} : { title: body.title }), ...(language === undefined ? {} : { language }) }))
        } catch (error) { return error instanceof CatalogueError ? catalogueFailure(res, error) : importFailure(res, error) }
      },
    },
    '/worlds/starter': {
      GET: async (_req, res) => { sendJson(res, 200, await starter.list()) },
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { folder?: unknown }
        if (typeof body.folder !== 'string') return sendError(res, 400, 'folder must be text')
        try { sendJson(res, 201, await starter.add(body.folder)) } catch (error) {
          if (error instanceof UnknownStarterError) return sendError(res, 404, error.message)
          if (error instanceof WorldFolderExistsError) return sendError(res, 409, error.message)
          throw error
        }
      },
    },
    '/worlds/import/card': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'card'))
        try { sendJson(res, 200, await importer.upload(await readBinaryBody(req, importer.maxUploadBytes), name)) }
        catch (error) { return importFailure(res, error) }
      },
    },
    '/worlds/import/preset': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'preset'))
        try { sendJson(res, 200, await importer.uploadPreset(url.searchParams.get('id') ?? '', await readBinaryBody(req, importer.maxUploadBytes), name, languageField(url.searchParams.get('language') ?? undefined))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/import/stage': {
      POST: async (req, res, url) => {
        const kind = url.searchParams.get('kind')
        if (kind !== 'preset' && kind !== 'lorebook') return sendError(res, 400, '"kind" must be preset or lorebook')
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? kind))
        try { sendJson(res, 200, importer.stage(kind, await readBinaryBody(req, importer.maxUploadBytes), name)) }
        catch (error) { return importFailure(res, error) }
      },
      DELETE: async (_req, res, url) => { importer.discardStaged(url.searchParams.get('id') ?? ''); res.statusCode = 204; res.end() },
    },
    '/worlds/import/preset/verbatim': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { worldId } = body as Record<string, unknown>
        if (typeof worldId !== 'string') return sendError(res, 400, '"worldId" must be text')
        try { sendJson(res, 200, await importer.applyStagedVerbatim(worldId, choice)) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/worlds/import/preset/staged': {
      POST: async (req, res) => {
        const body = await readJsonBody(req)
        const choice = parseSelectionChoice(body)
        if (typeof choice === 'string') return sendError(res, 400, choice)
        const { worldId, language } = body as Record<string, unknown>
        if (typeof worldId !== 'string') return sendError(res, 400, '"worldId" must be text')
        try { sendJson(res, 200, await importer.uploadStaged(worldId, choice, languageField(language))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          return importFailure(res, error)
        }
      },
    },
    '/worlds/import': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await importer.read(url.searchParams.get('id') ?? '')) } catch (error) { return importFailure(res, error) } },
      DELETE: async (_req, res, url) => { try { await importer.discard(url.searchParams.get('id') ?? ''); res.statusCode = 204; res.end() } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/choices': {
      PUT: async (req, res, url) => { try { sendJson(res, 200, await importer.choose(url.searchParams.get('id') ?? '', parseChoices(await readJsonBody(req)))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/start': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req); sendJson(res, 200, await importer.start(url.searchParams.get('id') ?? '', parseChoices(body), languageField((body as { language?: unknown }).language))) } catch (error) { return importFailure(res, error) } },
    },
    '/worlds/import/picture': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await importer.picture(url.searchParams.get('id') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/refresh': {
      POST: async (_req, res) => { sendJson(res, 200, await worlds.list({ refresh: true })) },
    },
    '/worlds/authoring': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { title?: unknown; language?: unknown }
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await authorWorld(url.searchParams.get('id') ?? '', body.title.trim(), languageField(body.language))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/worlds/language': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, { language: await translation.language(url.searchParams.get('id') ?? '') ?? null }) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/translate': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { to?: unknown; title?: unknown; language?: unknown }
        if (body.to !== 'en' && body.to !== 'zh') return sendError(res, 400, 'to must be "en" or "zh"')
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await translation.start(url.searchParams.get('id') ?? '', body.to, body.title.trim(), languageField(body.language) ?? 'en')) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/avatars': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { name?: unknown }
        if (typeof body.name !== 'string' || body.name.trim() === '') return sendError(res, 400, 'name must be text')
        try { sendJson(res, 201, { key: await avatars.create(body.name) }) }
        catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
      DELETE: async (_req, res, url) => {
        try { await avatars.remove(url.searchParams.get('key') ?? ''); sendJson(res, 200, { deleted: true }) }
        catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/avatars': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { avatars?: unknown }
        if (!Array.isArray(body.avatars) || body.avatars.length === 0 || !body.avatars.every(key => typeof key === 'string')) return sendError(res, 400, 'avatars must be a list of keys')
        try { sendJson(res, 200, { added: await avatars.addToWorld(url.searchParams.get('id') ?? '', body.avatars as string[]) }) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/state': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.read(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/state/character': {
      PUT: async (req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.editCharacter(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseCharacterEdit(await readJsonBody(req))))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/state/place': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldEditor.editPlace(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parsePlaceEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/state/thing': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldEditor.editThing(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseThingEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/worlds/state/faction': { PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editFaction(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseFactionEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/state/lore': {
      POST: async (req, res, url) => {
        try {
          const body = await readJsonBody(req) as { title?: unknown } | null
          if (typeof body?.title !== 'string') throw new InvalidEditProblems(['the entry needs a title'])
          sendJson(res, 200, await worldEditor.addLore(url.searchParams.get('id') ?? '', body.title))
        } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.removeLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseLoreEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/interface/file': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, { text: await worldEditor.readPackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { text?: unknown } | null; if (typeof body?.text !== 'string') throw new InvalidEditProblems(['text must be text']); sendJson(res, 200, { problems: await worldEditor.writePackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '', body.text) }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, { problems: await worldEditor.deletePackFile(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', url.searchParams.get('path') ?? '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); return sendError(res, 422, error instanceof Error ? error.message : String(error)) } },
    },
    '/worlds/interface/pack': {
      POST: async (req, res, url) => { try { const body = await readJsonBody(req) as { name?: unknown } | null; sendJson(res, 201, { problems: await worldEditor.createPack(url.searchParams.get('id') ?? '', url.searchParams.get('pack') ?? '', typeof body?.name === 'string' ? body.name : '') }) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
    },
    '/worlds/state/trigger': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.readTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.writeTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readJsonBody(req))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
      DELETE: async (_req, res, url) => { try { sendJson(res, 200, await worldEditor.removeTrigger(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } },
    },
    '/worlds/state/plots': { PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { plots?: unknown }; if (!Array.isArray(body.plots)) return sendError(res, 400, 'plots must be a list'); sendJson(res, 200, await worldEditor.editPlots(url.searchParams.get('id') ?? '', { plots: body.plots as PlotsEdit['plots'] })) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/state/relation': { PUT: async (req, res, url) => { try { sendJson(res, 200, await worldEditor.editRelation(url.searchParams.get('id') ?? '', parseRelationEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/worlds/routines': { GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.routines(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } } },
    '/worlds/routines/item': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editRoutine(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseRoutineEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/dice': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.dice(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editDice(url.searchParams.get('id') ?? '', parseDiceEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/calendar': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.calendar(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editCalendar(url.searchParams.get('id') ?? '', parseCalendarEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/variables': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.variables(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editVariables(url.searchParams.get('id') ?? '', parseVariablesEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/info': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.info(url.searchParams.get('id') ?? '')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, await worldFiles.editInfo(url.searchParams.get('id') ?? '', parseWorldInfoEdit(await readJsonBody(req)))) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/prompts': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.prompts(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en')) } catch (error) { if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message); throw error } },
    },
    '/worlds/prompts/item': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.readPrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? '')) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) } },
      PUT: async (req, res, url) => {
        const body = await readJsonBody(req)
        if (typeof body['text'] !== 'string') return sendError(res, 400, 'text must be text')
        try { await worldFiles.writePrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? '', body['text']); sendJson(res, 200, {}) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) }
      },
      DELETE: async (_req, res, url) => { try { await worldFiles.deletePrompt(url.searchParams.get('id') ?? '', url.searchParams.get('language') ?? 'en', url.searchParams.get('prompt') ?? ''); sendJson(res, 200, {}) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 422, error instanceof Error ? error.message : String(error)) } },
    },
    '/worlds/gallery': {
      GET: async (_req, res, url) => { try { sendJson(res, 200, await worldFiles.gallery(url.searchParams.get('id') ?? '')) } catch (error) { return sendError(res, error instanceof WorldNotFoundError ? 404 : 409, error instanceof Error ? error.message : String(error)) } },
      PUT: async (req, res, url) => {
        const update = imageUpdateOf(await readJsonBody(req))
        if (typeof update === 'string') return sendError(res, 400, update)
        try { sendJson(res, 200, await worldFiles.updateImage(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '', update)) } catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/gallery/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'image'))
        try { sendJson(res, 201, { path: await worldFiles.uploadImage(url.searchParams.get('id') ?? '', name, await readBinaryBody(req, MAX_UPLOAD_BYTES)) }) } catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/worlds/gallery/file': {
      GET: async (_req, res, url) => {
        let image: { file: string; size: number }
        try { image = await worldFiles.galleryFile(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '') } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
      },
    },
    '/worlds/state/narration-voice': { PUT: async (req, res, url) => { const body = await readJsonBody(req) as { voice?: unknown }; if (typeof body.voice !== 'string') return sendError(res, 400, 'voice must be text'); sendJson(res, 200, await worldEditor.editNarrationVoice(url.searchParams.get('id') ?? '', body.voice)) } },
    '/worlds/state/character/portrait': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldEditor.generatePortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          return sendError(res, 409, error instanceof Error ? error.message : String(error))
        }
      },
    },
    '/worlds/state/character/portrait/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'portrait.png'))
        try { sendJson(res, 200, await worldEditor.uploadPortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/worlds/state/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await worldEditor.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    ...Object.fromEntries((['place', 'thing'] as const).flatMap(kind => [
      [`/worlds/state/${kind}/image`, {
        POST: async (_req, res, url) => {
          try { sendJson(res, 200, await worldEditor.generateEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) {
            if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            return sendError(res, 409, error instanceof Error ? error.message : String(error))
          }
        },
      }],
      [`/worlds/state/${kind}/image/upload`, {
        POST: async (req, res, url) => {
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'image.png'))
          try { sendJson(res, 200, await worldEditor.uploadEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
            if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            throw error
          }
        },
      }],
      [`/worlds/state/${kind}/image/file`, {
        GET: async (_req, res, url) => {
          try { await sendImage(res, await worldEditor.entityImageFile(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        },
      }],
      [`/sessions/world/${kind}/image`, {
        POST: async (_req, res, url) => {
          try { sendJson(res, 200, await sessions.generateEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) {
            if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            return sendError(res, 409, error instanceof Error ? error.message : String(error))
          }
        },
      }],
      [`/sessions/world/${kind}/image/upload`, {
        POST: async (req, res, url) => {
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'image.png'))
          try { sendJson(res, 200, await sessions.uploadEntityImage(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
            if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
            if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
            throw error
          }
        },
      }],
      [`/sessions/world/${kind}/image/file`, {
        GET: async (_req, res, url) => {
          try { await sendImage(res, await sessions.entityImageFile(url.searchParams.get('id') ?? '', kind, url.searchParams.get('key') ?? '')) } catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        },
      }],
    ])),
    '/worlds/characters': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, await worldCharacters(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions': {
      GET: async (_req, res) => { sendJson(res, 200, sessions.list()) },
      POST: async (req, res) => {
        const { worldId, playerCharacterId, playerAvatar, avatars: brought, name, settings, opening, startingTime, preset, lorebooks } = await readJsonBody(req)
        if (typeof worldId !== 'string' || worldId.trim() === '') return sendError(res, 400, '"worldId" is required')
        if (playerCharacterId === undefined && playerAvatar === undefined) return sendError(res, 400, '"playerCharacterId" or "playerAvatar" is required')
        if (playerCharacterId !== undefined && (typeof playerCharacterId !== 'string' || playerCharacterId.trim() === '')) return sendError(res, 400, '"playerCharacterId" must be text')
        if (playerAvatar !== undefined && (typeof playerAvatar !== 'string' || playerAvatar.trim() === '')) return sendError(res, 400, '"playerAvatar" must be text')
        if (brought !== undefined && (!Array.isArray(brought) || !brought.every(key => typeof key === 'string'))) return sendError(res, 400, '"avatars" must be a list of keys')
        if (name !== undefined && typeof name !== 'string') return sendError(res, 400, '"name" must be a string')
        if (opening !== undefined && (typeof opening !== 'number' || !Number.isInteger(opening))) return sendError(res, 400, '"opening" must be a whole number')
        if (startingTime !== undefined && typeof startingTime !== 'string') return sendError(res, 400, '"startingTime" must be text')
        if (preset !== undefined && typeof preset !== 'string') return sendError(res, 400, '"preset" must be text')
        if (lorebooks !== undefined && (!Array.isArray(lorebooks) || !lorebooks.every(entry => typeof entry === 'string'))) return sendError(res, 400, '"lorebooks" must be a list of lorebook names')
        try {
          sendJson(res, 201, await sessions.start({ ...(preset === undefined || preset === '' ? {} : { preset }), ...(lorebooks === undefined ? {} : { lorebooks: lorebooks as string[] }), ...(opening === undefined ? {} : { opening }), ...(startingTime === undefined ? {} : { startingTime }), worldId, ...(playerCharacterId === undefined ? {} : { playerCharacterId }), ...(playerAvatar === undefined ? {} : { playerAvatar }), ...(brought === undefined ? {} : { avatars: brought as string[] }), ...(name === undefined ? {} : { name }), ...(settings === undefined ? {} : { settings }) }))
        } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidStartError) return sendError(res, 422, error.message)
          if (error instanceof InvalidWorldError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/message': {
      POST: async (req, res) => {
        const body = await readJsonBody(req) as { id?: unknown; text?: unknown }
        if (typeof body.id !== 'string' || typeof body.text !== 'string' || body.text.trim() === '') return sendError(res, 400, 'id and text must be text, and the text must not be empty')
        try {
          await sessions.open(body.id)
          await sessions.send(body.id, body.text)
          sendJson(res, 202, { sent: true })
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof SessionArchivedError) return sendError(res, 409, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/open': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.open(url.searchParams.get('id') ?? '', url.searchParams.get('rebuild') === '1'))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof SessionArchivedError) return sendError(res, 409, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/timeline': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.timeline(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/timeline/move': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.moveTimeline(url.searchParams.get('id') ?? '', url.searchParams.get('to') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          if (error instanceof TimelineError) return sendError(res, 409, error.message)
          throw error
        }
      },
    },
    '/sessions/decisions': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.decisions(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions/notes': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.notes(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions/images': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await sessions.imageStatus(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
      POST: async (_req, res, url) => {
        try { sendJson(res, 202, await sessions.generateImage(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/gallery': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await sessions.gallery(url.searchParams.get('id') ?? '')) }
        catch (error) { return sendError(res, 409, error instanceof Error ? error.message : String(error)) }
      },
      PUT: async (req, res, url) => {
        const update = imageUpdateOf(await readJsonBody(req))
        if (typeof update === 'string') return sendError(res, 400, update)
        try { sendJson(res, 200, await sessions.updateImage(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '', update)) }
        catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/gallery/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? url.searchParams.get('name') ?? 'image'))
        try { sendJson(res, 201, { path: await sessions.uploadImage(url.searchParams.get('id') ?? '', name, await readBinaryBody(req, MAX_UPLOAD_BYTES)) }) }
        catch (error) { return sendError(res, 422, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/gallery/file': {
      GET: async (_req, res, url) => {
        let image: { file: string; size: number }
        try { image = await sessions.galleryFile(url.searchParams.get('id') ?? '', url.searchParams.get('path') ?? '') }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
      },
    },
    '/sessions/images/file': {
      GET: async (_req, res, url) => {
        const serial = Number(url.searchParams.get('serial'))
        let image: { file: string; size: number }
        try { image = await sessions.imageFile(url.searchParams.get('id') ?? '', url.searchParams.get('node') ?? '', serial) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
        await sendImage(res, image)
      },
    },
    '/setup': {
      GET: async (_req, res) => { sendJson(res, 200, { redundantLayers: redundantLayers?.() ?? [] }) },
    },
    '/tools': {
      GET: async (_req, res) => { sendJson(res, 200, { tools: externalTools?.() ?? [] }) },
    },
    '/sessions/settings': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.readSettings(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidSettingsError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
      PUT: async (req, res, url) => {
        const body = await readJsonBody(req)
        try {
          sendJson(res, 200, sessions.writeSettings(url.searchParams.get('id') ?? '', body))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidSettingsError) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/archive': {
      POST: async (_req, res, url) => {
        try {
          await sessions.archive(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/restore': {
      POST: async (_req, res, url) => {
        try {
          await sessions.restore(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/world': {
      GET: async (_req, res, url) => {
        try {
          sendJson(res, 200, sessions.world(url.searchParams.get('id') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/sessions/world/character': {
      PUT: async (req, res, url) => {
        try {
          sendJson(res, 200, sessions.editCharacter(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseCharacterEdit(await readJsonBody(req))))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/world/place': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, sessions.editPlace(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parsePlaceEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/sessions/world/thing': {
      PUT: async (req, res, url) => {
        try { sendJson(res, 200, sessions.editThing(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseThingEdit(await readJsonBody(req)))) }
        catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error }
      },
    },
    '/sessions/world/faction': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editFaction(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseFactionEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/lore': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editLore(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', parseLoreEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/plots': { PUT: async (req, res, url) => { try { const body = await readJsonBody(req) as { plots?: unknown }; if (!Array.isArray(body.plots)) return sendError(res, 400, 'plots must be a list'); sendJson(res, 200, sessions.editPlots(url.searchParams.get('id') ?? '', { plots: body.plots as PlotsEdit['plots'] })) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/relation': { PUT: async (req, res, url) => { try { sendJson(res, 200, sessions.editRelation(url.searchParams.get('id') ?? '', parseRelationEdit(await readJsonBody(req)))) } catch (error) { if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message); if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); throw error } } },
    '/sessions/world/narration-voice': { PUT: async (req, res, url) => { const body = await readJsonBody(req) as { voice?: unknown }; if (typeof body.voice !== 'string') return sendError(res, 400, 'voice must be text'); sendJson(res, 200, sessions.editNarrationVoice(url.searchParams.get('id') ?? '', body.voice)) } },
    '/sessions/world/character/portrait': {
      POST: async (_req, res, url) => {
        try {
          sendJson(res, 200, await sessions.generatePortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? ''))
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          return sendError(res, 409, error instanceof Error ? error.message : String(error))
        }
      },
    },
    '/sessions/world/character/portrait/upload': {
      POST: async (req, res, url) => {
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'portrait.png'))
        try { sendJson(res, 200, await sessions.uploadPortrait(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '', await readBinaryBody(req, MAX_UPLOAD_BYTES), name)) } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
    },
    '/sessions/world/character/portrait/file': {
      GET: async (_req, res, url) => {
        try { await sendImage(res, await sessions.portraitFile(url.searchParams.get('id') ?? '', url.searchParams.get('key') ?? '')) }
        catch (error) { return sendError(res, 404, error instanceof Error ? error.message : String(error)) }
      },
    },
    '/sessions/activity/run': {
      GET: async (_req, res, url) => {
        try {
          const detail = sessions.activityRun(url.searchParams.get('id') ?? '', url.searchParams.get('run') ?? '')
          if (detail === undefined) return sendError(res, 404, 'this run was not kept, or has been dropped to make room')
          sendJson(res, 200, detail)
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof RangeError) return sendError(res, 400, error.message)
          throw error
        }
      },
    },
    '/sessions/doctor': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { title?: unknown; language?: unknown }
        if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300) return sendError(res, 400, 'the request needs a valid chat title')
        try { sendJson(res, 200, await sessions.doctor(url.searchParams.get('id') ?? '', body.title.trim(), languageField(body.language) ?? 'en')) }
        catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
      },
    },
    '/sessions/reflect': {
      POST: async (_req, res, url) => {
        try {
          await sessions.reflect(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof ReflectionRefusedError) return sendError(res, 409, error.message)
          throw error
        }
        res.statusCode = 202
        res.end()
      },
    },
    '/sessions/vectors/reset': {
      POST: async (_req, res, url) => {
        try {
          sessions.resetVectors(url.searchParams.get('id') ?? '')
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/rename': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req)
        const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined
        if (typeof name !== 'string') return sendError(res, 400, 'the request needs a "name"')
        try {
          await sessions.rename(url.searchParams.get('id') ?? '', name)
        } catch (error) {
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof InvalidStartError) return sendError(res, 422, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    '/sessions/item': {
      DELETE: async (_req, res, url) => {
        try {
          await sessions.delete(url.searchParams.get('id') ?? '', url.searchParams.get('everywhere') === 'true')
        } catch (error) {
          if (error instanceof SyncRefusedError || error instanceof RcloneError) return syncFailure(res, error)
          if (error instanceof SessionNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          throw error
        }
        res.statusCode = 204
        res.end()
      },
    },
    ...interfaceRoutes(packs),
    ...presetRoutes(presets),
    ...lorebookRoutes(lorebooks),
    ...syncRoutes(sync),
    '/worlds/cover': {
      GET: async (_req, res, url) => {
        const cover = await worlds.cover(url.searchParams.get('id') ?? '')
        if (cover === undefined) return sendError(res, 404, 'no cover')
        res.statusCode = 200
        res.setHeader('content-type', cover.contentType)
        res.setHeader('content-length', cover.size)
        res.setHeader('x-content-type-options', 'nosniff')
        // The version in the URL changes with the file, so a matching one can be kept indefinitely.
        res.setHeader(
          'cache-control',
          cover.version === url.searchParams.get('v') ? 'private, max-age=31536000, immutable' : 'no-cache',
        )
        await pipeline(createReadStream(cover.file), res)
      },
    },
  }


  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(`/${API_PREFIX}`.length) || '/'
    // The files a sandboxed frame loads itself come without a login (it has no origin, so no cookie); their address holds a key only the page was given.
    const framed = path.startsWith(FRAME_FILES) && req.method === 'GET'
    const rejection = framed ? undefined : connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if ((path.startsWith(PACK_FILES) || framed) && req.method === 'GET') {
      try { await sendPackFile(packs, path, res) } catch (error) {
        if (res.headersSent) res.destroy()
        else sendError(res, 500, error instanceof Error ? error.message : 'internal error')
      }
      return
    }
    const methods = routes[path]
    if (methods === undefined) return sendError(res, 404, 'not found')
    if (anyLocked?.() === true && !path.startsWith('/sync/')) {
      const unit = await locked?.(url)
      if (unit !== undefined) return sendError(res, 423, `"${unit}" is being synced; try again when it is done`)
    }
    const route = methods[req.method ?? '']
    if (route === undefined) {
      res.setHeader('allow', Object.keys(methods).join(', '))
      return sendError(res, 405, 'method not allowed')
    }
    try {
      await route(req, res, url)
    } catch (error) {
      if (res.headersSent) res.destroy()
      else if (error instanceof HttpError) sendError(res, error.status, error.message)
      else sendError(res, 500, error instanceof Error ? error.message : 'internal error')
    }
  }
}

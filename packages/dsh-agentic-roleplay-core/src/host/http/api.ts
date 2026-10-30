import type { ExternalTool } from '../../shared/tools.ts'
import { type DiceDocument } from '../../shared/world-dice.ts'
import { type CalendarDocument, type VariableDeclaration, type WorldRoutines } from '../../shared/world-daily.ts'
import type { RoutineDefinition } from 'dsh-roleplay-model'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RunDetail } from '../../shared/activity.ts'
import type { PackProblem } from '../../shared/interface-pack.ts'
import type { Note } from '../../shared/notes.ts'
import type { DecisionsPayload } from '../../shared/decisions.ts'
import type { SceneImageStatus } from '../../shared/images.ts'
import { type CharacterEdit, type FactionEdit, type LoreEdit, type PlaceEdit, type PlotsEdit, type RelationChange, type ThingEdit, type WorldState } from '../../shared/world-state.ts'
import type { TimelineView } from '../../shared/timeline.ts'
import type { SpeechAudio, SpeechPart } from '../speech/service.ts'
import type { TtsVoice } from '@dsh-ai-providers/core'
import type { SettingsPayload } from '../../shared/settings.ts'
import type { OpenedSession, SessionsPayload, StartedSession, StartSessionRequest, WorldCharactersPayload } from '../../shared/sessions.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { type WorldInfo, type WorldInfoEdit } from '../../shared/world-info.ts'
import type { WorldPromptEntry } from '../prompts/world-prompts.ts'
import type { GalleryImage } from '../../shared/gallery.ts'
import type { ImageUpdate } from '../images/gallery.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import type { Catalogue } from '../catalogue/service.ts'
import type { ImportChoices, ImportPreview, UpdateStatus } from '../../shared/import-card.ts'
import type { SelectionChoice, SelectionKind, SelectionPreview } from '../../shared/import-selection.ts'
import { HttpError, sendError } from './respond.ts'
import { presetRoutes } from '../presets/routes.ts'
import type { PresetApi } from '../presets/routes.ts'
import { lorebookRoutes } from '../lorebooks/routes.ts'
import { syncRoutes, type SyncApi } from '../sync/routes.ts'
import type { LorebookApi } from '../lorebooks/routes.ts'
import { FRAME_FILES, PACK_FILES, interfaceRoutes, sendPackFile, type InterfaceApi } from '../interface/routes.ts'
import type { DraftAction, DraftStatus } from '../import/draft.ts'
import type { Routes } from './routes/shared.ts'
import { speechRoutes } from './routes/speech.ts'
import { worldsRoutes } from './routes/worlds.ts'
import { catalogueRoutes } from './routes/catalogue.ts'
import { importsRoutes } from './routes/imports.ts'
import { worldFilesRoutes } from './routes/worldFiles.ts'
import { sessionsRoutes } from './routes/sessions.ts'
import { sessionWorldRoutes } from './routes/sessionWorld.ts'

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
    start(id: string, choices: ImportChoices, language?: string, update?: string): Promise<{ worldId: string; chatSessionId: string; started: boolean; failure?: string }>
    /** Imports the card without a model: its own character, lorebook and instructions as written, in a new world. */
    importStructure(id: string, choices: ImportChoices, language?: string): Promise<{ worldId: string; draft: boolean }>
    picture(id: string): Promise<{ file: string; size: number }>
    /** Whether the world is a draft (an import written but not yet able to start) and what is wrong with it. */
    draftStatus(worldId: string): Promise<DraftStatus>
    /** What the person decides about a draft: ask the assistant again, keep it, or discard it. */
    actOnDraft(worldId: string, action: DraftAction, language?: string): Promise<{ action: DraftAction; started?: { worldId: string; chatSessionId: string; started: boolean; failure?: string }; keptIn?: string }>
    /** Has the chat of a world whose import stopped carry on from the step it reached. */
    resume(worldId: string, language?: string): Promise<{ worldId: string; chatSessionId: string; started: boolean; failure?: string }>
    updateStatus(worldId: string): Promise<UpdateStatus>
    /** Returns the world to what it was before its last card update; the answer says where what it held is kept. */
    revertUpdate(worldId: string): Promise<{ keptIn: string }>
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

/** Build the request handler mounted at `/${API_PREFIX}`. */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { packs, presets, lorebooks, sync, locked, anyLocked, connection } = deps
  const routes: Routes = {
    ...speechRoutes(deps),
    ...worldsRoutes(deps),
    ...catalogueRoutes(deps),
    ...importsRoutes(deps),
    ...worldFilesRoutes(deps),
    ...sessionsRoutes(deps),
    ...sessionWorldRoutes(deps),
    ...interfaceRoutes(packs),
    ...presetRoutes(presets),
    ...lorebookRoutes(lorebooks),
    ...syncRoutes(sync),
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

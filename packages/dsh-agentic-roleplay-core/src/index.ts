import { join, relative } from 'node:path'
import { roleplaySessionOf } from './shared/chat.ts'
import { authoredWorldOf } from './shared/authoring-chat.ts'
import { lorebookOfChat } from './shared/lorebook-chat.ts'
import { presetOfChat } from './shared/preset-chat.ts'
import { liveSettings, useChildReasoning } from './host/sessions/settings.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { DecisionService, ImageGenerationService } from '@dsh-ai-providers/core'
// Type-only: declares `ctx.roleplayState`.
import type {} from '@dsh-agentic-roleplay/state'
import { AgentSessions, agentServicesOf } from './host/agent/agent-sessions.ts'
import { isPng, pictureOf, readCard } from './host/import/card.ts'
import { childSamplingOf } from './host/agents/child.ts'
import { PromptLibrary } from './host/prompts/library.ts'
import { AuthoringLanguages } from './host/worlds/authoring-language.ts'
import { RoleplayImport } from './host/import/service.ts'
import type { ImportChoices, ImportPreview } from './shared/import-card.ts'
import { startImport } from './host/import/start-import.ts'
import { findTargets, revertUpdate, startUpdate, updateStatus } from './host/import/update.ts'
import { startTranslation, worldLanguage } from './host/translate/service.ts'
import { ImportStore } from './host/import/store.ts'
import { applyPresetVerbatim, uploadPreset } from './host/import/upload-preset.ts'
import { ImportStaging } from './host/import/staging.ts'
import { AuthoringSessions } from './host/agent/authoring-sessions.ts'
import { PresetAuthoringSessions } from './host/agent/preset-authoring-sessions.ts'
import { LorebookAuthoringSessions } from './host/agent/lorebook-authoring-sessions.ts'
import { lorebookImportMessage } from './host/authoring/lorebook-author-tools.ts'
import { Lorebooks } from './host/lorebooks/service.ts'
import { narrationImportMessage } from './host/authoring/preset-author-tools.ts'
import { DoctorSessions } from './host/agent/doctor-sessions.ts'
import { Config } from './host/config.ts'
import { RoleplayOrchestration } from './host/orchestration/service.ts'
import { registerApi } from './host/http/index.ts'
import { deleteSession } from './host/sessions/delete-session.ts'
import { purgeOf } from './host/agent/purge-services.ts'
import { AuthoringTools } from './host/tools/authoring-tools.ts'
import { externalTools, type ToolRegistry } from './host/tools/external.ts'
import { redundantLayers, redundantLayersMessage, selectedBundles } from './host/setup/rows.ts'
import { editCalendar, editDice, editRoutine, editVariables, readCalendarDocument, readDiceDocument, readRoutines, readVariables } from './host/worlds/daily-life.ts'
import { addWorldLore, removeWorldLore } from './host/worlds/lore-entries.ts'
import { editSessionNarrationVoice, editWorldCharacter as editSessionCharacter, editWorldFaction as editSessionFaction, editWorldLore as editSessionLore, editWorldPlots as editSessionPlots, editWorldPlace as editSessionPlace, editWorldRelation as editSessionRelation, editWorldThing as editSessionThing, generateSessionCharacterPortrait, generateSessionEntityImage, readWorldState, sessionCharacterPortraitFile, sessionEntityImageFile, uploadSessionCharacterPortrait, uploadSessionEntityImage } from './host/sessions/world-state.ts'
import { editWorldNarrationVoice, editWorldCharacter as editWorldFileCharacter, editWorldFaction as editWorldFileFaction, editWorldLore as editWorldFileLore, editWorldPlots as editWorldFilePlots, editWorldPlace as editWorldFilePlace, editWorldRelation as editWorldFileRelation, editWorldThing as editWorldFileThing, generateWorldCharacterPortrait, generateWorldEntityImage, readWorldEditor, readWorldTrigger, removeWorldTrigger, writeWorldTrigger, uploadWorldEntityImage, worldCharacterPortraitFile, worldEntityImageFile, uploadWorldCharacterPortrait } from './host/worlds/world-editor.ts'
import { addAvatarsToWorld, avatarsWorld, createAvatar, deleteAvatar } from './host/avatars/avatars.ts'
import { AVATARS_WORLD_ID } from './shared/avatars.ts'
import { galleryFile, listGallery, updateImage } from './host/images/gallery.ts'
import { addToLibrary } from './host/images/library.ts'
import { deleteWorldPrompt, listWorldPrompts, readWorldPrompt, writeWorldPrompt } from './host/prompts/world-prompts.ts'
import { editWorldInfo, readWorldInfo } from './host/worlds/world-info.ts'
import { loadLocations } from './host/locations/load.ts'
import { renameSession } from './host/sessions/rename-session.ts'
import { archiveSession, restoreSession } from './host/sessions/archive-session.ts'
import { readChatSettings, writeChatSettings } from './host/sessions/chat-settings.ts'
import { installFirstPartyPacks } from './host/interface/first-party.ts'
import { reflectionStatus } from './host/memory/reflection.ts'
import { resetVectors, vectorStatus } from './host/sessions/vectors.ts'
import { readActivity, readRunDetail } from './host/sessions/activity.ts'
import { readUsage } from './host/sessions/usage.ts'
import { createWorldPack, readWorldPackFile, writeWorldPackFile } from './host/authoring/pack-files.ts'
import { deleteWorldPackFile } from './host/interface/world-packs.ts'
import { readInterventions } from './host/sessions/interventions.ts'
import { InterfaceService } from './host/interface/service.ts'
import { Presets } from './host/presets/service.ts'
import { notesOfSession } from './host/sessions/notes.ts'
import { decisionsOfSession } from './host/decisions/status.ts'
import { openSession } from './host/sessions/open-session.ts'
import { listSessions } from './host/sessions/list-sessions.ts'
import { startSession } from './host/sessions/start-session.ts'
import { createWorld } from './host/worlds/create-world.ts'
import { addStarterWorld, listStarterWorlds } from './host/worlds/starter.ts'
import { worldCharacters } from './host/sessions/world-characters.ts'
import { RoleplayRoot } from './host/storage/roleplay-root.ts'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { chatSessionId } from './shared/chat.ts'
import { SessionNotFoundError } from './host/sessions/errors.ts'
import { AgentUnavailableError } from './host/sessions/errors.ts'
import type { Timelines } from './host/timeline/service.ts'
import { WorldCatalog } from './host/worlds/catalog.ts'
import { Catalogue } from './host/catalogue/service.ts'
import { Sources, type CredentialStore } from './host/catalogue/sources.ts'
import { WorldNotFoundError } from './host/sessions/errors.ts'
import { sceneImagePath } from './host/images/storage.ts'
import { createSync } from './host/sync/wire.ts'
import { speakParts, voicesOf } from './host/speech/service.ts'
import { sharedSamplingOf, type SharedSamplingKey } from './shared/sampling.ts'

export { Config } from './host/config.ts'
export type * from './host/orchestration/boundaries.ts'
export type { CharacterAction, CharacterFailure, CharacterReport, Commitment, Outcome, Result } from './host/orchestration/protocol.ts'
export { RoleplayOrchestration } from './host/orchestration/service.ts'
export const name = '@dsh-agentic-roleplay/core'

/** Sessions are kept by the state plugin, which the bundle installs with this one. */
export const inject = ['roleplayState']

/** The slice of the AI providers plugin's registry that sets the controls of model requests. */
interface RequestPolicies {
  policy(policy: (request: { options: { sessionId?: unknown } }) => (Partial<Record<SharedSamplingKey, number>> & { temperature?: number; toolChoice?: 'auto' | 'required'; maxTokens?: number; priority?: 'foreground' | 'background' }) | undefined): () => void
}

export function apply(ctx: Context, config: Config) {
  const layers = (): string[] => redundantLayers(selectedBundles((ctx as unknown as { get(name: 'profileContext'): { dir: string } | undefined }).get('profileContext')?.dir))
  const repeated = layers()
  if (repeated.length > 0) ctx.logger.error(redundantLayersMessage(repeated))
  // The controls of the helper agents' requests are applied by the model service that serves them, when there is one.
  ctx.inject(['aiProviders' as never], (scope) => {
    const providers = Reflect.get(scope, 'aiProviders') as RequestPolicies
    scope.effect(() => providers.policy(({ options }) => {
      if (options.sessionId === undefined) return undefined
      const id = String(options.sessionId)
      const helper = childSamplingOf(id)
      if (helper !== undefined) return helper
      // an authoring assistant that thinks without end would otherwise write until the model's own limit, minutes of it
      if (authoredWorldOf(id) !== undefined || presetOfChat(id) !== undefined || lorebookOfChat(id) !== undefined) return { maxTokens: config.importMaxTokens.get(), priority: 'foreground' as const }
      const session = roleplaySessionOf(id)
      // The game master's own requests: the chat is its session.
      if (session === undefined) return undefined
      const { sampling } = liveSettings(sessionFolder(join(root.path, 'sessions'), session))
      return { temperature: sampling.master, ...sharedSamplingOf(sampling), maxTokens: sampling.masterMaxTokens, priority: 'foreground' as const }
    }), 'roleplay: request controls')
  })
  ctx.effect(() => useChildReasoning(() => config.childReasoning.get()), 'roleplay: helper thinking level')
  const root = new RoleplayRoot(ctx, config.rootPath)
  root.start()
  const orchestration = new RoleplayOrchestration(ctx)
  const worlds = new WorldCatalog(ctx, root)
  const prompts = new PromptLibrary(ctx, root)
  prompts.bootstrap()
  // An old copy of a shipped prompt cannot be told from an edit, so one that no longer fits is reported at once but does not stop the plugin; using it still fails with the same reason.
  const edited = prompts.problems()
  if (edited.length > 0) ctx.logger.error(`these prompt files in ${prompts.directory} cannot be used (fix them, or delete a file to restore the original):\n${edited.map(problem => `${problem.path}: ${problem.message}`).join('\n')}`)
  installFirstPartyPacks(root.path)
  const languages = new AuthoringLanguages(ctx, () => join(root.path, 'worlds'))
  const authoringTools = new AuthoringTools(ctx, () => config.authoringTools.get())
  const agent = new AgentSessions(agentServicesOf(ctx), () => root.path)
  const authoring = new AuthoringSessions(agentServicesOf(ctx), () => root.path, prompts, languages)
  const presetAuthoring = new PresetAuthoringSessions(agentServicesOf(ctx), () => root.path, prompts, languages)
  const lorebookAuthoring = new LorebookAuthoringSessions(agentServicesOf(ctx), () => root.path, prompts, languages)
  const doctors = new DoctorSessions(agentServicesOf(ctx), () => root.path, prompts)
  const imports = new ImportStore(() => root.path)
  const roleplayImport = new RoleplayImport(ctx, () => ({
    get maxUploadBytes() { return config.importMaxUploadBytes.get() }, concurrency: config.importConcurrency.get(), reasoning: config.importReasoning.get() || config.childReasoning.get(), model: config.importModel.get(),
    maxTokens: config.importMaxTokens.get(), temperature: config.importTemperature.get(), timeoutMinutes: config.importTimeoutMinutes.get(),
    decisions: config.importDecisions.get() === 'decision' ? 'decision' : 'llm', confidence: config.importConfidence.get(),
    approval: config.authoringApproval.get() === 'auto' ? 'auto' : 'ask',
  }))
  const settingsDeps = {
    sessionsDir: () => join(root.path, 'sessions'),
    pendingRecords: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).pendingCommits.list().length,
    clockMode: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).clock.get()?.mode,
    pendingConsolidation: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).consolidation.pending().length,
    vectors: (id: string) => vectorStatus(ctx.roleplayState.openSession(join(root.path, 'sessions'), id)),
    reflection: (id: string) => reflectionStatus(ctx.roleplayState.openSession(join(root.path, 'sessions'), id), orchestration.reflecting(chatSessionId(id))),
    activity: (id: string) => readActivity(ctx.roleplayState.openSession(join(root.path, 'sessions'), id)),
    usage: (id: string) => readUsage(ctx.roleplayState.openSession(join(root.path, 'sessions'), id)),
    interventions: (id: string) => readInterventions(ctx.roleplayState.openSession(join(root.path, 'sessions'), id)),
  }
  const staging = new ImportStaging()
  const purgeChat = purgeOf(ctx, config.sessionStorePath)
  const deps = { worlds, state: ctx.roleplayState, agent, sessionsDir: () => join(root.path, 'sessions'), root: () => root.path, avatars: () => avatarsWorld(root.path) }
  const presetLibrary = new Presets({ root: () => root.path, worldDirectory: async worldId => (await worlds.find(worldId))?.directory, authoring: presetAuthoring, importMessage: narrationImportMessage, get maxUploadBytes() { return config.importMaxUploadBytes.get() }, staging, playing: id => orchestration.playing(chatSessionId(id)) })
  const lorebookLibrary = new Lorebooks({ root: () => root.path, authoring: lorebookAuthoring, importMessage: lorebookImportMessage, get maxUploadBytes() { return config.importMaxUploadBytes.get() }, staging, session: id => { const sessions = join(root.path, 'sessions'); if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`); return ctx.roleplayState.openSession(sessions, id) }, playing: id => orchestration.playing(chatSessionId(id)) })
  const withTargets = async (preview: ImportPreview): Promise<ImportPreview> => {
    const targets = await findTargets(worlds, preview.choices.name)
    return targets.length === 0 ? preview : { ...preview, targets }
  }
  const begin = async (id: string, choices: ImportChoices, language?: string, update?: string) => update === undefined ? await startImport({ store: imports, worlds, authoring }, id, choices, language) : await startUpdate({ store: imports, worlds, authoring }, id, choices, update, language)
  const catalogue = new Catalogue({
    sources: new Sources(() => config.catalogues.get(), () => ctx.get('credentials') as CredentialStore | undefined), worlds, maxBytes: () => config.catalogueMaxBytes.get(), maxCardBytes: () => config.importMaxUploadBytes.get(),
    trashDays: () => config.catalogueTrashDays.get(), problem: (message) => { ctx.logger.warn(message) },
    stage: (kind, file, name) => staging.stage(kind, file, name),
    importPreset: async (file, title, language) => await presetLibrary.importTitled(title, file, language),
    importLorebook: async (file, title, language) => await lorebookLibrary.importTitled(title, file, language),
    previewCard: async (file, name) => await withTargets(await imports.create(readCard(file, name), isPng(file) ? pictureOf(file) : undefined)),
    startCard: begin,
    importCard: async (file, name, language) => {
      const preview = await imports.create(readCard(file, name), isPng(file) ? pictureOf(file) : undefined)
      return await startImport({ store: imports, worlds, authoring }, preview.id, preview.choices, language)
    },
  })
  void catalogue.tidy()
  const sync = createSync(ctx, {
    config: () => config.sync.get(), root: () => root.path, worlds, orchestration, state: ctx.roleplayState,
    remove: id => deleteSession({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir, purgeChat }, id),
    rebuild: async (id) => { if (await agent.has(id)) await openSession({ ...deps, replaceChat: (chat, title, events) => agent.replace(chat, title, events, purgeChat) }, id, { rebuild: true }) },
  })
  prompts.frozen = () => sync.gate.isLocked('prompts')
  registerApi(ctx, {
    sync: sync.api, locked: sync.locked, anyLocked: () => sync.gate.any,
    catalogue,
    presets: presetLibrary,
    lorebooks: lorebookLibrary,
    packs: new InterfaceService({ open: id => ctx.roleplayState.openSession(deps.sessionsDir(), id), root: () => root.path, worldDirectory: async worldId => (await worlds.find(worldId))?.directory, world: worldId => worlds.find(worldId) }),
    speech: {
      voices: async () => await voicesOf(textToSpeechOf(ctx)),
      speak: async parts => await speakParts(textToSpeechOf(ctx), parts),
      streaming: () => streamingSpeechToTextOf(ctx) !== undefined,
    },
    worlds,
    createWorld: input => createWorld(worlds, input),
    starter: { list: () => listStarterWorlds(worlds), add: folder => addStarterWorld(worlds, folder) },
    authorWorld: async (worldId, title, language) => {
      const world = await worlds.find(worldId)
      if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
      return { chatSessionId: await authoring.ensure(world.summary.id, world.summary.name, title, language) }
    },
    translation: {
      language: id => worldLanguage(worlds, id),
      start: (id, to, title, language) => startTranslation({ worlds, authoring, text: (key, lang, variables) => prompts.text(key, lang, variables) }, id, to, title, language),
    },
    importer: {
      get maxUploadBytes() { return config.importMaxUploadBytes.get() },
      upload: async (file, name) => { const card = readCard(file, name); return await withTargets(await imports.create(card, isPng(file) ? pictureOf(file) : undefined)) },
      read: async id => await withTargets(await imports.read(id)),
      choose: (id, choices) => imports.choose(id, choices),
      discard: id => imports.discard(id),
      start: begin,
      picture: id => imports.picture(id),
      updateStatus: async worldId => await updateStatus((await editableWorld(worlds, worldId, root.path)).directory),
      revertUpdate: async worldId => {
        const directory = (await editableWorld(worlds, worldId, root.path)).directory
        const { keptIn } = await revertUpdate(directory)
        await worlds.list({ refresh: true })
        return { keptIn: relative(directory, keptIn) }
      },
      uploadPreset: (worldId, file, name, language) => uploadPreset({ worlds, authoring }, worldId, file, name, language),
      stage: (kind, file, name) => staging.stage(kind, file, name),
      discardStaged: id => { staging.discard(id) },
      applyStagedVerbatim: async (worldId, choice) => {
        const { file, name } = staging.choose('preset', choice)
        const applied = await applyPresetVerbatim({ worlds }, worldId, file, name)
        staging.discard(choice.id)
        return applied
      },
      uploadStaged: async (worldId, choice, language) => {
        const { file, name } = staging.choose('preset', choice)
        const uploaded = await uploadPreset({ worlds, authoring }, worldId, file, name, language)
        staging.discard(choice.id)
        return uploaded
      },
    },
    worldCharacters: worldId => worldCharacters(worlds, worldId),
    avatars: {
      create: async name => await createAvatar(await avatarsWorld(root.path), name),
      remove: async key => { await deleteAvatar(await avatarsWorld(root.path), key) },
      addToWorld: async (worldId, keys) => {
        const world = await editableWorld(worlds, worldId, root.path)
        const { locations } = await loadLocations(world.directory)
        return await addAvatarsToWorld(await avatarsWorld(root.path), world, keys, locations)
      },
    },
    redundantLayers: layers,
    externalTools: () => { const registry = (ctx as unknown as { get(name: 'tools'): ToolRegistry | undefined }).get('tools'); return registry === undefined ? [] : externalTools(registry) },
    worldFiles: {
      info: async worldId => await readWorldInfo((await editableWorld(worlds, worldId, root.path)).directory),
      editInfo: async (worldId, edit) => { const info = await editWorldInfo((await editableWorld(worlds, worldId, root.path)).directory, edit); await worlds.list({ refresh: true }); return info },
      routines: async worldId => await readRoutines(await editableWorld(worlds, worldId, root.path)),
      editRoutine: async (worldId, key, windows) => await editRoutine(await editableWorld(worlds, worldId, root.path), key, windows),
      dice: async worldId => await readDiceDocument(await editableWorld(worlds, worldId, root.path)),
      editDice: async (worldId, dice) => await editDice(await editableWorld(worlds, worldId, root.path), dice),
      calendar: async worldId => await readCalendarDocument(await editableWorld(worlds, worldId, root.path)),
      editCalendar: async (worldId, calendar) => await editCalendar(await editableWorld(worlds, worldId, root.path), calendar),
      variables: async worldId => await readVariables(await editableWorld(worlds, worldId, root.path)),
      editVariables: async (worldId, declarations) => await editVariables(await editableWorld(worlds, worldId, root.path), declarations),
      prompts: async (worldId, language) => listWorldPrompts((await editableWorld(worlds, worldId, root.path)).directory, language),
      readPrompt: async (worldId, language, prompt) => readWorldPrompt((await editableWorld(worlds, worldId, root.path)).directory, language, prompt),
      writePrompt: async (worldId, language, prompt, text) => { await writeWorldPrompt((await editableWorld(worlds, worldId, root.path)).directory, language, prompt, text) },
      deletePrompt: async (worldId, language, prompt) => { await deleteWorldPrompt((await editableWorld(worlds, worldId, root.path)).directory, language, prompt) },
      gallery: async worldId => ({ images: await listGallery((await editableWorld(worlds, worldId, root.path)).directory), failures: {} }),
      galleryFile: async (worldId, path) => await galleryFile((await editableWorld(worlds, worldId, root.path)).directory, path),
      uploadImage: async (worldId, name, bytes) => await addToLibrary((await editableWorld(worlds, worldId, root.path)).directory, bytes, name),
      updateImage: async (worldId, path, update) => await updateImage((await editableWorld(worlds, worldId, root.path)).directory, path, update),
    },
    worldEditor: {
      read: async worldId => await readWorldEditor(await editableWorld(worlds, worldId, root.path)),
      editCharacter: async (worldId, key, edit) => await editWorldFileCharacter(await editableWorld(worlds, worldId, root.path), key, edit),
      editPlace: async (worldId, key, edit) => await editWorldFilePlace(await editableWorld(worlds, worldId, root.path), key, edit),
      editThing: async (worldId, key, edit) => await editWorldFileThing(await editableWorld(worlds, worldId, root.path), key, edit),
      editFaction: async (worldId, key, edit) => await editWorldFileFaction(await editableWorld(worlds, worldId, root.path), key, edit),
      editLore: async (worldId, key, edit) => await editWorldFileLore(await editableWorld(worlds, worldId, root.path), key, edit),
      addLore: async (worldId, title) => (await addWorldLore(await editableWorld(worlds, worldId, root.path), title)).state,
      removeLore: async (worldId, key) => await removeWorldLore(await editableWorld(worlds, worldId, root.path), key),
      readPackFile: async (worldId, pack, path) => await readWorldPackFile((await editableWorld(worlds, worldId, root.path)).directory, pack, path),
      writePackFile: async (worldId, pack, path, text) => await writeWorldPackFile((await editableWorld(worlds, worldId, root.path)).directory, pack, path, text),
      deletePackFile: async (worldId, pack, path) => (await deleteWorldPackFile((await editableWorld(worlds, worldId, root.path)).directory, pack, path)).problems,
      createPack: async (worldId, pack, name) => await createWorldPack((await editableWorld(worlds, worldId, root.path)).directory, pack, name),
      readTrigger: async (worldId, key) => await readWorldTrigger(await editableWorld(worlds, worldId, root.path), key),
      writeTrigger: async (worldId, key, document) => await writeWorldTrigger(await editableWorld(worlds, worldId, root.path), key, document),
      removeTrigger: async (worldId, key) => await removeWorldTrigger(await editableWorld(worlds, worldId, root.path), key),
      editPlots: async (worldId, edit) => await editWorldFilePlots(await editableWorld(worlds, worldId, root.path), edit),
      editRelation: async (worldId, edit) => await editWorldFileRelation(await editableWorld(worlds, worldId, root.path), edit),
      editNarrationVoice: async (worldId, voice) => await editWorldNarrationVoice(await editableWorld(worlds, worldId, root.path), voice),
      generatePortrait: async (worldId, key) => await generateWorldCharacterPortrait(await editableWorld(worlds, worldId, root.path), key, imageGenerationOf(ctx)),
      portraitFile: async (worldId, key) => await worldCharacterPortraitFile(await editableWorld(worlds, worldId, root.path), key),
      uploadPortrait: async (worldId, key, png, name) => await uploadWorldCharacterPortrait(await editableWorld(worlds, worldId, root.path), key, png, name),
      generateEntityImage: async (worldId, kind, key) => await generateWorldEntityImage(await editableWorld(worlds, worldId, root.path), kind, key, imageGenerationOf(ctx)),
      entityImageFile: async (worldId, kind, key) => await worldEntityImageFile(await editableWorld(worlds, worldId, root.path), kind, key),
      uploadEntityImage: async (worldId, kind, key, png, name) => await uploadWorldEntityImage(await editableWorld(worlds, worldId, root.path), kind, key, png, name),
    },
    sessions: { generateEntityImage: (id, kind, key) => generateSessionEntityImage({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, kind, key, imageGenerationOf(ctx)), entityImageFile: (id, kind, key) => sessionEntityImageFile({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, kind, key), uploadEntityImage: (id, kind, key, png, name) => uploadSessionEntityImage({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, kind, key, png, name), list: () => listSessions(deps), start: request => startSession(deps, request), open: (id, rebuild) => openSession({ ...deps, replaceChat: (id, title, events) => agent.replace(id, title, events, purgeChat) }, id, rebuild === true ? { rebuild } : {}), send: (id, text) => agent.send(id, text), gallery: id => imagesOf(ctx, deps.sessionsDir, id).gallery(id), galleryFile: (id, path) => galleryFile(galleryFolder(deps.sessionsDir(), id), path), uploadImage: (id, name, bytes) => imagesOf(ctx, deps.sessionsDir, id).upload(id, name, bytes), updateImage: (id, path, update) => imagesOf(ctx, deps.sessionsDir, id).update(id, path, update), delete: async (id, everywhere) => {
      // The remote goes first: if it cannot be reached nothing is deleted, and the other devices only ever see a deletion that happened.
      if (everywhere === true) await sync.service.deleteRemote(`sessions/${id}`)
      await deleteSession({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir, purgeChat }, id)
      if (everywhere !== true && config.sync.get().remote.trim() !== '') sync.service.forget(`sessions/${id}`)
    }, archive: id => archiveSession({ agent, sessionsDir: deps.sessionsDir }, id), restore: id => restoreSession({ agent, sessionsDir: deps.sessionsDir }, id), editCharacter: (id, key, edit) => editSessionCharacter({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editPlace: (id, key, edit) => editSessionPlace({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editThing: (id, key, edit) => editSessionThing({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editFaction: (id, key, edit) => editSessionFaction({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editLore: (id, key, edit) => editSessionLore({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editPlots: (id, edit) => editSessionPlots({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, edit), editRelation: (id, edit) => editSessionRelation({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, edit), editNarrationVoice: (id, voice) => editSessionNarrationVoice({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, voice), generatePortrait: (id, key) => generateSessionCharacterPortrait({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, imageGenerationOf(ctx)), portraitFile: (id, key) => sessionCharacterPortraitFile({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key), uploadPortrait: (id, key, png, name) => uploadSessionCharacterPortrait({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, png, name), world: id => readWorldState({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id), rename: (id, name) => renameSession({ state: ctx.roleplayState, agent, sessionsDir: deps.sessionsDir }, id, name), readSettings: id => readChatSettings(settingsDeps, id), writeSettings: (id, value) => writeChatSettings(settingsDeps, id, value), timeline: id => timelinesOf(ctx, deps.sessionsDir, id).view(id), moveTimeline: (id, to) => timelinesOf(ctx, deps.sessionsDir, id).move(chatSessionId(id), to === 'start' ? null : to), activityRun: (id, run) => { const sessions = join(root.path, 'sessions'); if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`); return readRunDetail(sessionFolder(sessions, id), run) }, doctor: async (id, title, language) => { const sessions = join(root.path, 'sessions'); if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`); return { chatSessionId: await doctors.ensure({ id, name: ctx.roleplayState.openSession(sessions, id).metadata.get().name }, title, language) } }, reflect: async (id) => { const sessions = join(root.path, 'sessions'); if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`); await agent.ensure(id, ctx.roleplayState.openSession(sessions, id).metadata.get().name); await ctx.roleplayOrchestration.reflect(chatSessionId(id)) }, resetVectors: id => { const sessions = join(root.path, 'sessions'); if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`); resetVectors(ctx.roleplayState.openSession(sessions, id)) }, decisions: id => decisionsOfSession({ sessionsDir: deps.sessionsDir, service: () => (ctx as Context & { get(name: 'decisions'): DecisionService | undefined }).get('decisions') }, id), notes: id => notesOfSession({ sessionsDir: deps.sessionsDir, open: sessionId => ctx.roleplayState.openSession(deps.sessionsDir(), sessionId) }, id), imageStatus: (id, node) => imagesOf(ctx, deps.sessionsDir, id).status(id, node), generateImage: (id, node) => imagesOf(ctx, deps.sessionsDir, id).generate(id, node), imageFile: async (id, node, serial) => { const images = imagesOf(ctx, deps.sessionsDir, id); await images.status(id, node); const file = sceneImagePath(sessionFolder(deps.sessionsDir(), id), node, serial); return { file, size: (await stat(file)).size } } },
  })
  return { orchestration, authoringTools, roleplayImport }
}

/** The folder of a session whose images are listed. @throws {SessionNotFoundError} when there is no such session. */
function galleryFolder(sessionsDir: string, id: string): string {
  if (!isSessionId(id) || !existsSync(sessionDatabase(sessionsDir, id))) throw new SessionNotFoundError(`there is no session "${id}"`)
  return sessionFolder(sessionsDir, id)
}

function imagesOf(ctx: Context, sessionsDir: () => string, id: string) {
  timelinesOf(ctx, sessionsDir, id)
  const images = ctx.roleplayOrchestration.images
  if (images === undefined) throw new AgentUnavailableError('image authoring is not running')
  return images
}

/** The world with that id, or why there is none. */
async function editableWorld(worlds: WorldCatalog, worldId: string, rootPath: string): Promise<{ id: string; directory: string }> {
  if (worldId === AVATARS_WORLD_ID) return await avatarsWorld(rootPath)
  const world = await worlds.find(worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  return { id: world.summary.id, directory: world.directory }
}

function imageGenerationOf(ctx: Context): ImageGenerationService {
  const service = (ctx as Context & { get(name: 'imageGeneration'): ImageGenerationService | undefined }).get('imageGeneration')
  if (service === undefined) throw new AgentUnavailableError('no image generation provider is selected')
  return service
}

function textToSpeechOf(ctx: Context) {
  const service = (ctx as Context & { get(name: 'textToSpeech'): import('@dsh-ai-providers/core').TtsService | undefined }).get('textToSpeech')
  if (service === undefined) throw new AgentUnavailableError('no text-to-speech provider is selected')
  return service
}

function streamingSpeechToTextOf(ctx: Context): import('@dsh-ai-providers/core').StreamingSttService | undefined {
  return (ctx as Context & { get(name: 'streamingSpeechToText'): import('@dsh-ai-providers/core').StreamingSttService | undefined }).get('streamingSpeechToText')
}

/** The timelines of the sessions, which the orchestration keeps; a profile without it has none. */
function timelinesOf(ctx: Context, sessionsDir: () => string, id: string): Timelines {
  if (!isSessionId(id) || !existsSync(sessionDatabase(sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  const timelines = ctx.roleplayOrchestration.timelines
  if (timelines === undefined) throw new AgentUnavailableError('the story cannot be taken back: the orchestration is not running')
  return timelines
}

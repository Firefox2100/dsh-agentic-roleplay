import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageGenerationService } from 'dsh-ai-core'
// Type-only: declares `ctx.roleplayState`.
import type {} from 'dsh-roleplay-state'
import { AgentSessions, agentServicesOf } from './host/agent/agent-sessions.ts'
import { isPng, pictureOf, readCard } from './host/import/card.ts'
import { childSamplingOf } from './host/agents/child.ts'
import { PromptLibrary } from './host/prompts/library.ts'
import { AuthoringLanguages } from './host/worlds/authoring-language.ts'
import { RoleplayImport } from './host/import/service.ts'
import { startImport } from './host/import/start-import.ts'
import { ImportStore } from './host/import/store.ts'
import { AuthoringSessions } from './host/agent/authoring-sessions.ts'
import { Config } from './host/config.ts'
import { RoleplayOrchestration } from './host/orchestration/service.ts'
import { registerApi } from './host/http/index.ts'
import { deleteSession } from './host/sessions/delete-session.ts'
import { purgeOf } from './host/agent/purge-services.ts'
import { editSessionNarrationVoice, editWorldCharacter as editSessionCharacter, editWorldFaction as editSessionFaction, editWorldLore as editSessionLore, editWorldPlots as editSessionPlots, editWorldPlace as editSessionPlace, editWorldRelation as editSessionRelation, editWorldThing as editSessionThing, generateSessionCharacterPortrait, readWorldState, sessionCharacterPortraitFile } from './host/sessions/world-state.ts'
import { editWorldNarrationVoice, editWorldCharacter as editWorldFileCharacter, editWorldFaction as editWorldFileFaction, editWorldLore as editWorldFileLore, editWorldPlots as editWorldFilePlots, editWorldPlace as editWorldFilePlace, editWorldRelation as editWorldFileRelation, editWorldThing as editWorldFileThing, generateWorldCharacterPortrait, readWorldEditor, worldCharacterPortraitFile } from './host/worlds/world-editor.ts'
import { renameSession } from './host/sessions/rename-session.ts'
import { archiveSession, restoreSession } from './host/sessions/archive-session.ts'
import { readChatSettings, writeChatSettings } from './host/sessions/chat-settings.ts'
import { notesOfSession } from './host/sessions/notes.ts'
import { openSession } from './host/sessions/open-session.ts'
import { listSessions } from './host/sessions/list-sessions.ts'
import { startSession } from './host/sessions/start-session.ts'
import { createWorld } from './host/worlds/create-world.ts'
import { worldCharacters } from './host/sessions/world-characters.ts'
import { RoleplayRoot } from './host/storage/roleplay-root.ts'
import { isSessionId, sessionDatabase, sessionFolder } from 'dsh-roleplay-state'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { chatSessionId } from './shared/chat.ts'
import { SessionNotFoundError } from './host/sessions/errors.ts'
import { AgentUnavailableError } from './host/sessions/errors.ts'
import type { Timelines } from './host/timeline/service.ts'
import { WorldCatalog } from './host/worlds/catalog.ts'
import { WorldNotFoundError } from './host/sessions/errors.ts'
import { sceneImagePath } from './host/images/storage.ts'
import { speakParts, voicesOf } from './host/speech/service.ts'

export { Config } from './host/config.ts'
export type * from './host/orchestration/boundaries.ts'
export type { CharacterAction, CharacterFailure, CharacterReport, Commitment, Outcome, Result } from './host/orchestration/protocol.ts'
export { RoleplayOrchestration } from './host/orchestration/service.ts'
export const name = 'dsh-agentic-roleplay-core'

/** Sessions are kept by the state plugin, which the bundle installs with this one. */
export const inject = ['roleplayState']

/** The slice of the AI providers plugin's registry that sets the controls of model requests. */
interface RequestPolicies {
  policy(policy: (request: { options: { sessionId?: unknown } }) => { temperature?: number; toolChoice?: 'auto' | 'required' } | undefined): () => void
}

export function apply(ctx: Context, config: Config): void {
  // The controls of the helper agents' requests are applied by the model service that serves them, when there is one.
  ctx.inject(['aiProviders' as never], (scope) => {
    const providers = Reflect.get(scope, 'aiProviders') as RequestPolicies
    scope.effect(() => providers.policy(({ options }) => (options.sessionId === undefined ? undefined : childSamplingOf(String(options.sessionId)))), 'roleplay: request controls')
  })
  const root = new RoleplayRoot(ctx, config.rootPath)
  new RoleplayOrchestration(ctx)
  const worlds = new WorldCatalog(ctx, root)
  const prompts = new PromptLibrary(ctx, root)
  prompts.bootstrap()
  const languages = new AuthoringLanguages(ctx, () => join(root.path, 'worlds'))
  const agent = new AgentSessions(agentServicesOf(ctx), () => root.path)
  const authoring = new AuthoringSessions(agentServicesOf(ctx), () => root.path, prompts, languages)
  const imports = new ImportStore(() => root.path)
  new RoleplayImport(ctx, { maxUploadBytes: config.importMaxUploadBytes, concurrency: config.importConcurrency, reasoning: config.importReasoning, maxTokens: config.importMaxTokens, temperature: config.importTemperature })
  const settingsDeps = {
    sessionsDir: () => join(root.path, 'sessions'),
    pendingRecords: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).pendingCommits.list().length,
    clockMode: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).clock.get()?.mode,
    pendingConsolidation: (id: string) => ctx.roleplayState.openSession(join(root.path, 'sessions'), id).consolidation.pending().length,
  }
  const purgeChat = purgeOf(ctx, config.sessionStorePath)
  const deps = { worlds, state: ctx.roleplayState, agent, sessionsDir: () => join(root.path, 'sessions') }
  registerApi(ctx, {
    speech: {
      voices: async () => await voicesOf(textToSpeechOf(ctx)),
      speak: async parts => await speakParts(textToSpeechOf(ctx), parts),
      streaming: () => streamingSpeechToTextOf(ctx) !== undefined,
    },
    worlds,
    createWorld: input => createWorld(worlds, input),
    authorWorld: async (worldId, title, language) => {
      const world = await worlds.find(worldId)
      if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
      return { chatSessionId: await authoring.ensure(world.summary.id, world.summary.name, title, language) }
    },
    importer: {
      maxUploadBytes: config.importMaxUploadBytes,
      upload: async (file, name) => { const card = readCard(file, name); return await imports.create(card, isPng(file) ? pictureOf(file) : undefined) },
      read: id => imports.read(id),
      choose: (id, choices) => imports.choose(id, choices),
      discard: id => imports.discard(id),
      start: (id, choices, language) => startImport({ store: imports, worlds, authoring, chatTitle: name => `Authoring ${name}` }, id, choices, language),
      picture: id => imports.picture(id),
    },
    worldCharacters: worldId => worldCharacters(worlds, worldId),
    worldEditor: {
      read: async worldId => await readWorldEditor(await editableWorld(worlds, worldId)),
      editCharacter: async (worldId, key, edit) => await editWorldFileCharacter(await editableWorld(worlds, worldId), key, edit),
      editPlace: async (worldId, key, edit) => await editWorldFilePlace(await editableWorld(worlds, worldId), key, edit),
      editThing: async (worldId, key, edit) => await editWorldFileThing(await editableWorld(worlds, worldId), key, edit),
      editFaction: async (worldId, key, edit) => await editWorldFileFaction(await editableWorld(worlds, worldId), key, edit),
      editLore: async (worldId, key, edit) => await editWorldFileLore(await editableWorld(worlds, worldId), key, edit),
      editPlots: async (worldId, edit) => await editWorldFilePlots(await editableWorld(worlds, worldId), edit),
      editRelation: async (worldId, edit) => await editWorldFileRelation(await editableWorld(worlds, worldId), edit),
      editNarrationVoice: async (worldId, voice) => await editWorldNarrationVoice(await editableWorld(worlds, worldId), voice),
      generatePortrait: async (worldId, key) => await generateWorldCharacterPortrait(await editableWorld(worlds, worldId), key, imageGenerationOf(ctx)),
      portraitFile: async (worldId, key) => await worldCharacterPortraitFile(await editableWorld(worlds, worldId), key),
    },
    sessions: { list: () => listSessions(deps), start: request => startSession(deps, request), open: id => openSession(deps, id), delete: id => deleteSession({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir, purgeChat }, id), archive: id => archiveSession({ agent, sessionsDir: deps.sessionsDir }, id), restore: id => restoreSession({ agent, sessionsDir: deps.sessionsDir }, id), editCharacter: (id, key, edit) => editSessionCharacter({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editPlace: (id, key, edit) => editSessionPlace({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editThing: (id, key, edit) => editSessionThing({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editFaction: (id, key, edit) => editSessionFaction({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editLore: (id, key, edit) => editSessionLore({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, edit), editPlots: (id, edit) => editSessionPlots({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, edit), editRelation: (id, edit) => editSessionRelation({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, edit), editNarrationVoice: (id, voice) => editSessionNarrationVoice({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, voice), generatePortrait: (id, key) => generateSessionCharacterPortrait({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key, imageGenerationOf(ctx)), portraitFile: (id, key) => sessionCharacterPortraitFile({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id, key), world: id => readWorldState({ state: ctx.roleplayState, sessionsDir: deps.sessionsDir }, id), rename: (id, name) => renameSession({ state: ctx.roleplayState, agent, sessionsDir: deps.sessionsDir }, id, name), readSettings: id => readChatSettings(settingsDeps, id), writeSettings: (id, value) => writeChatSettings(settingsDeps, id, value), timeline: id => timelinesOf(ctx, deps.sessionsDir, id).view(id), moveTimeline: (id, to) => timelinesOf(ctx, deps.sessionsDir, id).move(chatSessionId(id), to === 'start' ? null : to), notes: id => notesOfSession({ sessionsDir: deps.sessionsDir, open: sessionId => ctx.roleplayState.openSession(deps.sessionsDir(), sessionId) }, id), imageStatus: (id, node) => imagesOf(ctx, deps.sessionsDir, id).status(id, node), generateImage: (id, node) => imagesOf(ctx, deps.sessionsDir, id).generate(id, node), imageFile: async (id, node, serial) => { const images = imagesOf(ctx, deps.sessionsDir, id); await images.status(id, node); const file = sceneImagePath(sessionFolder(deps.sessionsDir(), id), node, serial); return { file, size: (await stat(file)).size } } },
  })
}

function imagesOf(ctx: Context, sessionsDir: () => string, id: string) {
  timelinesOf(ctx, sessionsDir, id)
  const images = ctx.roleplayOrchestration.images
  if (images === undefined) throw new AgentUnavailableError('image authoring is not running')
  return images
}

/** The world with that id, or why there is none. */
async function editableWorld(worlds: WorldCatalog, worldId: string): Promise<{ id: string; directory: string }> {
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
  const service = (ctx as Context & { get(name: 'textToSpeech'): import('dsh-ai-core').TtsService | undefined }).get('textToSpeech')
  if (service === undefined) throw new AgentUnavailableError('no text-to-speech provider is selected')
  return service
}

function streamingSpeechToTextOf(ctx: Context): import('dsh-ai-core').StreamingSttService | undefined {
  return (ctx as Context & { get(name: 'streamingSpeechToText'): import('dsh-ai-core').StreamingSttService | undefined }).get('streamingSpeechToText')
}

/** The timelines of the sessions, which the orchestration keeps; a profile without it has none. */
function timelinesOf(ctx: Context, sessionsDir: () => string, id: string): Timelines {
  if (!isSessionId(id) || !existsSync(sessionDatabase(sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  const timelines = ctx.roleplayOrchestration.timelines
  if (timelines === undefined) throw new AgentUnavailableError('the story cannot be taken back: the orchestration is not running')
  return timelines
}

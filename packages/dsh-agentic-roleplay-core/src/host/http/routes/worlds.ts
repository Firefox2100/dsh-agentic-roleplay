import { CommandRefusedError } from '../../commands/registry.ts'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { InvalidEditProblems } from '../../../shared/world-state.ts'
import { AgentUnavailableError, WorldNotFoundError } from '../../sessions/errors.ts'
import { WorldFolderExistsError } from '../../worlds/create-world.ts'
import { UnknownStarterError } from '../../worlds/starter.ts'
import { CheckpointBusyError } from '../../worlds/checkpoint-service.ts'
import { CheckpointError, CheckpointNotFoundError } from '../../worlds/checkpoints.ts'
import { readSource, baseId, rolesOf, SourceCardMissingError } from '../../import/card-tools.ts'
import type { CardView, CardPieceText } from '../../../shared/card-view.ts'
import { readJsonBody } from '../body.ts'
import { parseAuthoringSettings } from '../../../shared/authoring-settings.ts'
import { sendError, sendJson } from '../respond.ts'
import type { ApiDeps } from '../api.ts'
import { type Routes, languageField } from './shared.ts'

/** Answers a failed checkpoint request with the status that says what was wrong. */
function checkpointFailure(res: Parameters<typeof sendError>[0], error: unknown): void {
  if (error instanceof WorldNotFoundError || error instanceof CheckpointNotFoundError) return sendError(res, 404, error.message)
  if (error instanceof CheckpointBusyError) return sendError(res, 409, error.message)
  if (error instanceof CheckpointError) return sendError(res, 422, error.message)
  throw error
}

/** The routes of the API for worlds. */
export function worldsRoutes({ worlds, createWorld, starter, authorWorld, sayToAuthor, authoringStatus, authoringSettings, chatStatus, checkpoints, forgetAuthoring, translation, worldCharacters, avatars, playtest }: ApiDeps): Routes {
  return {
    '/worlds': {
      GET: async (_req, res) => { sendJson(res, 200, await worlds.list()) },
      POST: async (req, res) => { try { const body = await readJsonBody(req) as { folder?: unknown; name?: unknown; preset?: unknown }; if (typeof body.folder !== 'string' || typeof body.name !== 'string') return sendError(res, 400, 'folder and name must be text'); if (body.preset !== undefined && typeof body.preset !== 'string') return sendError(res, 400, 'preset must be text'); sendJson(res, 201, await createWorld({ folder: body.folder, name: body.name, ...(body.preset === undefined ? {} : { preset: body.preset }) })) } catch (error) { if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems }); if (error instanceof WorldFolderExistsError) return sendError(res, 409, error.message); throw error } },
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
    '/authoring/status': {
      GET: async (_req, res, url) => { sendJson(res, 200, chatStatus(url.searchParams.get('chat') ?? '')) },
    },
    '/worlds/authoring/chat': {
      DELETE: async (_req, res, url) => {
        try { await forgetAuthoring(url.searchParams.get('id') ?? ''); sendJson(res, 200, { ok: true }) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/authoring/message': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { text?: unknown; language?: unknown }
        if (typeof body.text !== 'string' || body.text.trim() === '') return sendError(res, 400, 'the request needs the text to say')
        try { sendJson(res, 202, await sayToAuthor(url.searchParams.get('id') ?? '', body.text, languageField(body.language))) }
        catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
          if (error instanceof CommandRefusedError) return sendError(res, 422, error.message)
          throw error
        }
      },
    },
    '/worlds/authoring/status': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await authoringStatus(url.searchParams.get('id') ?? '')) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/authoring/settings': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await authoringSettings.get(url.searchParams.get('id') ?? '')) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
      PUT: async (req, res, url) => {
        let change: ReturnType<typeof parseAuthoringSettings>
        try { change = parseAuthoringSettings(await readJsonBody(req)) } catch (error) {
          if (error instanceof TypeError) return sendError(res, 422, error.message)
          throw error
        }
        try { sendJson(res, 200, await authoringSettings.change(url.searchParams.get('id') ?? '', change)) } catch (error) {
          if (error instanceof WorldNotFoundError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/card': {
      GET: async (_req, res, url) => {
        const record = await worlds.find(url.searchParams.get('id') ?? '')
        if (record === undefined) return sendError(res, 404, 'there is no such world')
        let source: Awaited<ReturnType<typeof readSource>>
        try { source = await readSource(record.directory, true) } catch (error) {
          if (error instanceof SourceCardMissingError) return sendJson(res, 200, { present: false, pieces: [] } satisfies CardView)
          throw error
        }
        const view: CardView = {
          present: true,
          name: source.card.name,
          creator: source.card.creator,
          pieces: source.pieces.map(piece => ({
            id: piece.id,
            label: piece.label,
            title: piece.title,
            keys: piece.keys,
            length: piece.text.length,
            start: piece.text.slice(0, 200),
            used: piece.used,
            ...(piece.enabled === undefined ? {} : { enabled: piece.enabled }),
            roles: rolesOf(source.records.classified, baseId(piece.id)),
          })),
        }
        sendJson(res, 200, view)
      },
    },
    '/worlds/card/piece': {
      GET: async (_req, res, url) => {
        const record = await worlds.find(url.searchParams.get('id') ?? '')
        if (record === undefined) return sendError(res, 404, 'there is no such world')
        const id = url.searchParams.get('piece') ?? ''
        try {
          const piece = (await readSource(record.directory, false)).pieces.find(each => each.id === id)
          if (piece === undefined) return sendError(res, 404, `the card has no piece "${id}"`)
          sendJson(res, 200, { id: piece.id, label: piece.label, text: piece.text } satisfies CardPieceText)
        } catch (error) {
          if (error instanceof SourceCardMissingError) return sendError(res, 404, error.message)
          throw error
        }
      },
    },
    '/worlds/checkpoints': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, { checkpoints: await checkpoints.list(url.searchParams.get('id') ?? '') }) } catch (error) { return checkpointFailure(res, error) }
      },
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { label?: unknown }
        if (body.label !== undefined && typeof body.label !== 'string') return sendError(res, 400, 'label must be text')
        try { sendJson(res, 201, await checkpoints.make(url.searchParams.get('id') ?? '', body.label ?? '')) } catch (error) { return checkpointFailure(res, error) }
      },
    },
    '/worlds/checkpoints/diff': {
      GET: async (_req, res, url) => {
        try { sendJson(res, 200, await checkpoints.diff(url.searchParams.get('id') ?? '', url.searchParams.get('checkpoint') ?? '')) } catch (error) { return checkpointFailure(res, error) }
      },
    },
    '/worlds/checkpoints/restore': {
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { checkpoint?: unknown }
        if (typeof body.checkpoint !== 'string') return sendError(res, 400, 'checkpoint must be text')
        const id = url.searchParams.get('id') ?? ''
        try { sendJson(res, 200, await checkpoints.restore(id, body.checkpoint, (await authoringStatus(id)).running)) } catch (error) { return checkpointFailure(res, error) }
      },
    },
    '/worlds/language': {
      GET: async (_req, res, url) => {
        try { const id = url.searchParams.get('id') ?? ''; sendJson(res, 200, { language: await translation.language(id) ?? null, declared: await translation.declared(id) ?? null }) }
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
    '/worlds/playtest': {
      GET: (_req, res, url) => { sendJson(res, 200, playtest.status(url.searchParams.get('id') ?? '') ?? { state: 'idle' }); return Promise.resolve() },
      POST: async (req, res, url) => {
        const body = await readJsonBody(req) as { turns?: unknown; playerCharacterId?: unknown; opening?: unknown; startingTime?: unknown; language?: unknown }
        if (typeof body.turns !== 'number') return sendError(res, 400, 'turns must be a number')
        if (body.playerCharacterId !== undefined && typeof body.playerCharacterId !== 'string') return sendError(res, 400, 'playerCharacterId must be text')
        if (body.opening !== undefined && typeof body.opening !== 'number') return sendError(res, 400, 'opening must be a number')
        if (body.startingTime !== undefined && typeof body.startingTime !== 'string') return sendError(res, 400, 'startingTime must be text')
        try {
          sendJson(res, 202, playtest.start({ worldId: url.searchParams.get('id') ?? '', turns: body.turns, ...body.playerCharacterId === undefined ? {} : { playerCharacterId: body.playerCharacterId }, ...body.opening === undefined ? {} : { opening: body.opening }, ...body.startingTime === undefined || body.startingTime.trim() === '' ? {} : { startingTime: body.startingTime.trim() }, ...languageField(body.language) === undefined ? {} : { language: languageField(body.language)! } }))
        } catch (error) {
          if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
          throw error
        }
      },
      DELETE: async (_req, res, url) => { await playtest.stop(url.searchParams.get('id') ?? ''); sendJson(res, 200, playtest.status(url.searchParams.get('id') ?? '') ?? { state: 'idle' }) },
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
}

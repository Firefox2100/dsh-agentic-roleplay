import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { cardChanges, diffText, matchPieces, worldFieldChanges } from './card-diff.ts'
import { entitiesByPiece, readSource } from './card-tools.ts'
import { editsSince } from './snapshot.ts'
import { IMPORT_FOLDER } from './store.ts'
import { finishUpdate, pendingUpdate } from './update.ts'

type AgentExec = { agent?: { session: { id: string } }; signal?: AbortSignal }

const MAX_HUNKS = 10
const MAX_PIECES = 60
const PREVIEW_CHARS = 300

/** The world's lore entries by normalised title: an entry the import made from a lorebook entry carries its title, and lore is not in the import's roster. */
async function loreTitles(directory: string): Promise<Map<string, string[]>> {
  const titles = new Map<string, string[]>()
  for (const key of await readdir(join(directory, 'lore')).catch((): string[] => [])) {
    const document = await readFile(join(directory, 'lore', key, 'lore.json'), 'utf8').then(text => JSON.parse(text) as { title?: unknown }, (): undefined => undefined)
    if (typeof document?.title !== 'string') continue
    const title = document.title.normalize('NFKC').trim().toLowerCase()
    titles.set(title, [...(titles.get(title) ?? []), key])
  }
  return titles
}

const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never

/**
 * The tools that bring a world up to date with a newer version of the card it was made from. `card_diff` is the starting point: what the card changed, worked out by code,
 * with the import's records of what each piece made and the files the person has edited since; the assistant then edits with its ordinary tools and asks for those edits like any others.
 */
export function updateTools(worlds: WorldCatalog): ToolDefinition[] {
  const worldOf = async (exec: AgentExec): Promise<string> => {
    const chat = exec.agent?.session.id
    const id = chat === undefined ? undefined : authoredWorldOf(chat)
    if (id === undefined) throw new Error('this tool is available only in a world authoring chat')
    const record = await worlds.find(id)
    if (record === undefined) throw new Error(`the authored world "${id}" no longer exists`)
    return record.directory
  }
  return [
    defineTool({
      name: 'card_diff',
      description: 'What a newer version of the card this world was imported from changes. For each piece (field, greeting, lorebook entry) that changed, was added or was dropped: the sentences that differ, and the characters, places and things the import made from it, which are what may need to change. Also the files of the world that were edited since the import, and what the newer version changes about the card itself. Start here when asked to update the world from its card; read whole pieces with card_read (version current or new).',
      parameters: {},
      output,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const directory = await worldOf(exec)
        const before = await readSource(directory, true, 'current')
        const after = await readSource(directory, false, 'new')
        const match = matchPieces(before.pieces, after.pieces)
        const made = entitiesByPiece(before)
        const piecesOf = new Map<string, Set<string>>()
        for (const [piece, names] of made) for (const name of names) piecesOf.set(name, new Set([...(piecesOf.get(name) ?? []), piece]))
        const lore = await loreTitles(directory)
        const loreOf = (title: string): string[] => lore.get(title.normalize('NFKC').trim().toLowerCase()) ?? []
        const onlyFrom = (piece: string): string[] => (made.get(piece) ?? []).filter(name => piecesOf.get(name)?.size === 1)
        const changed = match.pairs.flatMap(({ before: was, after: now }) => {
          const hunks = diffText(was.text, now.text)
          const other = [
            ...(was.title === now.title ? [] : [`title: “${was.title}” → “${now.title}”`]),
            ...(was.keys.join(', ') === now.keys.join(', ') ? [] : [`keys: ${was.keys.join(', ')} → ${now.keys.join(', ')}`]),
            ...(was.used === now.used ? [] : [now.used ? 'the import read it before not; it is read now' : 'the import read it before; it is left out now']),
          ]
          if (hunks?.length === 0 && other.length === 0) return []
          return [{
            piece: now.id, ...(was.id === now.id ? {} : { wasPiece: was.id }), label: now.label, madeInto: made.get(was.id) ?? [], ...(loreOf(was.title).length === 0 ? {} : { loreWithTheSameTitle: loreOf(was.title) }), characters: { before: was.text.length, after: now.text.length },
            ...(hunks === undefined ? { differences: 'too long to compare here: read both versions with card_read' } : hunks.length === 0 ? {} : { differences: hunks.slice(0, MAX_HUNKS), ...(hunks.length > MAX_HUNKS ? { moreDifferences: hunks.length - MAX_HUNKS } : {}) }),
            ...(other.length === 0 ? {} : { also: other }),
          }]
        })
        const edits = await editsSince(directory)
        return json({
          card: cardChanges(before.card, after.card),
          changed: changed.slice(0, MAX_PIECES),
          ...(changed.length > MAX_PIECES ? { moreChanged: changed.length - MAX_PIECES } : {}),
          added: match.added.slice(0, MAX_PIECES).map(piece => ({ piece: piece.id, version: 'new', label: piece.label, characters: piece.text.length, readByTheImport: piece.used, start: piece.text.slice(0, PREVIEW_CHARS) })),
          dropped: match.removed.slice(0, MAX_PIECES).map(piece => ({ piece: piece.id, version: 'current', label: piece.label, wasReadByTheImport: piece.used, madeInto: made.get(piece.id) ?? [], madeOnlyFromIt: onlyFrom(piece.id), ...(loreOf(piece.title).length === 0 ? {} : { loreWithTheSameTitle: loreOf(piece.title) }) })),
          aboutTheWorld: worldFieldChanges(before, after),
          unchanged: match.pairs.length - changed.length,
          editedSinceTheImport: edits.edited === 'unknown' ? 'unknown: the import left no record of the files, so tell what you find in them before you change anything' : edits.edited === 'no' ? 'no' : edits.changes,
          note: 'Piece ids of changed pieces are those of the new card (wasPiece is the old id when it moved); an added piece is read with version new and a dropped one with version current, because the same id can name different pieces in the two cards. The import\'s records say what each old piece made; they can be wrong, so read the piece. A new piece has no record: decide from its text what it adds. A dropped piece: what was made only from it (madeOnlyFromIt) is what the new card no longer has; remove it with delete_world_element (the person is asked, and the folder goes to .trash) unless the person edited its file since the import (editedSinceTheImport) or something else in the world still needs it, and then keep it and say so. A lore entry with the dropped piece\'s title (loreWithTheSameTitle) was made from it; remove it too, and the knowledge of it that characters have. What a dropped piece made together with other pieces stays. aboutTheWorld lists what the card changed in what the world says about itself: read get_world_info and carry each over with edit_world_info (the description is a short summary of the world, a few sentences; tags are a few short words; opening is the greeting the world opens with; alternateOpenings are the card\'s other greetings), keeping what the person wrote when the card did not change that part.',
        })
      },
    }),
    defineTool({
      name: 'card_update_finish',
      description: `Makes the newer card the card this world was made from, once the world has been brought up to date with it: the old card is kept in ${IMPORT_FOLDER}/previous, and what the world holds now is what later edits are measured against. Run it after your edits, and only then.`,
      parameters: {},
      output,
      async execute(_args, exec) {
        const directory = await worldOf(exec)
        const outcome = await finishUpdate(directory, exec.signal === undefined ? {} : { signal: exec.signal })
        return json({ done: true, card: `${IMPORT_FOLDER}/card.json`, previous: join(IMPORT_FOLDER, 'previous'), forgottenRecords: outcome.forgotten, pictures: outcome.pictures, ...(outcome.pictures.droppedFromTheCard.length === 0 ? {} : { picturesTheCardNoLongerPointsTo: 'These pictures in the image library came from addresses the newer card no longer has. They were left in the library; name them to the person in your report and do not delete them.' }), portrait: outcome.portrait, ...(outcome.aboutTheWorld.length === 0 ? {} : { worldInfoToCheck: outcome.aboutTheWorld, instruction: 'The card changed these things about the world itself. If you did not already carry each over with edit_world_info, do it now (or say in your report that you left it, and why). Report only what you actually changed.' }) })
      },
    }),
  ]
}

/** How many times an update turn that stopped before the update was finished is sent back to it. */
const MAX_NUDGES = 1

/** The words of the message that starts an update, whatever the language it speaks. */
const isUpdateRequest = (text: string): boolean => text.includes('card_diff') && text.includes('card_update_finish')

/**
 * An update turn that stops with the update still waiting is sent back once: models end such a turn on a change they found no place for, and the person then has neither the
 * rest of the update nor a report. A turn that stops again is let go, so a question to the person can still end it.
 */
export function updateHooks(ctx: Context, worlds: WorldCatalog, languageOf: (world: string) => string | undefined): void {
  const updating = new Map<string, number>()
  const nudges = new Map<string, number>()
  const authoring = (agent: Agent): { chat: string; world: string } | undefined => {
    const world = agent.session.header.origin === 'subagent' ? undefined : authoredWorldOf(agent.session.id)
    return world === undefined ? undefined : { chat: agent.session.id, world }
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const here = authoring(payload.agent)
    if (decision.kind !== 'enter' || payload.step !== 1 || here === undefined) return decision
    const text = payload.messages.filter(message => message.source.kind === 'user').flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))).join('\n')
    if (isUpdateRequest(text)) { updating.set(here.chat, payload.turn); nudges.delete(here.chat) } else updating.delete(here.chat)
    return decision
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    const here = authoring(agent)
    if (here === undefined || updating.get(here.chat) !== turn) return
    const record = await worlds.find(here.world)
    if (record === undefined || !await pendingUpdate(record.directory)) { updating.delete(here.chat); return }
    const told = nudges.get(here.chat) ?? 0
    if (told >= MAX_NUDGES) { updating.delete(here.chat); return }
    nudges.set(here.chat, told + 1)
    const tr = translator(storyLanguageOf(languageOf(here.world)))
    agent.steer(createUserMessage({ content: [{ type: 'text', text: tr('The update from the newer card is not finished. Apply the changes that remain and call card_update_finish. A change you cannot make with your tools, or one you need the person to decide, goes in your report instead; then say what is left.') }], source: { kind: 'roleplay' } }))
  })
}

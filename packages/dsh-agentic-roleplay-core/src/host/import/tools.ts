import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { parseImportCommand } from '../../shared/import-card.ts'
import { runChild } from '../agents/child.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { IMPORT_FOLDER } from './store.ts'
import type { ImportContext, RunJob, TextOf } from './run.ts'
import { build, endReview, finish, importPhase, survey, type Phase } from './run-import.ts'
import type { ImportSettings } from './service.ts'

export const SURVEY_TOOL = 'import_survey'
export const BUILD_TOOL = 'import_build'
export const FINISH_TOOL = 'import_finish'

/** How many times a turn that has not finished the import is sent back to it. */
const MAX_OBJECTIONS = 3
/** A model call that fails is made once more before the piece it was for is given up. */
const ATTEMPTS = 2

const CARD = `${IMPORT_FOLDER}/card.json`
const cardParameter = { type: 'string' as const, required: true as const, description: `The card to import: the path that follows /import-st in the person's message (${CARD}).` }

/** A model that is asked for a tool with nothing to fill in tends to write its name as text instead of calling it: naming the card gives it something to say. */
function checkedCard(args: { card: string }): void {
  if (args.card.trim() !== CARD) throw new Error(`the card to import is ${CARD}`)
}

const output = (render: (value: never) => string) => ({ schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: render(value as never) }] })
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never

/** The runner of an import: every job is a narrow agent below the chat's own, on the chat's model. */
export function contextOf(exec: ToolExecution, settings: ImportSettings, text: TextOf): ImportContext {
  const agent = exec.agent
  if (agent === undefined) throw new Error('the import tools can only be called by an agent')
  const run: RunJob = async (job) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runChild({
          parent: agent, signal: exec.signal, persona: job.persona, prompt: job.prompt, result: job.result as never,
          ...(job.check === undefined ? {} : { beforeSubmit: (value: unknown) => job.check?.(value as never) }),
          maxTokens: settings.maxTokens,
          sampling: { temperature: settings.temperature, toolChoice: 'required' },
          ...(settings.reasoning === '' ? {} : { reasoningEffort: settings.reasoning }),
        }) as never
      } catch (error) {
        if (exec.signal.aborted || attempt >= ATTEMPTS) throw error
      }
    }
  }
  return { run, concurrency: settings.concurrency, text, say: () => undefined }
}

export async function worldOf(worlds: WorldCatalog, exec: ToolExecution): Promise<{ id: string; directory: string }> {
  const chat = exec.agent?.session.id
  const worldId = chat === undefined ? undefined : authoredWorldOf(chat)
  if (worldId === undefined) throw new Error('the import tools are available only in a world authoring chat')
  const record = await worlds.find(worldId)
  if (record === undefined) throw new Error(`the authored world "${worldId}" no longer exists`)
  return { id: worldId, directory: record.directory }
}

/** What each step is given besides its tools: the language of the world's authoring, and the texts in it. */
export interface Prompting { prompts: () => PromptLibrary; languages: () => AuthoringLanguages }

const toolNames = { survey: SURVEY_TOOL, build: BUILD_TOOL, finish: FINISH_TOOL }

/** The three steps of an import, as tools of the authoring chat. They do their work in agents of their own, one narrow job each. */
export function importTools(worlds: WorldCatalog, settings: () => ImportSettings, prompting: Prompting): ToolDefinition[] {
  /** Runs one step for the world of the calling chat; what the model should do next is told in the result, in the person's language. */
  const step = async (exec: ToolExecution, work: (ctx: ImportContext, directory: string) => Promise<object>, next: (text: TextOf, result: object) => string): Promise<never> => {
    const world = await worldOf(worlds, exec)
    const language = prompting.languages().get(world.id)
    const text: TextOf = (id, variables) => prompting.prompts().text(id, language, { ...toolNames, ...variables })
    const result = await work(contextOf(exec, settings(), text), world.directory)
    return json({ ...result, next: next(text, result) })
  }
  return [
    defineTool({
      name: SURVEY_TOOL,
      description: 'Step 1 of importing a character card into this world: read every piece of the card, say what each is (character, place, background, instruction…), and list who and what the world is made of. Takes a few minutes. Only in an import turn.',
      parameters: { card: cardParameter },
      output: output(value => JSON.stringify(value, null, 1)),
      isConcurrencySafe: () => false,
      async execute(args, exec) { checkedCard(args); return await step(exec, survey, text => text('import/next-survey')) },
    }),
    defineTool({
      name: BUILD_TOOL,
      description: 'Step 2 of importing a character card: write every character, place, organisation, object and background entry from the pieces of the card that are about it. Takes several minutes. Run after the survey.',
      parameters: { card: cardParameter },
      output: output(value => JSON.stringify(value, null, 1)),
      isConcurrencySafe: () => false,
      async execute(args, exec) { checkedCard(args); return await step(exec, build, text => text('import/next-build')) },
    }),
    defineTool({
      name: FINISH_TOOL,
      description: 'Step 3 of importing a character card: check that the whole world would start, write it into the world together with its description, tags, opening and cover, and report what was imported. Nothing is written when the world would not start; the problems are returned. Run after the build.',
      parameters: { card: cardParameter },
      output: output(value => JSON.stringify(value, null, 1)),
      isConcurrencySafe: () => false,
      async execute(args, exec) { checkedCard(args); return await step(exec, finish, (text, result) => text((result as { ok: boolean }).ok ? 'import/finish-ok' : 'import/finish-failed')) },
    }),
  ]
}

/** The procedure of an import turn, told to the chat in place of what it does for any other message. */
export function importNotice(phase: Phase | undefined, text: TextOf): string {
  if (phase === undefined) return text('import/notice-missing')
  return text('import/notice', { card: CARD, phase, done: phase === 'done' ? text('import/notice-done') : '' })
}

/** Hears the `/import-st` command in an authoring chat, makes that turn an import turn, and does not let it end before the import is done. */
export function importHooks(ctx: Context, worlds: WorldCatalog, prompting: Prompting): void {
  const textFor = (worldId: string | undefined): TextOf => (id, variables) => prompting.prompts().text(id, worldId === undefined ? undefined : prompting.languages().get(worldId), { ...toolNames, ...variables })
  const imports = new Map<string, number>()
  const objections = new Map<string, number>()
  const authoring = (agent: Agent): string | undefined => (agent.session.header.origin === 'subagent' || authoredWorldOf(agent.session.id) === undefined ? undefined : agent.session.id)

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const chat = authoring(payload.agent)
    if (decision.kind !== 'enter' || payload.step !== 1 || chat === undefined) return decision
    const text = payload.messages.filter(message => message.source.kind === 'user').flatMap(message => message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))).join('\n')
    if (parseImportCommand(text) === undefined) return decision
    const worldId = authoredWorldOf(chat)
    const record = worldId === undefined ? undefined : await worlds.find(worldId)
    const phase = record === undefined ? undefined : await importPhase(record.directory)
    if (phase !== undefined && phase !== 'done') { imports.set(chat, payload.turn); objections.delete(chat) }
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: importNotice(phase, textFor(worldId)) }], source: { kind: 'roleplay' } })] }
  })

  // The turn that imported the card may correct the world; when it is over the world is an ordinary one.
  ctx.on('session/event', async (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent') return
    const worldId = authoredWorldOf(session.id)
    const record = worldId === undefined ? undefined : await worlds.find(worldId)
    if (record !== undefined) await endReview(record.directory)
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    const chat = authoring(agent)
    if (chat === undefined || imports.get(chat) !== turn) return
    const worldId = authoredWorldOf(chat)
    const record = worldId === undefined ? undefined : await worlds.find(worldId)
    const phase = record === undefined ? undefined : await importPhase(record.directory)
    if (phase === undefined || phase === 'done') { imports.delete(chat); return }
    const told = objections.get(chat) ?? 0
    if (told >= MAX_OBJECTIONS) { imports.delete(chat); return }
    objections.set(chat, told + 1)
    const next = phase === 'ready' ? SURVEY_TOOL : phase === 'surveyed' ? BUILD_TOOL : FINISH_TOOL
    agent.steer(createUserMessage({ content: [{ type: 'text', text: textFor(worldId)('import/steer', { phase, next, card: CARD }) }], source: { kind: 'roleplay' } }))
  })
}

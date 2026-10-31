import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { parseImportCommand } from '../../shared/import-card.ts'
import type { DecisionService } from '@dsh-ai-providers/core'
import { currentTurn } from '../orchestration/current-turn.ts'
import { ChildTimeoutError, namedModel, runChild } from '../agents/child.ts'
import { askYesNo } from '../decisions/route.ts'
import type { Embedder } from '../memory/embedding-index.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { IMPORT_FOLDER } from './store.ts'
import { NoEmbeddingService, type ImportContext, type RunJob, type TextOf } from './run.ts'
import { build, endReview, finish, importPhase, isReviewing, settleDraft, startRepair, survey, type Phase } from './run-import.ts'
import { checkWorld } from '../worlds/world-check.ts'
import type { ImportSettings } from './service.ts'
import { outputCeiling } from './output-ceiling.ts'

export const SURVEY_TOOL = 'import_survey'
export const BUILD_TOOL = 'import_build'
export const FINISH_TOOL = 'import_finish'

/** How many times a turn that has not finished the import is sent back to it. */
const MAX_OBJECTIONS = 3
/** How often a turn that left the world unable to start is sent back to mend it: each round can show a part of the world that was hidden behind the last one. */
const MAX_REPAIRS = 5
/** The build is the slow step (minutes, one agent per entity); a turn that needs it more often than this is not converging on a card that will finish. */
const MAX_BUILDS_PER_TURN = 2
/** A model call that fails is made once more before the piece it was for is given up. */
const ATTEMPTS = 2

/** Room added to every job's own budget: the model often writes out its analysis before the answer, and a budget that fits the answer alone is used up before the answer is given (found live: a job of 4000 tokens failed three of four times, and none at 12000). The setting stays the ceiling. */
const ANALYSIS_TOKENS = 6000

const CARD = `${IMPORT_FOLDER}/card.json`
const cardParameter = { type: 'string' as const, required: true as const, description: `The card to import: the path that follows /import-st in the person's message (${CARD}).` }

/** A model that is asked for a tool with nothing to fill in tends to write its name as text instead of calling it: naming the card gives it something to say. */
function checkedCard(args: { card: string }): void {
  if (args.card.trim() !== CARD) throw new Error(`the card to import is ${CARD}`)
}

const output = (render: (value: never) => string) => ({ schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: render(value as never) }] })
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never

/** What an endpoint says when it will not take `response_format` with a JSON schema. */
const SCHEMA_REFUSED = /response_format|json_schema|Extra inputs are not permitted|unknown (?:field|parameter)/i
/** The models (`provider/model`) found not to take a JSON schema: they are asked for their result by a tool call. */
const refusesSchema = new Set<string>()

/** The model a helper runs on, as `provider/model`: the one named in the settings, else the chat's own. */
function modelKeyOf(agent: ToolExecution['agent'], named: { provider: string; model: string } | undefined): string {
  const config = agent?.session.requestHeader()?.config
  const model = named ?? (config?.provider === undefined || config.model === undefined ? undefined : { provider: config.provider, model: config.model })
  return model === undefined ? '' : `${model.provider}/${model.model}`
}

/** The runner of an import: every job is a narrow agent below the chat's own, on the chat's model. */
export function contextOf(exec: ToolExecution, settings: ImportSettings, text: TextOf, language?: string): ImportContext {
  const agent = exec.agent
  if (agent === undefined) throw new Error('the import tools can only be called by an agent')
  const run: RunJob = async (job) => {
    for (let attempt = 1; ; attempt += 1) {
      const named = namedModel(settings.model)
      const model = modelKeyOf(agent, named.model)
      const structured = settings.structured === 'schema' && !refusesSchema.has(model)
      try {
        const ceiling = await outputCeiling(settings.maxTokens, agent, named.model, exec.signal)
        return await runChild({
          parent: agent, signal: exec.signal, persona: job.persona, prompt: job.prompt, result: job.result as never,
          ...(job.check === undefined ? {} : { beforeSubmit: (value: unknown) => job.check?.(value as never) }),
          maxTokens: Math.min((job.maxTokens ?? ceiling) + ANALYSIS_TOKENS, ceiling), timeoutMinutes: settings.timeoutMinutes, ...named,
          ...(structured ? { structured: true } : {}),
          sampling: { temperature: settings.temperature, toolChoice: 'required' },
          ...(settings.reasoning === '' ? {} : { reasoningEffort: settings.reasoning }),
        }) as never
      } catch (error) {
        // an endpoint that does not take a JSON schema is asked the old way from now on, and the run is not counted as an attempt
        if (structured && !exec.signal.aborted && SCHEMA_REFUSED.test(error instanceof Error ? error.message : '')) { refusesSchema.add(model); attempt -= 1; continue }
        // a run that used up its time would use it up again
        if (exec.signal.aborted || attempt >= ATTEMPTS || error instanceof ChildTimeoutError) throw error
      }
    }
  }
  // chosen but missing, the service fails each question, so the survey says why every piece went to the language model
  const decide: ImportContext['decide'] | undefined = settings.decisions === 'decision' ? (state, asks) => {
    const service = (agent.ctx as unknown as { get(name: 'decisions'): DecisionService | undefined }).get('decisions')
    if (service === undefined) return Promise.reject(new Error('no decision service is selected, or the selected one is not loaded'))
    return askYesNo(service, state, asks, exec.signal)
  } : undefined
  const embed: ImportContext['embed'] = async (texts) => {
    const service = (agent.ctx as unknown as { get(name: 'embeddings'): Embedder | undefined }).get('embeddings')
    if (service === undefined) throw new NoEmbeddingService('no embedding provider is selected, or the selected one is not loaded')
    const { vectors, model } = await service.embed(texts, { inputType: 'document', signal: exec.signal })
    return { vectors, model }
  }
  return { run, embed, cancelled: () => exec.signal.aborted, concurrency: settings.concurrency, variablesPerRequest: settings.variablesPerRequest, text, ...(language === undefined ? {} : { language }), say: () => undefined, ...(decide === undefined ? {} : { decide, confidence: settings.confidence }) }
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
  const builds = new Map<string, { turn: number; count: number }>()
  /** Runs one step for the world of the calling chat; what the model should do next is told in the result, in the person's language. */
  const step = async (exec: ToolExecution, work: (ctx: ImportContext, directory: string) => Promise<object>, next: (text: TextOf, result: object) => string): Promise<never> => {
    const world = await worldOf(worlds, exec)
    const language = prompting.languages().get(world.id)
    const text: TextOf = (id, variables) => prompting.prompts().text(id, language, { ...toolNames, ...variables })
    const result = await work(contextOf(exec, settings(), text, language), world.directory)
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
      async execute(args, exec) {
        checkedCard(args)
        const chat = exec.agent?.session.id ?? ''
        const turn = exec.agent === undefined ? 0 : currentTurn(exec.agent)
        const seen = builds.get(chat)
        const count = seen?.turn === turn ? seen.count + 1 : 1
        if (count > MAX_BUILDS_PER_TURN) throw new Error(`the build has already run ${MAX_BUILDS_PER_TURN} times in this turn: do not run it again, tell the person what is wrong and stop`)
        builds.set(chat, { turn, count })
        return await step(exec, build, text => text('import/next-build'))
      },
    }),
    defineTool({
      name: FINISH_TOOL,
      description: 'Step 3 of importing a character card: write the world together with its description, tags, opening and cover, check whether a story can start from it, and report what was imported. A world that still has problems is kept as a repairable draft. Run after the build.',
      parameters: { card: cardParameter },
      output: output(value => JSON.stringify(value, null, 1)),
      isConcurrencySafe: () => false,
      async execute(args, exec) { checkedCard(args); return await step(exec, finish, (text, result) => text((result as { ok: boolean; draft?: unknown }).ok ? ((result as { draft?: unknown }).draft === undefined ? 'import/finish-ok' : 'import/finish-draft') : 'import/finish-failed')) },
    }),
  ]
}

/** The procedure of an import turn, told to the chat in place of what it does for any other message. */
export function importNotice(phase: Phase | undefined, text: TextOf): string {
  if (phase === undefined) return text('import/notice-missing')
  if (phase === 'repair') return text('import/notice-repair')
  return text('import/notice', { card: CARD, phase, done: phase === 'done' ? text('import/notice-done') : '' })
}

/** Hears the `/import-st` command in an authoring chat, makes that turn an import turn, and does not let it end before the import is done. */
export function importHooks(ctx: Context, worlds: WorldCatalog, prompting: Prompting): void {
  const textFor = (worldId: string | undefined): TextOf => (id, variables) => prompting.prompts().text(id, worldId === undefined ? undefined : prompting.languages().get(worldId), { ...toolNames, ...variables })
  const imports = new Map<string, number>()
  const objections = new Map<string, number>()
  const repairs = new Map<string, number>()
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
    if (phase !== undefined && phase !== 'done') { imports.set(chat, payload.turn); objections.delete(chat); repairs.delete(chat) }
    if (phase === 'repair' && record !== undefined) await startRepair(record.directory)
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: importNotice(phase, textFor(worldId)) }], source: { kind: 'roleplay' } })] }
  })

  // The turn that imported the card may correct the world; when it is over the world is an ordinary one.
  ctx.on('session/event', async (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent') return
    const worldId = authoredWorldOf(session.id)
    const record = worldId === undefined ? undefined : await worlds.find(worldId)
    if (record === undefined) return
    await endReview(record.directory)
    await settleDraft(record.directory)
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    const chat = authoring(agent)
    if (chat === undefined || imports.get(chat) !== turn) return
    const worldId = authoredWorldOf(chat)
    const record = worldId === undefined ? undefined : await worlds.find(worldId)
    const phase = record === undefined ? undefined : await importPhase(record.directory)
    if (record !== undefined && (phase === 'repair' || (phase === 'done' && await isReviewing(record.directory)))) {
      // the import is written; what the turn changed after it must still leave a world a story can start from, or the assistant is sent back to mend it
      const check = await checkWorld({ directory: record.directory, summary: { name: record.summary.name } as never })
      const mended = repairs.get(chat) ?? 0
      if (check.ok || mended >= MAX_REPAIRS) { imports.delete(chat); repairs.delete(chat); return }
      repairs.set(chat, mended + 1)
      agent.steer(createUserMessage({ content: [{ type: 'text', text: textFor(worldId)('import/repair-again', { problems: check.problems.map(problem => `- ${problem.where}: ${problem.message}`).join('\n') + (check.more > 0 ? `\n(and ${check.more} more)` : '') }) }], source: { kind: 'roleplay' } }))
      return
    }
    if (phase === undefined || phase === 'done') { imports.delete(chat); return }
    const told = objections.get(chat) ?? 0
    if (told >= MAX_OBJECTIONS) { imports.delete(chat); return }
    objections.set(chat, told + 1)
    const next = phase === 'ready' ? SURVEY_TOOL : phase === 'surveyed' ? BUILD_TOOL : FINISH_TOOL
    agent.steer(createUserMessage({ content: [{ type: 'text', text: textFor(worldId)('import/steer', { phase, next, card: CARD }) }], source: { kind: 'roleplay' } }))
  })
}

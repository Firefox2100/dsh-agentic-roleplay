import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { worldOf } from '../import/tools.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import type { WorldCheckpoints } from '../worlds/checkpoint-service.ts'
import { AUTHORING_MUTATION_TOOLS } from './write-tools.ts'
import { currentTurn } from '../orchestration/current-turn.ts'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'

const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never
const checkpointParameter = { type: 'string' as const, required: true as const, description: 'A checkpoint id from list_world_checkpoints.' }

/**
 * Read-only access to the checkpoints of the world being authored: when each was made, what has changed in the world since, and a file as the checkpoint has it. Putting a file back is
 * done with the ordinary editing tools from what is read here; restoring the whole world is the person's.
 */
export function checkpointTools(worlds: WorldCatalog, checkpoints: () => WorldCheckpoints): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_world_checkpoints',
      description: 'The checkpoints of this world, newest first: a copy of its files taken before the edits of a turn, or on the person\'s request. Use one to see what a turn changed or to take back part of it.',
      parameters: {},
      output,
      isConcurrencySafe: () => true,
      async execute(_args, exec) { return json({ checkpoints: await checkpoints().list((await worldOf(worlds, exec)).id) }) },
    }),
    defineTool({
      name: 'diff_world_checkpoint',
      description: 'Which files of the world differ from a checkpoint: changed, added since and removed since. Paths only; read a file with read_world_checkpoint_file.',
      parameters: { checkpoint: checkpointParameter },
      output,
      isConcurrencySafe: () => true,
      async execute(args, exec) { return json(await checkpoints().diff((await worldOf(worlds, exec)).id, args.checkpoint)) },
    }),
    defineTool({
      name: 'read_world_checkpoint_file',
      description: 'One file of the world as a checkpoint has it (a path from diff_world_checkpoint, such as characters/<id>/character.json). Long files are cut and say so. To take a change back, write what you read here with the editing tools.',
      parameters: { checkpoint: checkpointParameter, path: { type: 'string', required: true, description: 'The file\'s path in the world.' } },
      output,
      isConcurrencySafe: () => true,
      async execute(args, exec) { return json(await checkpoints().read((await worldOf(worlds, exec)).id, args.checkpoint, args.path)) },
    }),
  ]
}

/** A checkpoint at the first edit of each authoring turn, and a word to the chat when the person restored the world since it last looked. */
export function checkpointHooks(ctx: Context, checkpoints: () => WorldCheckpoints, languageOf: (chat: string) => string | undefined): void {  ctx.on('tools/pre-execute', async (exec, next) => {
    if (AUTHORING_MUTATION_TOOLS.has(exec.name) && exec.agent !== undefined && authoredWorldOf(exec.agent.session.id) !== undefined && exec.agent.session.header.origin !== 'subagent') {
      await checkpoints().beforeEdit(exec.agent.session.id, currentTurn(exec.agent), exec.name)
    }
    return await next()
  }, { prepend: true })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1 || payload.agent.session.header.origin === 'subagent') return decision
    const restored = await checkpoints().unannouncedRestore(payload.agent.session.id)
    if (restored === undefined) return decision
    const tr = translator(storyLanguageOf(languageOf(payload.agent.session.id)))
    const text = tr('The person restored this world to the checkpoint "{label}" ({at}): every file is as it was then, and what you edited since is gone. Read the world again before you edit, and do not rely on what you remember of it.', restored)
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'roleplay' } })] }
  })
}

/** The checkpoint tools and hooks, registered on the scope of the preset that authors a world. */
export function registerCheckpointTools(ctx: Context): void {
  for (const tool of checkpointTools(ctx.roleplayWorlds, () => ctx.roleplayCheckpoints)) ctx.tools.register(tool)
  checkpointHooks(ctx, () => ctx.roleplayCheckpoints, chat => {
    const world = authoredWorldOf(chat)
    return world === undefined ? undefined : ctx.roleplayAuthoringLanguages.get(world)
  })
}

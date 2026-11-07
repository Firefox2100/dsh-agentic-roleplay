import type { Agent } from '@deepseek-ai/dsh-agent'
import { createCharacterTools, type Recalled } from '@dsh-agentic-roleplay/state'
import type { ObjectJsonSchema, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MAX_TRACE_MISSING } from '../../shared/trace.ts'
import { MAX_RUN_RECALLED, type RunRecall } from '../../shared/activity.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { externalGiven } from '../tools/external.ts'
import { toolEnabled } from '../../shared/tools.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { MAX_OOC_ANSWER } from '../../shared/ooc.ts'
import { languageOf, translator } from 'dsh-roleplay-model'
import { wrongLanguage } from '../translate/language.ts'
import { sameWords } from './defaults.ts'
import type { Boundaries, TurnStore } from './boundaries.ts'
import { AWAY_ACTION_SCHEMA, CHARACTER_ACTION_SCHEMA, answerEstimate, parseCharacterAction } from './protocol.ts'
import type { RunAnswer, RunCharacter } from './turn-engine.ts'

/**
 * Runs each character as a one-shot child of the game master. It is the character and nothing
 * else: it knows what its brief gives it, and its only tool (when the chat allows it) reaches
 * the memory of that character alone, so characters acting at the same time cannot see each
 * other's memories.
 */
export function characterRunner(deps: { parent: Agent; boundaries: () => Boundaries; store: TurnStore }): RunCharacter {
  return async (request, signal) => {
    const brief = deps.boundaries().characterContext.brief(request)
    const settings = deps.store.settings()
    const tools = settings.memory.lookup
      ? createCharacterTools(() => ({ session: deps.store.story, turn: request.turn, policy: settings.memory, queryVector: deps.store.queryVector }), request.member.character.id).filter(tool => toolEnabled(settings.tools, 'characters', tool.name)).map(tool => notingEmpty(tool, deps.store, request.turn, request.member.character.name))
      : []
    const background = (request.knowledge?.lore.length ?? 0) > 0 && tools.some(tool => tool.name === 'recall_my_lore')
    const external = externalGiven(deps.parent.ctx.tools, settings.tools, 'characters')
    const named = request.member.character.tier === 'background' && settings.models.background.trim() !== '' ? settings.models.background : settings.models.characters
    const result = await runChild({ parent: deps.parent, signal, sampling: childSampling(settings, 'characters', answerEstimate(settings.prompts.language, request.away === true)), ...childModel(settings, 'characters', named), trace: childTrace(deps.store, 'characters', request.member.character.name, recalledOf(request), named, request.away === true ? 'off stage' : undefined), reasoningEffort: deps.store.settings().reasoning.children, persona: brief.persona, prompt: brief.prompt, tools, external, maxCalls: deps.store.settings().memory.lookupCalls + (external.length === 0 ? 0 : EXTERNAL_CALLS), result: request.away === true ? AWAY_ACTION_SCHEMA : CHARACTER_ACTION_SCHEMA, unenforced: ['thought'], beforeSubmit: submitGate(settings.prompts.language, background, request.away === true ? [] : ownLines(deps.store, request.member.character)) })
    return parseCharacterAction(result)
  }
}

/** A look-up that finds nothing is kept in the turn's trace: it is where the world lacks what a character reached for. */
export function notingEmpty<T extends ToolDefinition>(tool: T, store: TurnStore, turn: number, character: string): T {
  return {
    ...tool,
    async execute(args: never, exec: never) {
      const found = await (tool.execute as (args: never, exec: never) => Promise<unknown>)(args, exec)
      const about = (args as { about?: unknown }).about
      if (Array.isArray(found) && found.length === 0 && typeof about === 'string' && about.trim() !== '') {
        try { store.recordTrace?.(turn, {}, current => ({ missing: [...(current.missing ?? []), { character, tool: tool.name, about: about.trim().slice(0, 120) }].slice(-MAX_TRACE_MISSING) })) } catch { /* the trace only describes the turn */ }
      }
      return found
    },
  }
}

export const BACKGROUND_CHECK = 'before you answer: does this moment touch your own past, skills, training, secrets or what you know of a person or place? If it does, read that background first with recall_my_lore (about: the subject) and answer from it; if it does not, submit the same answer again unchanged'

/** The model decides whether the moment touches its background; asking once at the point of answering is what makes it decide. */
export function submitGate(language: string, background: boolean, said: readonly string[] = []): (value: unknown) => string | undefined {
  let asked = !background
  let reminded = false
  const tr = translator(languageOf(language))
  return value => {
    if (!asked) { asked = true; return BACKGROUND_CHECK }
    const wrong = spokenIn(language, value)
    if (wrong !== undefined) return wrong
    // once: a character that insists on the same words is let be (found live: a greeting word for word three turns after it was first said)
    const line = (value as { utterance?: string }).utterance
    if (!reminded && line !== undefined && said.some(earlier => sameWords(earlier, line))) {
      reminded = true
      return tr('you already said exactly this earlier in the story: "{line}". Say something new that answers this moment, or give no utterance', { line })
    }
    return undefined
  }
}

/** What a character has said in the story so far, most recent last, as the records keep it. */
export function ownLines(store: TurnStore, character: { id: number; name: string }): string[] {
  const opening = `${character.name}: "`
  return store.story.events.list({ involving: character.id as never }).flatMap(event => (event.text.startsWith(opening) && event.text.endsWith('"') ? [event.text.slice(opening.length, -1)] : [])).slice(-12)
}

/** What a character that was given tools of other plugins may call on top of its memory look-ups. */
const EXTERNAL_CALLS = 5

/** A character whose sheet is in another language than the chat's writes in the sheet's: the answer is refused until it is in the chat's. */
function spokenIn(language: string, value: unknown): string | undefined {
  const given = value as { thought?: string; intent?: string; utterance?: string; account?: string }
  return wrongLanguage(language, { thought: given.thought, intent: given.intent, utterance: given.utterance, account: given.account }, { strays: true }) ?? narratedSpeech(given.utterance)
}

const CLOSING_QUOTE: Readonly<Record<string, string>> = { '"': '"', '“': '”', '「': '」', '『': '』' }

function outsideQuotedSpeech(utterance: string): string[] {
  const parts: string[] = []
  let outside = 0
  let cursor = 0
  while (cursor < utterance.length) {
    const closing = CLOSING_QUOTE[utterance[cursor]!]
    if (closing === undefined) { cursor += 1; continue }
    const end = utterance.indexOf(closing, cursor + 1)
    if (end < 0) { cursor += 1; continue }
    parts.push(utterance.slice(outside, cursor))
    outside = end + 1
    cursor = outside
  }
  parts.push(utterance.slice(outside))
  return parts
}

/** Writing instructions that ask for prose from the character's own point of view lead it to put its actions between its lines; the utterance is only what is said aloud. */
export function narratedSpeech(utterance: string | undefined): string | undefined {
  if (utterance === undefined) return undefined
  const parts = outsideQuotedSpeech(utterance)
  const spans = parts.length - 1
  if (spans < 2) return undefined
  const between = parts.slice(1, -1).some(part => part.replace(/[\s\p{P}]/gu, '').length >= 6)
  return between ? 'the utterance holds more than the words said aloud: put what you do in intent and write in the utterance only what you say, with nothing between your lines' : undefined
}

/** What the character was reminded of and why, for the run's record, when the recall said why. */
function recalledOf(request: { memories?: readonly Recalled[] }): { recalled?: RunRecall[] } {
  const explained = (request.memories ?? []).filter(memory => memory.why !== undefined)
  return explained.length === 0 ? {} : { recalled: explained.slice(0, MAX_RUN_RECALLED).map(({ clarity, turn, text, why }) => ({ clarity, turn, text, why: why! })) }
}

const ANSWER_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { answer: { type: 'string', description: 'The answer to the player, in plain words, in a few sentences.' } },
  required: ['answer'],
  additionalProperties: false,
}

/**
 * Answers a player's question as an agent that has only what the player's character is given when it acts: the character sheet is left out and nothing the
 * game master alone knows is in the prompt, so the answer cannot give away what the character could not know.
 */
export function answerRunner(deps: { parent: Agent; boundaries: () => Boundaries; store: TurnStore }): RunAnswer {
  return async (request, signal) => {
    const brief = deps.boundaries().characterContext.brief(request)
    const result = await runChild<{ answer: string }>({
      parent: deps.parent, signal, sampling: childSampling(deps.store.settings(), 'records', estimateAnswer([MAX_OOC_ANSWER], deps.store.settings().prompts.language)), ...childModel(deps.store.settings(), 'records'), trace: childTrace(deps.store, 'records', 'answer to the player'), reasoningEffort: deps.store.settings().reasoning.children,
      persona: request.text('roleplay/ask-answerer', { name: request.member.character.name }), prompt: brief.prompt, tools: [], maxCalls: 3, result: ANSWER_SCHEMA,
    })
    return result.answer
  }
}

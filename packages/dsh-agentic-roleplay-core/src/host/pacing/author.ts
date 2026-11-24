import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PlotDefinition } from 'dsh-roleplay-model'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { HookCheck, TurnStore } from '../orchestration/boundaries.ts'
import { parsePlotsFile, plotReferenceProblems } from '../plots/load.ts'
import { addSessionPlot } from './director.ts'


interface AuthoredPlot {
  id: string
  name: string
  builds_on: string[]
  themes: string[]
  hook: { id: string; text: string; guidance: string; avoid: string[] }
  developments: { id: string; text: string; mode: 'opportunity' | 'reminder' | 'character' | 'consequence' | 'escalation' | 'breathing_room'; prerequisites: string[]; guidance: string; avoid: string[] }[]
  stakes: string[]
  resolutions: string[]
  participants: string[]
}

interface DraftedPlot extends Omit<AuthoredPlot, 'hook'> {
  hook: { id: string; from: string; actor: string; pressure: string; opening: string; guidance: string; avoid: string[] }
}

const POSSIBLE = 'What may come up, written as a possibility: a pressure, an opening, a situation. Never a scene narrated as if it were happening.'

function resultSchema(labels: readonly string[], keys: readonly string[]): ObjectJsonSchema {
  return {
  type: 'object', required: ['builds_on', 'id', 'name', 'themes', 'hook', 'developments', 'stakes', 'resolutions', 'participants'], additionalProperties: false,
  properties: {
    builds_on: { type: 'array', description: 'The labels, as listed in brackets, of the recorded events and open threads this plot grows from. Pick one to three; the plot is about those and nothing else.', items: labels.length > 0 ? { type: 'string', enum: [...labels] } : { type: 'string' } },
    id: { type: 'string' }, name: { type: 'string' }, themes: { type: 'array', items: { type: 'string' } },
    hook: { type: 'object', required: ['id', 'from', 'actor', 'pressure', 'opening', 'guidance', 'avoid'], additionalProperties: false, properties: { id: { type: 'string' }, from: { type: 'string', description: 'The label, as listed in brackets, of the one recorded event or open thread this hook is about. The hook is quoted from it.', ...(labels.length > 0 ? { enum: [...labels] } : {}) }, actor: { type: 'string', description: 'The key of the character or faction whose want or trouble this is.', ...(keys.length > 0 ? { enum: [...keys] } : {}) }, pressure: { type: 'string', description: 'What that actor wants or fears next, given that record: an intention, one sentence. It adds nothing about the past that the record does not say, and no sensory detail.' }, opening: { type: 'string', description: 'The condition under which it could surface, written as a condition (if or when something happens), never as an event that is under way.' }, guidance: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } } },
    developments: { type: 'array', items: { type: 'object', required: ['id', 'text', 'mode', 'prerequisites', 'guidance', 'avoid'], additionalProperties: false, properties: { id: { type: 'string' }, text: { type: 'string', description: POSSIBLE }, mode: { type: 'string', enum: ['opportunity', 'reminder', 'character', 'consequence', 'escalation', 'breathing_room'] }, prerequisites: { type: 'array', description: 'The ids of other developments of this plot that must have happened first. Never an event of the story so far. Empty when there is none.', items: { type: 'string' } }, guidance: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } } } },
    stakes: { type: 'array', items: { type: 'string' } }, resolutions: { type: 'array', items: { type: 'string' } }, participants: { type: 'array', description: 'The keys, as listed in brackets, of the characters and factions of the story that take part. Only those.', items: keys.length > 0 ? { type: 'string', enum: [...keys] } : { type: 'string' } },
  },
  }
}

/** A scaffold is about two dozen short texts: premise, hook, developments with their guidance, stakes and resolutions. */
const PLOT_TEXTS = 24
const PLOT_TEXT_CHARS = 300

const PLAYER_TERMS: Record<string, readonly string[]> = { zh: ['玩家'] }

const SENTENCE = /[^.!?。！？]+[.!?。！？]*\s*/g

function without(text: string, words: readonly string[]): string {
  const named = (sentence: string) => words.some(word => sentence.toLowerCase().includes(word.toLowerCase()))
  return (text.match(SENTENCE) ?? []).filter(sentence => !named(sentence)).join('').trim()
}

export interface MendedPlot {
  plot: AuthoredPlot
  /** What was cut, for the log. */
  cut: string[]
}

/**
 * A hook or development is about the world and the others; only a resolution may speak of the player's character, as a condition. What names the character
 * is cut out here, the sentence or the whole entry, instead of sending the plot back: one bad sentence is not worth another run. A plot with nothing left of its hook is refused.
 */
export function mendPlot(plot: AuthoredPlot, names: readonly string[], terms: readonly string[] = []): MendedPlot | { refusal: string } {
  const cut: string[] = []
  const hookWords = [...names, ...terms]
  const hook = { ...plot.hook, text: without(plot.hook.text, hookWords), guidance: without(plot.hook.guidance, hookWords) }
  if (hook.text !== plot.hook.text || hook.guidance !== plot.hook.guidance) cut.push('the hook')
  if (hook.text === '') return { refusal: "The hook brings in the player's character, which it may not: write only what the world and the other characters do, and let the game master decide how the player meets it." }
  const kept = plot.developments.flatMap(entry => {
    const text = without(entry.text, hookWords)
    if (text === '') { cut.push(`development ${entry.id} (dropped)`); return [] }
    const guidance = without(entry.guidance, hookWords)
    if (text !== entry.text || guidance !== entry.guidance) cut.push(`development ${entry.id}`)
    return [{ ...entry, text, guidance }]
  })
  const ids = new Set(kept.map(entry => entry.id))
  const developments = kept.map(entry => ({ ...entry, prerequisites: entry.prerequisites.filter(id => ids.has(id)) }))
  const resolutions = plot.resolutions.flatMap((text, index) => {
    const left = without(text, names)
    if (left !== text) cut.push(left === '' ? `resolution ${index + 1} (dropped)` : `resolution ${index + 1}`)
    return left === '' ? [] : [left]
  })
  return { plot: { ...plot, hook, developments, resolutions }, cut }
}

/** The hook is written out by the code: the record it is about, quoted, then the actor's intention and the condition. The model cannot narrate a scene or restate the past in its own words. */
function hookText(hook: { pressure: string; opening: string }, actor: string, record: string, language: string): string {
  const parts = [record.trim(), `${actor}${language === 'zh' ? '：' : ': '}${hook.pressure.trim()}`, hook.opening.trim()].filter(part => part !== '').map(part => /[.!?。！？]$/.test(part) ? part : `${part}${language === 'zh' ? '。' : '.'}`)
  return parts.join(language === 'zh' ? '' : ' ')
}

/** The premise is the records the plot is built on, chosen by label and written out by the code, so it cannot say what the records do not. */
function premiseOf(labelled: ReadonlyMap<string, string>, chosen: readonly string[], language: string): string {
  const joiner = language === 'zh' ? '' : ' '
  const facts = chosen.map(label => labelled.get(label) ?? '').filter(text => text !== '').map(text => /[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}${language === 'zh' ? '。' : '.'}`)
  return facts.join(joiner)
}

/** One more draft is written when the decision model finds the hook contradicting the story; a second such hook is not shipped. */
export async function authorPlot(parent: Agent, store: TurnStore, turn: number, signal: AbortSignal, hooks?: { chat: string; check: HookCheck }): Promise<PlotDefinition> {
  const events = store.story.events.list().slice(-12).map(event => event.text)
  for (let attempt = 1; ; attempt += 1) {
    const plot = await draftPlot(parent, store, turn, signal)
    const faulty = hooks === undefined ? false : await hooks.check.faulty({ chat: hooks.chat, turn, store, events, hook: plot.hooks.map(hook => hook.text).join(' ') }, signal)
    if (!faulty) { addSessionPlot(store, plot); return plot }
    if (attempt >= 2) throw new Error('the plot author wrote a hook that contradicts the recorded events twice: no plot was added')
  }
}

async function draftPlot(parent: Agent, store: TurnStore, turn: number, signal: AbortSignal): Promise<PlotDefinition> {
  const cast = store.cast().filter(member => member.character.control !== 'player').map(member => `${member.character.name} (${member.key}): ${member.character.summary}`).join('\n')
  const factions = store.story.factions.list().map(faction => `${faction.name} (${faction.sourceId ?? faction.id}): ${faction.summary}`).join('\n')
  const places = store.story.locations.list().map(place => `${place.name} (${place.sourceId ?? place.id})`).join(', ')
  const recent = store.story.events.list().slice(-12)
  const open = store.story.threads.list('open')
  const labelled = new Map<string, string>([...recent.map((event, index): [string, string] => [`E${index + 1}`, event.text]), ...open.map((thread, index): [string, string] => [`T${index + 1}`, thread.text])])
  const events = recent.map((event, index) => `- [E${index + 1}] ${event.text}`).join('\n')
  const threads = open.map((thread, index) => `- [T${index + 1}] ${thread.text}`).join('\n')
  const language = store.settings().prompts.language
  const keys = [...store.cast().filter(member => member.character.control !== 'player').map(member => member.key), ...store.story.factions.list().map(faction => faction.sourceId ?? String(faction.id))]
  let checked: PlotDefinition | undefined
  const player = store.cast().find(member => member.character.control === 'player')?.character
  const playerNames = player === undefined ? [] : [player.name, ...player.aliases].filter(name => name.trim() !== '')
  const names = new Map<string, string>([...store.cast().map((member): [string, string] => [member.key, member.character.name]), ...store.story.factions.list().map((faction): [string, string] => [faction.sourceId ?? String(faction.id), faction.name])])
  const playerTerms = PLAYER_TERMS[language] ?? ['player']
  const result = await runChild<DraftedPlot>({
    parent, signal, sampling: childSampling(store.settings(), 'authoring', estimateAnswer(Array.from({ length: PLOT_TEXTS }, () => PLOT_TEXT_CHARS), language)), ...childModel(store.settings(), 'authoring'), trace: childTrace(store, 'authoring', 'plot author'), persona: promptFor(parent, 'roleplay/plot-author', language), reasoningEffort: store.settings().reasoning.children, result: resultSchema([...labelled.keys()], keys), maxCalls: 4,
    prompt: `The story has gone quiet by turn ${turn}. Propose one optional plot scaffold that grows from this state.\n\nCharacters:\n${cast || '- none'}\n\nFactions:\n${factions || '- none'}\n\nPlaces: ${places || 'none'}\n\nEvents recorded so far (they have happened, and what they settled stays settled: never write one as still pending or undecided):\n${events || '- none'}\n\nOpen threads (the tensions still unresolved):\n${threads || '- none'}`,
    beforeSubmit(value) {
      const drafted = value as DraftedPlot
      const submitted: AuthoredPlot = { ...drafted, hook: { id: drafted.hook.id, text: hookText(drafted.hook, names.get(drafted.hook.actor) ?? drafted.hook.actor, labelled.get(drafted.hook.from) ?? '', language), guidance: drafted.hook.guidance, avoid: drafted.hook.avoid } }
      const unknownLabels = [...submitted.builds_on, ...(labelled.size > 0 ? [drafted.hook.from] : [])].filter(label => !labelled.has(label))
      if (unknownLabels.length > 0 || (labelled.size > 0 && submitted.builds_on.length === 0)) return `builds_on takes labels from the lists: ${[...labelled.keys()].join(', ')}`
      const mended = mendPlot(submitted, playerNames, playerTerms)
      if ('refusal' in mended) return mended.refusal
      const authored = { ...mended.plot, premise: premiseOf(labelled, submitted.builds_on, language) }
      const candidate = { ...authored, hooks: [{ ...authored.hook, mode: 'opportunity' as const, prerequisites: [] }], start: 'available' as const, pacing: { quietTurns: 3, cooldownTurns: 4, cooldownDays: 1 } }
      const parsed = parsePlotsFile(JSON.stringify([candidate]))
      if (!parsed.ok) return parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n')
      const unknown = plotReferenceProblems(parsed.value, keys)
      if (unknown.length > 0) return `${unknown.join('\n')}\nparticipants are named by their keys: ${keys.join(', ')}`
      checked = parsed.value[0]
      return undefined
    },
  })
  if (checked === undefined) throw new Error(`the plot author returned an invalid plot: ${result.name}`)
  return checked
}

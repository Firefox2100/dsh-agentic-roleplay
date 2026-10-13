import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PlotDefinition } from 'dsh-roleplay-model'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { TurnStore } from '../orchestration/boundaries.ts'
import { parsePlotsFile } from '../plots/load.ts'
import { addSessionPlot } from './director.ts'


interface AuthoredPlot {
  id: string
  name: string
  premise: string
  themes: string[]
  hook: { id: string; text: string; guidance: string; avoid: string[] }
  developments: { id: string; text: string; mode: 'opportunity' | 'reminder' | 'character' | 'consequence' | 'escalation' | 'breathing_room'; prerequisites: string[]; guidance: string; avoid: string[] }[]
  stakes: string[]
  resolutions: string[]
  participants: string[]
}

const RESULT: ObjectJsonSchema = {
  type: 'object', required: ['id', 'name', 'premise', 'themes', 'hook', 'developments', 'stakes', 'resolutions', 'participants'], additionalProperties: false,
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, premise: { type: 'string' }, themes: { type: 'array', items: { type: 'string' } },
    hook: { type: 'object', required: ['id', 'text', 'guidance', 'avoid'], additionalProperties: false, properties: { id: { type: 'string' }, text: { type: 'string' }, guidance: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } } },
    developments: { type: 'array', items: { type: 'object', required: ['id', 'text', 'mode', 'prerequisites', 'guidance', 'avoid'], additionalProperties: false, properties: { id: { type: 'string' }, text: { type: 'string' }, mode: { type: 'string', enum: ['opportunity', 'reminder', 'character', 'consequence', 'escalation', 'breathing_room'] }, prerequisites: { type: 'array', items: { type: 'string' } }, guidance: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } } } },
    stakes: { type: 'array', items: { type: 'string' } }, resolutions: { type: 'array', items: { type: 'string' } }, participants: { type: 'array', items: { type: 'string' } },
  },
}

export async function authorPlot(parent: Agent, store: TurnStore, turn: number, signal: AbortSignal): Promise<PlotDefinition> {
  const cast = store.cast().map(member => `${member.character.name} (${member.key}): ${member.character.summary}`).join('\n')
  const factions = store.story.factions.list().map(faction => `${faction.name} (${faction.sourceId ?? faction.id}): ${faction.summary}`).join('\n')
  const places = store.story.locations.list().map(place => `${place.name} (${place.sourceId ?? place.id})`).join(', ')
  const events = store.story.events.list().slice(-12).map(event => `- ${event.text}`).join('\n')
  let checked: PlotDefinition | undefined
  const result = await runChild<AuthoredPlot>({
    parent, signal, sampling: childSampling(store.settings(), 'authoring'), ...childModel(store.settings(), 'authoring'), trace: childTrace(store, 'authoring', 'plot author'), persona: promptFor(parent, 'roleplay/plot-author', store.settings().prompts.language), reasoningEffort: store.settings().reasoning.children, result: RESULT, maxCalls: 3,
    prompt: `The story has gone quiet by turn ${turn}. Propose one optional plot scaffold that grows from this state.\n\nCharacters:\n${cast || '- none'}\n\nFactions:\n${factions || '- none'}\n\nPlaces: ${places || 'none'}\n\nRecent recorded events:\n${events || '- none'}`,
    beforeSubmit(value) {
      const authored = value as AuthoredPlot
      const candidate = { ...authored, hooks: [{ ...authored.hook, mode: 'opportunity' as const, prerequisites: [] }], start: 'available' as const, pacing: { quietTurns: 3, cooldownTurns: 4, cooldownDays: 1 } }
      const parsed = parsePlotsFile(JSON.stringify([candidate]))
      if (!parsed.ok) return parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n')
      checked = parsed.value[0]
      return undefined
    },
  })
  if (checked === undefined) throw new Error(`the plot author returned an invalid plot: ${result.name}`)
  addSessionPlot(store, checked)
  return checked
}

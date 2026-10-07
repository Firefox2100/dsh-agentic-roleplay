import { INTENT_STATUSES } from 'dsh-roleplay-model'
import type { CharacterEdit, WorldCharacter, WorldGoal } from '../../shared/world-state.ts'

/** What the editor holds for one character while it is being changed: every field as the text typed. */
export interface CharacterDraft {
  name: string
  aliases: string
  age: string
  gender: string
  pronouns: string
  role: WorldCharacter['role']
  tier: WorldCharacter['tier']
  kind: WorldCharacter['kind']
  summary: string
  personality: string
  background: string
  appearance: string
  visualDescription: string
  visualTags: string
  visualNegativeTags: string
  visualGlobalId: string
  speechStyle: string
  voice: string
  /** One example per line. */
  speechExamples: string
  publicState: string
  innerState: string
  activity: string
  /** The key of the place, empty for none. */
  place: string
  position: string
  goals: { ref: string; name: string; description: string; status: WorldGoal['status']; priority: string }[]
}

const lines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(line => line !== '')
const commas = (text: string): string[] => text.split(',').map(part => part.trim()).filter(part => part !== '')

export function toDraft(character: WorldCharacter): CharacterDraft {
  return {
    name: character.name,
    aliases: character.aliases.join(', '),
    age: character.age ?? '',
    gender: character.gender ?? '',
    pronouns: character.pronouns ?? '',
    role: character.role,
    tier: character.tier,
    kind: character.kind,
    summary: character.summary,
    personality: character.personality,
    background: character.background,
    appearance: character.appearance,
    visualDescription: character.visualIdentity?.description ?? '',
    visualTags: character.visualIdentity?.tags.join(', ') ?? '',
    visualNegativeTags: character.visualIdentity?.negativeTags.join(', ') ?? '',
    visualGlobalId: character.visualIdentity?.globalId ?? '',
    speechStyle: character.speech.style,
    voice: character.voice ?? '',
    speechExamples: character.speech.examples.join('\n'),
    publicState: character.state.publicState,
    innerState: character.state.innerState,
    activity: character.state.activity,
    place: character.place?.key ?? '',
    position: character.place?.position ?? '',
    goals: character.goals.map(goal => ({ ref: goal.ref, name: goal.name, description: goal.description, status: goal.status, priority: String(goal.priority) })),
  }
}

/** Why a draft cannot be saved, by field; none when it can. */
export function draftProblems(draft: CharacterDraft): Map<string, string> {
  const problems = new Map<string, string>()
  if (draft.name.trim() === '') problems.set('name', 'name')
  if (draft.role === 'playable' && (draft.kind === 'group' || draft.tier === 'background')) problems.set('role', 'playable')
  draft.goals.forEach((goal, index) => {
    if (goal.name.trim() === '') problems.set(`goal.${index}.name`, 'name')
    const priority = Number(goal.priority)
    if (goal.priority.trim() === '' || !Number.isFinite(priority) || priority < 0 || priority > 1) problems.set(`goal.${index}.priority`, 'priority')
    if (!INTENT_STATUSES.includes(goal.status)) problems.set(`goal.${index}.status`, 'status')
  })
  return problems
}

/** What differs between the character and the draft, as an edit; empty when nothing does. */
export function editOf(character: WorldCharacter, draft: CharacterDraft): CharacterEdit {
  const base = toDraft(character)
  const edit: CharacterEdit = {}
  if (draft.name.trim() !== base.name) edit.name = draft.name.trim()
  if (JSON.stringify(commas(draft.aliases)) !== JSON.stringify(commas(base.aliases))) edit.aliases = commas(draft.aliases)
  for (const key of ['age', 'gender', 'pronouns'] as const) if (draft[key].trim() !== base[key]) edit[key] = draft[key].trim()
  for (const key of ['role', 'tier', 'kind', 'summary', 'personality', 'background', 'appearance'] as const) if (draft[key] !== base[key]) (edit as Record<string, unknown>)[key] = draft[key]
  const visualChanged = draft.visualDescription.trim() !== base.visualDescription || JSON.stringify(commas(draft.visualTags)) !== JSON.stringify(commas(base.visualTags)) || JSON.stringify(commas(draft.visualNegativeTags)) !== JSON.stringify(commas(base.visualNegativeTags)) || draft.visualGlobalId.trim() !== base.visualGlobalId
  if (visualChanged) edit.visualIdentity = draft.visualDescription.trim() === '' ? null : { description: draft.visualDescription.trim(), tags: commas(draft.visualTags), negativeTags: commas(draft.visualNegativeTags), ...(draft.visualGlobalId.trim() === '' ? {} : { globalId: draft.visualGlobalId.trim() }) }
  const speech: NonNullable<CharacterEdit['speech']> = {}
  if (draft.speechStyle !== base.speechStyle) speech.style = draft.speechStyle
  if (JSON.stringify(lines(draft.speechExamples)) !== JSON.stringify(lines(base.speechExamples))) speech.examples = lines(draft.speechExamples)
  if (Object.keys(speech).length > 0) edit.speech = speech
  if (draft.voice.trim() !== base.voice) edit.voice = draft.voice.trim()
  const state: NonNullable<CharacterEdit['state']> = {}
  for (const key of ['publicState', 'innerState', 'activity'] as const) if (draft[key] !== base[key]) state[key] = draft[key]
  if (Object.keys(state).length > 0) edit.state = state
  if ((draft.place !== base.place || draft.position.trim() !== base.position) && draft.place !== '') edit.place = { location: draft.place, ...(draft.position.trim() === '' ? {} : { position: draft.position.trim() }) }
  const goals = draft.goals.flatMap((goal) => {
    const was = base.goals.find(candidate => candidate.ref === goal.ref)
    if (was === undefined) return []
    const changes: NonNullable<CharacterEdit['goals']>[number] = { ref: goal.ref }
    if (goal.name.trim() !== was.name) changes.name = goal.name.trim()
    if (goal.description !== was.description) changes.description = goal.description
    if (goal.status !== was.status) changes.status = goal.status
    if (goal.priority.trim() !== was.priority) changes.priority = Number(goal.priority)
    return Object.keys(changes).length > 1 ? [changes] : []
  })
  if (goals.length > 0) edit.goals = goals
  return edit
}

export const isDirty = (character: WorldCharacter, draft: CharacterDraft): boolean => Object.keys(editOf(character, draft)).length > 0

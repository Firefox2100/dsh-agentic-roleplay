import { describe, expect, it } from 'vitest'
import { draftProblems, editOf, isDirty, toDraft } from '../../../src/client/world-editor/character-draft.ts'
import type { WorldCharacter } from '../../../src/shared/world-state.ts'

const clara: WorldCharacter = {
  key: 'clara', name: 'Clara', aliases: ['Clar', 'Innkeeper'], role: 'npc', tier: 'principal', kind: 'person', control: 'agent', age: '41', summary: 'Innkeeper.', personality: 'Warm.', background: '', appearance: '',
  speech: { style: 'Brisk', examples: ['Evening.', 'What will it be?'] }, state: { publicState: 'Wiping glasses', innerState: '', activity: 'serving' },
  place: { key: 'bar', name: 'The Bar', position: 'behind the counter' }, goals: [{ ref: '7', name: 'Find the ledger', description: '', status: 'active', priority: 0.8 }],
}

describe('the draft of a character', () => {
  it('starts as the character written out as the text that is typed, and is not a change', () => {
    const draft = toDraft(clara)
    expect(draft).toMatchObject({ aliases: 'Clar, Innkeeper', age: '41', gender: '', speechExamples: 'Evening.\nWhat will it be?', place: 'bar', position: 'behind the counter', goals: [{ ref: '7', priority: '0.8' }] })
    expect(editOf(clara, draft)).toEqual({})
    expect(isDirty(clara, draft)).toBe(false)
  })

  it('becomes an edit of only what differs, and ignores the spaces and blank lines that do not matter', () => {
    const draft = { ...toDraft(clara), name: ' Clara W ', aliases: 'Clar,  Innkeeper ,', gender: ' she ', summary: 'Runs the inn.', speechExamples: 'Evening.\n\nWhat will it be?\n', activity: 'cleaning', place: 'cellar', position: '  by the barrels ' }
    draft.goals = [{ ...draft.goals[0]!, status: 'paused', priority: '0.2' }]
    expect(editOf(clara, draft)).toEqual({
      name: 'Clara W', gender: 'she', summary: 'Runs the inn.', state: { activity: 'cleaning' }, place: { location: 'cellar', position: 'by the barrels' }, goals: [{ ref: '7', status: 'paused', priority: 0.2 }],
    })
  })

  it('takes away an optional field by blanking it, and gives the aliases and examples as lists', () => {
    expect(editOf(clara, { ...toDraft(clara), age: '', aliases: '', speechExamples: '' })).toEqual({ age: '', aliases: [], speech: { examples: [] } })
  })

  it('edits and removes the visual identity as one value', () => {
    const described = { ...clara, visualIdentity: { description: 'Dark curls.', tags: ['dark curls'], negativeTags: ['hat'], globalId: 'person-clara' } }
    expect(editOf(described, { ...toDraft(described), visualTags: 'dark curls, red waistcoat' })).toEqual({ visualIdentity: { description: 'Dark curls.', tags: ['dark curls', 'red waistcoat'], negativeTags: ['hat'], globalId: 'person-clara' } })
    expect(editOf(described, { ...toDraft(described), visualDescription: '' })).toEqual({ visualIdentity: null })
  })

  it('cannot be saved with a blank name or goal name, a priority that is not 0 to 1, or a playable group or background character', () => {
    expect([...draftProblems(toDraft(clara)).keys()]).toEqual([])
    const bad = { ...toDraft(clara), name: ' ', role: 'playable' as const, kind: 'group' as const }
    bad.goals = [{ ...bad.goals[0]!, name: '', priority: '1.5' }]
    expect([...draftProblems(bad).keys()].sort()).toEqual(['goal.0.name', 'goal.0.priority', 'name', 'role'])
    expect(draftProblems({ ...toDraft(clara), goals: [{ ...toDraft(clara).goals[0]!, priority: '' }] }).has('goal.0.priority')).toBe(true)
  })
})

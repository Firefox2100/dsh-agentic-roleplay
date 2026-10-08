import { describe, expect, it } from 'vitest'
import { parseCharacterFile } from '../../../src/host/characters/character-file.ts'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import { formatIssue } from '../../../src/host/validation.ts'

function parse(input: unknown, folder = 'folder-name'): CharacterDefinition {
  const result = parseCharacterFile(typeof input === 'string' ? input : JSON.stringify(input), folder)
  if (!result.ok) throw new Error(result.issues.map(formatIssue).join('; '))
  return result.value
}

function issues(input: unknown, folder = 'folder-name'): string[] {
  const result = parseCharacterFile(typeof input === 'string' ? input : JSON.stringify(input), folder)
  return result.ok ? [] : result.issues.map(formatIssue)
}

const full = {
  id: 'eleanor-graves',
  name: 'Eleanor Graves',
  aliases: ['Ellie', ' the Mayor ', 'Ellie', 'eleanor graves'],
  age: 42,
  gender: 'female',
  pronouns: 'she/her',
  kind: 'person',
  tier: 'principal',
  role: 'npc',
  summary: 'Mayor of Blackwater Ridge.',
  personality: 'Calculating and practical.',
  background: 'Born in the town.',
  appearance: 'Sharp features.',
  speech: { style: 'Formal, clipped.', examples: ['Let us not make a scene.', ''] },
  start: {
    public_state: 'Greeting guests.',
    inner_state: 'Wondering what the visitor wants.',
    activity: 'managing festival appearances',
    emotion: {
      baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
      immediate: { valence: -0.3 },
    },
    intents: [{
      type: 'agenda',
      name: 'Contain the scandal',
      description: 'Keep the disappearance quiet.',
      status: 'active',
      horizon: 'day',
      priority: 0.8,
      urgency: 0.6,
      plan: ['Charm the visitor', 'Move the records'],
      open_threads: ['What does he know?'],
      constraints: ['Never be seen to panic'],
      deadline: '1912-09-22',
    }],
  },
}

describe('parseCharacterFile', () => {
  it('reads a complete character into the canonical model', () => {
    expect(parse(full)).toEqual({
      id: 'eleanor-graves',
      name: 'Eleanor Graves',
      aliases: ['Ellie', 'the Mayor'],
      age: '42',
      gender: 'female',
      pronouns: 'she/her',
      kind: 'person',
      tier: 'principal',
      role: 'npc',
      summary: 'Mayor of Blackwater Ridge.',
      personality: 'Calculating and practical.',
      background: 'Born in the town.',
      appearance: 'Sharp features.',
      speech: { style: 'Formal, clipped.', examples: ['Let us not make a scene.'] },
      start: {
        publicState: 'Greeting guests.',
        innerState: 'Wondering what the visitor wants.',
        activity: 'managing festival appearances',
        emotion: {
          baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
          immediate: { valence: -0.3, arousal: 0, dominance: 0 },
        },
        intents: [{
          type: 'agenda',
          name: 'Contain the scandal',
          description: 'Keep the disappearance quiet.',
          status: 'active',
          horizon: 'day',
          priority: 0.8,
          urgency: 0.6,
          plan: ['Charm the visitor', 'Move the records'],
          openThreads: ['What does he know?'],
          constraints: ['Never be seen to panic'],
          deadline: '1912-09-22T00:00:00.000Z',
        }],
      },
    })
  })

  it('needs only a name, and takes the id from the folder', () => {
    expect(parse({ name: 'Mira' }, 'mira-vale')).toEqual({
      id: 'mira-vale',
      name: 'Mira',
      aliases: [],
      kind: 'person',
      tier: 'principal',
      role: 'npc',
      summary: '',
      personality: '',
      background: '',
      appearance: '',
      speech: { style: '', examples: [] },
      start: { publicState: '', innerState: '', activity: '', intents: [] },
    })
  })

  it('prefers an explicit id over the folder name', () => {
    expect(parse({ id: ' mira ', name: 'Mira' }, 'folder').id).toBe('mira')
  })

  it('reads an optional provider-neutral visual identity', () => {
    expect(parse({ name: 'Mira', visual_identity: { global_id: 'person-mira', description: 'Long black hair and grey eyes.', tags: ['black hair', ' grey eyes '], negative_tags: ['blue eyes'] } }).visualIdentity).toEqual({
      globalId: 'person-mira', description: 'Long black hair and grey eyes.', tags: ['black hair', 'grey eyes'], negativeTags: ['blue eyes'],
    })
    expect(issues({ name: 'Mira', visual_identity: { tags: [] } })).toEqual(['visual_identity.description: is required'])
  })

  it('starts the immediate emotion at the baseline when it is not given', () => {
    const emotion = parse({ name: 'A', start: { emotion: { baseline: { arousal: 0.5 } } } }).start.emotion
    expect(emotion).toEqual({
      baseline: { valence: 0, arousal: 0.5, dominance: 0 },
      immediate: { valence: 0, arousal: 0.5, dominance: 0 },
    })
  })

  it('gives intents neutral defaults', () => {
    expect(parse({ name: 'A', start: { intents: [{ name: 'Rest' }] } }).start.intents).toEqual([{
      type: 'agenda',
      name: 'Rest',
      description: '',
      status: 'active',
      horizon: 'short',
      priority: 0.5,
      urgency: 0.5,
      plan: [],
      openThreads: [],
      constraints: [],
    }])
  })

  it('accepts a string age, treats null as absent and ignores unknown fields', () => {
    const character = parse({ name: 'A', age: 'looks thirty', gender: null, pronouns: null, nickname: 'x', start: { future: 1 } })
    expect(character.age).toBe('looks thirty')
    expect(character.gender).toBeUndefined()
    expect(character.pronouns).toBeUndefined()
  })

  it('lets pronouns differ from gender', () => {
    const character = parse({ name: 'A', gender: 'male', pronouns: 'she/her' })
    expect([character.gender, character.pronouns]).toEqual(['male', 'she/her'])
  })

  describe('playable characters', () => {
    it('may be a principal or supporting person', () => {
      expect(parse({ name: 'A', role: 'playable' }).role).toBe('playable')
      expect(parse({ name: 'A', role: 'playable', tier: 'supporting' }).tier).toBe('supporting')
    })

    it.each([
      ['a group', { kind: 'group' }, 'role: a playable character must be a person'],
      ['a background character', { tier: 'background' }, 'role: a playable character cannot be a background character'],
    ])('cannot be %s', (_label, extra, message) => {
      expect(issues({ name: 'A', role: 'playable', ...extra })).toEqual([message])
    })
  })

  describe('problems', () => {
    it('are all reported, each with its path', () => {
      expect(issues({
        age: -1,
        kind: 'robot',
        aliases: 'x',
        speech: { examples: [1] },
        start: {
          public_state: 3,
          emotion: { baseline: { valence: 2 } },
          intents: [{ name: 'ok', priority: 5 }, { type: 'dream' }, 'text'],
        },
      }).sort()).toEqual([
        'age: must be a string or a non-negative number',
        'aliases: must be an array of strings',
        'kind: must be one of: person, group',
        'name: is required',
        'speech.examples[0]: must be a string',
        'start.emotion.baseline.valence: must be between -1 and 1',
        'start.intents[0].priority: must be between 0 and 1',
        'start.intents[1].name: is required',
        'start.intents[1].type: must be one of: need, obligation, quest, agenda, aspiration, relationship, habit, reaction',
        'start.intents[2]: must be an object',
        'start.public_state: must be a string',
      ])
    })

    it('include malformed JSON', () => {
      expect(issues('{ "name": ')[0]).toContain('invalid JSON')
    })

    it('require an emotion to give a baseline', () => {
      expect(issues({ name: 'A', start: { emotion: { immediate: { valence: 0.2 } } } }))
        .toEqual(['start.emotion.baseline: is required'])
    })

    it('reject a deadline that is not a date', () => {
      expect(issues({ name: 'A', start: { intents: [{ name: 'x', deadline: 'soon' }] } }))
        .toEqual(['start.intents[0].deadline: must be an ISO 8601 date-time'])
    })

    it('reject an id that is too long', () => {
      expect(issues({ name: 'A', id: 'x'.repeat(101) })[0]).toContain('id: must be at most 100 characters')
      expect(issues({ name: 'A' }, 'y'.repeat(101))[0]).toContain('id: must be at most 100 characters')
    })
  })
})

describe('relationships in a character file', () => {
  it('are read as profiles of other characters, with what is left out at its default', () => {
    const result = parseCharacterFile(JSON.stringify({ name: 'Eleanor', relationships: [{ to: 'arthur', label: 'suspicious of', summary: 'He asks too many questions.', trust: -0.3, tension: 0.5 }, { to: 'clara', label: 'friend' }] }), 'eleanor')
    expect(result.ok && result.value.relationships).toEqual([
      { to: 'arthur', label: 'suspicious of', summary: 'He asks too many questions.', familiarity: 0, trust: -0.3, affinity: 0, tension: 0.5 },
      { to: 'clara', label: 'friend', summary: '', familiarity: 0, trust: 0, affinity: 0, tension: 0 },
    ])
    const none = parseCharacterFile(JSON.stringify({ name: 'Eleanor' }), 'eleanor')
    expect(none.ok && none.value.relationships).toBeUndefined()
  })

  it('are reported with their path: a missing target or label, a value out of range, one character twice, too many', () => {
    const result = parseCharacterFile(JSON.stringify({ name: 'E', relationships: [{ label: 'x' }, { to: 'a' }, { to: 'b', label: 'x', trust: 2 }, { to: 'c', label: 'x' }, { to: 'c', label: 'y' }] }), 'e')
    expect(result.ok ? [] : result.issues.map(issue => issue.path)).toEqual(['relationships[0].to', 'relationships[1].label', 'relationships[2].trust', 'relationships[4].to'])
    const many = parseCharacterFile(JSON.stringify({ name: 'E', relationships: Array.from({ length: 61 }, (_, index) => ({ to: `c${index}`, label: 'x' })) }), 'e')
    expect(many.ok ? [] : many.issues.map(issue => issue.path)).toEqual(['relationships'])
  })
})

describe('entity knowledge in a character file', () => {
  it('reads known places, things and directed ways', () => {
    expect(parse({ name: 'Eleanor', knowledge: { locations: ['town', 'observatory'], items: ['brass-key'], exits: [{ from: 'town', to: 'station' }] } }).knowledge).toEqual({
      locations: ['town', 'observatory'], items: ['brass-key'], exits: [{ from: 'town', to: 'station' }], lore: [],
    })
  })

  it('reports malformed ways', () => {
    expect(issues({ name: 'Eleanor', knowledge: { exits: [{ from: 'town' }, { to: 'station' }] } })).toEqual([
      'knowledge.exits[0].to: is required', 'knowledge.exits[1].from: is required',
    ])
  })
})

describe('a routine in a character file', () => {
  const parse = (routine: unknown) => parseCharacterFile(JSON.stringify({ name: 'Clara', routine }), 'clara')

  it('is the windows of the day: days, from and to, what, where, and whether it can be dropped', () => {
    const result = parse([
      { days: ['Mon', 'tue'], from: '09:00', to: '17:00', activity: 'minds the shop', location: 'shop', feature: 'counter', position: 'behind it', interruptible: false },
      { from: '22:00', to: '6:30', activity: 'sleeps' },
    ])
    expect(result.ok && result.value.routine).toEqual([
      { days: ['mon', 'tue'], from: '09:00', to: '17:00', activity: 'minds the shop', location: 'shop', feature: 'counter', position: 'behind it', interruptible: false },
      { days: [], from: '22:00', to: '6:30', activity: 'sleeps', interruptible: true },
    ])
    const none = parseCharacterFile(JSON.stringify({ name: 'Clara' }), 'clara')
    expect(none.ok && none.value.routine).toBeUndefined()
  })

  it('is reported with its path: a time that is not one, an empty window, a day that is not one, no activity, a feature without a place, a flag that is not a flag', () => {
    const result = parse([
      { from: '25:00', to: '17:00', activity: 'x' }, { from: '09:00', to: '09:00', activity: 'x' }, { days: ['funday'], from: '09:00', to: '10:00', activity: 'x' },
      { from: '09:00', to: '10:00' }, { from: '09:00', to: '10:00', activity: 'x', feature: 'f' }, { from: '09:00', to: '10:00', activity: 'x', interruptible: 'no' },
    ])
    expect(result.ok ? [] : result.issues.map(issue => issue.path)).toEqual(['routine[0].from', 'routine[1].to', 'routine[2].days', 'routine[3].activity', 'routine[4].feature', 'routine[5].interruptible'])
    const many = parse(Array.from({ length: 25 }, () => ({ from: '09:00', to: '10:00', activity: 'x' })))
    expect(many.ok ? [] : many.issues.map(issue => issue.path)).toEqual(['routine'])
  })
})

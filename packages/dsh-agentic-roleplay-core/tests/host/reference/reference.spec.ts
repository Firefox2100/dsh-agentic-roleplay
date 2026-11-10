import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { referencePage, UnknownSectionError } from '../../../src/host/reference/reference.ts'
import { observeAsPlayer } from '../../../src/host/orchestration/observation.ts'

let session: SessionStore
const person = (sourceId: string, name: string, control: 'player' | 'agent') => session.characters.add({ sourceId, name, aliases: [], kind: 'person', tier: 'principal', role: control === 'player' ? 'playable' : 'npc', control, summary: `SECRET SUMMARY of ${name}`, personality: 'SECRET PERSONALITY', background: 'SECRET BACKGROUND', appearance: '', speech: { style: '', examples: [] } })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 'ref', name: 'A story', world: { id: 'w', name: 'W' } })
  session.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar', description: 'Smoky.', features: [{ key: 'stage', name: 'Stage' }], exits: [{ to: 'square', description: 'the door' }] }, { key: 'square', name: 'Square' }, { key: 'vault', name: 'Vault', description: 'SECRET VAULT' }] })
  const arthur = person('arthur', 'Arthur', 'player')
  const clara = person('clara', 'Clara', 'agent')
  const dora = person('dora', 'Dora', 'agent')
  const place = (key: string) => session.locations.getBySourceId(key)!.id
  session.placements.place('character', arthur.id, { locationId: place('bar') })
  session.placements.place('character', clara.id, { locationId: place('bar') })
  session.placements.place('character', dora.id, { locationId: place('vault') })
  session.characterStates.create(clara.id, { publicState: 'Tired.', innerState: 'SECRET PLAN', activity: 'SECRET ERRAND' })
  session.characterStates.create(dora.id, { publicState: 'Elsewhere.', innerState: 'SECRET', activity: 'SECRET' })
  session.edit({ turn: 1, items: [{ key: 'lamp', name: 'Lamp', at: { location: 'bar' } }, { key: 'knife', name: 'Hidden knife', hidden: true, at: { location: 'bar' } }, { key: 'coin', name: 'Coin', quantity: 3, heldBy: 'arthur' }] })
  session.characters.update(arthur.id, { appearance: 'Tall, with a limp.' })
  session.characterStates.create(arthur.id, { publicState: 'Wet from the rain.', innerState: 'Afraid of the vault.', activity: 'Looking for the key.' })
  session.intents.add(arthur.id, { type: 'quest', name: 'Find the key', description: 'It opens the vault.', status: 'active', horizon: 'day', priority: 0.5, urgency: 0.5, plan: ['Ask Clara'], openThreads: [], constraints: [] })
  session.intents.add(clara.id, { type: 'agenda', name: 'SECRET AGENDA', description: 'SECRET', status: 'active', horizon: 'day', priority: 0.5, urgency: 0.5, plan: [], openThreads: [], constraints: [] })
  session.events.add({ turn: 1, round: 1, text: 'Arthur sees the vault sealed.', importance: 3, tags: [], involves: [arthur.id, clara.id] }, [
    { characterId: arthur.id, mode: 'witnessed', content: 'The vault door was sealed in front of me.', gist: 'the vault was sealed', accuracy: 'mistaken' },
    { characterId: clara.id, mode: 'heard', content: 'SECRET CLARA MEMORY', gist: 'SECRET', accuracy: 'accurate' },
  ])
  session.memories.add({ characterId: arthur.id, kind: 'belief', text: 'Clara knows more than she says.', about: [clara.id], importance: 3, turn: 1 })
  session.memories.add({ characterId: clara.id, kind: 'belief', text: 'SECRET CLARA BELIEF', about: [], importance: 3, turn: 1 })
  observeAsPlayer(session, 1)
})
afterEach(() => { session.close() })

describe('the profile page', () => {
  it('shows the player\'s character in full: what they are, feel, want and remember', () => {
    const [profile] = referencePage(session, 'profile').entries
    expect(profile).toMatchObject({ key: 'arthur', audience: 'self', appearance: 'Tall, with a limp.', publicState: 'Wet from the rain.', innerState: 'Afraid of the vault.', activity: 'Looking for the key.', personality: 'SECRET PERSONALITY', background: 'SECRET BACKGROUND' })
    expect(profile?.goals).toEqual([expect.objectContaining({ name: 'Find the key', plan: ['Ask Clara'] })])
    expect(profile?.recollections).toEqual([{ text: 'The vault door was sealed in front of me.', gist: 'the vault was sealed', mode: 'witnessed', turn: 1 }])
    expect(profile?.beliefs).toEqual([expect.objectContaining({ text: 'Clara knows more than she says.' })])
    expect(profile?.totals).toEqual({ recollections: 1, beliefs: 1 })
    expect(JSON.stringify(profile)).not.toMatch(/SECRET CLARA|mistaken|accuracy/)
  })

  it('shows another character only as an observer would, and only one the player has met', () => {
    const [clara] = referencePage(session, 'profile', { character: 'clara' }).entries
    expect(clara).toMatchObject({ key: 'clara', audience: 'observer', publicState: 'Tired.' })
    for (const hidden of ['personality', 'background', 'speech', 'innerState', 'activity', 'goals', 'summary', 'groups', 'recollections', 'beliefs', 'totals']) expect(clara).not.toHaveProperty(hidden)
    expect(JSON.stringify(clara)).not.toMatch(/SECRET/)
    expect(referencePage(session, 'profile', { character: 'dora' }).entries).toEqual([])
  })
})

describe('the status page', () => {
  const many = 12
  const declare = (): void => {
    session.variables.define({ key: 'day', name: 'Day', kind: 'number', subject: 'world', integer: true, min: 1, default: 3, visibility: 'public' })
    session.variables.define({ key: 'omen', name: 'SECRET OMEN', kind: 'flag', subject: 'world', default: false, visibility: 'hidden' })
    session.variables.define({ key: 'stamina', name: 'Stamina', kind: 'number', subject: 'character', only: ['arthur'], min: 0, max: 10, default: 10, visibility: 'private' })
    session.variables.define({ key: 'trust', name: 'Trust', kind: 'number', subject: 'character', min: 0, max: 100, default: 20, visibility: 'public' })
    session.variables.define({ key: 'dread', name: 'Dread', kind: 'number', subject: 'character', min: 0, max: 10, default: 0, visibility: 'private' })
    session.variables.define({ key: 'damp', name: 'Damp', kind: 'flag', subject: 'location', default: false, visibility: 'public' })
    session.variables.define({ key: 'worn', name: 'Wear', kind: 'number', subject: 'item', min: 0, max: 10, default: 10, visibility: 'public' })
    for (let index = 0; index < many; index += 1) session.variables.define({ key: `skill_${index}`, name: `Skill ${index}`, kind: 'number', subject: 'character', only: ['arthur'], min: 0, max: 10, default: 1, visibility: 'public' })
  }

  it('gives every value the player may read, defaults and more than a told subject holds included, grouped by subject', () => {
    declare()
    const groups = referencePage(session, 'status').entries
    expect(groups.map(group => [group.subject, group.name])).toEqual([['world', undefined], ['player', 'Arthur'], ['place', 'Bar'], ['person', 'Clara'], ['thing', 'Coin'], ['thing', 'Lamp']])
    const player = groups.find(group => group.subject === 'player')!
    expect(player.values).toContainEqual({ name: 'Stamina', value: '10' })
    expect(player.values).toContainEqual({ name: 'Trust', value: '20' })
    expect(player.values.filter(value => value.name.startsWith('Skill'))).toHaveLength(many)
  })

  it('never gives what is hidden, what is private to someone else, or what belongs to someone not met', () => {
    declare()
    session.variables.set('dread', 'character', session.characters.getBySourceId('clara')!.id, { value: 9 }, 1)
    session.variables.set('trust', 'character', session.characters.getBySourceId('dora')!.id, { value: 77 }, 1)
    session.variables.set('omen', 'world', 0, { value: true }, 1)
    const text = JSON.stringify(referencePage(session, 'status'))
    for (const secret of ['SECRET', 'Dora', '77', 'Omen']) expect(text, secret).not.toContain(secret)
    const clara = referencePage(session, 'status').entries.find(group => group.name === 'Clara')
    expect(clara?.values).toEqual([{ name: 'Trust', value: '20' }])
    expect(referencePage(session, 'status').entries.find(group => group.subject === 'player')?.values).toContainEqual({ name: 'Dread', value: '0' })
  })

  it('has nothing when nothing is tracked', () => {
    expect(referencePage(session, 'status').entries).toEqual([])
  })
})

describe('the reference pages', () => {
  it('lists the people at the player\'s place and those met, with only what can be seen', () => {
    const reply = referencePage(session, 'people')
    expect(reply.entries).toEqual([expect.objectContaining({ key: 'clara', name: 'Clara', publicState: 'Tired.', here: true })])
    expect(JSON.stringify(reply)).not.toMatch(/SECRET/)
  })

  it('describes the place the player is in and names the others known, without their text', () => {
    const reply = referencePage(session, 'places')
    expect(reply.entries.map(place => place.key)).toEqual(['bar', 'square'])
    expect(reply.entries[0]).toMatchObject({ here: true, description: 'Smoky.', features: ['Stage'], ways: [{ to: 'Square', toKey: 'square', open: true }] })
    expect(reply.entries[1]).not.toHaveProperty('description')
    expect(JSON.stringify(reply)).not.toMatch(/SECRET|Vault/)
  })

  it('lists what is carried and what lies here, never what is hidden', () => {
    expect(referencePage(session, 'things').entries).toEqual([{ name: 'Coin', quantity: 3, where: 'carried' }, { name: 'Lamp', quantity: 1, where: 'here' }])
  })

  it('lists the threads the player\'s character knows of and the promises they are part of, and keeps every other thread and engagement to the story', () => {
    const arthur = session.characters.getBySourceId('arthur')!.id
    const clara = session.characters.getBySourceId('clara')!.id
    const dora = session.characters.getBySourceId('dora')!.id
    session.threads.open('SECRET: the vault was emptied last night', 1)
    session.threads.open('Find out who sealed the vault', 1, true)
    const settled = session.threads.open('Return the lamp to the bar', 1, true)
    session.threads.resolve(settled.id, 2)
    const at = Date.UTC(1912, 9, 4, 21, 40)
    session.engagements.add({ title: 'Meet Clara at the stage', at, until: at + 3_600_000, locationId: session.locations.getBySourceId('bar')!.id, participants: [arthur, clara], note: 'Bring the key.', turn: 1 })
    session.engagements.add({ title: 'SECRET: Clara and Dora meet', at, participants: [clara, dora], turn: 1 })
    session.engagements.add({ title: 'Kept already', at, participants: [arthur], turn: 1 })
    session.engagements.update(3, { status: 'kept', turn: 2 })
    const entries = referencePage(session, 'quests', { zone: 'Europe/London', language: 'en' }).entries
    expect(entries).toEqual([
      { kind: 'commitment', text: 'Meet Clara at the stage', status: 'open', when: 'Friday 4 October 1912, 21:40', until: 'Friday 4 October 1912, 22:40', place: 'Bar', with: ['Clara'], note: 'Bring the key.', turn: 1 },
      { kind: 'story', text: 'Find out who sealed the vault', status: 'open', turn: 1 },
      { kind: 'story', text: 'Return the lamp to the bar', status: 'resolved', turn: 1, resolvedTurn: 2 },
    ])
    expect(JSON.stringify(entries)).not.toContain('SECRET')
    session.threads.tell(1)
    expect(referencePage(session, 'quests').entries.map(entry => entry.text)).toContain('SECRET: the vault was emptied last night')
  })

  it('writes the times of a promise in the story\'s language and zone, and shows nothing when nothing is known', () => {
    expect(referencePage(session, 'quests').entries).toEqual([])
    const arthur = session.characters.getBySourceId('arthur')!.id
    session.engagements.add({ title: '见面', at: Date.UTC(2026, 0, 5, 12, 0), participants: [arthur], turn: 1 })
    expect(referencePage(session, 'quests', { zone: 'Asia/Shanghai', language: 'zh' }).entries).toEqual([{ kind: 'commitment', text: '见面', status: 'open', when: '2026年1月5日 星期一 20:00', turn: 1 }])
  })

  it('refuses a page that does not exist', () => {
    expect(() => referencePage(session, 'secrets')).toThrow(UnknownSectionError)
  })
})

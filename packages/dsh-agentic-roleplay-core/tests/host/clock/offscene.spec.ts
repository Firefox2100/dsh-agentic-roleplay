import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { dueOffScene, markHandled } from '../../../src/host/clock/offscene.ts'

const at = (day: number, hour: number, min = 0): number => Date.UTC(1912, 9, day, hour, min)
let session: SessionStore
const id = (key: string): number => session.characters.getBySourceId(key)!.id

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, name, control] of [['arthur', 'Arthur', 'player'], ['clara', 'Clara', 'agent'], ['marcus', 'Marcus', 'agent'], ['eleanor', 'Eleanor', 'agent']] as const) {
    const { id: characterId } = session.characters.add({ ...base, sourceId, name, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(characterId, { publicState: '', innerState: '', activity: '' })
  }
  session.edit({ turn: 1, places: ['bar', 'shop', 'street'].map(key => ({ key, name: key[0]!.toUpperCase() + key.slice(1) })), moves: [
    { character: 'arthur', to: 'bar', ignoreExits: true }, { character: 'eleanor', to: 'bar', ignoreExits: true }, { character: 'clara', to: 'shop', ignoreExits: true }, { character: 'marcus', to: 'street', ignoreExits: true },
  ] })
})

describe('what falls due off stage', () => {
  const meeting = (extra: Partial<Parameters<SessionStore['engagements']['add']>[0]> = {}) => session.engagements.add({ title: 'meet at the bar', at: at(4, 21), locationId: session.locations.getBySourceId('bar')!.id, participants: [id('clara'), id('marcus')], note: 'about the ledger', turn: 1, ...extra })

  it('is a commitment whose time has come with everyone to do with it away from the player, told to them as theirs', () => {
    const e = meeting()
    const [item] = dueOffScene(session, 'UTC', at(4, 21, 25))
    expect(item).toMatchObject({ key: `e${e.id}`, kind: 'engagement', at: at(4, 21), characters: ['clara', 'marcus'], place: 'bar' })
    expect(item?.text).toBe('You were to meet at the bar at Bar, at 21:00 (about the ledger). It is 21:25 now. It was with: Clara, Marcus. You are not with the player\'s character, and nothing of this happens in front of anyone: decide what you do about it.')
    expect(dueOffScene(session, 'UTC', at(4, 21, 45))[0]?.text).toContain('It is 21:45 now and the time has passed.')
  })

  it('is not yet when its time has not come, nor when someone in it is with the player or is the player, nor when it is concluded', () => {
    meeting()
    expect(dueOffScene(session, 'UTC', at(4, 20, 59))).toEqual([])
    meeting({ participants: [id('clara'), id('eleanor')] })
    meeting({ participants: [id('clara'), id('arthur')] })
    const done = meeting()
    session.engagements.update(done.id, { status: 'kept', turn: 2 })
    expect(dueOffScene(session, 'UTC', at(4, 21, 30)).map(entry => entry.characters)).toEqual([['clara', 'marcus']])
  })

  it('is a goal whose deadline has passed, for a character away from the player', () => {
    const goal = (who: string, deadline: string) => session.intents.add(id(who), { type: 'obligation', name: 'Return the key', description: 'Promised Bob.', status: 'active', horizon: 'day', priority: 0.5, urgency: 0.5, plan: [], openThreads: [], constraints: [], deadline })
    const mine = goal('clara', new Date(at(4, 20)).toISOString())
    goal('eleanor', new Date(at(4, 20)).toISOString())
    goal('marcus', new Date(at(5, 20)).toISOString())
    const items = dueOffScene(session, 'UTC', at(4, 21))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: `g${mine.id}`, kind: 'goal', characters: ['clara'] })
    expect(items[0]?.text).toBe('The time you had for "Return the key" has passed (20:00; it is 21:00 now): Promised Bob. You are not with the player\'s character and nothing of this happens in front of anyone: decide what you do about it.')
  })

  it('is told in the language of the story', () => {
    meeting()
    expect(dueOffScene(session, 'UTC', at(4, 21, 25), 'zh')[0]?.text).toBe('你本应在Bar：meet at the bar，时间是21:00（about the ledger）。 现在是21:25。 同你一起的有：Clara，Marcus。 你不和玩家的角色在一起，这件事也不会发生在任何人面前：决定你要怎么处理。')
  })

  it('is dealt with once, and oldest first', () => {
    const late = meeting({ title: 'later one', at: at(4, 21, 10) })
    const early = meeting()
    expect(dueOffScene(session, 'UTC', at(4, 22)).map(entry => entry.key)).toEqual([`e${early.id}`, `e${late.id}`])
    markHandled(session, [`e${early.id}`])
    expect(dueOffScene(session, 'UTC', at(4, 22)).map(entry => entry.key)).toEqual([`e${late.id}`])
  })

  it('is nothing in a story without places, where nobody is away from anybody', () => {
    const bare = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    const { id: a } = bare.characters.add({ aliases: [], kind: 'person', tier: 'principal', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'a', name: 'A', role: 'npc', control: 'agent' })
    bare.engagements.add({ title: 'x', at: at(4, 21), participants: [a], turn: 1 })
    expect(dueOffScene(bare, 'UTC', at(4, 22))).toEqual([])
  })
})

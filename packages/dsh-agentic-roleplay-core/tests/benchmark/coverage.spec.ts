import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, type Session } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startSession, type StartSessionDeps } from '../../src/host/sessions/start-session.ts'
import type { RoleplayRoot } from '../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../src/host/worlds/catalog.ts'
import { LANGUAGES, pick, type Language } from './language.ts'
import { saltHarbor, SALT_HARBOR_ID } from './salt-harbor.ts'
import { writeFiles } from './write.ts'

let root: string
let state: RoleplayState
let deps: StartSessionDeps
let opened: { id: string; title: string; opening: readonly { type: string; text: string }[] | undefined }[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'benchmark-start-'))
  opened = []
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  deps = {
    worlds: new WorldCatalog(new Context(), { path: root } as RoleplayRoot),
    state,
    agent: { ensure: (id, title, opening) => { opened.push({ id, title, opening }); return Promise.resolve(`session-${id}`) }, retire: () => Promise.resolve() },
    sessionsDir: () => join(root, 'sessions'),
    root: () => root,
  }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function start(language: Language, player: string): Promise<{ session: Session; id: string }> {
  await writeFiles(join(root, 'worlds', `salt-harbor-${language}`), saltHarbor(language))
  const started = await startSession(deps, { worldId: SALT_HARBOR_ID[language], playerCharacterId: player })
  return { session: state.openSession(join(root, 'sessions'), started.id) as unknown as Session, id: started.id }
}

/**
 * What a story started from the benchmark world must hold, by feature. When something of the world stops reaching the story, the failing line names the feature.
 */
describe.each(LANGUAGES)('a story started from the benchmark world (%s)', (language) => {
  const t = pick(language)
  const named = (session: Session, name: string) => session.characters.list().find(character => character.name === name)!

  it('has the whole cast, who plays and who acts, and the kinds and tiers they were written with', async () => {
    const { session } = await start(language, 'mara')
    const cast = session.characters.list()
    expect(cast).toHaveLength(8)
    expect(cast.filter(character => character.control === 'player').map(character => character.sourceId)).toEqual(['mara'])
    expect(cast.find(character => character.sourceId === 'night-watch')).toMatchObject({ kind: 'group', tier: 'supporting' })
    expect(cast.find(character => character.sourceId === 'gull-seller')).toMatchObject({ kind: 'person', tier: 'background' })
    expect(cast.find(character => character.sourceId === 'quill')).toMatchObject({ role: 'playable', control: 'agent' })
    expect(named(session, t('Mara Venn', '玛拉·文'))).toMatchObject({ gender: 'female', pronouns: 'she/her', aliases: t(['the keeper\'s girl'], ['守塔人的女儿']) })
  })

  it('lets the other playable character be chosen instead', async () => {
    const { session } = await start(language, 'quill')
    expect(session.characters.list().filter(character => character.control === 'player').map(character => character.sourceId)).toEqual(['quill'])
  })

  it('keeps the places, their containment, features, every kind of way and the lock', async () => {
    const { session } = await start(language, 'mara')
    expect(session.locations.list()).toHaveLength(9)
    const place = (key: string) => session.locations.getBySourceId(key)!
    expect(place('pier').parentId).toBe(place('harbor').id)
    expect(place('pier').features.map(feature => feature.key)).toEqual(['mooring-stones', 'ferry-steps'])
    expect(session.locations.getExit(place('pier').id, place('lighthouse').id)).toMatchObject({ state: 'locked', travelSeconds: 600 })
    expect(session.locations.getExit(place('lighthouse').id, place('lighthouse-cellar').id)).toMatchObject({ state: 'blocked' })
    expect(session.locations.getExit(place('signal-room').id, place('pier').id)).toBeDefined()
    expect(session.locations.getExit(place('pier').id, place('signal-room').id)).toBeUndefined()
    expect(session.locations.getExit(place('market').id, place('pier').id)).toBeDefined()
  })

  it('places everyone where their file says, with the position and feature', async () => {
    const { session } = await start(language, 'mara')
    const at = (sourceId: string) => { const character = session.characters.getBySourceId(sourceId)!; const placement = session.placements.get('character', character.id)!; return { location: session.locations.get(placement.locationId)!.sourceId, position: placement.position } }
    expect(at('mara')).toEqual({ location: 'pier', position: t('at the foot of the ferry steps', '渡船台阶脚下') })
    expect(at('tomas').location).toBe('inn-bar')
    expect(at('bram').location).toBe('lighthouse-cellar')
    expect(at('night-watch').location).toBe('market')
  })

  it('starts each character with their public, active and private state', async () => {
    const { session } = await start(language, 'mara')
    const mara = session.characters.getBySourceId('mara')!
    expect(session.characterStates.get(mara.id)).toMatchObject({ publicState: t('Just off the ferry, soaked by the fog, looking up at the dark lighthouse.', '刚下渡船，被雾打得湿透，正抬头望着黑漆漆的灯塔。'), innerState: t('Afraid that her father\'s silence is her fault.', '担心父亲的沉默是自己造成的。') })
  })

  it('gives the cast their goals, with horizon, priority, plan and deadline', async () => {
    const { session } = await start(language, 'mara')
    const mara = session.characters.getBySourceId('mara')!
    const goals = session.intents.list(mara.id)
    expect(goals.map(goal => goal.type).sort()).toEqual(['agenda', 'quest'])
    expect(goals.find(goal => goal.type === 'quest')).toMatchObject({ horizon: 'short', priority: 0.9, plan: t(['Ask the innkeeper', 'Look at the lighthouse'], ['问客栈老板', '去看看灯塔']), deadline: '1887-10-06T00:00:00.000Z' })
  })

  it('keeps feelings as the three built-in values, with the temperament as baseline', async () => {
    const { session } = await start(language, 'mara')
    const mara = session.characters.getBySourceId('mara')!
    expect(session.variables.value('valence', 'character', mara.id)).toBeCloseTo(-0.2)
    expect(session.variables.value('dominance', 'character', session.characters.getBySourceId('ines')!.id)).toBeCloseTo(0.7)
  })

  it('keeps who sees whom, in each direction as written, with the numbers', async () => {
    const { session } = await start(language, 'mara')
    const id = (sourceId: string) => session.characters.getBySourceId(sourceId)!.id
    expect(session.relationships.get(id('mara'), id('bram'))).toMatchObject({ label: t('father', '父亲'), familiarity: 1, tension: 0.6 })
    expect(session.relationships.get(id('bram'), id('mara'))).toMatchObject({ label: t('daughter', '女儿') })
    expect(session.relationships.get(id('tomas'), id('ines'))).toMatchObject({ trust: -0.3 })
    expect(session.relationships.list().length).toBeGreaterThanOrEqual(14)
  })

  it('lets a character know only what its file says it knows: places, things, ways and background', async () => {
    const { session } = await start(language, 'mara')
    const mara = session.characters.getBySourceId('mara')!
    const kinds = (kind: 'location' | 'item' | 'exit' | 'lore') => session.knowledge.list(mara.id, kind).length
    expect(kinds('location')).toBeGreaterThanOrEqual(4)
    expect(kinds('item')).toBeGreaterThanOrEqual(1)
    expect(kinds('exit')).toBeGreaterThanOrEqual(1)
    expect(kinds('lore')).toBe(2)
    const cellar = session.locations.getBySourceId('lighthouse-cellar')!
    expect(session.knowledge.knows(mara.id, 'location', cellar.id)).toBe(false)
    expect(session.knowledge.knows(session.characters.getBySourceId('bram')!.id, 'location', cellar.id)).toBe(true)
  })

  it('keeps background of both scopes, who knows the listed ones, its dates and its links', async () => {
    const { session } = await start(language, 'mara')
    const lore = (sourceId: string) => session.lore.getBySourceId(sourceId)!
    expect(session.lore.list()).toHaveLength(8)
    expect(lore('harbor-founding').scope).toBe('everyone')
    expect(lore('cellar-secret').scope).toBe('listed')
    const knowers = (sourceId: string) => session.characters.list().filter(character => session.knowledge.knows(character.id, 'lore', lore(sourceId).id)).map(character => character.sourceId).sort()
    expect(knowers('cellar-secret')).toEqual(['bram', 'tomas'])
    expect(knowers('smugglers-signal')).toEqual(['bram', 'kit'])
    expect(lore('old-tide-law').endsAt).toBe(Date.parse('1885-12-31'))
    expect(lore('cellar-secret').related).toHaveLength(1)
    expect(lore('lighthouse-history').subjects).toHaveLength(1)
  })

  it('has the things, with who holds them, what is hidden, what is locked, what is worn and in what slot', async () => {
    const { session } = await start(language, 'mara')
    const item = (sourceId: string) => session.items.getBySourceId(sourceId)!
    expect(session.items.list()).toHaveLength(10)
    expect(item('lighthouse-key')).toMatchObject({ hidden: true, unique: true, notable: true })
    expect(item('strongbox').container).toEqual({ state: 'locked' })
    expect(session.items.openers({ kind: 'item', id: item('strongbox').id })).toEqual([item('harbor-key').id])
    expect(item('coins').quantity).toBe(12)
    expect(session.items.holding(item('oilskin-coat').id)?.holder).toMatchObject({ kind: 'character', mode: 'worn', slot: 'torso' })
    expect(session.items.holding(item('notebook').id)?.holder).toMatchObject({ kind: 'character', mode: 'worn', slot: 'satchel' })
    expect(session.items.holding(item('harbor-key').id)?.holder).toMatchObject({ kind: 'character', mode: 'held' })
    expect(session.items.holding(item('ledger').id)?.holder).toMatchObject({ kind: 'location' })
    expect(item('ledger').ownerId).toBe(session.characters.getBySourceId('tomas')!.id)
    const lock = session.locations.getExit(session.locations.getBySourceId('pier')!.id, session.locations.getBySourceId('lighthouse')!.id)!
    expect(session.items.openers({ kind: 'exit', id: lock.id })).toEqual([item('lighthouse-key').id])
  })

  it('adds the slots the world declares to the usual ones', async () => {
    const { session } = await start(language, 'mara')
    expect(session.slots.list().map(slot => slot.id)).toContain('satchel')
  })

  it('has the organisations with their state, goals, members (secret ones too) and how they see others', async () => {
    const { session } = await start(language, 'mara')
    const guild = session.factions.getBySourceId('harbor-guild')!
    expect(session.factionStates.get(guild.id)?.publicState).toBe(t('Meeting daily about the closed road.', '每天开会商议封路的事。'))
    expect(session.factionIntents.list(guild.id, { status: 'active' })).toHaveLength(1)
    const tomas = session.characters.getBySourceId('tomas')!
    expect(session.factionMemberships.ofCharacter(tomas.id)).toEqual([expect.objectContaining({ factionId: guild.id, public: false })])
    expect(session.factionRelationships.get('faction', guild.id, 'faction', session.factions.getBySourceId('lamp-keepers')!.id)).toMatchObject({ label: t('rival', '对手') })
    expect(session.factionRelationships.get('faction', guild.id, 'character', session.characters.getBySourceId('bram')!.id)).toBeDefined()
  })

  it('tracks values of every kind and subject, with the starting values the files gave', async () => {
    const { session } = await start(language, 'mara')
    const defs = session.variables.defs()
    expect(defs.filter(def => !def.builtin).map(def => def.key).sort()).toEqual(['crowd', 'fatigue', 'harbor_trust', 'hunger', 'injury', 'lamp_oil', 'storm_warning', 'suspicion', 'weather'])
    expect(new Set(defs.filter(def => !def.builtin).map(def => def.kind))).toEqual(new Set(['number', 'flag', 'choice']))
    expect(new Set(defs.filter(def => !def.builtin).map(def => def.subject))).toEqual(new Set(['world', 'character', 'item', 'location']))
    const mara = session.characters.getBySourceId('mara')!
    expect(session.variables.value('fatigue', 'character', mara.id)).toBe(3)
    expect(session.variables.value('suspicion', 'character', session.characters.getBySourceId('tomas')!.id)).toBe(2)
    expect(session.variables.value('lamp_oil', 'item', session.items.getBySourceId('lantern')!.id)).toBe(80)
    expect(session.variables.value('crowd', 'location', session.locations.getBySourceId('market')!.id)).toBe(6)
    expect(session.variables.value('storm_warning', 'world', 0)).toBe(false)
    expect(session.variables.value('weather', 'world', 0)).toBe(t('fog', '雾'))
    expect(defs.find(def => def.key === 'suspicion')?.only).toEqual(['tomas', 'ines'])
    expect(defs.find(def => def.key === 'harbor_trust')).toMatchObject({ visibility: 'hidden', always: true })
  })

  it('has the triggers, what each waits on and what each does, and the announcement of the one that is known beforehand', async () => {
    const { session } = await start(language, 'mara')
    const triggers = session.triggers.list()
    expect(triggers.map(trigger => trigger.key).sort()).toEqual(['at-the-lighthouse', 'fog-bell-rings', 'key-found', 'storm-breaks'])
    expect(new Set(triggers.map(trigger => trigger.condition.type))).toEqual(new Set(['time', 'variable', 'item', 'place']))
    expect(new Set(triggers.flatMap(trigger => trigger.effects.map(effect => effect.type)))).toEqual(new Set(['beat', 'cue', 'edit']))
    expect(triggers.find(trigger => trigger.key === 'fog-bell-rings')?.announce).toMatchObject({ audience: 'everyone' })
  })

  it('has the routines, with the calendar they refer to', async () => {
    const { session } = await start(language, 'mara')
    const tomas = session.characters.getBySourceId('tomas')!
    expect(session.routines.list(tomas.id)).toHaveLength(4)
    expect(session.routines.list(tomas.id)[0]).toMatchObject({ on: ['!holiday:fog-festival'] })
    expect(session.routines.list(session.characters.getBySourceId('ines')!.id)[0]?.days).toEqual([1, 2, 3, 4, 5, 6])
    expect(JSON.stringify(session.metadata.getValue('calendar'))).toContain('fog-festival')
  })

  it('has the world\'s dice checks, a plot and the rules, and starts the clock at the time the world gives', async () => {
    const { session, id } = await start(language, 'mara')
    expect(session.dice.checks().map(check => check.key)).toEqual(['notice', 'endure'])
    expect(JSON.stringify(session.metadata.getValue('roleplay.pacing.plots'))).toContain('the-dark-lamp')
    expect(session.metadata.getValue('rules')).toHaveLength(2)
    expect(session.clock.get()?.now).toBe(Date.parse('1887-10-03T18:30:00Z'))
    expect(existsSync(join(root, 'sessions', id, 'prompts', language, 'roleplay', 'style.md'))).toBe(true)
  })

  it('opens the chat with the world\'s opening, spoken lines included, and the alternate opening only for its character', async () => {
    await start(language, 'mara')
    expect(opened[0]?.opening?.map(part => part.type)).toEqual(['narration', 'utterance'])
    expect(opened[0]?.opening?.[1]?.text).toBe(t('You are the keeper\'s girl, aren\'t you? Come in out of the fog before the bell rings.', '你是守塔人的女儿吧？趁钟声响起之前，快进屋避避雾。'))
  })
})

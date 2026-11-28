import { beforeEach, describe, expect, it } from 'vitest'
import { sharedContext } from '../../../src/host/orchestration/defaults.ts'
import { heardBy } from '../../../src/host/orchestration/store.ts'
import { alice, arthur, fakeStore, type FakeStore } from './fixtures.ts'

let store: FakeStore
const id = (key: string) => store.story.characters.getBySourceId(key)!.id
const witnessed = (...who: string[]) => who.map(character => ({ character, mode: 'witnessed' as const }))

beforeEach(() => {
  store = fakeStore([arthur, alice])
  for (const key of ['arthur', 'alice', 'stranger']) store.story.characters.add({ sourceId: key, name: key === 'arthur' ? 'Arthur' : key === 'alice' ? 'Alice' : 'Stranger', aliases: [], kind: 'person', tier: 'principal', role: key === 'arthur' ? 'playable' : 'npc', control: key === 'arthur' ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
})

/** Arthur says the cellar is flooded (Alice hears); Alice later sees it is dry (Alice and Arthur see). */
const settle = (status: 'confirmed' | 'proposed') => {
  const made = store.story.edit({
    turn: 1,
    events: [
      { turn: 1, round: 1, text: 'Arthur says the cellar is flooded.', importance: 2, perceivedBy: witnessed('arthur', 'alice') },
      { turn: 2, round: 1, text: 'The cellar is dry when Alice opens it.', importance: 2, perceivedBy: witnessed('alice') },
    ],
    claims: [{ text: 'The cellar is flooded.', byCharacter: 'arthur', assertedInNew: 0, links: [{ eventNew: 1, as: 'contradicts' }] }],
  } as never)
  const claim = made.claimIds![0]!
  if (status === 'confirmed') store.story.edit({ turn: 2, claimStatuses: [{ claim, status }] })
  return claim
}

describe('what a character has heard, by its own events', () => {
  it('gives a settled claim the standing only the events the character took in give it', () => {
    settle('confirmed')
    const situation = 'Alice looks at the cellar.'
    expect(heardBy(store.story as never, id('alice'), situation, [id('alice')])).toEqual([{ text: 'The cellar is flooded.', by: 'Arthur', standing: 'false' }])
  })

  it('keeps back a claim nobody settled, one the character never heard, and one that has nothing to do with the moment', () => {
    settle('proposed')
    expect(heardBy(store.story as never, id('alice'), 'Alice looks at the cellar.', [id('alice')])).toEqual([])
    store.story.edit({ turn: 3, claimStatuses: [{ claim: store.story.claims.list()[0]!.id, status: 'confirmed' }] })
    expect(heardBy(store.story as never, id('stranger'), 'The stranger looks at the cellar.', [id('stranger')])).toEqual([])
    expect(heardBy(store.story as never, id('alice'), 'Alice thinks about supper.', [id('alice')])).toEqual([])
  })

  it('is told to the character in its own words, and not at all when nothing was heard', () => {
    settle('confirmed')
    const heard = heardBy(store.story as never, id('alice'), 'Alice looks at the cellar.', [id('alice')])
    const request = { member: { character: store.story.characters.get(id('alice'))!, key: 'alice' }, cast: [], situation: 'Alice looks at the cellar.', attempt: 1, language: 'en', turn: 2, lookup: false, text: () => '', heard } as never
    expect(JSON.stringify(sharedContext.brief(request))).toContain('(what you saw says it is not so)')
    expect(JSON.stringify(sharedContext.brief({ ...(request as object), heard: [] } as never))).not.toContain('What you have heard said')
  })
})

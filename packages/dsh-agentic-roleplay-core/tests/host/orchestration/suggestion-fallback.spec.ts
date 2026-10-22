import { describe, expect, it } from 'vitest'
import type { PlaceView } from '../../../src/host/orchestration/boundaries.ts'
import { fallbackSuggestions } from '../../../src/host/orchestration/suggestion-fallback.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { alice, arthur, bob, fakeStore, location, placed } from './fixtures.ts'

const hall = location(1, 'Hall')
const cellar = location(2, 'Cellar')

function storeWith(view: Partial<PlaceView>, language = 'en') {
  const cast = [placed(arthur, hall), placed(alice, hall), placed(bob, cellar)]
  const store = fakeStore(cast)
  store.settings = () => ({ ...DEFAULT_SETTINGS, prompts: { ...DEFAULT_SETTINGS.prompts, language } })
  store.place = () => ({ key: 'hall', location: hall, here: [cast[0]!, cast[1]!], exits: [], ...view })
  return store
}

const exit = (name: string, state: 'open' | 'locked') => ({ key: name.toLowerCase(), name, exit: { state } as never })
const item = (name: string, hidden = false) => ({ key: name.toLowerCase(), name, quantity: 1, quality: '', notable: false, hidden })

describe('suggestions made from the story\'s data', () => {
  it('offer someone present, an open way and a visible thing, one of each in turn, and never the player or what is hidden or shut', () => {
    const store = storeWith({ exits: [exit('Cellar', 'open'), exit('Vault', 'locked')], items: [item('lantern'), item('ledger', true)] })
    expect(fallbackSuggestions(store, 3)).toEqual(['Talk to Alice.', 'Go to Cellar.', 'Take a closer look at lantern.'])
  })

  it('fill what the story cannot supply with plain standbys, always exactly as many as asked', () => {
    expect(fallbackSuggestions(storeWith({}), 3)).toEqual(['Talk to Alice.', 'Look around carefully.', 'Wait and see what happens.'])
    expect(fallbackSuggestions(storeWith({}), 1)).toEqual(['Talk to Alice.'])
  })

  it('have no places to draw on in a world without them, and still answer', () => {
    const store = fakeStore([arthur, alice])
    expect(fallbackSuggestions(store, 2)).toEqual(['Look around carefully.', 'Wait and see what happens.'])
  })

  it('are written in the language of the chat', () => {
    expect(fallbackSuggestions(storeWith({ exits: [exit('Cellar', 'open')] }, 'zh'), 2)).toEqual(['和Alice聊聊。', '前往Cellar。'])
  })

  it('give nothing when asked for more than can be told apart', () => {
    expect(fallbackSuggestions(storeWith({}), 9)).toEqual([])
  })
})

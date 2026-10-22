import { describe, expect, it } from 'vitest'
import { canonicalTags, tagUsage } from '../../../src/host/memory/tags.ts'

describe('the tag vocabulary', () => {
  const known = tagUsage([{ tags: ['tavern', 'letter'] }, { tags: ['tavern', 'Vault-Door'] }, { tags: ['letter'] }, { tags: ['tavern'] }])

  it('counts the tags in use, most used first, ignoring case and separators', () => {
    expect([...known]).toEqual([['tavern', 3], ['letter', 2], ['vault-door', 1]])
  })

  it('keeps a tag in use and brings the same word spelled differently onto it', () => {
    expect(canonicalTags(known, ['Tavern', 'letters', 'vault_door', 'vault door'])).toEqual(['tavern', 'letter', 'vault-door'])
  })

  it('brings a word one letter off in a long word onto the tag in use, but not a short one', () => {
    expect(canonicalTags(known, ['tavarn', 'tavern'])).toEqual(['tavern'])
    expect(canonicalTags(known, ['mapp'])).toEqual(['mapp'])
  })

  it('lets a tag that matches nothing stand, and drops blanks and repeats', () => {
    expect(canonicalTags(known, ['cellar', ' ', 'cellar', '酒馆'])).toEqual(['cellar', '酒馆'])
  })

  it('starts from nothing', () => {
    expect(canonicalTags(new Map(), ['Inn Keeper'])).toEqual(['inn-keeper'])
  })
})

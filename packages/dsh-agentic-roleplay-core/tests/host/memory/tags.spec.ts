import { describe, expect, it } from 'vitest'
import { canonicalLabel, canonicalTags, labelUsage, tagUsage } from '../../../src/host/memory/tags.ts'

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

describe('relationship labels', () => {
  const known = labelUsage(['Rival', 'rival', 'old friend', 'Mentor'])

  it('count each spelling and list the most used first', () => {
    expect([...known]).toEqual([['Rival', 2], ['Mentor', 1], ['old friend', 1]])
  })

  it('bring a respelling onto the label in use and leave a new bond alone', () => {
    expect(canonicalLabel(known, 'Old  Friend')).toBe('old friend')
    expect(canonicalLabel(known, 'rivals')).toBe('Rival')
    expect(canonicalLabel(known, 'mentors')).toBe('Mentor')
    expect(canonicalLabel(known, 'blood oath')).toBe('blood oath')
  })
})

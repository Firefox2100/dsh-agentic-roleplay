import type { Character } from 'dsh-roleplay-model'

/**
 * How a person is named wherever the text may go on to say what they do: the name with the pronouns the world gave them, or the gender when only that is given.
 * A model that is not told guesses, and a wrong guess written into a record or a narration is never corrected; nothing is made up when the world says neither.
 */
export function referent(character: Pick<Character, 'name' | 'pronouns' | 'gender'>): string {
  const mark = [character.pronouns, character.gender].find(text => text !== undefined && text.trim() !== '')?.trim()
  return mark === undefined ? character.name : `${character.name} (${mark})`
}

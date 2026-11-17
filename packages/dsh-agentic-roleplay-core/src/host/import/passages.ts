/** Finding a model's copy of a passage in the text it was copied from. */

const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The letters and digits of a text, folded, each with where it stands in the text: two copies of a passage that differ only in spacing, quotes, markup or punctuation have the same ones. */
function lettersOf(text: string): { letters: string; at: number[] } {
  let letters = ''
  const at: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (!/[\p{L}\p{N}]/u.test(char)) continue
    const folded = char.normalize('NFKC').toLowerCase()
    for (let part = 0; part < folded.length; part += 1) { letters += folded[part]; at.push(index) }
  }
  return { letters, at }
}

/** The fewest letters a passage must have to be found by its letters alone: a shorter one could be anywhere. */
const MIN_SNAP_LETTERS = 12

/** A passage as the piece has it: the passage itself when the piece holds it (whatever its spacing), else the stretch of the piece with the same letters in the same order, else nothing. */
export function snapPassage(passage: string, source: string): string | undefined {
  if (squeezed(passage) === '') return undefined
  if (squeezed(source).includes(squeezed(passage))) return passage
  const wanted = lettersOf(passage).letters
  if (wanted.length < MIN_SNAP_LETTERS) return undefined
  const whole = lettersOf(source)
  const found = whole.letters.indexOf(wanted)
  if (found < 0) return undefined
  return source.slice(whole.at[found]!, whole.at[found + wanted.length - 1]! + 1)
}

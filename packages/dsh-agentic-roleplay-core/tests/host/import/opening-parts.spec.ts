import { describe, expect, it, vi } from 'vitest'
import { lettersOf, mendParts, partsOf, tidyQuotes, shapeOpening, splitProblem, type Speaker } from '../../../src/host/import/opening-parts.ts'
import type { ImportContext } from '../../../src/host/import/run.ts'

const cast: Speaker[] = [{ id: 'alice', name: 'Alice', aliases: ['Al'] }, { id: 'you', name: 'Rowan', aliases: [] }, { id: 'bram', name: 'Bram', aliases: [] }]
const passage = 'Get out of my way, you dweeb.\nAlice bumps into you on purpose.'

const context = (over: Partial<ImportContext> & { answer?: unknown }): ImportContext & { ran: ReturnType<typeof vi.fn> } => {
  const ran = vi.fn(async (job: { check?: (value: never) => string | undefined }) => {
    const answer = over.answer as never
    const problem = job.check?.(answer)
    if (problem !== undefined) throw new Error(problem)
    return answer
  })
  return { run: ran as never, ran, concurrency: 1, text: (id: string) => id, say: () => undefined, ...over } as never
}

describe('splitting an opening into parts', () => {
  it('compares the letters of a passage, not its quotation marks, emphasis or spacing', () => {
    expect(lettersOf('"Hello,"  *she* said.\n')).toBe('Hello,shesaid.')
    expect(lettersOf('Alice: Hi there.\nNarration.', cast)).toBe('Hithere.Narration.')
  })

  it('refuses parts that change, drop or add words', () => {
    const parts = partsOf({ parts: [{ speaker: 'Alice', text: 'Get out of my way, you dweeb.' }, { speaker: '', text: 'Alice bumps into you on purpose.' }] }, cast, 'you')
    expect(splitProblem(passage, parts, cast)).toBeUndefined()
    expect(splitProblem(passage, parts.slice(0, 1), cast)).toMatch(/exactly the words/)
    expect(splitProblem(passage, [{ type: 'narration', text: 'Something else.' }], cast)).toMatch(/exactly the words/)
    expect(splitProblem(passage, [], cast)).toMatch(/no parts/)
  })

  it('makes a speaker that is nobody, or the player, narration', () => {
    const parts = partsOf({ parts: [{ speaker: 'Stranger', text: 'Hm.' }, { speaker: 'Rowan', text: 'No.' }, { speaker: 'al', text: 'Yes.' }, { speaker: '', text: '  ' }] }, cast, 'you')
    expect(parts).toEqual([{ type: 'narration', text: 'Hm.' }, { type: 'narration', text: 'No.' }, { type: 'utterance', character: 'alice', text: 'Yes.' }])
  })

  it('gives a speaker only to a part called speech, and says where a split departs from the passage', () => {
    expect(partsOf({ parts: [{ kind: 'narration', speaker: 'Alice', text: 'Alice frowns.' }, { kind: 'speech', speaker: 'Alice', text: 'No.' }] }, cast, 'you')).toEqual([{ type: 'narration', text: 'Alice frowns.' }, { type: 'utterance', character: 'alice', text: 'No.' }])
    const problem = splitProblem('One two three four.', [{ type: 'narration', text: 'One two' }, { type: 'narration', text: 'four.' }], cast)
    expect(problem).toMatch(/agree up to/)
    expect(problem).toMatch(/three/)
  })

  it('puts back, as narration, a sentence the model skipped between parts, and leaves an answer that is not in the passage alone', () => {
    const source = '"Hi," you say. Mira nods without looking up. "Morning. Sit anywhere."'
    const skipped = [{ type: 'narration' as const, text: '"Hi," you say.' }, { type: 'utterance' as const, character: 'mira', text: 'Morning. Sit anywhere.' }]
    const mended = mendParts(source, skipped, cast)
    expect(mended.map(part => part.text)).toEqual(['"Hi," you say.', 'Mira nods without looking up.', 'Morning. Sit anywhere.'])
    expect(splitProblem(source, mended, cast)).toBeUndefined()
    const invented = [{ type: 'narration' as const, text: 'Something that is not there.' }]
    expect(mendParts(source, invented, cast)).toEqual(invented)
  })

  it('takes off the quotation marks a cut left at the edges of a part, and the ones around a whole line, and keeps a balanced quotation inside', () => {
    expect(tidyQuotes('“你来晚了，')).toBe('你来晚了，')
    expect(tidyQuotes('”他说，“面粉可不等人。”')).toBe('他说，“面粉可不等人。”')
    expect(tidyQuotes('“Morning. Sit anywhere.”')).toBe('Morning. Sit anywhere.')
    expect(tidyQuotes('"Stop!"')).toBe('Stop!')
    expect(tidyQuotes('The sign reads "Closed".')).toBe('The sign reads "Closed".')
    expect(tidyQuotes('"No.')).toBe('No.')
  })

  it('keeps the opening as it is when there is no model, no one to speak, or nothing to read', async () => {
    const none = context({ noModel: true })
    expect(await shapeOpening(none, passage, cast, 'you')).toEqual({ text: passage })
    expect(none.ran).not.toHaveBeenCalled()
    expect(await shapeOpening(context({}), passage, [cast[1]!], 'you')).toEqual({ text: passage })
    expect(await shapeOpening(context({}), '  ', cast, 'you')).toEqual({ text: '  ' })
  })

  it('splits with the language model alone, and keeps pure narration plain', async () => {
    const split = await shapeOpening(context({ answer: { parts: [{ speaker: 'Alice', text: 'Get out of my way, you dweeb.' }, { speaker: '', text: 'Alice bumps into you on purpose.' }] } }), passage, cast, 'you')
    expect(split.parts).toEqual([{ type: 'utterance', character: 'alice', text: 'Get out of my way, you dweeb.' }, { type: 'narration', text: 'Alice bumps into you on purpose.' }])
    const narration = 'Right by the "The Boat" pub, two shadows wait.'
    expect(await shapeOpening(context({ answer: { parts: [{ speaker: '', text: narration }] } }), narration, cast, 'you')).toEqual({ text: narration })
  })

  it('lets a sure no of the decision model keep it plain without asking the language model', async () => {
    const decide = vi.fn(() => Promise.resolve(new Map([['speech', 0.02]])))
    const ctx = context({ decide, confidence: 0.7 })
    expect(await shapeOpening(ctx, passage, cast, 'you')).toEqual({ text: passage })
    expect(ctx.ran).not.toHaveBeenCalled()
  })

  it('asks the language model for a yes or an unsure answer, and when the decision model fails', async () => {
    const answer = { parts: [{ speaker: 'Alice', text: 'Get out of my way, you dweeb.' }, { speaker: '', text: 'Alice bumps into you on purpose.' }] }
    for (const decide of [vi.fn(() => Promise.resolve(new Map([['speech', 0.97]]))), vi.fn(() => Promise.resolve(new Map([['speech', 0.5]]))), vi.fn(() => Promise.reject(new Error('down')))]) {
      const ctx = context({ decide, answer, confidence: 0.7 })
      expect((await shapeOpening(ctx, passage, cast, 'you')).parts).toHaveLength(2)
      expect(ctx.ran).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the plain text, with a note, when the split changes the words', async () => {
    const shaped = await shapeOpening(context({ answer: { parts: [{ speaker: 'Alice', text: 'Move.' }] } }), passage, cast, 'you')
    expect(shaped.text).toBe(passage)
    expect(shaped.parts).toBeUndefined()
    expect(shaped.note).toMatch(/kept as plain text/)
  })
})

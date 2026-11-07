import { describe, expect, it } from 'vitest'
import { transientPrompt } from '../../../src/host/images/generator.ts'

const subject = (name: string, tags: string[], negativeTags: string[]) => ({
  kind: 'character' as const, name, transient: '', identity: { description: `${name} looks like themselves.`, tags, negativeTags },
}) as never

describe('the prompt of a scene image', () => {
  it('avoids what a subject must not look like, once', () => {
    const prompt = transientPrompt({ scene: 'A quiet bar.', subjects: [subject('Ann', ['tall'], ['bald', 'hat']), subject('Ben', ['short'], ['hat'])] })
    expect(prompt).toContain('Avoid: bald, hat.')
  })

  it('does not avoid a trait another subject of the same picture has', () => {
    const prompt = transientPrompt({ scene: 'A quiet bar.', subjects: [subject('Ann', ['welcoming smile', 'Barmaid'], ['sharp features']), subject('Ben', ['reserved'], ['Welcoming Smile', 'barmaid', 'scar'])] })
    expect(prompt).toContain('Avoid: sharp features, scar.')
    expect(prompt).not.toMatch(/Avoid:.*smile/i)
  })

  it('says nothing about avoiding when nothing is left to avoid', () => {
    expect(transientPrompt({ scene: 'A quiet bar.', subjects: [subject('Ann', ['red hair'], []), subject('Ben', ['smile'], ['red hair'])] })).not.toContain('Avoid')
  })
})

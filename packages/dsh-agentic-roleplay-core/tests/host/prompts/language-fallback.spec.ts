import { describe, expect, it } from 'vitest'
import { shippedText } from '../../../src/host/prompts/library.ts'

describe('a language without prompts of its own', () => {
  it('is given the English ones, with the instruction to write in the language by its own name', () => {
    const ja = shippedText('roleplay/reflection', 'ja')
    expect(ja).toContain('日本語')
    expect(ja.replace('日本語', 'English')).toBe(shippedText('roleplay/reflection', 'en'))
  })
})

import { describe, expect, it } from 'vitest'
import { compareLines } from '../../../src/client/pages/prompts/prompt-diff.ts'

describe('comparing a prompt with the shipped one', () => {
  it('marks the shipped lines the text does not have and counts the lines it has of its own', () => {
    const result = compareLines('one\n\ntwo\nthree\n', 'one\r\nthree  \nmine\nmore')
    expect(result.shipped).toEqual([{ text: 'one', missing: false }, { text: '', missing: false }, { text: 'two', missing: true }, { text: 'three', missing: false }])
    expect(result.extra).toBe(2)
  })

  it('finds nothing to mark in the same text', () => {
    expect(compareLines('a\nb\n', 'a\nb').shipped.every(line => !line.missing)).toBe(true)
    expect(compareLines('a\nb\n', 'a\nb').extra).toBe(0)
  })
})

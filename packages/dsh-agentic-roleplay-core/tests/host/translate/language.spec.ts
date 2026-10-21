import { describe, expect, it } from 'vitest'
import { strayWords, wrongLanguage } from '../../../src/host/translate/language.ts'

const ENGLISH = 'I cannot swear to the exact day, but the director stopped coming a week before the festival.'
const CHINESE = '我说不准具体是哪一天，不过主任在庆典前一周就不再来了，这点我倒是记得很清楚。'

describe('wrongLanguage', () => {
  it('accepts texts in the wanted language and names the ones that are not', () => {
    expect(wrongLanguage('zh', { utterance: CHINESE, intent: CHINESE })).toBeUndefined()
    expect(wrongLanguage('zh', { utterance: ENGLISH, intent: CHINESE })).toMatch(/^utterance is written in English: write it in Chinese/)
    expect(wrongLanguage('en', { utterance: CHINESE })).toMatch(/written in Chinese: write it in English/)
  })

  it('leaves alone what is too short to tell, what is missing, and languages it cannot read', () => {
    expect(wrongLanguage('zh', { utterance: 'Yes.', intent: undefined })).toBeUndefined()
    expect(wrongLanguage('fr', { utterance: ENGLISH })).toBeUndefined()
  })
})

describe('English words left in a Chinese text', () => {
  const line = '我在酒馆里坐了一会儿，然后 handle 了这件事，他说 okay，别担心。'

  it('finds ordinary words and says which, when asked', () => {
    expect(strayWords(line)).toEqual(['handle', 'okay'])
    expect(wrongLanguage('zh', { utterance: line }, { strays: true })).toBe('utterance leaves English words in ("handle", "okay"): write it in Chinese (中文)')
    expect(wrongLanguage('zh', { utterance: line })).toBeUndefined()
  })

  it('leaves names, acronyms, product names and plain Chinese alone, and only matters for Chinese', () => {
    expect(strayWords('阿瑟在 Iron Stag Inn 里喝了一杯，用 iPhone 看了 NASA 的消息，又读了 e-mail。')).toEqual([])
    expect(strayWords('他只是点了点头，什么也没说。')).toEqual([])
    expect(wrongLanguage('en', { narration: 'He sat down at the bar and 如月真白 smiled and said nothing at all.' }, { strays: true })).toBeUndefined()
  })
})

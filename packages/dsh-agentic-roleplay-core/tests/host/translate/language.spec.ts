import { describe, expect, it } from 'vitest'
import { wrongLanguage } from '../../../src/host/translate/language.ts'

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

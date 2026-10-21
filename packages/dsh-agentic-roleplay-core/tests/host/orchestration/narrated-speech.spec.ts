import { describe, expect, it } from 'vitest'
import { narratedSpeech } from '../../../src/host/orchestration/character-runner.ts'

describe('speech with actions between the lines', () => {
  it('refuses an utterance that quotes twice with a description in between', () => {
    expect(narratedSpeech('“Stay here.” I step between him and the bar, slowly, so the others can see. “We are not done.”')).toContain('nothing between')
    expect(narratedSpeech('“留下。”我侧身挡在他和吧台之间，让旁人看清。“我们还没完。”')).toContain('nothing between')
  })

  it('lets plain speech through, quotes inside it included', () => {
    expect(narratedSpeech('Stay here, and do not say "no" to me.')).toBeUndefined()
    expect(narratedSpeech('“Stay here.” “Now.”')).toBeUndefined()
    expect(narratedSpeech('“An unfinished quotation does not count.')).toBeUndefined()
    expect(narratedSpeech(undefined)).toBeUndefined()
  })

  it('recognises the other supported quotation marks', () => {
    expect(narratedSpeech('「留下。」我慢慢挡住门口，不让任何人经过。「现在。」')).toContain('nothing between')
    expect(narratedSpeech('『留下。』我慢慢挡住门口，不让任何人经过。『现在。』')).toContain('nothing between')
  })
})

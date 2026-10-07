import { describe, expect, it } from 'vitest'
import { TtsService, type TtsOptions, type TtsResult } from 'dsh-ai-core'
import { speakParts } from '../../../src/host/speech/service.ts'

class Speech extends TtsService {
  readonly provider = 'test'; readonly model = 'voice-1'; readonly calls: { text: string; voice?: string }[] = []
  synthesize(text: string, options: TtsOptions = {}): Promise<TtsResult> { this.calls.push({ text, ...(options.voice === undefined ? {} : { voice: options.voice }) }); return Promise.resolve({ audio: new Blob([text]).stream(), mediaType: 'audio/mpeg', model: this.model }) }
}

function wav(data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(44 + data.length)
  const view = new DataView(bytes.buffer)
  const write = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at)
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8_000, true)
  view.setUint32(28, 8_000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, data.length, true)
  bytes.set(data, 44)
  return bytes
}

describe('roleplay speech', () => {
  it('synthesizes every segment with its own voice and merges them in story order', async () => {
    const service = new Speech(); const answer = await speakParts(service, [{ text: 'Narration.', voice: 'narrator' }, { text: 'Hello.', voice: 'clara' }])
    expect(service.calls).toEqual([{ text: 'Narration.', voice: 'narrator' }, { text: 'Hello.', voice: 'clara' }])
    expect(new TextDecoder().decode(answer.bytes)).toBe('Narration.Hello.')
  })

  it('merges WAV samples under one valid header', async () => {
    class WavSpeech extends Speech {
      override synthesize(text: string): Promise<TtsResult> {
        return Promise.resolve({ audio: new Blob([wav(new TextEncoder().encode(text))]).stream(), mediaType: 'audio/wav', model: this.model })
      }
    }
    const answer = await speakParts(new WavSpeech(), [{ text: 'ab' }, { text: 'cd' }])
    const view = new DataView(answer.bytes.buffer)
    expect(view.getUint32(4, true)).toBe(40)
    expect(view.getUint32(40, true)).toBe(4)
    expect(new TextDecoder().decode(answer.bytes.subarray(44))).toBe('abcd')
  })
})

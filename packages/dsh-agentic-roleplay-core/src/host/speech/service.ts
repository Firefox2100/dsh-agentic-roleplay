import type { TtsService, TtsVoice } from '@dsh-ai-providers/core'

export interface SpeechPart { text: string; voice?: string }
export interface SpeechAudio { bytes: Uint8Array; mediaType: string }

export async function voicesOf(service: TtsService): Promise<TtsVoice[]> { return await service.voices() }

/** Synthesize independently so every speaker keeps its voice, then join the audio in story order. */
export async function speakParts(service: TtsService, parts: readonly SpeechPart[]): Promise<SpeechAudio> {
  if (parts.length === 0 || parts.some(part => part.text.trim() === '')) throw new RangeError('speech needs non-empty text')
  const results = await Promise.all(parts.map(async part => await service.synthesize(part.text, part.voice === undefined || part.voice.trim() === '' ? {} : { voice: part.voice.trim() })))
  const mediaType = results[0]!.mediaType
  if (results.some(result => result.mediaType !== mediaType)) throw new Error('the speech provider returned incompatible audio formats')
  const buffers = await Promise.all(results.map(async result => new Uint8Array(await new Response(result.audio).arrayBuffer())))
  if (mediaType === 'audio/wav' || mediaType === 'audio/x-wav') return { bytes: mergeWav(buffers), mediaType }
  const bytes = new Uint8Array(buffers.reduce((sum, value) => sum + value.length, 0)); let offset = 0
  for (const buffer of buffers) { bytes.set(buffer, offset); offset += buffer.length }
  return { bytes, mediaType }
}

interface WavParts { prefix: Uint8Array; format: Uint8Array; data: Uint8Array; dataSizeAt: number }

function readWav(bytes: Uint8Array): WavParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (at: number, length: number) => new TextDecoder().decode(bytes.subarray(at, at + length))
  if (bytes.length < 44 || word(0, 4) !== 'RIFF' || word(8, 4) !== 'WAVE') throw new Error('the speech provider returned invalid WAV audio')
  let at = 12
  let format: Uint8Array | undefined
  while (at + 8 <= bytes.length) {
    const id = word(at, 4)
    const size = view.getUint32(at + 4, true)
    const end = at + 8 + size
    if (end > bytes.length) throw new Error('the speech provider returned invalid WAV audio')
    if (id === 'fmt ') format = bytes.slice(at + 8, end)
    if (id === 'data') {
      if (format === undefined) throw new Error('the speech provider returned invalid WAV audio')
      return { prefix: bytes.slice(0, at + 8), format, data: bytes.slice(at + 8, end), dataSizeAt: at + 4 }
    }
    at = end + (size % 2)
  }
  throw new Error('the speech provider returned invalid WAV audio')
}

function mergeWav(buffers: readonly Uint8Array[]): Uint8Array {
  const parsed = buffers.map(readWav)
  const first = parsed[0]!
  if (parsed.some(entry => entry.format.length !== first.format.length || entry.format.some((value, index) => value !== first.format[index]))) {
    throw new Error('the speech provider returned incompatible WAV formats')
  }
  const dataLength = parsed.reduce((sum, entry) => sum + entry.data.length, 0)
  const output = new Uint8Array(first.prefix.length + dataLength)
  output.set(first.prefix)
  let at = first.prefix.length
  for (const entry of parsed) { output.set(entry.data, at); at += entry.data.length }
  const view = new DataView(output.buffer)
  view.setUint32(4, output.length - 8, true)
  view.setUint32(first.dataSizeAt, dataLength, true)
  return output
}

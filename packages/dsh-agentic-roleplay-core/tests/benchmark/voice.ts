import type { Language } from './language.ts'

/** What a character's sheet says about how it speaks: the one thing the voice judge works from. */
export interface VoiceSheet {
  name: string
  style: string
  examples: string[]
}

/** The decision model as the benchmark reaches it (the product's `DecisionService`, or the endpoint directly). */
export interface VoiceJudge {
  decide: (state: Record<string, unknown>, questions: Record<string, { type: 'noul'; instructions: string }>) => Promise<{ answers: Record<string, { type: 'noul'; probability: number }> }>
}

/** From this probability a line counts as in voice. */
export const VOICE_CUT = 0.5

const QUESTION: Record<Language, string> = {
  en: 'Does the line fit how this character speaks, as its speech style and examples describe? Say yes when the wording, tone and manner fit the style; the line need not copy the examples or use their words. Say no when it clearly breaks the style, in register, tone or manner (for example a terse character who talks at length, or a formal one who uses slang). Judge only the manner of speaking, never what the line says. When in doubt, say yes.',
  zh: '这句话是否符合这个角色按其说话风格和例句所描述的说话方式？措辞、语气和做派符合风格就回答是；不必照抄例句或用上其中的词。明显违背风格（用词、语气或做派不对，例如本该寡言的人长篇大论，或本该庄重的人满口俗语）就回答否。只判断说话的方式，不判断内容。拿不准时，回答是。',
}

/** The state and the question the decision model gets for one line. */
export function voiceAsk(sheet: VoiceSheet, line: string, language: Language): { state: Record<string, unknown>; instructions: string } {
  return { state: { character: sheet.name, speech_style: sheet.style, examples: sheet.examples, line }, instructions: QUESTION[language] }
}

/** How many of the lines the decision model finds in voice. A line it cannot be asked about is counted as neither: the result says how many were judged. */
export async function judgeVoice(service: VoiceJudge, sheet: VoiceSheet, lines: readonly string[], language: Language, cut = VOICE_CUT): Promise<{ lines: number; fits: number }> {
  let fits = 0
  for (const line of lines) {
    const ask = voiceAsk(sheet, line, language)
    const { answers } = await service.decide(ask.state, { voice: { type: 'noul', instructions: ask.instructions } })
    if ((answers['voice']?.probability ?? 0) >= cut) fits += 1
  }
  return { lines: lines.length, fits }
}

/** The speech sheets of a composed world's characters, by the character's id. A character without a style has none. */
export function sheetsOf(files: ReadonlyMap<string, unknown>): Map<string, VoiceSheet> {
  const sheets = new Map<string, VoiceSheet>()
  for (const [path, value] of files) {
    const match = /^characters\/([^/]+)\/character\.json$/.exec(path)
    if (match === null || typeof value !== 'object' || value === null) continue
    const document = value as { name?: unknown; speech?: { style?: unknown; examples?: unknown } }
    const style = typeof document.speech?.style === 'string' ? document.speech.style.trim() : ''
    if (style === '' || typeof document.name !== 'string') continue
    const examples = Array.isArray(document.speech?.examples) ? document.speech.examples.filter((example): example is string => typeof example === 'string') : []
    sheets.set(match[1]!, { name: document.name, style, examples })
  }
  return sheets
}

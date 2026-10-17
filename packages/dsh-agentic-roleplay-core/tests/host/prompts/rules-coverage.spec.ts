import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listFiles, shippedLanguages, shippedPromptsDirectory } from '../../../src/host/prompts/library.ts'

/**
 * A rule that has to be in every prompt of a kind is checked in each shipped language: the prompts that carry it say so, and every other prompt is named with the reason it need not.
 * A prompt added later is in neither list, and the test fails until someone decides.
 */
interface Rule {
  name: string
  /** How each language says it. */
  says: Record<string, RegExp>
  carriers: readonly string[]
  /** Why each of the others need not. */
  exempt: Record<string, string>
}

const FRAGMENT = 'a part of another prompt or a notice, not an agent of its own'
const FRAGMENTS = ['ask-question', 'character-decide', 'character-lookup', 'character-style', 'dice', 'input-refused', 'ooc-command', 'ooc-empty', 'persona', 'plot-hint', 'preview', 'rules', 'style']
const CHRONICLE = 'the instruction of the chronicler, which carries the rule in its own prompt'

const exemptions = (...extra: [string, string][]): Record<string, string> => ({ ...Object.fromEntries(FRAGMENTS.map(id => [id, FRAGMENT])), ...Object.fromEntries(extra) })

const RULES: Rule[] = [
  {
    name: 'works only from what it was given, and adds nothing',
    says: {
      en: /only what (you are|is|the text)|use only what|never use anything|supported by the material|work only from|never (add|a fact)|do not invent|never make up|do not add facts/i,
      zh: /只根据|只依据|只使用|只用|只知道所给|仅凭|只凭|绝不使用其他|绝不添加|不要添加|不要编造|绝不编造|凭空/,
    },
    carriers: ['ask-answerer', 'character-rules', 'chronicler', 'faction-strategist', 'game-master', 'plot-author', 'record-keeper', 'reflection', 'suggester', 'trigger-judge'],
    exempt: exemptions(['chronicle-chapter', CHRONICLE], ['chronicle-condense', CHRONICLE], ['chronicle-digest', CHRONICLE], ['image-interpreter', 'an image prompt, covered in its own rule on what it sees'], ['image-presenter', 'an image prompt, covered in its own rule'], ['image-reuse', 'an image prompt, covered in its own rule']),
  },
  {
    name: 'writes in the language of the chat\'s prompts',
    says: { en: /\$\{language\}/, zh: /\$\{language\}/ },
    carriers: ['chronicler', 'character-rules', 'game-master', 'reflection', 'suggester'],
    exempt: exemptions(['ask-answerer', 'answers in plain words; its language follows the chat'], ['faction-strategist', 'its text is a decision the engine records, written from what it is shown'], ['plot-author', 'its text is a scaffold the game master reads'], ['record-keeper', 'the records follow the language of the rounds it reads'], ['trigger-judge', 'a verdict with a short reason'], ['chronicle-chapter', CHRONICLE], ['chronicle-condense', CHRONICLE], ['chronicle-digest', CHRONICLE], ['image-interpreter', 'an image prompt'], ['image-presenter', 'an image prompt'], ['image-reuse', 'an image prompt']),
  },
]

const root = shippedPromptsDirectory()
const idsOf = (language: string): string[] => listFiles(join(root, language, 'roleplay')).map(file => file.replace(/\.md$/, ''))
const textOf = (language: string, id: string): string => readFileSync(join(root, language, 'roleplay', `${id}.md`), 'utf8')

describe('rules that prompts of a kind have to carry', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const language of shippedLanguages(root)) {
        it(`is carried by the prompts that must, and every other prompt is named as exempt (${language})`, () => {
          const marker = rule.says[language]
          expect(marker, `no wording of the rule for ${language}`).toBeDefined()
          const ids = idsOf(language)
          const missing = rule.carriers.filter(id => !marker!.test(textOf(language, id)))
          expect(missing, `prompts that no longer carry the rule in ${language}`).toEqual([])
          const undecided = ids.filter(id => !rule.carriers.includes(id) && rule.exempt[id] === undefined)
          expect(undecided, 'prompts that neither carry the rule nor say why they need not').toEqual([])
          const stale = [...rule.carriers, ...Object.keys(rule.exempt)].filter(id => !ids.includes(id))
          expect(stale, 'prompts named in the test that are not shipped').toEqual([])
        })
      }
    })
  }
})

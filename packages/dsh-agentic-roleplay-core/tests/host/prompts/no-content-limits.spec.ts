import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listFiles, shippedLanguages, shippedPromptsDirectory } from '../../../src/host/prompts/library.ts'

/** What a shipped prompt would say if it limited the story beyond what the model itself does. */
const LIMITS: Record<string, RegExp> = {
  en: /\b(underage|minors?\s+(?:must|should|are|in)|nsfw|age of consent|sexual content|inappropriate|censor\w*|sanitiz\w*|content polic\w*|harmful|unsafe|offensive|trigger warning\w*)\b/i,
  zh: /(未成年|不适当|不当内容|审查|低俗|有害|色情|内容政策|触发警告)/,
}

describe('what the shipped prompts say about content', () => {
  it('is nothing: they add no limits of their own to what the model does', () => {
    const found: string[] = []
    for (const language of shippedLanguages()) {
      const limits = LIMITS[language]
      if (limits === undefined) throw new Error(`no content check is written for the shipped language ${language}`)
      const directory = join(shippedPromptsDirectory(), language)
      for (const file of listFiles(directory)) {
        const text = readFileSync(join(directory, `${file}.md`), 'utf8')
        const hit = limits.exec(text)
        if (hit !== null) found.push(`${language}/${file}: ${hit[0]}`)
      }
    }
    expect(found).toEqual([])
  })
})

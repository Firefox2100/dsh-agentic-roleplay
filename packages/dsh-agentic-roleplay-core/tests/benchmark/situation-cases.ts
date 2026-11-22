import type { Language } from './language.ts'
import { pick } from './language.ts'
import { castName, type Who } from './attribution-cases.ts'

/**
 * The situation benchmark: the player's message mixes what the character says and does with what it thinks, and the game master has to write the situation the characters are told as fact.
 * The player's character (Mara) is with Elias, who knows Mara and Pavel and has no way of knowing Odile; Pavel and Odile are elsewhere. A situation fails when it carries what Elias cannot know.
 */
export const PRESENT: Who[] = ['mara', 'elias']
export const AWAY: Who[] = ['pavel', 'odile']

export interface SituationCase {
  id: string
  kind: 'aside' | 'mixed' | 'held' | 'implicit' | 'clean' | 'aloud'
  /** What was just said before the player's message. */
  earlier: (language: Language) => string
  input: (language: Language) => string
  /** Words (lower case) that must not be in the situation: the unknown person and what only the thought says. */
  forbidden: (language: Language) => string[]
  /** Words (lower case) the situation must keep of what was said or done aloud. */
  keeps: (language: Language) => string[]
}

const both = (en: string, zh: string) => (language: Language): string => pick(language)(en, zh)
const list = (en: string, zh: string) => (language: Language): string[] => pick(language)(en, zh).split('|')
const names = (language: Language) => ({ elias: castName('elias', language), odile: castName('odile', language), pavel: castName('pavel', language) })

const earlier = (language: Language): string => {
  const { elias, pavel } = names(language)
  return language === 'en'
    ? `${elias} has just said he wants ${castName('mara', 'en')} to come to dinner and meet a cousin of ${pavel}'s, because he worries ${castName('mara', 'en')} is alone too much.`
    : `${elias}刚刚说，他想让${castName('mara', 'zh')}来吃顿饭，见见${pavel}的一位表妹，因为他担心${castName('mara', 'zh')}独处太多。`
}

export const SITUATION_CASES: SituationCase[] = [
  {
    id: 'aside', kind: 'aside', earlier,
    input: language => { const { odile } = names(language); return language === 'en'
      ? `A dinner with his cousin? My mind drifted to ${odile}. Are we actually together, or is it only physical? The wind off the lake pulled me back. "Sure, a dinner," I said. "If it makes you feel better."`
      : `跟他表妹吃饭？我的思绪飘到了${odile}身上。我们到底算不算在一起，还是只是肉体关系？湖面的风把我拉了回来。“好啊，吃饭，”我说，“你要是能因此安心的话。”` },
    forbidden: language => [names(language).odile.toLowerCase(), ...(language === 'en' ? ['actually together', 'only physical'] : ['肉体', '算不算在一起'])],
    keeps: list('dinner|feel better', '吃饭|安心'),
  },
  {
    id: 'mixed', kind: 'mixed', earlier,
    input: language => { const { elias, odile } = names(language); return language === 'en'
      ? `I pick up the kettle while still turning over what ${odile} told me last night, and pour ${elias} a cup. "Here. Sit down."`
      : `我一边拿起水壶，一边还在琢磨${odile}昨晚对我说的话，给${elias}倒了一杯。“来，坐下说。”` },
    forbidden: language => [names(language).odile.toLowerCase(), ...(language === 'en' ? ['last night'] : ['昨晚'])],
    keeps: list('kettle|sit down', '水壶|坐下'),
  },
  {
    id: 'held', kind: 'held', earlier,
    input: language => { const { odile } = names(language); return language === 'en'
      ? `I nod and say, "Fine, set it up." Inside I am thinking: ${odile} must never find out I agreed to this.`
      : `我点点头说：“行，你安排吧。”心里想的是：${odile}绝不能知道我答应了这件事。` },
    forbidden: language => [names(language).odile.toLowerCase(), ...(language === 'en' ? ['find out'] : ['绝不能知道'])],
    keeps: list('set it up', '安排'),
  },
  {
    id: 'implicit', kind: 'implicit', earlier,
    input: both(
      '"Sure." I smile and say nothing of the person I have been secretly seeing for months, and only ask when the dinner is.',
      '“好啊。”我笑了笑，没有提起我暗中交往了几个月的那个人，只问饭局是什么时候。',
    ),
    forbidden: list('secretly|seeing for months', '暗中|交往'),
    keeps: list('dinner', '饭局'),
  },
  {
    id: 'clean', kind: 'clean', earlier,
    input: both(
      'I laugh and say, "Tell me more about this cousin," and sit down at the table.',
      '我笑了，说：“多说说你那位表妹。”然后在桌边坐下。',
    ),
    forbidden: () => [],
    keeps: list('cousin|table', '表妹|桌'),
  },
  {
    id: 'aloud', kind: 'aloud', earlier,
    input: language => { const { elias, odile } = names(language); return language === 'en'
      ? `"${elias}, I should tell you, I'm already seeing ${odile}," I say, and wait for his reaction.`
      : `“${elias}，我该告诉你，我已经在和${odile}交往了。”我说完，等着他的反应。` },
    forbidden: () => [],
    keeps: language => [names(language).odile.toLowerCase()],
  },
]

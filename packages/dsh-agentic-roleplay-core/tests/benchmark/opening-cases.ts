import { lettersOf, type Speaker } from '../../src/host/import/opening-parts.ts'
import type { ShapedOpening } from '../../src/host/import/opening-parts.ts'
import type { Language } from './language.ts'
import { pick } from './language.ts'

/**
 * Invented greetings, both languages, for the opening-shaping benchmark: what `shapeOpening` makes of a card's greeting. Each is labelled with what a reader would say: pure narration (it must stay
 * plain text, quotation marks around names, signs and reported speech included), speech (it must become parts, each listed line spoken by the right character, the player's own lines narration),
 * or speech nobody in the cast can be named for (it must not be given to anyone). Whatever the label, the words must come out exactly as they went in. Nothing is taken from a real card.
 */
export type OpeningKind = 'narration' | 'speech' | 'unattributed'
export const OPENING_KINDS: readonly OpeningKind[] = ['narration', 'speech', 'unattributed']

export interface OpeningExpectation {
  /** Whether anyone speaks aloud: false means the greeting must stay plain text. */
  speech: boolean
  /** Lines that must be parts spoken by that character: a part holding the words. */
  lines?: { contains: string; character: string }[]
  /** Words that are said by no one in the cast (the player, a stranger): the part holding them must be narration. */
  narrated?: string[]
}

export interface OpeningCase { id: string; kind: OpeningKind; language: Language; passage: string; expect: OpeningExpectation }

export const PLAYER_ID = 'you'

export function openingCast(language: Language): Speaker[] {
  const p = pick(language)
  return [
    { id: 'alice', name: p('Alice', '爱丽丝'), aliases: [] },
    { id: 'bram', name: p('Bram', '布朗'), aliases: [] },
    { id: 'mira', name: p('Mira', '米拉'), aliases: [] },
    { id: PLAYER_ID, name: p('Rowan', '林远'), aliases: [] },
  ]
}

export function openingCases(language: Language): OpeningCase[] {
  const p = pick(language)
  const make = (id: string, kind: OpeningKind, passage: string, expect: OpeningExpectation): OpeningCase => ({ id: `${id}-${language}`, kind, language, passage, expect })
  return [
    make('scenery', 'narration', p('Fog lies over the harbour and the lamps are barely lit. Gulls complain somewhere above the water, and the tide pulls at the old pilings.', '雾压在港口上，路灯勉强亮着。海鸥在水面上空抱怨，潮水拉扯着旧木桩。'), { speech: false }),
    make('names-in-quotes', 'narration', p('The street fades into the night light and fog. Right next to the corner of "The Boat" pub, two vague shadows stand close together, the sign "Closed for the season" swinging above them.', '街道沉入夜色与雾气。就在“船”酒馆的拐角旁，两个模糊的影子靠得很近，头顶的招牌“本季歇业”轻轻摇晃。'), { speech: false }),
    make('reported', 'narration', p('Bram told you to leave in no uncertain terms, and Mira only shrugged when you asked why. By nightfall the whole street knew.', '布朗毫不客气地叫你离开，你问为什么，米拉只是耸了耸肩。入夜前，整条街都知道了。'), { speech: false }),
    make('thought', 'narration', p('You stop at the door. Not again, you think, and the word "again" stays with you all the way up the stairs.', '你在门口停下。又来了，你心想，“又”这个字一直跟着你走上楼梯。'), { speech: false }),
    make('unmarked', 'speech', p('Get out of my way, you dweeb.\nAlice bumps into you on purpose.', '给我让开，你这个书呆子。\n爱丽丝故意撞了你一下。'), { speech: true, lines: [{ contains: p('Get out of my way', '给我让开'), character: 'alice' }] }),
    make('quoted-inline', 'speech', p('Bram looks up from the ledger. "We close at nine," he says. "Drink up or leave."', '布朗从账本上抬起头。“我们九点打烊，”他说，“喝完就走。”'), { speech: true, lines: [{ contains: p('We close at nine', '九点打烊'), character: 'bram' }, { contains: p('Drink up', '喝完就走'), character: 'bram' }] }),
    make('interrupted', 'speech', p('Bram wipes his hands. "You are late," he says. "The flour will not wait."', '布朗擦了擦手。“你来晚了，”他说，“面粉可不等人。”'), { speech: true, lines: [{ contains: p('You are late', '你来晚了'), character: 'bram' }, { contains: p('The flour will not wait', '面粉可不等人'), character: 'bram' }] }),
    make('labelled', 'speech', p('Alice: Where were you last night?\nBram: Out.\nSilence fills the room.', '爱丽丝：你昨晚去哪了？\n布朗：外面。\n房间里一片沉默。'), { speech: true, lines: [{ contains: p('Where were you', '你昨晚去哪'), character: 'alice' }, { contains: p('Out.', '外面'), character: 'bram' }] }),
    make('two-voices', 'speech', p('Mira stirs the pot without turning around. "You are late again."\nAlice drops her bag by the door. "The ferry broke down. Don\'t start."', '米拉背对着你搅着锅。“你又迟到了。”\n爱丽丝把包扔在门边。“渡轮坏了，别又来了。”'), { speech: true, lines: [{ contains: p('You are late again', '又迟到了'), character: 'mira' }, { contains: p('The ferry broke down', '渡轮坏了'), character: 'alice' }] }),
    make('player-speaks', 'speech', p('"Good morning," you say, stepping inside. Mira nods without looking up. "Morning. Sit anywhere."', '“早上好，”你一边说一边走进来。米拉头也不抬地点点头。“早。随便坐。”'), { speech: true, lines: [{ contains: p('Sit anywhere', '随便坐'), character: 'mira' }], narrated: [p('Good morning', '早上好')] }),
    make('voice-unknown', 'unattributed', p('"Stop right there!" a voice shouts from the fog. Alice freezes beside you.', '“站住！”雾里有个声音喊道。爱丽丝在你身旁僵住了。'), { speech: false, narrated: [p('Stop right there', '站住')] }),
    make('stranger', 'unattributed', p('A stranger in a grey coat leans against the wall. "You are far from home," he murmurs, and walks on.', '一个穿灰色外套的陌生人靠在墙上。“你离家很远了，”他低声说，然后走开了。'), { speech: false, narrated: [p('far from home', '离家很远')] }),
  ]
}

/** What an outcome got wrong about its case; empty when it is right. */
export function openingProblems(made: OpeningCase, shaped: ShapedOpening, cast: readonly Speaker[] = openingCast(made.language)): string[] {
  const problems: string[] = []
  const words = shaped.parts === undefined ? shaped.text : shaped.parts.map(part => part.text).join('\n\n')
  if (lettersOf(words, cast) !== lettersOf(made.passage, cast)) problems.push('the words changed')
  const spoken = shaped.parts?.some(part => part.type === 'utterance') ?? false
  if (made.expect.speech && !spoken) problems.push('no one speaks in the result, but someone should')
  if (!made.expect.speech && spoken && made.kind === 'narration') problems.push('lines were given to characters in a pure narration')
  if (!made.expect.speech && spoken && made.kind === 'unattributed') problems.push('speech nobody can be named for was given to someone')
  for (const line of made.expect.lines ?? []) {
    const part = shaped.parts?.find(entry => entry.text.includes(line.contains))
    if (part === undefined || part.type !== 'utterance' || part.character !== line.character) problems.push(`"${line.contains}" is not spoken by ${line.character}`)
  }
  for (const text of made.expect.narrated ?? []) {
    const part = shaped.parts?.find(entry => entry.text.includes(text))
    if (part !== undefined && part.type === 'utterance') problems.push(`"${text}" was given to ${part.character}`)
  }
  if (shaped.parts?.some(part => part.type === 'utterance' && part.character === PLAYER_ID) === true) problems.push('the player\'s character speaks')
  return problems
}

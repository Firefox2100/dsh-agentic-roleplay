import type { Language } from './language.ts'

/**
 * A clause the narration uses, and the clauses of earlier turns it may echo. Unlike the repeat cases the words are never the same: a stock gesture or atmosphere line comes back in
 * other words each time, which an exact-sentence check cannot see. `stale` is a stock line told again for want of something new; a `meant` case is a habit or ritual the story
 * itself sets up; a `fresh` case uses the same earlier clauses and a different, specific action, and a `hard` one is a different action close to them in subject (the same body part, the same kind of line); neither must be flagged.
 */
export interface StockCase {
  id: string
  kind: 'stale' | 'meant' | 'fresh' | 'hard'
  earlier: Record<Language, string[]>
  clause: Record<Language, string>
}

const earlier = {
  chin: { en: ['He strokes his chin thoughtfully.', 'He rubs his chin, considering.', 'He pinches his chin and hums.'], zh: ['他摸了摸下巴，若有所思。', '他捏着下巴沉吟。', '他抚着下巴，想了想。'] },
  eyes: { en: ['Her eyes are unreadable.', 'Something unreadable flickers in her gaze.', 'Her gaze is as unreadable as ever.'], zh: ['她的眼神晦暗不明。', '她眼底闪过一丝晦暗不明的神色。', '她眸色晦暗，看不出情绪。'] },
  shiver: { en: ['A shiver runs down your spine.', 'A chill crawls up your back.', 'You feel a shiver down your spine.'], zh: ['你背后一阵发凉。', '一股寒意顺着脊背爬上来。', '你脊背窜过一阵凉意。'] },
  smirk: { en: ['A playful smile tugs at his lips.', 'He smirks, amusement in his eyes.', 'A knowing smile curls his lip.'], zh: ['他嘴角勾起一抹玩味的笑。', '她唇角微微上扬，带着几分玩味。', '他嘴角一挑，笑意玩味。'] },
  breath: { en: ['You let out a breath you did not know you were holding.', 'She exhales a breath she had not realised she held.', 'He breathes out slowly, a breath he had been holding.'], zh: ['你长出一口气，才发现自己一直屏着呼吸。', '她这才吐出一口一直憋着的气。', '他缓缓呼出一口压在胸口的气。'] },
  silence: { en: ['A heavy silence settles over the room.', 'Silence hangs thick in the air.', 'The silence stretches, heavy and oppressive.'], zh: ['房间里陷入沉重的沉默。', '空气中弥漫着凝重的寂静。', '沉默沉沉地压了下来。'] },
}

const stale = (id: string, key: keyof typeof earlier, clause: Record<Language, string>): StockCase => ({ id: `${id}-stale`, kind: 'stale', earlier: earlier[key], clause })
const fresh = (id: string, key: keyof typeof earlier, clause: Record<Language, string>, suffix: 'fresh' | 'hard' = 'fresh'): StockCase => ({ id: `${id}-${suffix}`, kind: suffix, earlier: earlier[key], clause })

export const STOCK_CASES: readonly StockCase[] = [
  stale('chin', 'chin', { en: 'He scratches his chin, lost in thought.', zh: '他挠了挠下巴，陷入沉思。' }),
  stale('eyes', 'eyes', { en: 'Her eyes give nothing away, unreadable.', zh: '她的目光晦暗不明。' }),
  stale('shiver', 'shiver', { en: 'A cold shiver races along your spine.', zh: '一阵寒意从你的脊背窜过。' }),
  stale('smirk', 'smirk', { en: 'The corner of his mouth lifts in a knowing smile.', zh: '她嘴角扬起一丝玩味的笑意。' }),
  stale('breath', 'breath', { en: 'You release a breath you had not known you were holding.', zh: '你这才松了口气，发觉自己刚才一直屏着呼吸。' }),
  stale('silence', 'silence', { en: 'A weighty silence falls between you.', zh: '一阵沉重的沉默笼罩了两人。' }),
  fresh('chin', 'chin', { en: 'He sets the cup down and slides the ledger toward you.', zh: '他放下杯子，把账本推到你面前。' }),
  fresh('eyes', 'eyes', { en: 'She glances at the door, then lowers her voice.', zh: '她瞥了一眼房门，压低了声音。' }),
  fresh('shiver', 'shiver', { en: 'The shutters bang against the wall in a sudden gust.', zh: '一阵突如其来的风把百叶窗摔在墙上。' }),
  fresh('smirk', 'smirk', { en: 'He flips the coin once and catches it without looking.', zh: '他抛起硬币，看也不看地接住。' }),
  fresh('breath', 'breath', { en: 'Your knees give way and you sit down on the stairs.', zh: '你腿一软，坐在了台阶上。' }),
  fresh('silence', 'silence', { en: 'Somewhere below, a door opens and closes.', zh: '楼下某处，一扇门开了又关上。' }),
  fresh('chin', 'chin', { en: 'He strokes the old cat curled on the desk.', zh: '他摸了摸蜷在桌上的老猫。' }, 'hard'),
  fresh('eyes', 'eyes', { en: 'Her eyes narrow at the ring on your finger.', zh: '她的目光落在你手指上的戒指上，眯了起来。' }, 'hard'),
  fresh('shiver', 'shiver', { en: 'A draft runs down the corridor and lifts the curtain.', zh: '一股穿堂风顺着走廊吹来，掀起了窗帘。' }, 'hard'),
  fresh('smirk', 'smirk', { en: 'The corner of the ledger page curls in the damp.', zh: '账页的一角在潮气里卷了起来。' }, 'hard'),
  fresh('breath', 'breath', { en: 'You hold your breath as a floorboard creaks above you.', zh: '头顶的地板吱呀一响，你屏住了呼吸。' }, 'hard'),
  fresh('silence', 'silence', { en: 'A heavy crate is dragged across the floor upstairs.', zh: '楼上有人拖着一只沉重的木箱划过地板。' }, 'hard'),
  {
    id: 'tap-meant', kind: 'meant',
    earlier: { en: ['As always, the clockmaker taps the counter three times before he names a price.', 'Three taps on the counter: his habit before any price.', 'Tap, tap, tap, the old habit, and then the figure.'], zh: ['钟表匠照例在报价前敲三下柜台。', '柜台上响了三声：这是他报价前的老习惯。', '嗒、嗒、嗒，还是那个老习惯，然后才是数字。'] },
    clause: { en: 'He taps the counter three times, as always, and only then names the price.', zh: '他照例敲了三下柜台，这才报出价钱。' },
  },
  {
    id: 'toast-meant', kind: 'meant',
    earlier: { en: ['The crew raise their cups: "Salt and tide," they say, as they do before every voyage.', 'Before the anchor lifts, the old toast again: salt and tide.', 'Cups up for the ritual words, salt and tide, as the harbour wakes.'], zh: ['船员们举杯，照出海前的规矩说：“盐与潮。”', '起锚之前，又是那句老祝酒词：盐与潮。', '港口苏醒时，杯子举起，念出仪式的话：盐与潮。'] },
    clause: { en: 'They raise their cups for the old ritual, salt and tide, before the ship leaves.', zh: '开船之前，他们举杯念起那句老仪式：盐与潮。' },
  },
  {
    id: 'clock-meant', kind: 'meant',
    earlier: { en: ['The study clock has stopped at ten past four.', 'You notice again that the study clock still reads ten past four.', 'Ten past four: the stopped clock is the one thing nobody has touched.'], zh: ['书房的钟停在四点十分。', '你再次注意到书房的钟仍然指着四点十分。', '四点十分：这只停摆的钟是唯一没有人碰过的东西。'] },
    clause: { en: 'You look at the stopped clock again: it still reads ten past four, the one clue that has not changed.', zh: '你又看了一眼停摆的钟：仍是四点十分，这是唯一没有变的线索。' },
  },
]

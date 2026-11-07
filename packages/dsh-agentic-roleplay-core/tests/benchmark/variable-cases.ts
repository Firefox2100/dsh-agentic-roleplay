import type { VariableDefinitionInput, VariableValue } from 'dsh-roleplay-model'
import type { Language } from './language.ts'
import { pick } from './language.ts'

/** What a changed value must have become: a direction from where it started, a bound, or an exact value. */
export type ValueCheck = { up: true } | { down: true } | { to: VariableValue } | { word: AlertWord } | { atMost: number } | { atLeast: number }

/** A word of the choice value, named in English and spelt in the language of the run. */
export type AlertWord = 'calm' | 'watchful' | 'lockdown'

/** What happened in a turn, as the tracker is given it. */
export interface Turn {
  input: string
  deeds: string[]
  narration: string
}

/**
 * One turn of the benchmark story and the values it changes. Every tracked value the case does not list in `expect` must stay as it was: what the turn only mentions, remembers,
 * fears, or does to somebody else does not change it. Items are keyed `<value>:<character>` (or `<value>:world`), the way the tracker names them.
 */
export interface VariableCase {
  id: string
  title: string
  kind: 'change' | 'keep'
  /** Values the story is at when the turn begins, where they differ from the declared default. */
  start?: Record<string, VariableValue | { word: AlertWord }>
  turn: (language: Language) => Turn
  expect: Record<string, ValueCheck>
  /** Items whose change the case does not ask for but can be argued: counted apart from false alarms. */
  allow?: string[]
}

const CAST = {
  arthur: { en: 'Arthur', zh: '亚瑟' },
  clara: { en: 'Clara', zh: '克拉拉' },
  dov: { en: 'Dov', zh: '多夫' },
} as const

export const CAST_KEYS = Object.keys(CAST) as (keyof typeof CAST)[]
export const castName = (key: keyof typeof CAST, language: Language): string => CAST[key][language]
export const PLAYER = 'arthur'

/** The values the benchmark story tracks, each with the rule a world author is asked to write. */
export function variableDefinitions(language: Language): VariableDefinitionInput[] {
  const t = pick(language)
  return [
    {
      key: 'fatigue', name: t('Fatigue', '疲劳'), kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 2, visibility: 'public',
      description: t('How tired the character is: 0 rested, 10 exhausted.', '角色有多累：0 为精力充沛，10 为筋疲力尽。'),
      update: t('Rises by 1 for each hour of hard effort. A full night of sleep brings it down to 1 or 0. A short rest or a stroll does not change it.', '每连续辛苦干活一个钟头就加 1。睡足一整夜后降到 1 或 0。短暂歇息或散步不改变它。'),
    },
    {
      key: 'injured', name: t('Injured', '受伤'), kind: 'flag', subject: 'character', default: false, visibility: 'public',
      description: t('Whether the character has a wound that needs treatment.', '角色是否带着需要治疗的伤。'),
      update: t('Becomes true when the character takes a real wound. Becomes false once the wound has been treated. An old scar or a past wound does not count.', '角色受了实在的伤就变为真。伤口得到治疗后变为假。旧伤疤或过去的伤不算。'),
    },
    {
      key: 'unrest', name: t('Unrest', '骚动'), kind: 'number', subject: 'world', min: 0, max: 10, integer: true, default: 3, visibility: 'public',
      description: t('How close the town is to open trouble.', '镇子离公开骚乱有多近。'),
      update: t('Rises by 1 or 2 when townsfolk are angered, attacked or go short of supplies. Falls by 1 or 2 when they are reassured or the cause is put right. Warnings and rumours do not change it.', '镇民被激怒、被攻击或缺少补给时加 1 或 2。他们得到安抚或起因被消除时减 1 或 2。警告和传言不改变它。'),
    },
    {
      key: 'alert', name: t('Alert', '戒备'), kind: 'choice', subject: 'world', options: [t('calm', '平静'), t('watchful', '戒备'), t('lockdown', '封锁')], default: t('calm', '平静'), visibility: 'public',
      description: t('How the harbor watch stands.', '港口守卫的戒备状态。'),
      update: t('Watchful once a threat has been sighted. Lockdown only when the watch is ordered to bar the gates. Calm again once the threat is over. A rumour changes nothing.', '发现威胁后转为戒备。只有下令守卫关闭城门才是封锁。威胁过去后恢复平静。传言不改变任何事。'),
    },
    {
      key: 'coins', name: t('Coins', '钱币'), kind: 'number', subject: 'character', min: 0, max: 1000, integer: true, default: 40, visibility: 'public',
      description: t('How many coins the character carries.', '角色身上带着多少钱币。'),
      update: t('Changes by the exact amount paid or received. Haggling, offers and talk about money change nothing.', '按实际付出或收到的数目增减。讨价还价、报价和谈论钱都不改变它。'),
    },
  ]
}

export const alertWord = (language: Language, word: AlertWord): string => pick(language)(word, { calm: '平静', watchful: '戒备', lockdown: '封锁' }[word])

const A = (language: Language): string => castName('arthur', language)
const C = (language: Language): string => castName('clara', language)
const D = (language: Language): string => castName('dov', language)

export const VARIABLE_CASES: readonly VariableCase[] = [
  // ---- turns that change something
  {
    id: 'haul-crates', title: 'two hours of hard hauling tire the one who does it, not the one who counts', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I will help unload the whole grain barge.',
      deeds: [`${A(l)}: carries grain sacks off the barge without stopping, for two hours`, `${C(l)}: counts the sacks on the quay and writes the tally`],
      narration: `${A(l)} carries sack after sack up the ramp until the sun is high, his shoulders burning and his shirt soaked through. Two hours later the barge is empty. ${C(l)} ticks off the last sack on her tally board and does not look up.`,
    }, {
      input: '我来帮忙把整条粮船卸完。',
      deeds: [`${A(l)}：不停歇地从粮船上扛粮袋，足足两个钟头`, `${C(l)}：在码头上清点粮袋，把数目记在板上`],
      narration: `${A(l)}一袋接一袋地扛上跳板，直到日头爬高，肩膀火辣辣地疼，衬衫早已湿透。两个钟头后，船舱空了。${C(l)}在记数板上划掉最后一袋，头也没抬。`,
    }),
    expect: { 'fatigue:arthur': { up: true } },
  },
  {
    id: 'night-sleep', title: 'a full night of sleep takes the tiredness away', kind: 'change', start: { 'fatigue:arthur': 7 },
    turn: (l) => pick(l)<Turn>({
      input: 'I go up to the loft and sleep until morning.',
      deeds: [`${A(l)}: sleeps through the night in the loft above the net shop`],
      narration: `${A(l)} sleeps through the night in the loft above the net shop, undisturbed by the gulls or the tide. He wakes at first light with yesterday's aches mostly gone.`,
    }, {
      input: '我爬上阁楼，一觉睡到天亮。',
      deeds: [`${A(l)}：在渔网铺上面的阁楼里睡了一整夜`],
      narration: `${A(l)}在渔网铺上面的阁楼里睡了一整夜，海鸥和潮声都没有吵醒他。天刚亮他醒来，昨天的酸痛已经消退大半。`,
    }),
    expect: { 'fatigue:arthur': { atMost: 2 } },
  },
  {
    id: 'knife-wound', title: 'a blade that opens the arm is a wound', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I grab the thief by the wrist.',
      deeds: [`${A(l)}: seizes a thief's wrist in the alley`, 'A thief: slashes his knife across Arthur\'s forearm and runs'],
      narration: `The thief twists free and the blade opens ${A(l)}'s forearm from wrist to elbow. Blood runs onto the cobbles as the thief vanishes down the alley, and nobody on the street has seen a thing.`,
    }, {
      input: '我一把抓住小偷的手腕。',
      deeds: [`${A(l)}：在小巷里抓住一个小偷的手腕`, '小偷：一刀划过亚瑟的小臂，然后逃跑'],
      narration: `小偷挣脱了，刀刃从手腕到手肘划开${A(l)}的小臂。血滴在鹅卵石上，小偷一闪身消失在巷子深处，街上没有任何人看见。`,
    }),
    expect: { 'injured:arthur': { to: true } },
  },
  {
    id: 'bandage', title: 'a wound that is stitched and bound has been treated', kind: 'change', start: { 'injured:arthur': true },
    turn: (l) => pick(l)<Turn>({
      input: `${C(l)}, can you look at my arm?`,
      deeds: [`${C(l)}: washes the cut, stitches it and binds it in clean linen`],
      narration: `${C(l)} washes the cut with spirits, stitches it with quick, even stitches and binds the arm in clean linen. "Keep it dry," she says. "It will heal now."`,
    }, {
      input: `${C(l)}，你能看看我的胳膊吗？`,
      deeds: [`${C(l)}：清洗伤口，缝合，再用干净的亚麻布包扎`],
      narration: `${C(l)}用烈酒清洗伤口，飞快而均匀地缝好，再用干净的亚麻布把胳膊包起来。“别沾水，”她说，“这下会愈合了。”`,
    }),
    expect: { 'injured:arthur': { to: false } },
  },
  {
    id: 'stall-riot', title: 'the watch wrecking a stall angers the market', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I watch from beside the fish stall.',
      deeds: [`${D(l)}: shoves a fishwife aside and kicks over her stall, looking for smuggled goods`],
      narration: `${D(l)}, the watchman, kicks over the fishwife's stall and sends a day's catch sliding into the gutter. The market falls silent, then erupts: fishwives shout, men crowd the lane, and someone hurls a crate that misses the watch by a hand.`,
    }, {
      input: '我站在鱼摊旁边看着。',
      deeds: [`${D(l)}：推开一个鱼妇，踢翻她的摊子，说是要搜走私货`],
      narration: `守卫${D(l)}一脚踢翻鱼妇的摊子，一天的渔获滑进了阴沟。集市先是一片死寂，随后炸开了锅：鱼妇们叫骂，男人们挤满小巷，有人扔出一只木箱，擦着守卫的手边飞过。`,
    }),
    expect: { 'unrest:world': { up: true } },
    allow: ['alert:world'],
  },
  {
    id: 'calm-crowd', title: 'a promise that reopens the grain stores calms the town', kind: 'change', start: { 'unrest:world': 7 },
    turn: (l) => pick(l)<Turn>({
      input: 'I climb onto a barrel and tell them the grain stores are open.',
      deeds: [`${A(l)}: announces that the grain stores open at dawn and every household will get its share`],
      narration: `${A(l)}'s voice carries across the market: the grain stores open at dawn, and every household will get its share. The shouting dies away. Men lower their fists, and the crowd drifts back to the stalls, murmuring.`,
    }, {
      input: '我爬上一只木桶，告诉大家粮仓开放了。',
      deeds: [`${A(l)}：宣布粮仓明早开放，每户都有份`],
      narration: `${A(l)}的声音传遍集市：粮仓明早开放，每户都有一份。叫骂声渐渐平息。男人们放下拳头，人群低声议论着散回各个摊位。`,
    }),
    expect: { 'unrest:world': { down: true } },
  },
  {
    id: 'gates-barred', title: 'the order to bar the gates is a lockdown, and the sighting before it was not', kind: 'change', start: { 'alert:world': { word: 'watchful' } },
    turn: (l) => pick(l)<Turn>({
      input: 'I run to the watch captain and tell her what I saw.',
      deeds: [`${C(l)}: the watch captain, orders the gates barred and the harbor chain raised`],
      narration: `${C(l)} does not hesitate. "Bar the gates. Raise the harbor chain. Nobody goes in or out until I say so." Within minutes the great gates grind shut and the chain rises, dripping, from the water.`,
    }, {
      input: '我跑去找守卫队长，把看到的告诉她。',
      deeds: [`${C(l)}：守卫队长，下令关闭城门、拉起港口铁链`],
      narration: `${C(l)}毫不迟疑。“关上城门，拉起港口铁链。我没发话之前，谁也不许进出。”几分钟之内，巨大的城门轰然合拢，铁链滴着水从海里升起。`,
    }),
    expect: { 'alert:world': { word: 'lockdown' } },
  },
  {
    id: 'sighted-sails', title: 'sighting unknown ships makes the watch watchful, not locked down', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'What is that out on the horizon?',
      deeds: [`${C(l)}: points out three unfamiliar sails flying no colors`],
      narration: `${C(l)} shades her eyes. Three unfamiliar ships are standing in from the south under no colors. She says nothing more, but her hand drifts to her sword hilt, and the lookouts on the wall are told to keep their eyes on the water.`,
    }, {
      input: '地平线上那是什么？',
      deeds: [`${C(l)}：指出三张没有挂旗的陌生帆`],
      narration: `${C(l)}抬手遮住阳光。三艘陌生的船正从南面驶近，没有挂任何旗帜。她没再多说，手却滑向剑柄，城墙上的瞭望哨被吩咐盯紧海面。`,
    }),
    expect: { 'alert:world': { word: 'watchful' } },
  },
  {
    id: 'pay-ferryman', title: 'a payment moves coins from the payer to the one paid', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I pay the ferryman his fifteen coins.',
      deeds: [`${A(l)}: counts fifteen coins into the ferryman's hand`, `${D(l)}: the ferryman, pockets the coins and unties the boat`],
      narration: `${A(l)} counts fifteen coins into the ferryman's palm. ${D(l)} weighs them with a thumb, nods, pockets them and unties the boat from the post.`,
    }, {
      input: '我把十五个钱币付给摆渡人。',
      deeds: [`${A(l)}：把十五个钱币数进摆渡人手里`, `${D(l)}：摆渡人，把钱收进口袋，解开船缆`],
      narration: `${A(l)}把十五个钱币数进摆渡人的手心。${D(l)}用拇指掂了掂，点点头，把钱收进口袋，从木桩上解开船缆。`,
    }),
    expect: { 'coins:arthur': { to: 25 }, 'coins:dov': { to: 55 } },
  },
  {
    id: 'pay-reward', title: 'a reward is paid out of one purse into another', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I deliver the message and hold out my hand.',
      deeds: [`${C(l)}: reads the message, counts thirty coins into ${A(l)}'s hand`],
      narration: `${C(l)} reads the message twice, folds it away and counts thirty coins into ${A(l)}'s hand. "For the trouble," she says.`,
    }, {
      input: '我把信送到，伸出手。',
      deeds: [`${C(l)}：读完信，把三十个钱币数进${A(l)}手里`],
      narration: `${C(l)}把信读了两遍，收好，把三十个钱币数进${A(l)}的手里。“辛苦你了。”她说。`,
    }),
    expect: { 'coins:arthur': { to: 70 }, 'coins:clara': { to: 10 } },
  },
  {
    id: 'clara-carries', title: 'the one named as working is the one that tires', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: `I sit on the steps and watch ${C(l)} work.`,
      deeds: [`${C(l)}: hauls water barrels up from the cellar for three hours without a break`, `${A(l)}: sits on the steps and watches`],
      narration: `${C(l)} hauls barrel after barrel of water up the cellar stairs, three hours without a break, until her hands shake on the rope. ${A(l)} sits on the steps with his chin on his fist and watches the line of barrels grow.`,
    }, {
      input: `我坐在台阶上看${C(l)}干活。`,
      deeds: [`${C(l)}：从地窖里一桶桶往上提水，三个钟头没停`, `${A(l)}：坐在台阶上看着`],
      narration: `${C(l)}从地窖楼梯一桶接一桶地往上提水，三个钟头没有歇过，直到握绳的手都在发抖。${A(l)}托着下巴坐在台阶上，看着水桶排成一长列。`,
    }),
    expect: { 'fatigue:clara': { up: true } },
  },
  {
    id: 'fight-and-riot', title: 'a broken rib and an enraged crowd, both in one turn', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I charge the watchmen at the gate.',
      deeds: [`${A(l)}: charges the watchmen at the gate`, `${D(l)}: clubs ${A(l)} across the ribs and breaks two of them`],
      narration: `${A(l)}'s rush ends with ${D(l)}'s club across his ribs, and something cracks. ${A(l)} goes down. The crowd behind him, who had been waiting to see what he would do, surges against the watch, shouting that the watch is beating townsfolk now.`,
    }, {
      input: '我向城门口的守卫冲过去。',
      deeds: [`${A(l)}：向城门口的守卫冲去`, `${D(l)}：一棍抽在${A(l)}的肋骨上，打断了两根`],
      narration: `${A(l)}的冲锋止于${D(l)}抽在肋骨上的一棍，骨头咔地一响，${A(l)}倒了下去。他身后一直在看他会怎么做的人群涌向守卫，喊着守卫如今打起镇民来了。`,
    }),
    expect: { 'injured:arthur': { to: true }, 'unrest:world': { up: true } },
    allow: ['alert:world'],
  },

  {
    id: 'two-carry', title: 'two people sharing a heavy effort both tire', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'We carry the chest up the cliff stairs together.',
      deeds: [`${A(l)}: carries one end of an iron-bound chest up the long cliff stairs for two hours`, `${C(l)}: carries the other end all the way up`],
      narration: `${A(l)} and ${C(l)} haul the iron-bound chest up the cliff stairs, one at each end, resting only when the steps turn. Two hours later they set it down at the top, both of them gasping and soaked in sweat.`,
    }, {
      input: '我们一起把箱子抬上悬崖台阶。',
      deeds: [`${A(l)}：抬着包铁箱子的一端，沿着长长的悬崖台阶往上爬了两个钟头`, `${C(l)}：抬着另一端一路爬到顶`],
      narration: `${A(l)}和${C(l)}一人一头，把包铁的箱子抬上悬崖台阶，只在台阶转弯处歇一下。两个钟头后他们把箱子放在顶上，两人都气喘吁吁，汗透衣衫。`,
    }),
    expect: { 'fatigue:arthur': { up: true }, 'fatigue:clara': { up: true } },
  },
  {
    id: 'blast-both', title: 'one blast that wounds both of the people beside it', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I light the fuse and step back.',
      deeds: [`${A(l)}: lights the fuse of a powder keg in the empty cellar of the old customs house`, `${C(l)}: stands beside ${A(l)} at the cellar wall`],
      narration: `The powder keg goes off sooner than ${A(l)} counted on. The blast throws him and ${C(l)} against the cellar wall, and each of them comes up bleeding from a deep cut, ears ringing. The cellar is empty and nobody else hears it.`,
    }, {
      input: '我点燃引信，退后一步。',
      deeds: [`${A(l)}：在旧海关空荡荡的地窖里点燃火药桶的引信`, `${C(l)}：站在${A(l)}旁边的地窖墙边`],
      narration: `火药桶比${A(l)}算的时间炸得更早。冲击把他和${C(l)}一起甩到地窖的墙上，两人都被划开深深的口子，流着血爬起来，耳朵嗡嗡作响。地窖里没有别人，也没有人听见。`,
    }),
    expect: { 'injured:arthur': { to: true }, 'injured:clara': { to: true } },
  },

  // ---- turns that touch a value without changing it
  {
    id: 'weather-talk', title: 'idle talk about the tide changes nothing', kind: 'keep',
    turn: (l) => pick(l)<Turn>({
      input: 'I look at the water.',
      deeds: [`${A(l)}: remarks that the tide is late`, `${C(l)}: agrees and says the wind is in the west`],
      narration: `"Tide's late," ${A(l)} says. ${C(l)} glances at the flags on the wall. "Wind's in the west. It will turn by noon." They stand a while and watch the gulls.`,
    }, {
      input: '我看着海面。',
      deeds: [`${A(l)}：说潮水来晚了`, `${C(l)}：表示同意，说刮的是西风`],
      narration: `“潮水来晚了。”${A(l)}说。${C(l)}瞥了一眼城墙上的旗子。“西风。中午就会转。”他们站了一会儿，看着海鸥。`,
    }),
    expect: {},
  },
  {
    id: 'old-scar', title: 'remembering an old scar is not a wound', kind: 'keep',
    turn: (l) => pick(l)<Turn>({
      input: 'I rub my arm and think about the old days.',
      deeds: [`${A(l)}: touches an old scar on his arm and remembers the fight that gave it to him years ago`],
      narration: `${A(l)} rubs the pale line of an old scar on his forearm, a keepsake from a fight years ago in another port. It has not troubled him in a long time.`,
    }, {
      input: '我揉着胳膊，想起从前的日子。',
      deeds: [`${A(l)}：摸着手臂上的一道旧疤，想起多年前留下这道疤的那场架`],
      narration: `${A(l)}揉着小臂上那道发白的旧疤，那是多年前在另一座港口打架留下的纪念。这道疤已经很久没有再困扰他了。`,
    }),
    expect: {},
  },
  {
    id: 'stroll', title: 'a stroll is not hard effort', kind: 'keep', start: { 'fatigue:arthur': 4 },
    turn: (l) => pick(l)<Turn>({
      input: 'We take a walk along the quay.',
      deeds: [`${A(l)}: strolls along the quay for a few minutes`, `${C(l)}: walks beside him`],
      narration: `${A(l)} and ${C(l)} stroll the length of the quay, in no hurry, and stop to look at the nets. A few minutes later they are back where they started.`,
    }, {
      input: '我们沿着码头散步。',
      deeds: [`${A(l)}：沿着码头溜达了几分钟`, `${C(l)}：走在他身旁`],
      narration: `${A(l)}和${C(l)}不慌不忙地走完整条码头，停下来看了看渔网。几分钟后，他们又回到了起点。`,
    }),
    expect: {},
  },
  {
    id: 'hypothetical-riot', title: 'a warning that the town could riot is not a riot', kind: 'keep',
    turn: (l) => pick(l)<Turn>({
      input: 'I ask her whether the town is safe.',
      deeds: [`${C(l)}: warns that the town could riot if the grain runs short`],
      narration: `"If the grain runs short," ${C(l)} says, "this town will riot. I have seen it happen elsewhere." Outside, the market is quiet and the stalls are full.`,
    }, {
      input: '我问她镇子安不安全。',
      deeds: [`${C(l)}：警告说要是粮食不够，镇子可能会暴乱`],
      narration: `“要是粮食不够，”${C(l)}说，“这镇子就会暴乱。我在别处见过。”窗外，集市很安静，摊位上堆得满满的。`,
    }),
    expect: {},
  },
  {
    id: 'already-injured', title: 'favouring an arm that is already counted as wounded changes nothing', kind: 'keep', start: { 'injured:arthur': true },
    turn: (l) => pick(l)<Turn>({
      input: 'I lift my mug.',
      deeds: [`${A(l)}: winces and shifts the mug to his other hand`],
      narration: `${A(l)} winces as he lifts the mug and shifts it to his other hand. The bandaged arm is still stiff.`,
    }, {
      input: '我端起杯子。',
      deeds: [`${A(l)}：皱了皱眉，把杯子换到另一只手`],
      narration: `${A(l)}端杯子时皱了皱眉，把它换到另一只手上。缠着绷带的那条胳膊依旧僵硬。`,
    }),
    expect: {},
  },
  {
    id: 'other-injured', title: 'a sprained ankle belongs to the one who sprained it', kind: 'change',
    turn: (l) => pick(l)<Turn>({
      input: 'I offer him my shoulder.',
      deeds: [`${D(l)}: slips on the wet ramp and badly sprains his ankle`, `${A(l)}: offers ${D(l)} his shoulder`],
      narration: `${D(l)} slips on the wet ramp and goes down hard. His ankle twists under him, and he cannot put his weight on it. ${A(l)} offers him a shoulder and takes the strain.`,
    }, {
      input: '我把肩膀借给他。',
      deeds: [`${D(l)}：在湿滑的跳板上滑倒，脚踝严重扭伤`, `${A(l)}：把肩膀借给${D(l)}`],
      narration: `${D(l)}在湿滑的跳板上摔了个结实。脚踝在身下一拧，他再也不能把重量压在这只脚上。${A(l)}把肩膀递过去，替他撑住身子。`,
    }),
    expect: { 'injured:dov': { to: true } },
  },
  {
    id: 'haggle', title: 'haggling without buying leaves the purse alone', kind: 'keep',
    turn: (l) => pick(l)<Turn>({
      input: 'I argue about the price of a rope.',
      deeds: [`${A(l)}: haggles with a rope seller over the price of a coil and walks away without buying`],
      narration: `${A(l)} argues for ten minutes about the price of a coil of rope, then shakes his head and walks off. The seller mutters after him.`,
    }, {
      input: '我和人争一卷绳子的价钱。',
      deeds: [`${A(l)}：和卖绳子的人为一卷绳子讨价还价，最后没买就走了`],
      narration: `${A(l)}为一卷绳子的价钱争了十分钟，最后摇摇头走开。卖绳人在他身后嘟囔着。`,
    }),
    expect: {},
  },
  {
    id: 'rumor-gates', title: 'a rumour that the gates may close is not an order to close them', kind: 'keep',
    turn: (l) => pick(l)<Turn>({
      input: 'I ask what he has heard.',
      deeds: [`${D(l)}: repeats a rumour that the gates might be closed tomorrow`],
      narration: `"They say the gates might be barred tomorrow," ${D(l)} says, lowering his voice. "Somebody's cousin heard it from a guard." Nobody at the gate seems to know anything about it.`,
    }, {
      input: '我问他听到了什么。',
      deeds: [`${D(l)}：转述一个传言，说城门明天可能会关`],
      narration: `“听说明天城门可能要关。”${D(l)}压低声音说，“某人的表亲从一个守卫那儿听来的。”城门口的人似乎对此一无所知。`,
    }),
    expect: {},
  },
  {
    id: 'doze', title: 'a few minutes of dozing is not a night of sleep', kind: 'keep', start: { 'fatigue:arthur': 6 },
    turn: (l) => pick(l)<Turn>({
      input: 'I sit down by the stove for a moment.',
      deeds: [`${A(l)}: dozes in a chair for a few minutes`],
      narration: `${A(l)} drops into a chair by the stove and dozes for a few minutes, until the kettle's whistle wakes him.`,
    }, {
      input: '我在炉子边坐一会儿。',
      deeds: [`${A(l)}：在椅子上打了几分钟盹`],
      narration: `${A(l)}瘫进炉边的椅子里打了几分钟盹，直到水壶的哨声把他吵醒。`,
    }),
    expect: {},
  },
]

/** The value a case starts a value at, in the language of the run. */
export const startValue = (given: VariableValue | { word: AlertWord }, language: Language): VariableValue => (typeof given === 'object' ? alertWord(language, given.word) : given)

/** Whether the value a case ended on is what the case asks of it. */
export function valueOk(check: ValueCheck, started: VariableValue, got: VariableValue, language: Language): boolean {
  if ('to' in check) return got === check.to
  if ('word' in check) return got === alertWord(language, check.word)
  if (typeof got !== 'number' || typeof started !== 'number') return false
  if ('up' in check) return got > started
  if ('down' in check) return got < started
  if ('atMost' in check) return got <= check.atMost
  return got >= check.atLeast
}

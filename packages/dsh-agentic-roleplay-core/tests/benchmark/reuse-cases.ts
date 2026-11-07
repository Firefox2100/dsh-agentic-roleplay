import type { Language } from './language.ts'

/** One stored picture, as the gallery describes it, and whether it shows the moment. */
export interface Candidate {
  fits: boolean
  description: Record<Language, string>
}

/**
 * A moment of the story and the stored pictures that were close to it by words: the ones that show it, and the near misses a decision model is meant to refuse (the same place at
 * another time, the same people with someone else, something in the picture the moment contradicts). A moment may have no picture that fits.
 */
export interface ReuseCase {
  id: string
  title: string
  moment: Record<Language, string>
  candidates: readonly Candidate[]
}

const yes = (en: string, zh: string): Candidate => ({ fits: true, description: { en, zh } })
const no = (en: string, zh: string): Candidate => ({ fits: false, description: { en, zh } })

export const REUSE_CASES: readonly ReuseCase[] = [
  {
    id: 'quay-dawn', title: 'the same quay and people, at another hour or with other people',
    moment: { en: 'Arthur and Clara stand on the quay at dawn and watch the grain barge come in.', zh: '亚瑟和克拉拉在黎明的码头上站着，看粮船靠岸。' },
    candidates: [
      no('Arthur and Clara stand on the quay at night under a swinging lantern, the harbor black behind them.', '亚瑟和克拉拉在夜里的码头上站着，一盏摇晃的提灯照着，身后的港湾一片漆黑。'),
      yes('Two figures, Arthur and Clara, stand at the edge of a stone quay in the first grey light as a laden grain barge noses in.', '亚瑟和克拉拉两个人站在石砌码头边缘，天刚蒙蒙亮，一条满载的粮船缓缓靠拢。'),
      no('Dov alone on the quay at dawn, mending a net.', '多夫独自在黎明的码头上补渔网。'),
      no('A crowded market square at dawn, stalls being set up.', '黎明时分人来人往的集市广场，摊位正在支起来。'),
    ],
  },
  {
    id: 'lamp-lit', title: 'a paraphrase fits, the lamp dark or the tower from outside does not',
    moment: { en: 'Clara lights the great lamp at the top of the lighthouse as the sun sets.', zh: '日落时，克拉拉在灯塔顶上点亮大灯。' },
    candidates: [
      no('Clara stands in the lantern room of the lighthouse at noon, the great lamp dark.', '正午，克拉拉站在灯塔的灯室里，大灯没有点亮。'),
      no('The lighthouse tower seen from the beach at sunset, a small light in its window.', '日落时从海滩望去的灯塔，塔窗里透出一点微光。'),
      yes('In the lantern room at the top of the lighthouse, Clara touches a taper to the huge lamp while the sun sinks into the sea.', '灯塔顶部的灯室里，克拉拉把火绳凑向巨大的灯，太阳正沉入海中。'),
    ],
  },
  {
    id: 'bar-alone', title: 'alone at the bar, against the same bar with company',
    moment: { en: 'Arthur sits at the inn bar alone with a drink.', zh: '亚瑟独自坐在客栈的吧台边，面前一杯酒。' },
    candidates: [
      no('Arthur sits at the inn bar with Clara beside him, both with drinks.', '亚瑟坐在客栈的吧台边，克拉拉坐在他旁边，两人都端着酒。'),
      yes('Arthur sits alone at the long bar of a smoky inn, a mug in front of him.', '亚瑟独自坐在烟气弥漫的客栈长吧台边，面前放着一只酒杯。'),
      no('The inn bar at closing time, empty stools and a sleeping cat.', '打烊时的客栈吧台，空凳子和一只睡着的猫。'),
    ],
  },
  {
    id: 'market-storm', title: 'the market in a storm, not in sunshine or crowded',
    moment: { en: 'Rain lashes the empty market square, the stalls shuttered, lightning over the roofs.', zh: '暴雨抽打着空荡的集市广场，摊位都关着，闪电划过屋顶。' },
    candidates: [
      no('The market square on a sunny morning, stalls crowded with shoppers.', '阳光明媚的早晨，集市广场上的摊位挤满了顾客。'),
      yes('An empty market square in a downpour, shutters closed on every stall, a flash of lightning above the rooftops.', '倾盆大雨中空无一人的集市广场，每个摊位都关着板，屋顶上空闪过一道电光。'),
      no('The market square at dusk with lanterns lit and a few late shoppers.', '黄昏的集市广场，点着灯笼，还有几个晚归的顾客。'),
    ],
  },
  {
    id: 'cove-boat', title: 'nothing stored shows it',
    moment: { en: 'Dov rows a small boat across the cove, alone.', zh: '多夫独自划着一条小船穿过海湾。' },
    candidates: [
      no('Arthur and Clara stand on the quay at dawn and watch a barge come in.', '亚瑟和克拉拉在黎明的码头上站着，看一条驳船靠岸。'),
      no('Arthur sits at the inn bar alone with a drink.', '亚瑟独自坐在客栈的吧台边，面前一杯酒。'),
      no('A crowded market square at midday.', '正午人头攒动的集市广场。'),
    ],
  },
  {
    id: 'bandage-inn', title: 'the same act by someone else is another picture',
    moment: { en: 'Clara bandages Arthur\'s arm at a table in the inn.', zh: '克拉拉在客栈的桌边给亚瑟的手臂包扎。' },
    candidates: [
      no('Dov bandages Arthur\'s arm at a table in the inn.', '多夫在客栈的桌边给亚瑟的手臂包扎。'),
      yes('At a table in the inn, Clara wraps linen around Arthur\'s forearm while he looks away.', '客栈的桌边，克拉拉用亚麻布缠住亚瑟的小臂，他把头转向一边。'),
      no('Clara bandages Arthur\'s arm on the quay in the rain.', '克拉拉在雨中的码头上给亚瑟的手臂包扎。'),
    ],
  },
  {
    id: 'packed-square', title: 'a packed square is not two people in an empty one',
    moment: { en: 'The market square is packed, townsfolk shoulder to shoulder before the platform.', zh: '集市广场挤得满满当当，镇民们肩挨着肩围在高台前。' },
    candidates: [
      no('Two townsfolk stand in an empty market square, a dog between them.', '两个镇民站在空荡的集市广场上，中间蹲着一条狗。'),
      yes('A packed market square, townspeople crammed shoulder to shoulder around a wooden platform.', '挤满人的集市广场，镇民们肩并肩挤在一座木台周围。'),
    ],
  },
  {
    id: 'gates-shut', title: 'closed gates and a chain, not open gates',
    moment: { en: 'The harbor gates are shut and the chain is raised across the harbor mouth.', zh: '港口的大门紧闭，铁链横拉在港口入口处。' },
    candidates: [
      no('The harbor gates stand wide open and ships pass through under a bright sky.', '港口的大门敞开着，船只在明朗的天空下驶过。'),
      yes('Heavy harbor gates closed tight and an iron chain drawn taut across the mouth of the harbor.', '沉重的港口大门紧紧关闭，一条铁链在港口入口处拉得笔直。'),
      no('The harbor gates closed at night, a single guard with a lantern.', '夜里关闭的港口大门，一个守卫提着灯站着。'),
    ],
  },
  {
    id: 'tower-door', title: 'an open door against a locked one',
    moment: { en: 'The door of the lighthouse tower stands unlatched and a little open, wind pushing at it.', zh: '灯塔塔楼的门虚掩着，开着一道缝，风推着它。' },
    candidates: [
      no('The lighthouse tower door locked with a heavy iron bar, the street empty.', '灯塔塔楼的门被一根沉重的铁闩锁着，街上空无一人。'),
      yes('A weathered door at the base of the lighthouse hangs slightly open, the wind tugging at it.', '灯塔底部一扇风吹日晒的门微微敞开，风在拉扯着它。'),
      no('The inn door standing open, warm light spilling out.', '客栈的门敞开着，温暖的灯光洒出来。'),
    ],
  },
  {
    id: 'three-ships', title: 'three ships, not one',
    moment: { en: 'Three unfamiliar ships stand in from the south under no colors.', zh: '三艘没有挂旗的陌生船只从南面驶近。' },
    candidates: [
      no('A single merchant ship tied up at the quay, flags flying.', '一艘商船系在码头边，旗帜飘扬。'),
      yes('Three dark ships with no flags sail in from the southern horizon toward the harbor.', '三艘没有旗帜的黑色船只从南方的地平线驶向港口。'),
      no('Three fishing boats returning at sunset, nets hanging.', '日落时三条归来的渔船，渔网垂在船边。'),
      no('Two unfamiliar ships with red flags at anchor outside the harbor.', '两艘挂着红旗的陌生船只停泊在港外。'),
    ],
  },
  {
    id: 'sleeping-loft', title: 'the sleeper alone, with the right room',
    moment: { en: 'Arthur sleeps in the loft above the net shop, morning light through the shutters.', zh: '亚瑟睡在渔网铺上面的阁楼里，晨光透过百叶窗洒进来。' },
    candidates: [
      yes('A man asleep on a straw mattress in a low loft, nets hanging below, morning light slanting through the shutters.', '一个男人睡在低矮阁楼的草垫上，下面挂着渔网，晨光斜斜地穿过百叶窗。'),
      no('A man asleep in an inn bed at night, a candle burnt down.', '一个男人夜里睡在客栈的床上，蜡烛已经烧尽。'),
      no('A cat asleep on a pile of nets in the net shop in the morning.', '早晨渔网铺里，一只猫睡在一堆渔网上。'),
    ],
  },
  {
    id: 'toast', title: 'the same room and day, with a different thing happening',
    moment: { en: 'Clara raises a mug in a toast at the crowded inn, everyone cheering.', zh: '克拉拉在人声鼎沸的客栈里举杯祝酒，所有人都在欢呼。' },
    candidates: [
      no('Clara arm-wrestles a sailor at a table in the crowded inn, onlookers shouting.', '克拉拉在人声鼎沸的客栈里和一个水手掰手腕，旁观的人大声喊叫。'),
      yes('In a crowded inn Clara holds her mug high, and the patrons around her cheer and raise theirs.', '在拥挤的客栈里，克拉拉高举酒杯，周围的客人欢呼着举起了自己的杯子。'),
      no('Clara sits alone in the inn, her mug untouched, the room empty.', '克拉拉独自坐在客栈里，酒杯没动过，房间里空无一人。'),
    ],
  },
]

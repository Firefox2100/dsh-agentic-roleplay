import type { Language } from './language.ts'
import { pick } from './language.ts'

/** A list of texts with the pairs among them that are the same thing (or conflict): what the cut that picks the pairs to ask a model about has to keep. */
export interface PairSet {
  id: string
  texts: string[]
  /** Index pairs a model must be asked about. */
  positives: [number, number][]
}

const withPositives = (texts: string[], named: [string, string][]): PairSet['positives'] => named.map(([a, b]) => [texts.findIndex(text => text.startsWith(`${a} (`) || text.startsWith(`${a}:`)), texts.findIndex(text => text.startsWith(`${b} (`) || text.startsWith(`${b}:`))] as [number, number])

/** Tracked values as the check writes them: `Name (key): description`. Most are distinct needs and feelings that sit close in meaning. */
export function valuesSet(language: Language): PairSet {
  const t = pick(language)
  const rows: [string, string, string][] = [
    ['reputation', t('Reputation', '声望'), t('How well the town thinks of this person.', '镇上人对这个人的评价有多好。')],
    ['standing', t('Standing', '名望'), t('Where this person stands in the eyes of the townsfolk.', '这个人在镇民眼中的地位。')],
    ['courage', t('Courage', '勇气'), t('How bold the character is when frightened.', '角色在害怕时有多大胆。')],
    ['nerve', t('Nerve', '胆量'), t('How bold the character is when frightened.', '角色在害怕时有多大胆。')],
    ['vigor', t('Vigor', '精力'), t('How much strength the character has left to work with.', '角色还剩多少力气可用。')],
    ['strength_left', t('Strength left', '剩余体力'), t('How much strength the character has left for hard work.', '角色还剩多少力气干重活。')],
    ['hunger', t('Hunger', '饥饿'), t('How hungry the character is.', '角色有多饿。')],
    ['thirst', t('Thirst', '口渴'), t('How thirsty the character is.', '角色有多渴。')],
    ['cold', t('Cold', '寒冷'), t('How cold the character is.', '角色有多冷。')],
    ['fatigue', t('Fatigue', '疲劳'), t('How tired the character is.', '角色有多累。')],
    ['fear', t('Fear', '恐惧'), t('How frightened the character is right now.', '角色此刻有多害怕。')],
    ['anger', t('Anger', '愤怒'), t('How angry the character is right now.', '角色此刻有多愤怒。')],
    ['joy', t('Joy', '喜悦'), t('How happy the character is right now.', '角色此刻有多开心。')],
    ['grief', t('Grief', '悲伤'), t('How much the character mourns a loss.', '角色为失去的东西哀悼得有多深。')],
    ['trust', t('Trust', '信任'), t('How far this person trusts the player\'s character.', '这个人有多信任玩家角色。')],
    ['affection', t('Affection', '好感'), t('How fond this person is of the player\'s character.', '这个人有多喜欢玩家角色。')],
    ['loyalty', t('Loyalty', '忠诚'), t('How loyal this person is to their organisation.', '这个人对所属组织有多忠诚。')],
    ['suspicion', t('Suspicion', '怀疑'), t('How much this person suspects the player\'s character.', '这个人有多怀疑玩家角色。')],
    ['greed', t('Greed', '贪婪'), t('How much this person wants money.', '这个人有多想要钱。')],
    ['pride', t('Pride', '骄傲'), t('How proud this person is.', '这个人有多骄傲。')],
    ['shame', t('Shame', '羞耻'), t('How ashamed this person is.', '这个人有多羞愧。')],
    ['curiosity', t('Curiosity', '好奇'), t('How much this person wants to find out.', '这个人有多想弄个明白。')],
    ['patience', t('Patience', '耐心'), t('How long this person will wait.', '这个人愿意等多久。')],
    ['wealth', t('Wealth', '财富'), t('How much money the character has.', '角色有多少钱。')],
    ['debt', t('Debt', '债务'), t('How much money the character owes.', '角色欠了多少钱。')],
    ['injury', t('Injury', '伤势'), t('How badly the character is hurt.', '角色伤得有多重。')],
    ['illness', t('Illness', '疾病'), t('How sick the character is.', '角色病得有多重。')],
    ['alertness', t('Alertness', '警觉'), t('How watchful the character is.', '角色有多警惕。')],
    ['stealth', t('Stealth', '隐蔽'), t('How well hidden the character is.', '角色藏得有多好。')],
    ['faith', t('Faith', '信仰'), t('How strongly the character believes in the keeper\'s oath.', '角色对守塔誓言的信念有多坚定。')],
  ]
  const texts = rows.map(([key, name, description]) => `${name} (${key}): ${description}`)
  return { id: 'values', texts, positives: withPositives(texts, [[t('Reputation', '声望'), t('Standing', '名望')], [t('Courage', '勇气'), t('Nerve', '胆量')], [t('Vigor', '精力'), t('Strength left', '剩余体力')]]) }
}

/** Background entries, each a fact about one subject, from a table so that the entries sit close together; a few subjects have a second entry that contradicts the first. */
export function loreSet(language: Language): PairSet {
  const t = pick(language)
  const subjects: [string, string, string, string][] = [
    ['the lighthouse', '灯塔', 'Mara Venn\'s father', '玛拉的父亲'], ['the pier bell', '码头的钟', 'the guild', '公会'], ['the harbor office', '港务所', 'Ines Calder', '伊内斯·卡尔德'], ['the Anchor & Lamp', '锚与灯客栈', 'Tomas Reyes', '托马斯·雷耶斯'],
    ['the north breakwater', '北防波堤', 'the county', '郡政府'], ['the fish market', '鱼市', 'the salt-panners', '晒盐人'], ['the ferry', '渡船', 'the guild', '公会'], ['the signal lamp', '信号灯', 'Old Bram', '老布拉姆'],
    ['the salt pans', '盐田', 'the first families', '最早的几户人家'], ['the cliff road', '悬崖路', 'the county', '郡政府'], ['the chapel', '小教堂', 'the first families', '最早的几户人家'], ['the rope walk', '制绳场', 'the guild', '公会'],
    ['the net loft', '晒网阁', 'Kit Alder\'s uncle', '基特·奥尔德的叔叔'], ['the boat yard', '造船厂', 'the salt-panners', '晒盐人'], ['the customs shed', '关税棚', 'the county', '郡政府'], ['the herring smokehouse', '熏鲱鱼房', 'the Reyes family', '雷耶斯家'],
    ['the school', '学堂', 'the chapel', '小教堂'], ['the well', '水井', 'the first families', '最早的几户人家'], ['the old mill', '旧磨坊', 'the salt-panners', '晒盐人'], ['the tide gauge', '潮位标', 'Ines Calder', '伊内斯·卡尔德'],
  ]
  const years = [1851, 1790, 1862, 1874, 1886, 1789, 1830, 1858, 1795, 1840, 1801, 1867, 1822, 1812, 1879, 1855, 1869, 1792, 1805, 1881]
  const entry = (at: number, year: number, by: [string, string]): string => t(`${subjects[at]![0]}: built in ${year} by ${by[0]} and kept in good repair ever since.`, `${subjects[at]![1]}：由${by[1]}于 ${year} 年建成，此后一直保养完好。`)
  const texts = subjects.map((subject, at) => entry(at, years[at]!, [subject[2], subject[3]]))
  const conflicts: [number, number, [string, string]][] = [[0, 1872, ['a ship\'s carpenter', '一位船木匠']], [3, 1850, ['Tomas Reyes', '托马斯·雷耶斯']], [8, 1795, ['the guild', '公会']], [15, 1855, ['the county', '郡政府']]]
  const positives: [number, number][] = []
  for (const [at, year, by] of conflicts) { positives.push([at, texts.length]); texts.push(entry(at, year, by)) }
  return { id: 'lore', texts, positives }
}

/** Characters, places, organisations and things as the name check writes them; a few are one thing written twice. */
export function thingsSet(language: Language): PairSet {
  const t = pick(language)
  const rows: [string, string][] = [
    ['Mara Venn', t('Tall, dry-witted surveyor, the lighthouse keeper\'s daughter.', '身材高挑、说话带冷幽默的测绘员，守塔人的女儿。')],
    ['Tomas Reyes', t('Genial landlord of the Anchor & Lamp, a former keeper\'s mate.', '锚与灯客栈和气的老板，曾是守塔人的助手。')],
    ['Ines Calder', t('Harbor master and head of the guild, orderly and immovable.', '港务长兼公会会长，井井有条，寸步不让。')],
    ['Old Bram', t('The lighthouse keeper, silent and exact, missing for nine days.', '守塔人，沉默而一丝不苟，已失踪九天。')],
    ['Bram the Keeper', t('The keeper of the lighthouse, a silent and exact man, missing for nine days.', '灯塔的守塔人，沉默而一丝不苟，已失踪九天。')],
    ['Kit Alder', t('A cheerful dock boy who runs errands.', '开朗的码头少年，常跑腿送信。')],
    ['Rosa Reyes', t('Tomas Reyes\'s sister, who bakes the harbor\'s bread.', '托马斯·雷耶斯的姐姐，给全港烤面包。')],
    ['Quill Marsh', t('A rumpled newspaper reporter with a notebook.', '皱巴巴的报社记者，带着笔记本。')],
    ['The Pier', t('A long wooden pier slick with fog, with mooring stones along its edge.', '被雾打湿的长木码头，边缘排着系缆石。')],
    ['The Old Pier', t('A derelict pier across the cove, rotted through and used only by gulls.', '海湾对面废弃的码头，木头烂透，只有海鸥停歇。')],
    ['The Market', t('A cobbled square of fish stalls under oilcloth awnings.', '鹅卵石广场，油布篷下排着鱼摊。')],
    ['The Fish Market', t('A cobbled square where fish stalls stand under oilcloth awnings.', '鹅卵石铺的广场，鱼摊立在油布篷下。')],
    ['The Lighthouse', t('A stone tower on the headland, its lamp dark.', '岬角上的石塔，灯已熄灭。')],
    ['The Lighthouse Tower', t('A stone tower on the headland whose great lamp is dark.', '岬角上的石塔，大灯熄灭。')],
    ['The Harbor Office', t('A panelled upper room with tide tables and a locked strongbox.', '镶木板的楼上房间，有潮汐表和一只上锁的保险箱。')],
    ['The Signal Room', t('A glass room under the lamp with a signal lamp by the window.', '灯下的玻璃房间，窗边有一盏信号灯。')],
    ['The Cellar', t('A dry stone cellar full of crates stamped with the guild\'s mark.', '干燥的石砌地窖，堆满印着公会标记的木箱。')],
    ['The Anchor & Lamp', t('The inn above the market with a bar, a fire and a ledger.', '集市上方的客栈，有酒吧、炉火和一本账簿。')],
    ['The Harbor Guild', t('The body that controls moorings, fish prices and the harbor office.', '掌管泊位、鱼价和港务所的组织。')],
    ['The Order of Lamp-Keepers', t('The old brotherhood of lighthouse keepers along the coast.', '沿海灯塔守护人的古老兄弟会。')],
    ['Lighthouse key', t('A heavy iron key with a salt-white bow.', '一把沉重的铁钥匙，柄环结着白盐。')],
    ['Iron key to the lighthouse', t('A heavy iron key with a salt-white bow, for the lighthouse door.', '一把沉重的铁钥匙，柄环结着白盐，用来开灯塔的门。')],
    ['Strongbox key', t('A small steel key on a ring.', '环上挂着的一把小钢钥匙。')],
    ['Tide table', t('A printed table of tides for the year.', '全年潮汐的印刷表。')],
    ['Room ledger', t('The inn\'s book of guests, dates and payments.', '客栈记录住客、日期和付款的账簿。')],
    ['Oilskin coat', t('A surveyor\'s coat, stiff with wax.', '测绘员的外套，打过蜡，硬挺挺的。')],
    ['Hand lantern', t('A tin lantern with a horn window.', '锡皮提灯，带角质窗。')],
    ['Signal lamp', t('A shuttered lamp for flashing signals out to sea.', '带遮光板的灯，用来向海上打信号。')],
  ]
  const zh: Record<string, string> = {"Mara Venn": "玛拉·文", "Tomas Reyes": "托马斯·雷耶斯", "Ines Calder": "伊内斯·卡尔德", "Old Bram": "老布拉姆", "Bram the Keeper": "守塔人布拉姆", "Kit Alder": "基特·奥尔德", "Rosa Reyes": "罗莎·雷耶斯", "Quill Marsh": "奎尔·马什", "The Pier": "码头", "The Old Pier": "旧码头", "The Market": "集市", "The Fish Market": "鱼市", "The Lighthouse": "灯塔", "The Lighthouse Tower": "灯塔塔楼", "The Harbor Office": "港务所", "The Signal Room": "信号室", "The Cellar": "地窖", "The Anchor & Lamp": "锚与灯客栈", "The Harbor Guild": "渔港公会", "The Order of Lamp-Keepers": "守灯人会", "Lighthouse key": "灯塔钥匙", "Iron key to the lighthouse": "通往灯塔的铁钥匙", "Strongbox key": "保险箱钥匙", "Tide table": "潮汐表", "Room ledger": "客房账簿", "Oilskin coat": "油布外套", "Hand lantern": "手提灯", "Signal lamp": "信号灯"}
  const shown = (name: string): string => t(name, zh[name]!)
  const texts = rows.map(([name, text]) => `${shown(name)}: ${text}`)
  const at = (name: string): number => rows.findIndex(row => row[0] === name)
  return { id: 'things', texts, positives: [[at('Old Bram'), at('Bram the Keeper')], [at('The Lighthouse'), at('The Lighthouse Tower')], [at('Lighthouse key'), at('Iron key to the lighthouse')], [at('The Market'), at('The Fish Market')]] }
}

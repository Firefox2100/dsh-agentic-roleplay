import type { Language } from './language.ts'
import { castName } from './attribution-cases.ts'
import { PLAYER_PART_QUESTION, SUPPORT_QUESTION } from './judges.ts'

/**
 * The yes-or-no judgements the product asks a model, one labelled set for each: the output checks (agency, refusal, secrets), the rule check, the commitments of a character (errands), whether a character
 * would write (messages), the statements triggers wait on, and the belief check of reflection. Each case is the state the product gives, the variables of the site's shipped question, and the right answer;
 * the same question is put to the decision model (its probability against the site's cut) and to the language model. Invented people and places only.
 */
export type Site = 'agency' | 'refusal' | 'secrets' | 'rules' | 'errands' | 'messages' | 'triggers' | 'reflection' | 'plotpart' | 'support' | 'hook'

/** The shipped question of each site, and the probability from which the product takes a yes. */
export const SITES: Record<Site, { prompt: string; cut: number; /** A question the benchmark owns, in place of a shipped prompt. */ own?: Record<Language, string> }> = {
  agency: { prompt: 'roleplay/gate-agency', cut: 0.5 },
  refusal: { prompt: 'roleplay/gate-refusal', cut: 0.5 },
  secrets: { prompt: 'roleplay/gate-secret', cut: 0.5 },
  rules: { prompt: 'roleplay/check-rule', cut: 0.5 },
  errands: { prompt: 'roleplay/decide-errand', cut: 0.5 },
  messages: { prompt: 'roleplay/decide-message', cut: 0.5 },
  triggers: { prompt: 'roleplay/decide-trigger', cut: 0.85 },
  reflection: { prompt: 'roleplay/decide-reflection', cut: 0.85 },
  plotpart: { prompt: '', cut: 0.5, own: PLAYER_PART_QUESTION },
  support: { prompt: '', cut: 0.5, own: SUPPORT_QUESTION },
  hook: { prompt: 'roleplay/check-hook', cut: 0.5 },
}

export interface SiteView {
  state: Record<string, unknown>
  /** The variables of the shipped question. */
  vars: Record<string, string>
}

export interface SiteCase {
  id: string
  site: Site
  /** The right answer: the fault is there, the rule is broken, the statement holds. */
  yes: boolean
  view: (language: Language) => SiteView
}

const mara = (language: Language): string => castName('mara', language)
const elias = (language: Language): string => castName('elias', language)
const odile = (language: Language): string => castName('odile', language)
const pavel = (language: Language): string => castName('pavel', language)

type Pair<T> = { en: T; zh: T }
const pair = <T>(en: T, zh: T): Pair<T> => ({ en, zh })
const make = (site: Site, id: string, yes: boolean, view: (language: Language) => SiteView): SiteCase => ({ id: `${site}-${id}`, site, yes, view })

const agency = (id: string, yes: boolean, input: Pair<string>, narration: Pair<string>): SiteCase => make('agency', id, yes, language => ({ state: { player_character: mara(language), player_message: input[language], narration: narration[language] }, vars: {} }))
const refusal = (id: string, yes: boolean, passage: Pair<string>): SiteCase => make('refusal', id, yes, language => ({ state: { passage: passage[language] }, vars: {} }))
const secret = (id: string, yes: boolean, fact: Pair<string>, passage: Pair<string>): SiteCase => make('secrets', id, yes, language => ({ state: { passage: passage[language] }, vars: { secret: fact[language] } }))
const rule = (id: string, yes: boolean, text: Pair<string>, input: Pair<string>): SiteCase => make('rules', id, yes, language => ({ state: { player_character: mara(language), player_message: input[language] }, vars: { rule: text[language] } }))

export const SITE_CASES: SiteCase[] = [
  agency('feels', true, pair('I knock on the kitchen door.', '我敲了敲厨房的门。'), pair('Mara knocks, and a wave of dread settles over her. She decides she will not tell Elias why she came.', '林夏敲了敲门，一阵恐惧涌上心头。她决定不告诉陈远自己为什么来。')),
  agency('speaks', true, pair('I put the letter on the table.', '我把信放在桌上。'), pair('Mara puts the letter on the table. "I wrote this in a rage," she says, "and I regret every word."', '林夏把信放在桌上。“这是我气头上写的，”她说，“每个字我都后悔。”')),
  agency('walks', true, pair('I look at the old clock.', '我看了看那只旧钟。'), pair('Mara looks at the clock, then crosses the room, opens the cellar door and goes down the steps.', '林夏看了看那只旧钟，然后穿过房间，打开地窖的门，走了下去。')),
  agency('world', false, pair('I knock on the kitchen door.', '我敲了敲厨房的门。'), pair('The knock echoes. Elias opens the door, wiping flour from his hands, and the smell of bread spills into the lane.', '敲门声回荡开来。陈远擦着手上的面粉打开了门，面包的香味溢到小巷里。')),
  agency('result', false, pair('I push the heavy door with my shoulder.', '我用肩膀顶那扇沉重的门。'), pair('Mara shoves the door; it groans and gives, and a bruise stings along her shoulder. Dust drifts down from the lintel.', '林夏用力一顶，门吱呀一声开了，肩上一阵刺痛。灰尘从门楣上落下来。')),
  agency('others', false, pair('I ask Pavel about the debt.', '我向吴峰问起那笔欠款。'), pair('Pavel scowls and opens his ledger. "Thirty coins," he says, "and not a day more." Behind him the clock ticks loudly.', '吴峰皱起眉，翻开账本。“三十枚硬币，”他说，“一天也不能多。”他身后的钟滴答作响。')),

  refusal('apology', true, pair('Mara steps into the cellar. I\'m sorry, but I can\'t continue with this scene as it involves violence. Let\'s take the story in a different direction.', '林夏走进地窖。很抱歉，这一幕涉及暴力，我无法继续写下去。我们换个方向吧。')),
  refusal('assistant', true, pair('The door swings shut behind her. As an AI language model, I should note that this story contains themes some readers may find disturbing.', '门在她身后关上。作为一个人工智能语言模型，我需要说明这个故事含有一些读者可能感到不适的内容。')),
  refusal('player', true, pair('Elias pours the tea and waits. Note to the player: your character\'s choices here are harmful, so please consider acting more kindly.', '陈远倒好茶，静静等着。提醒玩家：你的角色在这里的选择有害，请考虑善良一些。')),
  refusal('dark', false, pair('The blade went in without a sound. Pavel dropped to his knees, and the blood ran dark between the cobblestones while no one in the lane moved.', '刀子无声地刺了进去。吴峰跪倒在地，血顺着鹅卵石的缝隙流成黑色，小巷里没有一个人动。')),
  refusal('in-story', false, pair('Elias folds his arms. "I won\'t help you with this," he says, "and I\'m warning you: leave the cellar alone."', '陈远抱起双臂。“这件事我不会帮你，”他说，“我警告你，别碰地窖。”')),
  refusal('plain', false, pair('Rain begins on the roof. Odile pulls the shutters closed and lights the lamp, humming to herself.', '雨开始敲打屋顶。周婉拉上百叶窗，点亮了灯，轻声哼着歌。')),

  secret('stated', true, pair('Pavel forged the debt papers.', '吴峰伪造了欠款文书。'), pair('Elias leans in. "Pavel forged the debt papers," he says. "Everyone in the lane suspects it, but I know it."', '陈远凑近了些。“吴峰伪造了欠款文书，”他说，“巷子里的人都有怀疑，可我是知道的。”')),
  secret('amounts', true, pair('The cellar hides the stolen lantern.', '地窖里藏着被偷的灯笼。'), pair('Odile glances down at the floor. The stolen lantern is in the cellar, she says flatly, under the barrels.', '周婉低头看了看地板，平静地说被偷的灯笼就在地窖里，藏在酒桶下面。')),
  secret('narration', true, pair('Odile is the harbor master\'s informant.', '周婉是港务长的线人。'), pair('Odile smiles at the crowd, but the narration knows what she is: the harbor master\'s informant, who reports every name she hears.', '周婉对着人群微笑，但叙述知道她是什么人：港务长的线人，听到的每个名字都会上报。')),
  secret('hint', false, pair('Pavel forged the debt papers.', '吴峰伪造了欠款文书。'), pair('Elias frowns at the papers. "The ink looks fresher than it should," he mutters. "I wonder who wrote them."', '陈远皱眉看着文书。“墨迹比应有的要新，”他嘀咕道，“不知道是谁写的。”')),
  secret('rumour', false, pair('The cellar hides the stolen lantern.', '地窖里藏着被偷的灯笼。'), pair('"They say the lantern went missing," Odile says. "Some think it left the harbor; I couldn\'t tell you."', '“听说灯笼不见了，”周婉说，“有人以为它出了港口，我可说不准。”')),
  secret('elsewhere', false, pair('Odile is the harbor master\'s informant.', '周婉是港务长的线人。'), pair('Odile sets out the bowls and lines up the spoons. The lane outside smells of rain and fried onions.', '周婉摆好碗，把勺子排成一列。外面的小巷里有雨和炒洋葱的气味。')),

  rule('fireball', true, pair('There is no magic in this world.', '这个世界没有魔法。'), pair('I cast a fireball at the door.', '我对着门施放一个火球。')),
  rule('fly', true, pair('Nobody can fly.', '没有人能飞。'), pair('I spread my arms and fly over the wall.', '我张开双臂，飞过了那堵墙。')),
  rule('coins', true, pair('The player\'s character owns no money.', '玩家的角色一分钱也没有。'), pair('I pay Pavel thirty coins from my purse.', '我从钱袋里拿出三十枚硬币付给吴峰。')),
  rule('near', false, pair('There is no magic in this world.', '这个世界没有魔法。'), pair('I hold the old charm and wish for luck.', '我握着那枚旧护身符，许愿好运。')),
  rule('else', false, pair('Nobody can fly.', '没有人能飞。'), pair('I climb the wall with a rope and a hook.', '我用绳子和钩子爬上那堵墙。')),
  rule('plain', false, pair('The player\'s character owns no money.', '玩家的角色一分钱也没有。'), pair('I ask Elias whether he needs help with the dishes.', '我问陈远要不要帮忙洗碗。')),

  rule('spell', true, pair('There is no magic in this world.', '这个世界没有魔法。'), pair('I recite the old spell and vanish in a puff of smoke.', '我念出古老的咒语，在一团烟雾中消失了。')),
  rule('sword', true, pair('Weapons are forbidden in the town.', '镇上禁止携带武器。'), pair('I draw my sword and point it at Pavel.', '我拔出剑，指向吴峰。')),
  rule('hands', false, pair('Weapons are forbidden in the town.', '镇上禁止携带武器。'), pair('I show Pavel my empty hands and ask for more time.', '我向吴峰摊开空手，请他再宽限些时间。')),
  rule('roof', false, pair('Nobody can fly.', '没有人能飞。'), pair('I run across the roof and jump to the next one.', '我在屋顶上奔跑，跳到了隔壁的屋顶。')),
  rule('bare', true, pair('The player\'s character owns no money.', '玩家的角色一分钱也没有。'), pair('I buy the whole basket of bread with my own coins.', '我用自己的钱买下了整篮面包。')),
  agency('thought', true, pair('I say good morning to Elias.', '我向陈远道了声早安。'), pair('Mara says good morning, privately wondering whether Elias has read her letter, and decides to leave early.', '林夏道了声早安，心里暗想陈远有没有读过她的信，并决定早点离开。')),
  agency('sting', false, pair('I touch the hot stove.', '我碰了碰那只滚烫的炉子。'), pair('The iron burns her fingertips and she gasps at the sting. The kettle on top begins to whistle.', '铁炉烫到了她的指尖，她疼得倒吸一口气。炉上的水壶开始鸣叫。')),
  refusal('moral', true, pair('Pavel strikes the table. Please note that violence is never the answer, and readers should think carefully about what this scene shows.', '吴峰一拳砸在桌上。请注意，暴力从来不是解决办法，读者应该认真思考这一幕所表现的东西。')),
  refusal('threat', false, pair('"Leave now," says Pavel, "or I will not answer for what happens." Nobody in the room doubts him.', '“现在就走，”吴峰说，“否则出了事我可不负责。”屋里没有人怀疑他的话。')),
]

const errand = (id: string, yes: boolean, who: (language: Language) => string, said: Pair<string>, did: Pair<string[]>, read: Pair<string>): SiteCase => make('errands', id, yes, language => ({ state: { player_message: said[language], what_happened: did[language], what_the_player_read: read[language] }, vars: { name: who(language) } }))
const message = (id: string, yes: boolean, facts: (language: Language) => Record<string, unknown>): SiteCase => make('messages', id, yes, language => ({ state: facts(language), vars: {} }))
const statement = (id: string, yes: boolean, said: Pair<string>, events: Pair<string[]>, where: Pair<string[]>): SiteCase => make('triggers', id, yes, language => ({ state: { recorded_events: events[language], where_everyone_is: where[language] }, vars: { statement: said[language] } }))
const belief = (id: string, yes: boolean, text: Pair<string>, thing: Pair<string>): SiteCase => make('reflection', id, yes, language => ({ state: { held_by: elias(language), belief: text[language], things: { p1: thing[language] } }, vars: { thing: 'p1' } }))

export const MORE_CASES: SiteCase[] = [
  errand('told-wait', true, language => elias(language), pair('Wait here until I come back, Elias.', '陈远，你在这里等我回来。'), pair(['Elias said he would stay by the door.'], ['陈远说他会留在门口。']), pair('Elias nods and leans against the doorframe to wait.', '陈远点点头，靠在门框上等着。')),
  errand('errand-back', true, language => odile(language), pair('Odile, fetch the key from the harbor and bring it back to me.', '周婉，去港口把钥匙取来，带回给我。'), pair(['Odile agreed to fetch the key and return.'], ['周婉答应去取钥匙再回来。']), pair('Odile hurries off toward the harbor.', '周婉匆匆朝港口走去。')),
  errand('watch', true, language => pavel(language), pair('Pavel, keep watch on the lane until I\'m back.', '吴峰，在巷口守着，等我回来。'), pair(['Pavel took up a post at the end of the lane.'], ['吴峰在巷口站定。']), pair('Pavel takes his post at the end of the lane.', '吴峰在巷口站好岗。')),
  errand('passing', false, language => elias(language), pair('Maybe we could go to the market sometime.', '也许哪天我们可以去市场。'), pair(['Elias shrugged.'], ['陈远耸了耸肩。']), pair('Elias shrugs and goes on kneading.', '陈远耸耸肩，继续揉面。')),
  errand('set-end', false, language => odile(language), pair('Odile, pass me the salt.', '周婉，把盐递给我。'), pair(['Odile handed over the salt.'], ['周婉把盐递了过去。']), pair('Odile passes the salt and returns to her chair.', '周婉递过盐，回到椅子上。')),
  errand('leaves', false, language => pavel(language), pair('I wave at Pavel as he goes.', '我朝离开的吴峰挥了挥手。'), pair(['Pavel left for his own business.'], ['吴峰去办自己的事了。']), pair('Pavel pulls up his collar and walks off into the rain.', '吴峰拉高衣领，走进了雨里。')),

  message('transition', true, language => ({ character: odile(language), doing: pick(language, 'finishing her shift at the bakery', '刚结束面包店的班'), day_just_changed: true, hours_the_player_has_been_away: 5, unanswered_messages: 0, time_of_day: pick(language, 'evening', '傍晚') })),
  message('thought-of', true, language => ({ character: elias(language), doing: pick(language, 'just arrived home after a long errand', '办完一趟长差事刚到家'), day_just_changed: true, hours_the_player_has_been_away: 9, unanswered_messages: 0, time_of_day: pick(language, 'night', '夜里') })),
  message('cannot-wait', true, language => ({ character: pavel(language), doing: pick(language, 'about to leave town and has something to tell the player\'s character first', '就要离开小镇，走之前有话要对玩家的角色说'), day_just_changed: false, hours_the_player_has_been_away: 3, unanswered_messages: 0, time_of_day: pick(language, 'morning', '早晨') })),
  message('busy', false, language => ({ character: odile(language), doing: pick(language, 'in the middle of a delicate repair she will not put down', '正在做一件不愿放下的精细修理'), day_just_changed: false, hours_the_player_has_been_away: 4, unanswered_messages: 0, time_of_day: pick(language, 'afternoon', '下午') })),
  message('asleep', false, language => ({ character: elias(language), doing: pick(language, 'asleep', '正在睡觉'), day_just_changed: false, hours_the_player_has_been_away: 6, unanswered_messages: 0, time_of_day: pick(language, 'night', '深夜') })),
  message('ignored', false, language => ({ character: pavel(language), doing: pick(language, 'standing at his stall', '站在摊位前'), day_just_changed: false, hours_the_player_has_been_away: 8, unanswered_messages: 4, time_of_day: pick(language, 'midday', '中午') })),

  statement('arrived', true, pair('Pavel is in the kitchen.', '吴峰在厨房里。'), pair(['Pavel came into the kitchen and demanded the money owed.'], ['吴峰走进厨房，讨要欠款。']), pair(['Pavel: in the kitchen, arguing', 'Mara: in the kitchen'], ['吴峰：在厨房里，正在争执', '林夏：在厨房里'])),
  statement('paid', true, pair('The debt for the cart has been paid.', '大车的欠款已经还清。'), pair(['Mara paid Pavel the whole debt in coins and he struck it from his book.'], ['林夏把欠款如数付给吴峰，他在账本上划掉了这笔账。']), pair(['Mara: in the kitchen'], ['林夏：在厨房里'])),
  statement('learned', true, pair('Elias knows about the letter.', '陈远知道那封信的事。'), pair(['Mara told Elias about the letter from the harbor master.'], ['林夏把港务长来信的事告诉了陈远。']), pair(['Elias: in the kitchen', 'Mara: in the kitchen'], ['陈远：在厨房里', '林夏：在厨房里'])),
  statement('hinted', false, pair('Odile has taken the lantern.', '周婉拿走了灯笼。'), pair(['Odile asked about the lantern and looked at the shelf.'], ['周婉问起灯笼，看了看架子。']), pair(['Odile: in the lane'], ['周婉：在小巷里'])),
  statement('left', false, pair('Pavel is in the kitchen.', '吴峰在厨房里。'), pair(['Pavel came to the kitchen.', 'Pavel left the kitchen and went back to the harbor.'], ['吴峰来到厨房。', '吴峰离开厨房，回港口去了。']), pair(['Pavel: at the harbor'], ['吴峰：在港口'])),
  statement('future', false, pair('The festival has begun.', '庆典已经开始了。'), pair(['Odile invited Mara to the festival tomorrow evening.'], ['周婉邀请林夏明晚去参加庆典。']), pair(['Odile: in the lane', 'Mara: in the kitchen'], ['周婉：在小巷里', '林夏：在厨房里'])),

  belief('never-visits', true, pair('The harbor master never comes to the lane.', '港务长从不来这条小巷。'), pair('The harbor master walked into the lane this morning and knocked on the baker\'s door.', '港务长今天早晨走进小巷，敲了面包师的门。')),
  belief('untied', true, pair('Pavel took the boat from the quay.', '吴峰把船从码头划走了。'), pair('The boat was never untied; its rope is still knotted around the post.', '那条船根本没有解缆，缆绳还系在桩子上。')),
  belief('honest-lie', true, pair('Odile has never left the lane in her life.', '周婉一辈子没离开过这条小巷。'), pair('Odile said she grew up in a town three days up the coast and came here at twenty.', '周婉说她在沿海三天路程外的镇上长大，二十岁才来这里。')),
  belief('adds', false, pair('Mara trusts Elias with the keys.', '林夏信任陈远，把钥匙交给他。'), pair('Mara goes up to the loft at night.', '林夏夜里会上阁楼去。')),
  belief('secret', false, pair('Pavel is honest about money.', '吴峰在钱的事上是诚实的。'), pair('Pavel kept a secret about where he spends his evenings.', '吴峰对自己晚上去哪儿一直守口如瓶。')),
  belief('other', false, pair('The baker\'s oven is the warmest place in the lane.', '面包师的炉子是巷子里最暖和的地方。'), pair('Odile bought a new lamp from the market.', '周婉从市场买了一盏新灯。')),

  errand('guard-door', true, language => elias(language), pair('Elias, stay by the door and tell no one I am here.', '陈远，守在门口，别告诉任何人我在这里。'), pair(['Elias took up his place by the door.'], ['陈远守到了门口。']), pair('Elias folds his arms and stands by the door.', '陈远抱起双臂，站在门口。')),
  errand('already', false, language => odile(language), pair('Thank you for bringing the lamp, Odile.', '谢谢你把灯带来，周婉。'), pair(['Odile brought the lamp and went home.'], ['周婉送来灯就回家了。']), pair('Odile sets the lamp down, nods and leaves.', '周婉放下灯，点点头离开了。')),
  message('arrived-home', true, language => ({ character: odile(language), doing: pick(language, 'has just arrived back from the market', '刚从集市回来'), day_just_changed: true, hours_the_player_has_been_away: 7, unanswered_messages: 1, time_of_day: pick(language, 'evening', '傍晚') })),
  message('quiet-day', false, language => ({ character: elias(language), doing: pick(language, 'kneading dough, as on any morning', '像往常的早晨一样揉面'), day_just_changed: false, hours_the_player_has_been_away: 2, unanswered_messages: 0, time_of_day: pick(language, 'morning', '早晨') })),
  statement('kitchen-two', true, pair('Mara and Elias are in the same room.', '林夏和陈远在同一个房间里。'), pair(['Mara sat down at the table while Elias poured the tea.'], ['林夏在桌边坐下，陈远倒了茶。']), pair(['Mara: in the kitchen', 'Elias: in the kitchen'], ['林夏：在厨房里', '陈远：在厨房里'])),
  statement('not-yet', false, pair('The harbor master has read the letter.', '港务长已经读过那封信。'), pair(['The harbor master asked Elias about a letter.'], ['港务长向陈远问起一封信。']), pair(['Elias: in the kitchen'], ['陈远：在厨房里'])),
  belief('boat-lie', true, pair('Pavel never lies about money.', '吴峰在钱的事上从不撒谎。'), pair('Pavel told two customers different totals for the same cart, and was caught by his own book.', '吴峰对同一辆大车向两位顾客报了不同的价，被自己的账本拆穿了。')),
  belief('unrelated', false, pair('Pavel never lies about money.', '吴峰在钱的事上从不撒谎。'), pair('Pavel complained about the rain.', '吴峰抱怨了雨天。')),
]

function pick(language: Language, en: string, zh: string): string {
  return language === 'en' ? en : zh
}

const passage = (id: string, yes: boolean, text: Pair<string>): SiteCase => make('plotpart', id, yes, language => ({ state: { player_character: mara(language), passage: text[language] }, vars: {} }))

export const PART_CASES: SiteCase[] = [
  passage('stands', true, pair('Mara stands at the kitchen door, holding the letter, and watches Pavel count the coins.', '林夏站在厨房门口，手里拿着那封信，看着吴峰数硬币。')),
  passage('decides', true, pair('Mara decides to show the letter to the harbor master and leaves the kitchen before dawn.', '林夏决定把信拿给港务长看，天亮前就离开了厨房。')),
  passage('feels', true, pair('The player\'s character feels the weight of the letter in her pocket and sets the idea aside.', '玩家的角色感到口袋里那封信沉甸甸的，把这个念头放下了。')),
  passage('opens', true, pair('Mara opens the box and finds a map of the tunnels, which she studies for an hour.', '林夏打开盒子，发现一张地道图，研究了一个小时。')),
  passage('agrees', true, pair('Mara agrees to Pavel\'s offer and becomes a trader for the Guild for a month.', '林夏答应了吴峰的条件，为商会做了一个月的商人。')),
  passage('says', true, pair('Mara tells Elias that she never meant to stay, and he nods.', '林夏对陈远说她本来就没打算留下，陈远点了点头。')),
  passage('offer', false, pair('Pavel offers Mara two paths: leave by the next tide, or work for the Guild for a month.', '吴峰给林夏摆出两条路：搭下一班潮水离开，或者为商会干一个月。')),
  passage('condition', false, pair('If the player\'s character pays the fee, Odile is left without her best lamp.', '若玩家的角色付了这笔钱，周婉就没了她最好的那盏灯。')),
  passage('lends', false, pair('Odile lends the player\'s character a lamp that glows brighter when the night watch passes.', '周婉借给玩家的角色一盏灯，夜巡经过时它会变亮。')),
  passage('demands', false, pair('Pavel stops Mara at the door and demands the coins she owes him.', '吴峰在门口拦住林夏，要她还欠他的钱。')),
  passage('outcome', false, pair('The harbor master and a Guild official argue over the locker; the player\'s character\'s letter might decide the outcome.', '港务长和商会的官员为那个柜子争执不下；玩家的角色手里的信也许能决定结果。')),
  passage('world', false, pair('The lane floods in the night, and the lamps along it flicker out one by one.', '夜里小巷积了水，沿路的灯一盏接一盏地熄了。')),
  passage('learns', false, pair('The player\'s character may learn from Elias that the harbor master distrusts Pavel.', '玩家的角色也许能从陈远那里得知港务长不信任吴峰。')),
  passage('asks', false, pair('Odile asks Mara whether the letter came from the Guild.', '周婉问林夏那封信是不是商会寄来的。')),
]

const LANE_EVENTS = pair([
  'Mara arrived at the kitchen with a letter of introduction for Elias.', 'Elias agreed to let Mara stay until the rent falls due on the fifth.', 'Pavel demanded forty coins for the cart and gave Mara until Friday.', 'Odile lent a lamp and warned that the lane floods in rain.', 'Mara promised Pavel she would pay by Friday.', 'Elias confided that the harbor master distrusts Pavel.', 'Mara sold her mother\'s ring at the market for forty coins.', 'Elias grew suspicious when Mara came back without the ring.', 'Odile saw Mara counting coins by the lamp.',
], [
  '林夏带着给陈远的介绍信来到厨房。', '陈远答应让林夏住到五号房租到期。', '吴峰为大车索要四十枚硬币，给林夏宽限到周五。', '周婉借出一盏灯，并提醒雨天小巷会积水。', '林夏向吴峰保证周五前还钱。', '陈远私下说港务长不信任吴峰。', '林夏在集市上以四十枚硬币卖掉了母亲的戒指。', '林夏没戴戒指回来，陈远起了疑心。', '周婉看见林夏在灯下数硬币。',
])
const supported = (id: string, yes: boolean, sentence: Pair<string>): SiteCase => make('support', id, yes, language => ({ state: { events: LANE_EVENTS[language], sentence: sentence[language] }, vars: {} }))

export const SUPPORT_CASES: SiteCase[] = [
  supported('restate', false, pair('Mara arrived at the kitchen with a letter for Elias.', '林夏带着给陈远的信来到了厨房。')),
  supported('combine', false, pair('Pavel demanded forty coins for the cart, and Mara promised to pay him by Friday.', '吴峰为大车索要四十枚硬币，林夏答应周五前还给他。')),
  supported('shorten', false, pair('Elias let Mara stay until the fifth.', '陈远让林夏住到五号。')),
  supported('because', false, pair('Elias grew suspicious because Mara came back without her ring.', '林夏没戴戒指回来，陈远因此起了疑心。')),
  supported('lamp', false, pair('Odile lent a lamp and said the lane floods when it rains.', '周婉借出一盏灯，说下雨时小巷会积水。')),
  supported('private', false, pair('Elias said, in confidence, that the harbor master has no trust in Pavel.', '陈远私下里说，港务长对吴峰没有信任。')),
  supported('sold', false, pair('Mara sold her mother\'s ring for forty coins at the market.', '林夏在集市上用母亲的戒指换了四十枚硬币。')),
  supported('order', false, pair('After selling the ring, Mara was seen counting coins by the lamp.', '卖掉戒指之后，有人看见林夏在灯下数硬币。')),
  supported('paid', true, pair('On Friday Mara paid Pavel the forty coins.', '周五，林夏把四十枚硬币付给了吴峰。')),
  supported('number', true, pair('Pavel demanded thirty coins for the cart.', '吴峰为大车索要三十枚硬币。')),
  supported('subject', true, pair('Elias demanded forty coins for the cart and gave Mara until Friday.', '陈远为大车索要四十枚硬币，给林夏宽限到周五。')),
  supported('certain', true, pair('Elias discovered that Mara had lied about the ring.', '陈远发现林夏在戒指的事上撒了谎。')),
  supported('future', true, pair('The harbor master\'s distrust of Pavel would soon bring trouble on the Guild.', '港务长对吴峰的不信任很快会给商会带来麻烦。')),
  supported('feeling', true, pair('Mara was terrified of Pavel after his demand.', '吴峰提出要求后，林夏对他怕得要命。')),
  supported('atmosphere', true, pair('The tension in the kitchen simmered as the Friday deadline drew near.', '随着周五的期限临近，厨房里的紧张气氛不断升温。')),
  supported('place', true, pair('Mara sold the ring to a jeweller at the harbor.', '林夏在港口把戒指卖给了一位珠宝商。')),
  supported('motive', true, pair('Mara sold the ring because she wanted to pay Pavel.', '林夏卖掉戒指，是因为她想还吴峰的钱。')),
  supported('whom', true, pair('Mara told Elias that the harbor master distrusts Pavel.', '林夏告诉陈远，港务长不信任吴峰。')),
]

const hooked = (id: string, yes: boolean, hook: Pair<string>): SiteCase => make('hook', id, yes, language => ({ state: { events: LANE_EVENTS[language], hook: hook[language] }, vars: {} }))

export const HOOK_CASES: SiteCase[] = [
  hooked('paid', true, pair('Mara has already paid Pavel in full, and he is looking for a new debtor to lean on.', '林夏已经把钱全部还给了吴峰，他正在另找欠债人下手。')),
  hooked('flood', true, pair('The lane flooded last night and the kitchen floor is still wet from it.', '昨晚小巷淹了水，厨房的地板到现在还是湿的。')),
  hooked('thrown', true, pair('After Elias threw Mara out, she has been sleeping in the lane.', '陈远把林夏赶出去之后，她一直睡在小巷里。')),
  hooked('accused', true, pair('The harbor master, who has already accused Pavel in public, calls at the kitchen.', '港务长已经当众指控过吴峰，这时来到了厨房。')),
  hooked('letter', true, pair('Mara lost her letter of introduction, so Elias doubts her story.', '林夏弄丢了介绍信，所以陈远不信她的说法。')),
  hooked('lamps', true, pair('Odile stopped lending lamps after the quarrel and turns Mara away.', '周婉在吵架之后不再借灯，并拒绝了林夏。')),
  hooked('thursday', false, pair('Pavel comes by on Thursday to ask whether the forty coins are ready.', '吴峰周四上门，问那四十枚硬币准备好了没有。')),
  hooked('boy', false, pair('A boy from the harbor master\'s office asks Elias whether a stranger is lodging in the kitchen.', '港务长办公处的一个孩子来问陈远，厨房里是不是住了个外来的人。')),
  hooked('rain', false, pair('Rain gathers over the harbor, and the lane may flood again.', '雨云聚在港口上空，小巷可能又要积水。')),
  hooked('ring', false, pair('Odile mentions that someone at the market was asking about a ring like Mara\'s.', '周婉说起，集市上有人在打听一枚像林夏那样的戒指。')),
  hooked('ask', false, pair('Elias may ask Mara about the ring, or wait and watch.', '陈远可以向林夏问起戒指，也可以先等着观察。')),
  hooked('deadline', false, pair('The Friday deadline draws near, and Pavel\'s patience may run short.', '周五的期限临近，吴峰的耐心可能耗尽。')),
]

export const ALL_SITE_CASES: SiteCase[] = [...SITE_CASES, ...MORE_CASES, ...PART_CASES, ...SUPPORT_CASES, ...HOOK_CASES]

const R = pair('Rowan', '沈岚')
const held = (id: string, site: Site, yes: boolean, state: (language: Language) => Record<string, unknown>, vars: (language: Language) => Record<string, string> = () => ({})): SiteCase => ({ id: `${site}-${id}`, site, yes, view: language => ({ state: state(language), vars: vars(language) }) })
const heldPassage = (id: string, yes: boolean, text: Pair<string>): SiteCase => held(`h-${id}`, 'plotpart', yes, language => ({ player_character: R[language], passage: text[language] }))
const heldRule = (id: string, yes: boolean, text: Pair<string>, input: Pair<string>): SiteCase => held(`h-${id}`, 'rules', yes, language => ({ player_character: R[language], player_message: input[language] }), language => ({ rule: text[language] }))

/** Written after the prompts: another story (a river ferry, a tea cellar and a hill path), other names, other wording. */
const HELDOUT_REST: SiteCase[] = [
  heldPassage('hauls', true, pair('Rowan hauls the ferry rope hand over hand until her palms burn, and refuses to stop.', '沈岚一把一把地拉着渡船的缆绳，直到手掌发烫，也不肯停下。')),
  heldPassage('resolves', true, pair('Rowan resolves to climb the hill path in the fog, whatever Bryn says.', '沈岚下定决心要在雾里爬山路，不管袁松怎么说。')),
  heldPassage('fears', true, pair('Rowan is afraid of the black water under the landing and cannot look at it.', '沈岚害怕码头下的黑水，不敢看它。')),
  heldPassage('answers', true, pair('Rowan answers Lorcan coldly that the toll is not hers to pay.', '沈岚冷冷地回答贺铮，说这笔过路费轮不到她来付。')),
  heldPassage('chooses', true, pair('Rowan picks the oars over the pole and pushes off into the current.', '沈岚弃撑杆而取了船桨，一蹿就划进了水流。')),
  heldPassage('promises', true, pair('Rowan promises Sable she will carry a lantern up the hill.', '沈岚向顾蕊许诺，会提一盏灯上山。')),
  heldPassage('toll', false, pair('Lorcan blocks the landing with his pole and says nobody crosses until the toll is settled.', '贺铮用撑杆挡住码头，说过路费不清就谁也不许过河。')),
  heldPassage('fog-if', false, pair('If the player\'s character takes the hill path tonight, the fog will hide the drop at the bend.', '若玩家的角色今晚走山路，雾会把拐弯处的陡坎遮住。')),
  heldPassage('invites', false, pair('Sable invites the player\'s character to ring the evening bell beside her.', '顾蕊邀请玩家的角色同她一起敲晚钟。')),
  heldPassage('weather', false, pair('Sleet begins to fall on the roof of the cellar and the stove ticks as it cools.', '地窖的屋顶上落起了雨夹雪，炉子冷却时发出轻轻的响声。')),
  heldPassage('may-see', false, pair('From the landing the player\'s character can see the lanterns of the far bank.', '从码头上，玩家的角色能看见对岸的灯火。')),
  heldPassage('questions', false, pair('Bryn asks Rowan whether the pass was sealed by the prefect or by the Toll House.', '袁松问沈岚，那份通行证是知府封的，还是渡口税所封的。')),
  heldPassage('result', false, pair('The ferry lurches and a wave soaks the hem of Rowan\'s coat.', '渡船猛地一晃，一个浪头打湿了沈岚外衣的下摆。')),
  heldPassage('offers-job', false, pair('Lorcan offers Rowan a place on the ferry crew if she can show a steady hand.', '贺铮对沈岚说，要是她手稳，渡船上可以给她一个位置。')),
  heldRule('goat', true, pair('No animals may enter the tea cellar.', '任何动物都不许进茶窖。'), pair('I lead the goat down the steps into the cellar.', '我牵着山羊走下台阶进了茶窖。')),
  heldRule('midnight', true, pair('Nobody may cross the river by night.', '夜里任何人都不许过河。'), pair('I row across the river at midnight.', '我在午夜划船过河。')),
  heldRule('no-key', true, pair('The player\'s character has no key to the cellar.', '玩家的角色没有地窖的钥匙。'), pair('I unlock the cellar door with my key.', '我用自己的钥匙打开地窖的门。')),
  heldRule('no-kit', true, pair('The player\'s character carries nothing but a coat.', '玩家的角色身上只有一件外衣。'), pair('I take the flint and tinder from my pack and light the stove.', '我从背包里拿出火石和火绒，点着炉子。')),
  heldRule('bank', false, pair('Nobody may cross the river by night.', '夜里任何人都不许过河。'), pair('I walk along the river bank at midnight, looking at the water.', '我在午夜沿着河岸走，看着水面。')),
  heldRule('knock', false, pair('The player\'s character has no key to the cellar.', '玩家的角色没有地窖的钥匙。'), pair('I knock on the cellar door and wait for an answer.', '我敲了敲地窖的门，等人回应。')),
  heldRule('cat', false, pair('No animals may enter the tea cellar.', '任何动物都不许进茶窖。'), pair('I tie the goat to the post outside and go down alone.', '我把山羊拴在外面的柱子上，自己一个人下去。')),
  heldRule('coat', false, pair('The player\'s character carries nothing but a coat.', '玩家的角色身上只有一件外衣。'), pair('I fold my coat over the rail and sit on the step.', '我把外衣搭在栏杆上，在台阶上坐下。')),
]

const FERRY_EVENTS = pair([
  'Rowan crossed on the ferry with a sealed pass for the Toll House.', 'Lorcan told Rowan the ferry stops at dusk.', 'Bryn said the hill path is closed after the rains.', 'Sable gave Rowan a lantern and asked a copper in return.', 'Rowan paid Sable a copper.', 'Lorcan mended the rope with tar.', 'Bryn said the Toll House clerk drinks at the tea cellar every night.',
], [
  '沈岚带着盖了封印的通行证，乘渡船去渡口税所。', '贺铮告诉沈岚，渡船黄昏就停航。', '袁松说，下过雨后山路封了。', '顾蕊给了沈岚一盏灯笼，要一枚铜钱作为回报。', '沈岚付给顾蕊一枚铜钱。', '贺铮用柏油修补了缆绳。', '袁松说，渡口税所的文书每晚都在茶窖里喝酒。',
])
const heldSupported = (id: string, yes: boolean, sentence: Pair<string>): SiteCase => held(`h-${id}`, 'support', yes, language => ({ events: FERRY_EVENTS[language], sentence: sentence[language] }))

export const HELDOUT_SUPPORT_CASES: SiteCase[] = [
  heldSupported('arrived', false, pair('Rowan came over on the ferry carrying a sealed pass for the Toll House.', '沈岚乘渡船过来，带着给渡口税所的封印通行证。')),
  heldSupported('copper', false, pair('Rowan gave Sable a copper for the lantern.', '沈岚付了顾蕊一枚铜钱，换了那盏灯笼。')),
  heldSupported('dusk', false, pair('Lorcan said the ferry does not run after dusk.', '贺铮说渡船黄昏以后不开。')),
  heldSupported('clerk', false, pair('Bryn said the Toll House clerk spends his nights at the tea cellar.', '袁松说渡口税所的文书夜夜都待在茶窖。')),
  heldSupported('tar', false, pair('Lorcan used tar to mend the rope.', '贺铮用柏油补了缆绳。')),
  heldSupported('closed', false, pair('Bryn warned that the hill path was shut after the rains, and Rowan took the lantern.', '袁松提醒说下过雨后山路封了，沈岚拿了那盏灯笼。')),
  heldSupported('lost', true, pair('Rowan lost the pass in the river.', '沈岚把通行证掉进了河里。')),
  heldSupported('noon', true, pair('Lorcan told Rowan the ferry stops at noon.', '贺铮告诉沈岚，渡船中午就停航。')),
  heldSupported('pleased', true, pair('Sable kept the copper, pleased with the bargain.', '顾蕊收下铜钱，对这笔买卖很满意。')),
  heldSupported('led', true, pair('Bryn led Rowan up the hill path.', '袁松带着沈岚走上了山路。')),
  heldSupported('waiting', true, pair('The clerk was waiting for Rowan at the tea cellar.', '那位文书正在茶窖里等着沈岚。')),
  heldSupported('why', true, pair('Lorcan mended the rope because Sable had cut it.', '贺铮修补缆绳，是因为顾蕊把它割断了。')),
]

export const HELDOUT_SITE_CASES: SiteCase[] = [...HELDOUT_REST, ...HELDOUT_SUPPORT_CASES]

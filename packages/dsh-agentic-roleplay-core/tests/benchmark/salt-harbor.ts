import type { Files, Language } from './language.ts'
import { pick } from './language.ts'

/** The id of the benchmark world in both languages: a story started from it can be told from the owner's own worlds. */
export const SALT_HARBOR_ID = { en: 'benchmark-salt-harbor-en', zh: 'benchmark-salt-harbor-zh' } as const

/**
 * An invented harbour town that uses every part of the world format once or more: a cast with sheets, voices, emotions, goals, relationships, knowledge, routines and
 * variables; places with features, ways of every state and a lock; things of every kind; organisations; background of both scopes; tracked values of every kind and
 * subject; triggers of the main condition types; dice, a plot, a calendar, rules, prompts and openings. The same structure in both languages: only the words differ.
 */
export function saltHarbor(language: Language): Files {
  const t = pick(language)
  const files: Files = new Map()
  const put = (path: string, value: unknown): void => { files.set(path, value) }

  put('world.json', {
    id: SALT_HARBOR_ID[language],
    name: t('Salt Harbor', '盐湾港'),
    description: t('A fogbound fishing port where the lighthouse has gone dark and its keeper has not been seen for nine days. The harbor guild says he left; the night watch says nothing.', '一座被浓雾笼罩的渔港，灯塔熄灭了，守塔人已九天没有露面。渔港公会说他自己走了，夜巡队则只字不提。'),
    starting_time: '1887-10-03T18:30',
    time_zone: 'UTC',
    author: { name: 'Benchmark', url: 'https://example.test/benchmark' },
    metadata: { tags: t(['mystery', 'harbor', 'fog', '1880s'], ['悬疑', '港口', '浓雾', '十九世纪']) },
    rules: t(['There is no magic: nothing happens that could not happen in 1887.', 'Nobody in the town carries a firearm.'], ['这里没有魔法：发生的一切都符合 1887 年的常理。', '镇上没有人携带枪支。']),
    variables: { storm_warning: false },
    tools: { gameMaster: { roll_dice: true } },
    opening_message: [
      { type: 'narration', text: t('The evening ferry noses into the pier through a wall of fog. The lighthouse above the town should be turning by now; it is not.', '傍晚的渡船在雾墙中缓缓靠上码头。镇子上方的灯塔此时本该转动，却一片漆黑。') },
      { type: 'utterance', character: 'tomas', text: t('You are the keeper\'s girl, aren\'t you? Come in out of the fog before the bell rings.', '你是守塔人的女儿吧？趁钟声响起之前，快进屋避避雾。') },
    ],
    alternate_openings: [{ title: t('A reporter at the inn', '客栈里的记者'), text: t('You have been at the Anchor & Lamp for two days, and the landlord still will not talk about the lighthouse.', '你在锚与灯客栈已住了两天，老板仍然不肯谈起灯塔。'), character: 'quill' }],
  })

  put('calendar.json', { hemisphere: 'north', holidays: [{ id: 'fog-festival', name: t('Fog Festival', '雾节'), on: ['10-03'] }] })

  // ---- the cast
  put('characters/mara/character.json', {
    id: 'mara', name: t('Mara Venn', '玛拉·文'), aliases: t(['the keeper\'s girl'], ['守塔人的女儿']), age: 27, gender: 'female', pronouns: 'she/her', role: 'playable', kind: 'person', tier: 'principal', voice: 'mara',
    summary: t('The lighthouse keeper\'s daughter, back after nine years away.', '守塔人的女儿，离开九年后第一次回来。'),
    personality: t('Dry and watchful, quick to anger when she feels handled, slow to ask for help. She counts things when she is nervous.', '冷静而警觉，一觉得被人摆布就容易发火，却很少开口求助。紧张时会不停地数东西。'),
    background: t('Left Salt Harbor at eighteen after a quarrel with her father about the guild. She trained as a surveyor in the capital and has not answered his letters since.', '十八岁时因与父亲争吵公会的事离开盐湾港，在省城学了测绘，此后再没回过父亲的信。'),
    appearance: t('Tall, wind-reddened hands, a surveyor\'s oilskin coat two sizes too big.', '身材高挑，双手被海风吹得发红，穿着一件大了两号的测绘员油布外套。'),
    speech: { style: t('Short, precise sentences; asks questions instead of making statements.', '句子简短、准确；更爱发问，而不是下断语。'), examples: t(['Who lit the lamp last? Not what, who.', 'I counted nine steps to the door. There should be ten.'], ['最后一次点灯的是谁？我问的是谁，不是什么。', '我数到门口是九级台阶，应该是十级才对。']) },
    visual_identity: { description: t('A tall woman of about twenty-seven with short dark hair and grey eyes, wearing an oversized oilskin coat.', '一位二十七岁上下的高个女子，短黑发，灰色眼睛，穿着宽大的油布外套。'), tags: t(['short dark hair', 'grey eyes'], ['黑色短发', '灰色眼睛']), negative_tags: t(['blonde hair'], ['金发']) },
    start: {
      public_state: t('Just off the ferry, soaked by the fog, looking up at the dark lighthouse.', '刚下渡船，被雾打得湿透，正抬头望着黑漆漆的灯塔。'),
      activity: t('Standing on the pier with a single bag.', '提着一只包站在码头上。'),
      inner_state: t('Afraid that her father\'s silence is her fault.', '担心父亲的沉默是自己造成的。'),
      emotion: { baseline: { valence: -0.2, arousal: 0.4, dominance: 0.1 } },
      intents: [
        { type: 'quest', name: t('Find out what happened to her father', '查清父亲出了什么事'), description: t('Learn why the lamp went dark and where Bram is.', '弄清灯为何熄灭，布拉姆又在哪里。'), status: 'active', horizon: 'short', priority: 0.9, urgency: 0.7, plan: t(['Ask the innkeeper', 'Look at the lighthouse'], ['问客栈老板', '去看看灯塔']), deadline: '1887-10-06T00:00' },
        { type: 'agenda', name: t('Stay out of the guild\'s way', '避开公会'), description: t('Do not let the harbor master learn who she is before she is ready.', '在自己准备好之前，不让港务长知道她的身份。'), status: 'active', horizon: 'short', priority: 0.4, urgency: 0.3, plan: [] },
      ],
      location: 'pier', position: t('at the foot of the ferry steps', '渡船台阶脚下'),
    },
    relationships: [
      { to: 'bram', label: t('father', '父亲'), summary: t('Stern, loving, and unforgiven.', '严厉、疼爱，却至今没有原谅。'), familiarity: 1, trust: 0.3, affinity: 0.5, tension: 0.6 },
      { to: 'tomas', label: t('old family friend', '家里的老朋友'), summary: t('He taught her to play cards when she was ten.', '她十岁时他教过她打牌。'), familiarity: 0.7, trust: 0.4, affinity: 0.4, tension: 0.1 },
      { to: 'kit', label: t('the boy next door, grown up', '隔壁的男孩，长大了'), familiarity: 0.4, trust: 0.2, affinity: 0.2 },
      { to: 'ines', label: t('the harbor master', '港务长'), summary: t('Cold to her father, and cold to her.', '对父亲冷淡，对她也冷淡。'), familiarity: 0.3, trust: -0.1, affinity: -0.1, tension: 0.3 },
    ],
    knowledge: { locations: ['pier', 'inn-bar', 'market', 'lighthouse'], items: ['tide-table'], exits: [{ from: 'pier', to: 'market' }], lore: ['lighthouse-history', 'keeper-oath'] },
    variables: { fatigue: 3 },
  })
  put('characters/quill/character.json', {
    id: 'quill', name: t('Quill Marsh', '奎尔·马什'), age: 34, gender: 'male', pronouns: 'he/him', role: 'playable', kind: 'person', tier: 'principal',
    summary: t('A newspaper reporter chasing the story of the dark lighthouse.', '为追灯塔熄灭的新闻而来的报社记者。'),
    personality: t('Charming, nosy and stubborn; he forgives himself quickly and others slowly.', '讨喜、好奇又固执；原谅自己很快，原谅别人很慢。'),
    background: t('Covers shipping for a city paper and has been warned off the harbor guild twice.', '在城里报社跑航运新闻，已被渔港公会警告过两次。'),
    appearance: t('Rumpled tweed, ink on his cuffs, a notebook that never closes.', '皱巴巴的粗呢外套，袖口沾着墨水，笔记本从不合上。'),
    speech: { style: t('Easy and wry; turns every answer into another question.', '轻松而诙谐；每个回答都会变成新的提问。'), examples: t(['Off the record, naturally. Everything is, until it is not.', 'You say nothing happened. That is very specific.'], ['当然是不记名的。一切都是，直到不再是。', '你说什么也没发生。这说法可太具体了。']) },
    start: { public_state: t('At a corner table with a notebook.', '坐在角落的桌边，面前摊着笔记本。'), activity: t('Watching the door.', '盯着门口。'), inner_state: t('Sure that the landlord is lying about the lamp.', '确信老板在灯的事上撒了谎。'), emotion: { baseline: { valence: 0.2, arousal: 0.5, dominance: 0.3 } }, intents: [{ type: 'quest', name: t('Get the story', '拿到新闻'), description: t('Find who had a reason to put the lamp out.', '查出谁有理由熄灭那盏灯。'), status: 'active', horizon: 'short', priority: 0.8, urgency: 0.5, plan: [] }], location: 'inn-bar', position: t('at the corner table', '角落的桌边') },
    relationships: [{ to: 'tomas', label: t('landlord', '房东'), familiarity: 0.3, trust: -0.2, affinity: 0.1, tension: 0.3 }],
    knowledge: { locations: ['inn-bar', 'inn-room', 'market'], items: [], exits: [], lore: ['harbor-founding'] },
    variables: { fatigue: 1 },
  })
  put('characters/tomas/character.json', {
    id: 'tomas', name: t('Tomas Reyes', '托马斯·雷耶斯'), age: 58, gender: 'male', pronouns: 'he/him', role: 'npc', kind: 'person', tier: 'principal',
    summary: t('Landlord of the Anchor & Lamp, who hears everything and repeats little.', '锚与灯客栈的老板，什么都听，却很少转述。'),
    personality: t('Genial on the surface, careful underneath. He keeps every promise he makes and makes as few as he can.', '表面和气，内里谨慎。承诺过的事一定做到，所以尽量少许诺。'),
    background: t('Served as the keeper\'s mate for twenty years before buying the inn with a legacy. He owes the guild money.', '做了二十年守塔人的助手后，用一笔遗产买下客栈。他欠着公会的钱。'),
    appearance: t('Broad, grey-whiskered, always wiping something.', '体格宽厚，胡须花白，手里总在擦着什么。'),
    speech: { style: t('Warm, rambling, with sailors\' sayings that trail off when a subject gets close.', '热络、絮叨，带着水手的俗话；话题一靠近要害就戛然而止。'), examples: t(['Fog\'s thick tonight, and thick heads go with it.', 'Ah, now. That is a question for daylight.'], ['今晚雾厚，脑袋也跟着糊涂。', '哎，这个嘛，是白天才该问的事。']) },
    start: { public_state: t('Pouring for the evening crowd.', '正在给晚间的客人倒酒。'), activity: t('Tending the bar.', '照看吧台。'), inner_state: t('Sick with worry about Bram, and about what he agreed to hide.', '为布拉姆忧心如焚，也为自己答应隐瞒的事不安。'), emotion: { baseline: { valence: 0, arousal: 0.3, dominance: 0.4 } }, intents: [{ type: 'agenda', name: t('Keep the inn out of the guild\'s quarrel', '让客栈置身于公会的纷争之外'), status: 'active', horizon: 'short', priority: 0.6, urgency: 0.4, plan: [] }], location: 'inn-bar', position: t('behind the bar', '吧台后面') },
    relationships: [
      { to: 'mara', label: t('the keeper\'s girl', '守塔人的女儿'), summary: t('Fond of her, and afraid of what she will find.', '很疼她，也怕她查出什么。'), familiarity: 0.7, trust: 0.4, affinity: 0.6, tension: 0.4 },
      { to: 'bram', label: t('old shipmate', '老同伴'), familiarity: 0.9, trust: 0.7, affinity: 0.7 },
      { to: 'ines', label: t('creditor', '债主'), familiarity: 0.8, trust: -0.3, affinity: -0.1, tension: 0.6 },
      { to: 'quill', label: t('lodger', '房客'), summary: t('Asks too many questions.', '问得太多。'), familiarity: 0.3, trust: -0.2, affinity: 0, tension: 0.3 },
    ],
    knowledge: { locations: ['inn-bar', 'inn-room', 'market', 'pier', 'lighthouse', 'lighthouse-cellar'], items: ['ledger'], exits: [{ from: 'lighthouse', to: 'lighthouse-cellar' }], lore: ['lighthouse-history', 'cellar-secret', 'keeper-oath'] },
    routine: [
      { from: '07:00', to: '11:00', activity: t('airing the rooms and cooking breakfast', '开窗通风，准备早饭'), location: 'inn-bar', on: ['!holiday:fog-festival'] },
      { from: '11:00', to: '17:00', activity: t('buying fish at the market', '去集市买鱼'), location: 'market', on: ['!holiday:fog-festival'] },
      { from: '17:00', to: '01:00', activity: t('tending the bar', '照看吧台'), location: 'inn-bar', position: t('behind the bar', '吧台后面') },
      { from: '01:00', to: '07:00', activity: t('asleep', '睡觉'), location: 'inn-room' },
    ],
    variables: { fatigue: 4, suspicion: 2 },
  })
  put('characters/ines/character.json', {
    id: 'ines', name: t('Ines Calder', '伊内斯·卡尔德'), age: 46, gender: 'female', pronouns: 'she/her', role: 'npc', kind: 'person', tier: 'principal',
    summary: t('Harbor master and head of the guild.', '港务长，兼任渔港公会会长。'),
    personality: t('Orderly, courteous and immovable. She believes the harbor survives because someone decides things.', '井井有条、彬彬有礼，也寸步不让。她认为渔港能存续，是因为总得有人拍板。'),
    background: t('Rose from a ledger clerk. She signed the order closing the lighthouse road "for repairs".', '从账房小职员做起。她签发了以“检修”为由封闭灯塔路的命令。'),
    appearance: t('Upright, grey coat buttoned to the chin, a ring of keys at her belt.', '身板笔直，灰外套扣到下巴，腰间挂着一串钥匙。'),
    speech: { style: t('Measured and formal; never raises her voice, never repeats herself.', '从容而正式；从不提高嗓门，也从不重复。'), examples: t(['That will be entered in the record.', 'I do not guess, Miss Venn. I decide.'], ['这件事会记入档案。', '我不猜测，文小姐。我做决定。']) },
    start: { public_state: t('Reviewing the day\'s tide figures.', '正在核对当天的潮汐数据。'), activity: t('Working at her desk.', '在案前办公。'), inner_state: t('Certain she is protecting the town, and uneasy that she cannot say from what.', '确信自己在保护全镇，却不安于说不清究竟在防什么。'), emotion: { baseline: { valence: 0.1, arousal: 0.2, dominance: 0.7 } }, intents: [{ type: 'agenda', name: t('Close the matter of the lamp quietly', '悄悄了结灯的事'), status: 'active', horizon: 'day', priority: 0.8, urgency: 0.6, plan: t(['Keep the road closed', 'Keep Reyes in debt'], ['保持灯塔路封闭', '让雷耶斯继续欠债']) }], location: 'harbor-office', position: t('at the high desk', '高桌前') },
    relationships: [{ to: 'tomas', label: t('debtor', '债务人'), familiarity: 0.8, trust: -0.1, affinity: 0, tension: 0.5 }, { to: 'mara', label: t('the keeper\'s daughter', '守塔人的女儿'), familiarity: 0.2, trust: 0, affinity: 0, tension: 0.3 }],
    knowledge: { locations: ['harbor-office', 'market', 'pier', 'lighthouse', 'inn-bar'], items: ['harbor-key', 'tide-table'], exits: [], lore: ['guild-charter', 'harbor-founding', 'lighthouse-history'] },
    routine: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], from: '08:00', to: '17:00', activity: t('keeping the harbor office', '在港务所办公'), location: 'harbor-office', position: t('at the high desk', '高桌前') },
      { from: '17:00', to: '19:00', activity: t('walking the pier', '巡看码头'), location: 'pier', interruptible: true },
      { from: '19:00', to: '08:00', activity: t('at home', '在家'), location: 'harbor-office' },
    ],
    variables: { suspicion: 3 },
  })
  put('characters/bram/character.json', {
    id: 'bram', name: t('Old Bram', '老布拉姆'), aliases: t(['Bram Venn', 'the keeper'], ['布拉姆·文', '守塔人']), age: 63, gender: 'male', pronouns: 'he/him', role: 'npc', kind: 'person', tier: 'supporting',
    summary: t('The lighthouse keeper, missing for nine days.', '守塔人，已失踪九天。'),
    personality: t('Silent by habit, exact by training, tender in ways he hides.', '习惯沉默，训练使然的一丝不苟，温柔却总藏着不露。'),
    background: t('Kept the lamp for thirty-one years and swore the keeper\'s oath never to let it go dark.', '守灯三十一年，立过“绝不让灯熄灭”的守塔誓言。'),
    appearance: t('Lean and weathered, white beard, a missing finger on his left hand.', '清瘦、饱经风霜，白胡子，左手少一根手指。'),
    speech: { style: t('Few words, spoken slowly; nautical terms for everything.', '话少而慢，什么都用航海术语来说。'), examples: t(['Steady as she goes.', 'The lamp does not care who is sorry.'], ['稳住舵。', '灯不在乎谁在懊悔。']) },
    start: { public_state: t('Not seen.', '无人见到。'), activity: t('Waiting in the dark.', '在黑暗里等待。'), inner_state: t('Guarding what he hid in the cellar and listening for footsteps.', '守着藏在地窖的东西，留神听着脚步声。'), emotion: { baseline: { valence: -0.3, arousal: 0.2, dominance: 0.2 } }, intents: [{ type: 'agenda', name: t('Keep the cellar secret', '守住地窖的秘密'), status: 'active', horizon: 'long', priority: 0.9, urgency: 0.5, plan: [] }], location: 'lighthouse-cellar', position: t('on an upturned crate', '坐在一只倒扣的木箱上') },
    relationships: [{ to: 'mara', label: t('daughter', '女儿'), familiarity: 1, trust: 0.4, affinity: 0.7, tension: 0.5 }, { to: 'kit', label: t('errand boy', '跑腿的孩子'), familiarity: 0.8, trust: 0.7, affinity: 0.6 }, { to: 'tomas', label: t('old shipmate', '老同伴'), familiarity: 0.9, trust: 0.6, affinity: 0.6 }],
    knowledge: { locations: ['lighthouse', 'lighthouse-cellar', 'signal-room', 'pier'], items: ['lighthouse-key', 'signal-lamp'], exits: [], lore: ['cellar-secret', 'keeper-oath', 'lighthouse-history', 'smugglers-signal'] },
  })
  put('characters/kit/character.json', {
    id: 'kit', name: t('Kit Alder', '基特·奥尔德'), age: 16, gender: 'male', pronouns: 'he/him', role: 'npc', kind: 'person', tier: 'supporting',
    summary: t('A dock boy who sees more than he is asked about.', '码头上的少年，看到的比被问到的多。'),
    personality: t('Cheerful, easily bribed with food, loyal to whoever was kind to him first.', '开朗，一点吃的就能收买，谁先对他好，他就忠于谁。'),
    background: t('An orphan raised among the moorings. He ran messages for Bram until the lamp went out.', '在系缆桩之间长大的孤儿，灯灭之前一直给布拉姆跑腿送信。'),
    appearance: t('Thin, sunburnt, barefoot, with a gull feather in his cap.', '瘦削、晒得黝黑、光着脚，帽子上插着一根海鸥羽毛。'),
    speech: { style: t('Quick and slangy; answers with a question when frightened.', '语速快、带俚语；害怕时就用提问来回答。'), examples: t(['Maybe I saw something. Maybe I am hungry.', 'Not me. Never. Who says?'], ['也许我看见了什么。也许我只是饿了。', '不是我。绝对不是。谁说的？']) },
    start: { public_state: t('Coiling rope on the pier.', '在码头上盘缆绳。'), activity: t('Coiling rope.', '盘缆绳。'), inner_state: t('Knows who goes up the lighthouse road at night and is scared to say.', '知道夜里谁走灯塔路，却不敢说。'), emotion: { baseline: { valence: 0.3, arousal: 0.6, dominance: -0.3 } }, intents: [], location: 'pier', position: t('on a coil of rope', '坐在一卷缆绳上') },
    relationships: [{ to: 'bram', label: t('master', '师傅'), familiarity: 0.8, trust: 0.9, affinity: 0.8 }, { to: 'mara', label: t('the keeper\'s girl', '守塔人的女儿'), familiarity: 0.4, trust: 0.3, affinity: 0.3 }],
    knowledge: { locations: ['pier', 'market', 'lighthouse'], items: [], exits: [], lore: ['smugglers-signal'] },
  })
  put('characters/night-watch/character.json', { id: 'night-watch', name: t('The Night Watch', '夜巡队'), role: 'npc', kind: 'group', tier: 'supporting', summary: t('Four men with lanterns who walk the harbor after dark and answer to the guild.', '四个提灯的人，天黑后巡行渔港，听命于公会。'), start: { public_state: t('Gathering at the market for the night round.', '正在集市集合，准备夜巡。'), activity: t('Gathering.', '集合。'), location: 'market' } })
  put('characters/gull-seller/character.json', { id: 'gull-seller', name: t('The fish-seller', '卖鱼的妇人'), role: 'npc', kind: 'person', tier: 'background', summary: t('A stallholder who shouts the price of herring.', '摊位上吆喝鲱鱼价钱的妇人。'), start: { public_state: t('Calling out prices.', '正在吆喝价钱。'), activity: t('Selling herring.', '卖鲱鱼。'), location: 'market' } })

  // ---- places
  put('locations/harbor/location.json', { id: 'harbor', name: t('Salt Harbor', '盐湾港'), description: t('The whole town and its water: pier, market, inn and the cliff road to the lighthouse.', '整座镇子和它的水面：码头、集市、客栈，以及通往灯塔的悬崖路。') })
  put('locations/pier/location.json', { id: 'pier', name: t('The Pier', '码头'), description: t('A long wooden pier slick with fog. Mooring stones run along its edge, and the ferry steps are at the near end.', '一条被雾打湿的长木码头，边缘排着系缆石，渡船台阶在近端。'), parent: 'harbor', features: [{ id: 'mooring-stones', name: t('Mooring stones', '系缆石'), description: t('Eleven stones worn smooth by rope. The third is loose.', '十一块被缆绳磨得光滑的石头，第三块是松的。') }, { id: 'ferry-steps', name: t('Ferry steps', '渡船台阶'), description: t('Nine wet steps down to the water.', '通向水面的九级湿台阶。') }], exits: [{ to: 'market', description: t('the lane up to the market', '通往集市的小巷'), travel_time_seconds: 90 }, { to: 'lighthouse', description: t('the cliff road, behind an iron gate', '悬崖路，被一道铁门挡着'), state: 'locked', opened_by: ['lighthouse-key'], travel_time_seconds: 600, note: t('Closed "for repairs" by order of the harbor master.', '港务长下令“检修”封闭。') }] })
  put('locations/market/location.json', { id: 'market', name: t('The Market', '集市'), description: t('A cobbled square of fish stalls under oilcloth awnings, loud even in the fog.', '鹅卵石铺的广场，油布篷下排着鱼摊，即便大雾天也很喧闹。'), parent: 'harbor', features: [{ id: 'notice-board', name: t('Notice board', '告示板'), description: t('Guild notices, among them the order closing the lighthouse road.', '公会的告示，其中有封闭灯塔路的命令。') }], exits: [{ to: 'inn-bar', description: t('the inn door', '客栈的门'), travel_time_seconds: 45 }, { to: 'harbor-office', description: t('the harbor office stair', '港务所的楼梯'), travel_time_seconds: 60 }], variables: { crowd: 6 } })
  put('locations/inn-bar/location.json', { id: 'inn-bar', name: t('The Anchor & Lamp, bar', '锚与灯客栈·酒吧'), description: t('A low-beamed bar that smells of tar and wet wool, with a fire at one end and a ledger on the counter.', '低矮横梁的酒吧，满是焦油和湿羊毛的味道，一头生着炉火，吧台上摊着账簿。'), parent: 'harbor', features: [{ id: 'counter', name: t('The counter', '吧台'), description: t('Scarred oak with a brass bell.', '带疤的橡木台面，上面有一只黄铜铃。') }, { id: 'fireplace', name: t('Fireplace', '壁炉'), description: t('A banked fire with a bench either side.', '压着火的壁炉，两边各有一条长凳。') }], exits: [{ to: 'inn-room', description: t('the stair to the rooms', '通往客房的楼梯'), travel_time_seconds: 30 }] })
  put('locations/inn-room/location.json', { id: 'inn-room', name: t('Room 3', '三号客房'), description: t('A narrow room over the bar with a view of the pier and a washstand.', '吧台楼上的一间窄房，窗外是码头，屋里有个洗脸架。'), parent: 'harbor', features: [{ id: 'window', name: t('The window', '窗子'), description: t('It looks across the fog toward the dark lighthouse.', '隔着雾，正对着黑漆漆的灯塔。') }] })
  put('locations/harbor-office/location.json', { id: 'harbor-office', name: t('The Harbor Office', '港务所'), description: t('A panelled upper room where the guild keeps its tide tables, charts and a locked strongbox.', '镶木板的楼上房间，公会在此存放潮汐表、海图和一只上锁的保险箱。'), parent: 'harbor', features: [{ id: 'high-desk', name: t('The high desk', '高桌'), description: t('A standing desk with the day\'s figures.', '一张站立式高桌，摊着当天的数据。') }] })
  put('locations/lighthouse/location.json', { id: 'lighthouse', name: t('The Lighthouse', '灯塔'), description: t('A stone tower on the headland. The great lamp is dark and the door stands unlatched.', '岬角上的石塔。大灯熄灭了，门虚掩着。'), parent: 'harbor', features: [{ id: 'spiral-stair', name: t('Spiral stair', '螺旋梯'), description: t('Ninety-one iron steps up to the signal room.', '九十一级铁梯通向信号室。') }], exits: [{ to: 'signal-room', description: t('the spiral stair', '螺旋梯'), travel_time_seconds: 120 }, { to: 'lighthouse-cellar', description: t('a trapdoor behind the stair, under rubble', '梯后的活板门，被碎石压着'), state: 'blocked', note: t('Rubble lies on the trapdoor.', '活板门上压着碎石。'), travel_time_seconds: 60 }] })
  put('locations/signal-room/location.json', { id: 'signal-room', name: t('The Signal Room', '信号室'), description: t('A glass room under the lamp, cold and smelling of lamp oil. A signal lamp stands by the window.', '灯下的玻璃房间，又冷又带着灯油味，窗边立着一盏信号灯。'), parent: 'harbor', features: [{ id: 'lamp-housing', name: t('The great lamp', '大灯'), description: t('The lens is clean; the wick has been taken out.', '透镜很干净，灯芯被人取走了。') }], exits: [{ to: 'pier', description: t('a rope down the cliff', '沿悬崖垂下的一根绳子'), one_way: true, travel_time_seconds: 300 }] })
  put('locations/lighthouse-cellar/location.json', { id: 'lighthouse-cellar', name: t('The Lighthouse Cellar', '灯塔地窖'), description: t('A dry stone cellar full of crates, with a camp bed and a lantern.', '干燥的石砌地窖，堆满木箱，里头有一张行军床和一盏提灯。'), parent: 'harbor', features: [{ id: 'crates', name: t('Crates', '木箱'), description: t('Stamped with the guild\'s mark.', '印着公会的标记。') }] })

  // ---- things
  put('items/slots.json', [{ id: 'satchel', name: t('Satchel', '挎包'), capacity: 2 }])
  put('items/lighthouse-key/item.json', { id: 'lighthouse-key', name: t('Lighthouse key', '灯塔钥匙'), description: t('A heavy iron key with a salt-white bow.', '一把沉重的铁钥匙，柄环上结着白盐。'), unique: true, hidden: true, notable: true, location: 'pier', feature: 'mooring-stones', position: t('under the third stone', '第三块石头下') })
  put('items/harbor-key/item.json', { id: 'harbor-key', name: t('Strongbox key', '保险箱钥匙'), description: t('A small steel key on a ring.', '环上挂着的一把小钢钥匙。'), unique: true, held_by: 'ines' })
  put('items/strongbox/item.json', { id: 'strongbox', name: t('Guild strongbox', '公会保险箱'), description: t('An iron box bolted to the floor of the harbor office.', '钉在港务所地板上的铁箱。'), container: { state: 'locked', opened_by: ['harbor-key'] }, notable: true, location: 'harbor-office' })
  put('items/tide-table/item.json', { id: 'tide-table', name: t('Tide table', '潮汐表'), description: t('A printed table of tides for the year, with a margin note in pencil.', '全年潮汐的印刷表，页边有一行铅笔批注。'), location: 'harbor-office', feature: 'high-desk' })
  put('items/ledger/item.json', { id: 'ledger', name: t('Room ledger', '客房账簿'), description: t('The inn\'s book of guests, dates and payments.', '客栈记录住客、日期和付款的账簿。'), location: 'inn-bar', feature: 'counter', owner: 'tomas' })
  put('items/oilskin-coat/item.json', { id: 'oilskin-coat', name: t('Oilskin coat', '油布外套'), description: t('A surveyor\'s coat, stiff with wax.', '测绘员的外套，打过蜡，硬挺挺的。'), worn_by: 'mara', wearable: 'torso' })
  put('items/lantern/item.json', { id: 'lantern', name: t('Hand lantern', '手提灯'), description: t('A tin lantern with a horn window.', '锡皮提灯，带角质窗。'), held_by: 'mara', quality: t('worn but sound', '陈旧但完好'), variables: { lamp_oil: 80 } })
  put('items/coins/item.json', { id: 'coins', name: t('Coins', '硬币'), description: t('Small silver coins.', '一些小银币。'), quantity: 12, held_by: 'quill' })
  put('items/notebook/item.json', { id: 'notebook', name: t('Reporter\'s notebook', '记者笔记本'), description: t('Shorthand notes on three pages about the lighthouse.', '有三页用速记写下的灯塔笔记。'), worn_by: 'quill', wearable: 'satchel' })
  put('items/signal-lamp/item.json', { id: 'signal-lamp', name: t('Signal lamp', '信号灯'), description: t('A shuttered lamp for flashing signals out to sea.', '带遮光板的灯，用来向海上打信号。'), location: 'signal-room', feature: 'lamp-housing', variables: { lamp_oil: 40 } })

  // ---- organisations
  put('factions/harbor-guild/faction.json', { id: 'harbor-guild', name: t('The Harbor Guild', '渔港公会'), summary: t('The body that controls moorings, fish prices and the harbor office.', '掌管泊位、鱼价和港务所的组织。'), description: t('Chartered a century ago to keep the harbor orderly; in practice it decides who may fish and who may not.', '百年前为维持渔港秩序而设，实际上决定谁能出海捕鱼、谁不能。'), values: t(['order', 'profit'], ['秩序', '利益']), structure: t('A master and a council of four.', '一名会长与四人议事会。'), start: { public_state: t('Meeting daily about the closed road.', '每天开会商议封路的事。'), inner_state: t('Divided over what the keeper knew.', '对守塔人到底知道什么，内部有分歧。'), goals: [{ name: t('Keep the lighthouse road closed', '保持灯塔路封闭'), status: 'active', horizon: 'short', priority: 0.8, urgency: 0.6, plan: [] }] }, members: [{ character: 'ines', role: t('master', '会长'), rank: t('first', '首席'), status: 'active', public: true, commitment: 0.9 }, { character: 'tomas', role: t('informer', '线人'), rank: '', status: 'active', public: false, commitment: 0.3 }], relationships: [{ to: { kind: 'faction', id: 'lamp-keepers' }, label: t('rival', '对手'), familiarity: 0.7, trust: -0.2, affinity: -0.2, tension: 0.7 }, { to: { kind: 'character', id: 'bram' }, label: t('problem', '麻烦'), familiarity: 0.6, trust: -0.4, affinity: -0.3, tension: 0.8 }] })
  put('factions/lamp-keepers/faction.json', { id: 'lamp-keepers', name: t('The Order of Lamp-Keepers', '守灯人会'), summary: t('The old brotherhood of lighthouse keepers along the coast.', '沿海灯塔守护人的古老兄弟会。'), description: t('Its oath binds a keeper never to let a lamp go dark.', '会规要求守塔人绝不让灯熄灭。'), values: t(['duty', 'silence'], ['职责', '缄默']), start: { public_state: t('Dwindling.', '日渐凋零。'), inner_state: t('Unaware that its last keeper in Salt Harbor has vanished.', '尚不知盐湾港的最后一位守塔人已经失踪。'), goals: [] }, members: [{ character: 'bram', role: t('keeper', '守塔人'), rank: t('senior', '资深'), status: 'active', public: true, commitment: 1 }], relationships: [] })

  // ---- background
  const lore = (id: string, entry: Record<string, unknown>): void => { put(`lore/${id}/lore.json`, { id, ...entry }) }
  lore('harbor-founding', { title: t('The founding of Salt Harbor', '盐湾港的建立'), kind: 'history', scope: 'everyone', summary: t('Salt-panners settled the cove in 1789 and built the first pier.', '晒盐人于 1789 年在海湾定居，建起第一座码头。'), body: t('Salt Harbor was founded in 1789 by families of salt-panners who built its first pier from driftwood. The guild\'s charter dates from the town\'s hundredth year.', '盐湾港由晒盐人家族于 1789 年建立，第一座码头用浮木搭成。公会的特许状来自建镇百年之时。'), subjects: [{ kind: 'location', id: 'harbor' }] })
  lore('lighthouse-history', { title: t('The lighthouse', '灯塔的来历'), kind: 'history', scope: 'listed', known_by: ['mara', 'tomas', 'ines', 'bram'], summary: t('Built in 1851; the lamp has burned every night since.', '建于 1851 年，此后灯夜夜不熄。'), body: t('The lighthouse on the headland was built in 1851 after a wreck killed forty fishermen. Its lamp has burned every night since, until nine days ago.', '岬角上的灯塔建于 1851 年，起因是一场海难夺去了四十名渔民的性命。此后灯夜夜不熄，直到九天前。'), subjects: [{ kind: 'location', id: 'lighthouse' }], related: ['keeper-oath'] })
  lore('keeper-oath', { title: t('The keeper\'s oath', '守塔誓言'), kind: 'religion', scope: 'listed', known_by: ['bram', 'tomas', 'mara'], summary: t('A keeper swears never to let the lamp go dark, whatever it costs.', '守塔人立誓：无论代价如何，绝不让灯熄灭。'), body: t('The oath is spoken once, at the foot of the lamp: the keeper answers for the light with his own, and may leave it only for a successor.', '誓言只在灯座前说一次：守塔人以自己的光为灯作保，只有在有人接替时才可离岗。'), subjects: [{ kind: 'faction', id: 'lamp-keepers' }] })
  lore('guild-charter', { title: t('The guild charter', '公会特许状'), kind: 'politics', scope: 'everyone', summary: t('The guild alone may grant moorings and close roads on the harbor\'s land.', '只有公会能批准泊位，并封闭港区土地上的道路。'), body: t('The charter gives the guild sole right to grant moorings, set fish prices and close any road in the harbor\'s land for repairs for up to thirty days.', '特许状赋予公会批准泊位、制定鱼价、以检修为由封闭港区任何道路（最长三十天）的专有权。'), subjects: [{ kind: 'faction', id: 'harbor-guild' }] })
  lore('smugglers-signal', { title: t('The smugglers\' signal', '走私者的暗号'), kind: 'custom', scope: 'listed', known_by: ['kit', 'bram'], summary: t('Two long flashes and one short from the signal room mean a boat may land unseen.', '信号室打出两长一短的闪光，表示船可以悄悄靠岸。'), body: t('Fishermen who carry more than fish use the signal room\'s lamp: two long flashes and one short mean the watch is looking elsewhere.', '运货不止是鱼的渔民会用信号室的灯：两长一短，意味着夜巡队的目光在别处。'), subjects: [{ kind: 'location', id: 'signal-room' }] })
  lore('cellar-secret', { title: t('What the cellar holds', '地窖里藏着什么'), kind: 'custom', scope: 'listed', known_by: ['bram', 'tomas'], summary: t('Crates stamped with the guild\'s mark hold goods that were never entered in its books.', '印着公会标记的木箱里装着从未入账的货物。'), body: t('Under the lighthouse lie crates of untaxed brandy stamped with the guild\'s mark: proof that the guild runs the smuggling it claims to police.', '灯塔下放着印有公会标记的免税白兰地木箱：证明公会正在经营它声称要取缔的走私。'), subjects: [{ kind: 'location', id: 'lighthouse-cellar' }], related: ['smugglers-signal'] })
  lore('fog-bell', { title: t('The fog bell', '雾钟'), kind: 'culture', scope: 'everyone', summary: t('The bell on the pier rings at eight on foggy nights.', '雾夜八点，码头的钟会敲响。'), body: t('When fog lies on the harbor the pier bell is rung at eight, so that boats still out can find the pier by sound.', '港上起雾时，码头的钟在八点敲响，好让还在海上的船循声找到码头。'), subjects: [{ kind: 'location', id: 'pier' }] })
  lore('old-tide-law', { title: t('The old tide law', '旧潮汐法'), kind: 'geography', scope: 'everyone', summary: t('Until 1885 the pier closed to all boats at the spring tides.', '1885 年之前，大潮期间码头对所有船只关闭。'), body: t('Before the new breakwater was finished, the pier was closed to every boat for the three days of the spring tides.', '新防波堤建成之前，大潮的三天里，码头对所有船只关闭。'), ends_at: '1885-12-31' })

  // ---- what the story tracks
  const bands = (...labels: [number, string][]) => labels.map(([up_to, label]) => ({ up_to, label }))
  put('variables.json', [
    { key: 'harbor_trust', name: t('Trust in the guild', '对公会的信任'), description: t('How far the town believes the guild: 0 none, 10 complete.', '镇上人对公会的信任程度：0 毫无，10 完全。'), kind: 'number', subject: 'world', min: 0, max: 10, integer: true, default: 5, visibility: 'hidden', always: true, bands: bands([3, t('doubtful', '怀疑')], [7, t('wary', '观望')], [10, t('loyal', '拥护')]) },
    { key: 'storm_warning', name: t('Storm warning', '风暴警报'), description: t('Whether a storm warning has been raised.', '是否已发出风暴警报。'), kind: 'flag', subject: 'world', default: false, visibility: 'public' },
    { key: 'weather', name: t('Weather', '天气'), description: t('What the weather is doing.', '当前天气。'), kind: 'choice', subject: 'world', options: t(['clear', 'fog', 'rain', 'storm'], ['晴', '雾', '雨', '风暴']), default: t('fog', '雾'), visibility: 'public' },
    { key: 'fatigue', name: t('Fatigue', '疲劳'), description: t('How tired the character is: 0 rested, 10 exhausted.', '角色的疲劳程度：0 精力充沛，10 筋疲力尽。'), kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 0, visibility: 'public', bands: bands([2, t('rested', '精力充沛')], [5, t('tired', '疲倦')], [8, t('weary', '疲惫')], [10, t('exhausted', '筋疲力尽')]) },
    { key: 'hunger', name: t('Hunger', '饥饿'), description: t('How hungry the character is: 0 full, 10 starving.', '角色的饥饿程度：0 吃饱，10 饿极。'), kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 1, visibility: 'public' },
    { key: 'suspicion', name: t('Suspicion of the player\'s character', '对玩家角色的怀疑'), description: t('How much this person suspects the player\'s character of meddling.', '这个人对玩家角色多管闲事的怀疑程度。'), kind: 'number', subject: 'character', only: ['tomas', 'ines'], min: 0, max: 10, integer: true, default: 1, visibility: 'private' },
    { key: 'injury', name: t('Injury', '伤势'), description: t('How badly the character is hurt.', '角色的受伤程度。'), kind: 'choice', subject: 'character', options: t(['none', 'light', 'serious'], ['无', '轻伤', '重伤']), default: t('none', '无'), visibility: 'public' },
    { key: 'lamp_oil', name: t('Lamp oil', '灯油'), description: t('How much oil is left in a lamp, in percent.', '灯里剩下的灯油，以百分数计。'), kind: 'number', subject: 'item', only: ['lantern', 'signal-lamp'], min: 0, max: 100, integer: true, default: 100, visibility: 'public' },
    { key: 'crowd', name: t('Crowd', '人流'), description: t('How crowded a place is: 0 empty, 10 packed.', '地点的拥挤程度：0 空无一人，10 挤满人。'), kind: 'number', subject: 'location', min: 0, max: 10, integer: true, default: 2, visibility: 'public', bands: bands([2, t('quiet', '冷清')], [6, t('busy', '热闹')], [10, t('packed', '人挤人')]) },
  ])

  // ---- what the world does by itself
  put('triggers.json', [
    { key: 'fog-bell-rings', name: t('The fog bell rings', '雾钟敲响'), when: { type: 'time', from: '1887-10-03T20:00' }, effects: [{ type: 'beat', text: t('The fog bell on the pier begins to ring, slow and flat.', '码头的雾钟开始敲响，缓慢而沉闷。') }, { type: 'cue', audience: { place: 'inn-bar' }, text: t('The bell has started; the bar goes quiet for a moment.', '钟响了，酒吧里安静了一瞬。') }], announce: { audience: 'everyone', text: t('The fog bell will ring at eight.', '雾钟将在八点敲响。'), at: '1887-10-03T18:30' } },
    { key: 'storm-breaks', name: t('The storm breaks', '风暴降临'), when: { type: 'variable', variable: 'storm_warning', op: 'eq', value: true }, effects: [{ type: 'edit', edit: { events: [{ text: t('A storm broke over Salt Harbor and every boat ran for the pier.', '风暴席卷盐湾港，所有的船都赶回码头。'), tags: ['storm'], importance: 4, perceived_by: 'everyone' }] } }] },
    { key: 'key-found', name: t('The key is found', '钥匙被找到'), when: { type: 'item', item: 'lighthouse-key', held_by: 'mara' }, effects: [{ type: 'beat', text: t('Someone on the pier has seen the player\'s character pick something up from the mooring stones.', '码头上有人看见玩家角色从系缆石下拿起了什么。') }] },
    { key: 'at-the-lighthouse', name: t('At the lighthouse', '到了灯塔'), when: { type: 'place', character: 'mara', location: 'lighthouse' }, effects: [{ type: 'cue', audience: { characters: ['bram'] }, text: t('Footsteps on the stair above.', '楼上传来脚步声。') }] },
  ])

  put('dice.json', { checks: [
    { key: 'notice', name: t('Notice', '察觉'), use: t('An attempt to spot, overhear or realise something that is not obvious and matters.', '尝试发现、听到或意识到某件不明显但重要的事。'), dice: '2d6', reading: 'total', compare: 'absolute', bands: [{ max: 6, label: t('misses it', '没有察觉'), result: 'failed' }, { min: 7, max: 9, label: t('catches a part', '察觉了一部分'), result: 'partial' }, { min: 10, label: t('notices clearly', '清楚地察觉'), result: 'succeeded' }] },
    { key: 'endure', name: t('Endure', '坚持'), use: t('Pushing on through cold, fear or exhaustion when it is uncertain that the body will hold.', '在寒冷、恐惧或疲惫中硬撑，且身体能否撑住并不确定。'), dice: '1d20', compare: 'over', bands: [{ max: -1, label: t('gives out', '撑不住'), result: 'failed' }, { min: 0, max: 9, label: t('holds', '撑住了'), result: 'succeeded' }, { min: 10, label: t('holds easily', '轻松撑住'), result: 'succeeded' }] },
  ] })

  put('plots.json', [{ id: 'the-dark-lamp', name: t('The dark lamp', '熄灭的灯'), premise: t('Someone put the lighthouse out on purpose, and the keeper is hiding with the proof.', '有人故意熄灭了灯塔，守塔人带着证据躲了起来。'), themes: t(['duty', 'complicity'], ['职责', '同谋']), hooks: [{ id: 'closed-road', text: t('The harbor master\'s notice closing the lighthouse road.', '港务长封闭灯塔路的告示。'), mode: 'opportunity' }], developments: [{ id: 'cellar-found', text: t('The cellar and its guild-stamped crates come to light.', '地窖和印着公会标记的木箱被发现。'), mode: 'opportunity', prerequisites: ['closed-road'] }], stakes: t(['the keeper\'s safety', 'the guild\'s hold on the harbor'], ['守塔人的安危', '公会对渔港的掌控']), resolutions: t(['the guild is exposed', 'the matter is buried'], ['公会败露', '事情被掩盖']), participants: ['bram', 'ines', 'tomas'], start: 'available' }])

  put(`prompts/${language}/roleplay/style.md`, t('Write in plain, concrete prose. Let fog, salt and lamplight carry the mood; never explain a feeling the scene already shows.', '用平实具体的文字写作。让雾、盐和灯光承载气氛；场景已经表现出来的情绪，不要再加解释。'))
  return files
}

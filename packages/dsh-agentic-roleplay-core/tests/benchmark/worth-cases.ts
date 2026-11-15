import type { Language } from './language.ts'

/** One moment of an invented story, in both languages, and whether it is a moment a reader would want a picture of. */
export interface WorthCase {
  id: string
  worth: boolean
  text: { en: string; zh: string }
}

export const WORTH_CASES: readonly WorthCase[] = [
  { id: 'arrive-place', worth: true, text: {
    en: 'The ferry bumps against the pier and you step off. Before you the market town of Larkwater climbs the hill in tiers: white stairs, hanging lanterns, and a clock tower with a green copper roof glowing in the low sun.',
    zh: '渡船轻轻撞上码头，你走了下去。眼前的雾桥镇沿着山坡一层层向上：白色的石阶，悬挂的灯笼，还有一座铜顶发绿的钟楼在低斜的阳光里闪着光。' } },
  { id: 'creature', worth: true, text: {
    en: 'The reeds part and something huge rises out of the marsh: a heron taller than a horse, its feathers the colour of rust, a single pale eye fixed on your lantern.',
    zh: '芦苇向两边分开，沼泽里升起一个庞然大物：一只比马还高的苍鹭，羽毛锈红，一只苍白的眼睛盯着你的灯笼。' } },
  { id: 'fire', worth: true, text: {
    en: 'The granary roof catches. Flame runs along the beams, sparks fall like orange snow into the yard, and the villagers form a line to the well, shouting.',
    zh: '粮仓的屋顶着了火。火焰沿着房梁蔓延，火星像橙色的雪落进院子，村民们喊叫着排成一列向水井传水。' } },
  { id: 'dress', worth: true, text: {
    en: 'Odile comes down the stairs in a midnight-blue gown stitched with silver thread, a mask of black feathers in her hand, and every head in the ballroom turns.',
    zh: '奥黛尔穿着缀满银线的午夜蓝长裙走下楼梯，手里拿着一副黑羽毛面具，舞厅里的每个人都转过头来。' } },
  { id: 'vista', worth: true, text: {
    en: 'At the top of the pass the cloud lifts. A glacier-blue lake lies far below, ringed by black pines, and beyond it a line of snow peaks turns pink with the sunrise.',
    zh: '到了山口的顶端，云层散开。远处下方有一片冰蓝色的湖，四周环着黑松，湖的那边一排雪峰在日出里染成粉红。' } },
  { id: 'duel', worth: true, text: {
    en: 'Steel rings in the narrow alley. The masked fencer lunges, you twist away, and her blade slices the lantern rope; the light swings wildly across the wet stones.',
    zh: '窄巷里钢刃相击。蒙面的剑手突刺，你侧身躲开，她的剑劈断了灯绳，灯光在湿漉漉的石板上疯狂摇晃。' } },
  { id: 'ruin', worth: true, text: {
    en: 'You push open the library door. Fallen shelves, a ceiling gone to sky, and in the middle of the floor a tree growing through a drift of old books, its leaves bright against the grey.',
    zh: '你推开图书馆的门。倒塌的书架，塌成天空的屋顶，地板中央有一棵树穿过成堆的旧书长出来，叶子在灰色里格外鲜亮。' } },
  { id: 'ship', worth: true, text: {
    en: 'The mist thins and the ship appears: a three-masted wreck with black sails, listing in the shallows, a red lantern still burning at her stern.',
    zh: '雾渐渐变薄，那艘船显了出来：一艘三桅的残骸，黑色的帆，在浅水里歪着，船尾还亮着一盏红灯。' } },
  { id: 'banter', worth: false, text: {
    en: '"So you will not tell me where you were last night?" Marek asks. "I would rather not," you say. He shrugs, pours the tea, and talks about the price of barley for a while.',
    zh: '“所以你不肯告诉我昨晚去了哪里？”马雷克问。“我不想说。”你答道。他耸耸肩，倒了茶，又谈了一会儿大麦的价钱。' } },
  { id: 'think', worth: false, text: {
    en: 'You sit with the letter in your lap and think it over. Perhaps the offer is honest. Perhaps not. You weigh the risks again, and decide to sleep on it.',
    zh: '你把信放在膝上坐着，仔细思量。也许这个提议是真诚的，也许不是。你再次权衡风险，决定睡一觉再说。' } },
  { id: 'known-road', worth: false, text: {
    en: 'You walk the same road back to the village, past the same fences and the same dog, and arrive a little before noon.',
    zh: '你沿着同一条路走回村里，经过同样的篱笆和同样的那条狗，中午稍前到了。' } },
  { id: 'inventory', worth: false, text: {
    en: 'You count your supplies: four loaves, a skin of water, two candles and a coil of rope. It should last three days if you are careful.',
    zh: '你清点补给：四个面包，一皮囊水，两支蜡烛和一卷绳子。省着点够用三天。' } },
  { id: 'rules', worth: false, text: {
    en: 'The clerk explains that the permit costs six coins and must be stamped at the second desk, and that the second desk is only open on market days.',
    zh: '办事员解释说通行证要六个铜币，必须在第二个柜台盖章，而第二个柜台只在赶集日开。' } },
  { id: 'wait', worth: false, text: {
    en: 'You wait. An hour passes, then another. Nobody comes. The tea goes cold and you read the same page again.',
    zh: '你等着。一个小时过去了，又一个小时。没有人来。茶凉了，你把同一页又读了一遍。' } },
  { id: 'recap', worth: false, text: {
    en: 'Brin sums up what you know so far: the key was taken on the third night, the guard saw nothing, and the steward was away. None of it adds up yet.',
    zh: '布林总结了你们目前知道的：钥匙在第三天夜里被拿走，守卫什么也没看见，管家不在。这一切还说不通。' } },
  { id: 'chat-bed', worth: false, text: {
    en: 'The innkeeper says the room is the second on the left and breakfast is at seven. You thank her and go up, tired, and fall asleep at once.',
    zh: '旅店老板说房间在左边第二间，早饭七点。你谢过她上楼，很累，立刻睡着了。' } },
]

export const worthText = (made: WorthCase, language: Language): string => made.text[language]

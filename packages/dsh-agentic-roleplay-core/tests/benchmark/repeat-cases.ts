import type { Language } from './language.ts'

/** A sentence the narration tells again in the same words, and whether it is stale filler (`stale`) or a repeat the story means. */
export interface RepeatCase {
  id: string
  stale: boolean
  earlier: Record<Language, string>
  narration: Record<Language, string>
  sentence: Record<Language, string>
}

const made = (id: string, stale: boolean, sentence: Record<Language, string>, earlier: Record<Language, string>, narration: Record<Language, string>): RepeatCase => ({ id, stale, sentence, earlier, narration })

/**
 * Invented moments. In the stale cases an atmosphere line, a gesture or a stock phrase comes back for want of something new; in the meant cases the same words come back on purpose
 * (a refrain, a ritual formula, an echoed quotation, a detail the scene is about). Written for each language, not translated word for word.
 */
export const REPEAT_CASES: readonly RepeatCase[] = [
  made('rain-filler', true,
    { en: 'The rain outside shows no sign of stopping.', zh: '窗外的雨丝毫没有要停的意思。' },
    { en: 'You ask Mira about the ferry. The rain outside shows no sign of stopping. She shrugs and says it left at dawn.', zh: '你向米拉打听渡船。窗外的雨丝毫没有要停的意思。她耸耸肩，说船天亮就开走了。' },
    { en: 'Mira wipes the counter and hands you the key. The rain outside shows no sign of stopping. Upstairs a door closes softly.', zh: '米拉擦了擦柜台，把钥匙递给你。窗外的雨丝毫没有要停的意思。楼上有扇门轻轻关上了。' }),
  made('lamp-filler', true,
    { en: 'The lamp flickers and throws long shadows across the walls.', zh: '油灯闪了闪，在墙上投下长长的影子。' },
    { en: 'You open the ledger. The lamp flickers and throws long shadows across the walls. The last page is torn out.', zh: '你翻开账本。油灯闪了闪，在墙上投下长长的影子。最后一页被人撕走了。' },
    { en: 'Orrin stands and walks to the window. The lamp flickers and throws long shadows across the walls. He says nothing about the page.', zh: '奥林站起来走向窗边。油灯闪了闪，在墙上投下长长的影子。他对那一页只字不提。' }),
  made('nod-filler', true,
    { en: 'She nods slowly, as if weighing every word you said.', zh: '她缓缓点头，像是在掂量你说的每一个字。' },
    { en: 'You describe the man at the pier. She nods slowly, as if weighing every word you said. Then she asks what he carried.', zh: '你描述码头上那个男人。她缓缓点头，像是在掂量你说的每一个字。然后她问他带了什么。' },
    { en: 'You admit you did not see his face. She nods slowly, as if weighing every word you said. The kettle begins to whistle.', zh: '你承认没看清他的脸。她缓缓点头，像是在掂量你说的每一个字。水壶开始鸣叫。' }),
  made('air-filler', true,
    { en: 'The air in the cellar is cold and smells of old stone.', zh: '地窖里的空气阴冷，带着陈年石头的气味。' },
    { en: 'You climb down the ladder. The air in the cellar is cold and smells of old stone. Crates line the far wall.', zh: '你顺着梯子爬下去。地窖里的空气阴冷，带着陈年石头的气味。远处的墙边堆着木箱。' },
    { en: 'You pry the lid off the first crate. The air in the cellar is cold and smells of old stone. Inside lie folded sailcloth and a rusted key.', zh: '你撬开第一只箱子的盖子。地窖里的空气阴冷，带着陈年石头的气味。里面是叠好的帆布和一把生锈的钥匙。' }),
  made('crowd-filler', true,
    { en: 'The market hums with the noise of a hundred voices.', zh: '集市里人声鼎沸，嗡嗡作响。' },
    { en: 'You push through the stalls toward the fish seller. The market hums with the noise of a hundred voices. A boy runs past with a basket.', zh: '你挤过摊位走向卖鱼的人。集市里人声鼎沸，嗡嗡作响。一个男孩提着篮子跑过。' },
    { en: 'The fish seller names a price too high. The market hums with the noise of a hundred voices. You offer half.', zh: '卖鱼的人报了个太高的价。集市里人声鼎沸，嗡嗡作响。你还了一半的价。' }),
  made('sigh-filler', true,
    { en: 'He lets out a long, tired sigh and rubs the bridge of his nose.', zh: '他长长地叹了口气，疲惫地揉了揉鼻梁。' },
    { en: 'You ask whether the harbor will open. He lets out a long, tired sigh and rubs the bridge of his nose. Not before the inspector comes, he says.', zh: '你问港口会不会开。他长长地叹了口气，疲惫地揉了揉鼻梁。他说，督察来之前不会。' },
    { en: 'You press him about the inspector. He lets out a long, tired sigh and rubs the bridge of his nose. He gives you a date and no more.', zh: '你追问督察的事。他长长地叹了口气，疲惫地揉了揉鼻梁。他给了你一个日期，再没说别的。' }),
  made('refrain-meant', false,
    { en: 'What the tide takes, the tide returns.', zh: '潮水带走的，潮水会送回来。' },
    { en: 'The old women sing as they mend the nets. "What the tide takes, the tide returns." The children join the last line.', zh: '老妇人们一边补网一边唱：“潮水带走的，潮水会送回来。”孩子们跟着唱最后一句。' },
    { en: 'At the funeral the harbor master lowers his voice. "What the tide takes, the tide returns." The crowd answers him in one breath.', zh: '葬礼上，港务长压低了声音：“潮水带走的，潮水会送回来。”人群齐声应和。' }),
  made('oath-meant', false,
    { en: 'I swear by the salt and the sea to carry the word true.', zh: '我以盐和海起誓，必将此言如实带到。' },
    { en: 'Mira holds up her hand. "I swear by the salt and the sea to carry the word true." She waits for you to say it back.', zh: '米拉举起手：“我以盐和海起誓，必将此言如实带到。”她等着你复述。' },
    { en: 'You raise your hand and speak the old words. "I swear by the salt and the sea to carry the word true." Mira lets out a breath.', zh: '你举起手，说出那句古老的誓词：“我以盐和海起誓，必将此言如实带到。”米拉松了口气。' }),
  made('echo-meant', false,
    { en: 'Nobody leaves the island before the bell is rung.', zh: '钟声未响，谁也不许离岛。' },
    { en: 'The warden reads the rule aloud. "Nobody leaves the island before the bell is rung." You note the bell hangs from a rotten beam.', zh: '看守大声念出规矩：“钟声未响，谁也不许离岛。”你注意到那口钟挂在一根朽烂的梁上。' },
    { en: 'You turn his own words back on him: "Nobody leaves the island before the bell is rung." He glances at the beam, and says nothing.', zh: '你把他的话原样还给他：“钟声未响，谁也不许离岛。”他瞥了一眼横梁，没有出声。' }),
  made('formula-meant', false,
    { en: 'The court is in session, and the truth is the only coin here.', zh: '开庭，此处唯真话可作数。' },
    { en: 'The clerk strikes the floor with his staff. "The court is in session, and the truth is the only coin here." The room falls quiet.', zh: '书记官用杖敲了敲地面：“开庭，此处唯真话可作数。”满堂寂静。' },
    { en: 'After the recess the clerk strikes the floor again. "The court is in session, and the truth is the only coin here." Orrin takes the stand.', zh: '休庭之后，书记官再次敲杖：“开庭，此处唯真话可作数。”奥林走上证人席。' }),
  made('detail-meant', false,
    { en: 'The third stair from the top creaks under any weight.', zh: '从上数第三级台阶一踩就吱呀作响。' },
    { en: 'You note the way up. The third stair from the top creaks under any weight. You will have to step over it tonight.', zh: '你记下上楼的路。从上数第三级台阶一踩就吱呀作响。今晚得跨过去。' },
    { en: 'You creep up in the dark and stop. The third stair from the top creaks under any weight. You lift your foot and step over it.', zh: '你摸黑往上爬，忽然停住。从上数第三级台阶一踩就吱呀作响。你抬起脚，跨了过去。' }),
  made('catchphrase-meant', false,
    { en: 'Mind the gap, friend, mind the gap.', zh: '当心脚下，朋友，当心脚下。' },
    { en: 'The ferryman grins as you board. "Mind the gap, friend, mind the gap." He says it to everyone.', zh: '你上船时，船夫咧嘴一笑：“当心脚下，朋友，当心脚下。”他对谁都这么说。' },
    { en: 'You step off at the far pier and he calls after you. "Mind the gap, friend, mind the gap." You find you are smiling.', zh: '你在对岸码头下船，他在身后喊：“当心脚下，朋友，当心脚下。”你发现自己笑了。' }),
]

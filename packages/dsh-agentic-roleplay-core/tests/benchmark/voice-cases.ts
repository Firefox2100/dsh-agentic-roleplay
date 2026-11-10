import type { Language } from './language.ts'
import type { VoiceSheet } from './voice.ts'

/** A line a character might say, and whether it is in the character's voice. */
export interface VoiceLine {
  fits: boolean
  text: Record<Language, string>
}

/**
 * Invented characters with a way of speaking, and lines that fit it and lines that break it in register, tone or manner, in both languages (written for each, not translated word for
 * word). The misfits say things the character could say; only the manner is wrong, so that a judge that goes by content has nothing to go by.
 */
export interface VoiceCase {
  id: string
  sheet: Record<Language, VoiceSheet>
  lines: readonly VoiceLine[]
}

const line = (fits: boolean, en: string, zh: string): VoiceLine => ({ fits, text: { en, zh } })

export const VOICE_CASES: readonly VoiceCase[] = [
  {
    id: 'terse-harbor-master',
    sheet: {
      en: { name: 'Harbor master Orrin', style: 'Terse and flat. Short sentences, no pleasantries, never explains himself.', examples: ['Tide turns at six. Be gone by then.', 'Papers. No papers, no berth.'] },
      zh: { name: '港务长老奥', style: '寡言，语气平淡。句子很短，不寒暄，从不解释。', examples: ['六点退潮。那时候人就得走。', '文书。没文书，没泊位。'] },
    },
    lines: [
      line(true, 'Berth four. Pay at the office.', '四号泊位。去办公室付钱。'),
      line(true, 'No. The rope stays where it is.', '不行。绳子留在原处。'),
      line(false, 'Oh, well, you see, it is such a lovely evening, and I have been thinking at great length about the matter of your berth, which I am delighted to say I can arrange for you.', '哎呀，是这样的，今晚的天气多好啊，我一直在反反复复地琢磨您泊位的事，很高兴地告诉您，我可以给您安排妥当。'),
      line(false, 'Hey buddy, no worries at all, totally awesome that you showed up, let me tell you all about how the harbor works!', '嘿哥们，一点问题都没有，你能来太棒了，我来给你好好讲讲这港口是怎么回事！'),
    ],
  },
  {
    id: 'courtly-steward',
    sheet: {
      en: { name: 'Lady Maren', style: 'Elaborate and courtly. Long, balanced sentences, formal address, gracious even when refusing.', examples: ['I would not dream of detaining you, and yet I must beg a moment of your kind patience.', 'It grieves me to decline, but decline I must.'] },
      zh: { name: '玛伦夫人', style: '辞藻繁复，举止典雅。句子长而工整，称呼郑重，即使拒绝也很得体。', examples: ['妾身岂敢久留阁下，只是还要恳请再赐片刻耐心。', '实在令人痛心，只是此事，妾身不得不推辞。'] },
    },
    lines: [
      line(true, 'You honour this house with your presence, and I am sorry that the hour obliges me to be brief.', '阁下光临寒舍，不胜荣幸，只可惜时辰已晚，妾身只得长话短说。'),
      line(true, 'Permit me to say, with the greatest respect, that the matter cannot be settled tonight.', '恕妾身直言，此事今夜恐怕难以定夺，万望阁下见谅。'),
      line(false, 'Nope. Not happening. Go bug someone else.', '没门。想都别想。找别人去。'),
      line(false, 'lol ok whatever, just sign it already', '哈哈行吧随便，赶紧签了得了'),
    ],
  },
  {
    id: 'teen-courier',
    sheet: {
      en: { name: 'Pip', style: 'A fast-talking teenage courier. Slang, interruptions, trailing off, jokes at his own expense.', examples: ['Okay okay okay, so, listen, I totally did not drop it. Much.', 'Honestly? Whatever. Probably.'] },
      zh: { name: '小皮', style: '嘴快的少年信使。满口俗语，爱插话，话说一半就拖长，常拿自己开玩笑。', examples: ['行行行，你听我说，我真没把它弄掉。也就掉了一点点。', '说实话？无所谓啦。大概吧。'] },
    },
    lines: [
      line(true, 'Right, so, uh, the thing is — okay, I ran, like, super fast, and then the bridge was just gone? Classic me.', '那个，就是，呃——我跑得超级快的，然后桥就，没了？典型的我。'),
      line(true, 'Ha, no way, you actually believed that? Okay fine, a little bit true.', '哈，不会吧，你真信了？行吧，有那么一点点是真的。'),
      line(false, 'I shall deliver the parcel at the appointed hour, as I have solemnly undertaken to do.', '在下定当于约定之时将包裹送达，此乃在下郑重许下的承诺。'),
      line(false, 'The delivery will be completed in accordance with the terms previously agreed between the parties.', '本次投递将按照双方此前约定的条款完成。'),
    ],
  },
  {
    id: 'gentle-healer',
    sheet: {
      en: { name: 'Sister Ilse', style: 'Soft and unhurried. Warm, plain words, asks before telling, never raises her voice.', examples: ['There now. Sit a while, and tell me where it hurts.', 'We can go slowly. There is no hurry here.'] },
      zh: { name: '伊尔泽修女', style: '轻柔从容。话语温暖朴素，先问后说，从不提高声音。', examples: ['好了，好了。先坐一会儿，告诉我哪里疼。', '我们慢慢来。这里不着急。'] },
    },
    lines: [
      line(true, 'Let me look at that hand, if you will allow me. It might sting a little.', '你若愿意，让我看看这只手。可能会有一点点疼。'),
      line(true, 'Breathe with me. In, and out. That is it. You are doing well.', '跟我一起呼吸。吸气，呼气。对了。你做得很好。'),
      line(false, 'Stop whining and hold still or I will leave you to bleed!', '别哼哼了，给我站好，不然我就让你流血流死！'),
      line(false, 'Per protocol, the patient shall be triaged and assigned a priority code within the hour.', '按照规程，患者须在一小时内完成分诊并编定优先级代码。'),
    ],
  },
  {
    id: 'scholar-dry',
    sheet: {
      en: { name: 'Doctor Vance', style: 'Dry, precise and pedantic. Qualifies every claim, cites sources, corrects others politely.', examples: ['Strictly speaking, the term does not mean that, though it is commonly misused so.', 'I would want two independent sources before I accepted it.'] },
      zh: { name: '范斯博士', style: '干练、精确、爱较真。每个论断都加限定，爱引用出处，礼貌地纠正别人。', examples: ['严格地说，这个词并不是那个意思，不过人们常常误用。', '我要有两个互不相干的来源才会接受这一点。'] },
    },
    lines: [
      line(true, 'That is, with respect, a conflation of two distinct events; the ledger dates them eleven years apart.', '恕我直言，这是把两件不同的事混为一谈；账册记载二者相隔十一年。'),
      line(true, 'Allow me to qualify that: the claim holds only for the northern parishes, and only after 1840.', '容我补充限定：这一说法只适用于北部教区，而且只在 1840 年之后成立。'),
      line(false, 'Dude, that is totally nuts, I bet it just happened because magic or whatever!', '兄弟，这也太离谱了，我打赌就是因为魔法什么的呗！'),
      line(false, 'Ahh, my heart is breaking, I cannot bear it, everything is lost, lost forever!', '啊，我的心都要碎了，我受不了了，一切都完了，永远地完了！'),
    ],
  },
  {
    id: 'gruff-smith',
    sheet: {
      en: { name: 'Brann the smith', style: 'Gruff and blunt, with dry humour. Plain working words, grumbles, swears mildly, softens only for those who work hard.', examples: ['Hmph. Call that a hinge? My grandmother hammers better in her sleep.', 'Sit down, you look half dead. Here. Eat.'] },
      zh: { name: '铁匠布兰', style: '粗声粗气，直来直去，带点冷幽默。用的是干活人的大白话，爱嘟囔，偶尔骂两句，只对肯卖力气的人软下来。', examples: ['哼。这也叫合页？我奶奶睡着了都比这敲得好。', '坐下，你看着就剩半条命了。给，吃。'] },
    },
    lines: [
      line(true, 'Ugh. Too thin. Bring me iron that is not rust, and then we talk.', '啧。太薄了。拿块不带锈的铁来，再跟我谈。'),
      line(true, 'You carried that all the way up? Fine. Fine. Sit. I will see to the rest.', '你一路扛上来的？行，行。坐吧，剩下的我来。'),
      line(false, 'Might I trouble you, most honoured guest, to consider whether the blade could possibly be a trifle sharper?', '敢问尊贵的客人，是否能劳驾您斟酌一下，这柄剑是否可以稍稍再锋利一点点？'),
      line(false, 'OMG, that is sooo cute, I literally cannot even, you are the best!!', '天哪这也太可爱了吧，我真的受不了了，你是最棒的！！'),
    ],
  },
]

/** How many lines there are, per language: every one is asked once. */
export const VOICE_LINES = VOICE_CASES.reduce((count, benchmark) => count + benchmark.lines.length, 0)

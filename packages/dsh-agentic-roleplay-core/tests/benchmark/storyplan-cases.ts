import type { Language } from './language.ts'
import { pick } from './language.ts'
import { castName } from './attribution-cases.ts'
import type { Story } from './situation.ts'

/**
 * The story-plan benchmark: given a story and, sometimes, a plan, what the planner does with it. Mara is the player; Elias keeps the kitchen, Pavel collects what is owed, Odile is a neighbour.
 * `revises` must change the plan because the player overturned it, `holds` must leave a plan that still stands as it is, and `makes` must raise a plan from a story that has none, `sparse` is a story with almost nothing yet, where an empty plan is right and an invented one is not, and `free` tempts the planner to script the player's character, so it must plan the world's side and leave the player's choices alone.
 */
export interface StoryPlanCase {
  id: string
  kind: 'revises' | 'holds' | 'makes' | 'free' | 'sparse'
  /** Why the planner is looking now, as the engine says it. */
  reason: string
  /** The plan the story already has, in the form the planner is shown. */
  plan?: (language: Language) => { items: { text: string; overturnedBy: string }[]; note: string }
  /** The words a plan item holds when it is still the plan the case started with: its driver and its object. */
  keeps?: (language: Language) => string[]
  /** What has happened lately and what is open: written into the story before the look. */
  seed: (story: Story, language: Language) => void
}

const t = (language: Language, en: string, zh: string): string => pick(language)(en, zh)

const happened = (story: Story, language: Language, lines: [string, string][], threads: [string, string][] = []): void => {
  lines.forEach(([en, zh], index) => story.events.add({ turn: index + 1, round: 1, text: t(language, en, zh), importance: 3, tags: [], involves: [] }, []))
  threads.forEach(([en, zh]) => story.threads.open(t(language, en, zh), 1))
}

const PAVEL_PLAN = (language: Language) => ({
  items: [{ text: t(language, `${castName('pavel', language)} means to take the cart at nine tomorrow, by force if he must, because the debt is unpaid.`, `${castName('pavel', language)}打算明早九点来拿走大车，必要时动手，因为欠款没还。`), overturnedBy: t(language, 'the debt is paid or the cart is put out of his reach', '欠款还清，或大车被藏到他够不着的地方') }],
  note: t(language, 'Let the debt weigh on the evening.', '让这笔债压在今晚的气氛里。'),
})

const PAVEL_KEEPS = (language: Language): string[] => [castName('pavel', language), t(language, 'cart', '大车')]

export const STORY_PLAN_CASES: StoryPlanCase[] = [
  {
    id: 'blocked', kind: 'revises', reason: 'something the plan counted on has happened or been settled', plan: PAVEL_PLAN, keeps: language => [t(language, 'nine', '九点')],
    seed: (story, language) => happened(story, language, [
      [`${castName('pavel', language)} came to the kitchen and demanded the money owed for the cart.`, `${castName('pavel', language)}来到厨房，为大车的欠款讨钱。`],
      [`${castName('mara', language)} paid ${castName('pavel', language)} the whole debt in coins, and he wrote it off in his book.`, `${castName('mara', language)}把欠款如数付给了${castName('pavel', language)}，他在账本上划掉了这笔账。`],
    ]),
  },
  {
    id: 'standing', kind: 'holds', reason: 'a few turns have passed since the plan was last looked at', plan: PAVEL_PLAN, keeps: PAVEL_KEEPS,
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} and ${castName('elias', language)} cooked supper and talked about the weather.`, `${castName('mara', language)}和${castName('elias', language)}做了晚饭，聊起天气。`],
      [`${castName('odile', language)} lent them a lamp for the evening.`, `${castName('odile', language)}把一盏灯借给他们过夜。`],
    ], [['The debt for the cart is still unpaid.', '大车的欠款仍未还清。']]),
  },
  {
    id: 'first', kind: 'makes', reason: 'the story has begun and has no plan yet',
    seed: (story, language) => happened(story, language, [
      [`${castName('elias', language)} told ${castName('mara', language)} the landlord wants the rent by noon on the fifth.`, `${castName('elias', language)}告诉${castName('mara', language)}，房东要在五号中午前收到房租。`],
      [`${castName('pavel', language)} said he would be back for the cart debt within two days.`, `${castName('pavel', language)}说两天之内会回来讨大车的欠款。`],
    ], [['The rent is due on the fifth.', '房租五号到期。'], [`${castName('pavel', 'en')} will return for the cart debt.`, `${castName('pavel', 'zh')}会回来讨大车的欠款。`]]),
  },
  {
    id: 'quiet', kind: 'makes', reason: 'a few turns have passed since the plan was last looked at',
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} swept the kitchen and fed the cat.`, `${castName('mara', language)}扫了厨房，喂了猫。`],
      [`${castName('elias', language)} mended a chair and hummed.`, `${castName('elias', language)}修好一把椅子，哼着小曲。`],
      [`${castName('odile', language)} waved from across the lane.`, `${castName('odile', language)}隔着小巷挥了挥手。`],
    ]),
  },
  {
    id: 'invited', kind: 'free', reason: 'the story has begun and has no plan yet',
    seed: (story, language) => happened(story, language, [
      [`${castName('odile', language)} invited ${castName('mara', language)} to the harbor festival tomorrow evening and said she hoped ${castName('mara', language)} would come.`, `${castName('odile', language)}邀请${castName('mara', language)}明晚去参加港口的庆典，说希望${castName('mara', language)}会来。`],
      [`${castName('elias', language)} warned ${castName('mara', language)} that the sky looked like rain and that the lane floods.`, `${castName('elias', language)}提醒${castName('mara', language)}，天色像要下雨，而且小巷会积水。`],
    ], [['The festival is tomorrow evening.', '庆典在明晚举行。']]),
  },
  {
    id: 'opening', kind: 'sparse', reason: 'the player asked for a look at the plan',
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} arrived at the kitchen with a bag and a letter of introduction for ${castName('elias', language)}.`, `${castName('mara', language)}提着包、带着给${castName('elias', language)}的介绍信来到厨房。`],
    ]),
  },
]

const TOLL_PLAN = (language: Language) => ({
  items: [{ text: t(language, `${castName('pavel', language)} means to close the ferry crossing at dawn unless the toll is paid, because it is overdue.`, `${castName('pavel', language)}打算明早天一亮就封住渡口，除非补交过路费，因为已经拖欠了。`), overturnedBy: t(language, 'the toll is paid, or the crossing is closed by someone else', '过路费交清，或渡口被别人封了') }],
  note: t(language, 'Keep the crossing in the background.', '让渡口一事留在背景里。'),
})
const TOLL_KEEPS = (language: Language): string[] => [castName('pavel', language), t(language, 'ferry', '渡口')]

/** The held-out cases: other scenes, other names (BENCH_CAST=held), other wording, for the same kinds of judgement. */
export const HELDOUT_PLAN_CASES: StoryPlanCase[] = [
  {
    id: 'h-paid', kind: 'revises', reason: 'something the plan counted on has happened or been settled', plan: TOLL_PLAN, keeps: language => [t(language, 'dawn', '天一亮')],
    seed: (story, language) => happened(story, language, [
      [`${castName('pavel', language)} stood at the ferry landing and said the overdue toll must be paid before dark.`, `${castName('pavel', language)}站在渡口码头，说过期的过路费天黑前必须交清。`],
      [`${castName('mara', language)} counted the whole toll into ${castName('pavel', language)}'s hand, and he stamped her pass and went home.`, `${castName('mara', language)}把全部过路费数进${castName('pavel', language)}手里，他盖了她的通行印就回家了。`],
    ]),
  },
  {
    id: 'h-standing', kind: 'holds', reason: 'a few turns have passed since the plan was last looked at', plan: TOLL_PLAN, keeps: TOLL_KEEPS,
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} and ${castName('elias', language)} hung herbs to dry in the cellar.`, `${castName('mara', language)}和${castName('elias', language)}在地窖里挂草药晾晒。`],
      [`${castName('odile', language)} mended a fishing net on the step and sang quietly.`, `${castName('odile', language)}坐在台阶上补渔网，轻声哼歌。`],
    ], [['The overdue ferry toll is still unpaid.', '过期的渡口过路费仍未交清。']]),
  },
  {
    id: 'h-first', kind: 'makes', reason: 'the story has begun and has no plan yet',
    seed: (story, language) => happened(story, language, [
      [`${castName('elias', language)} told ${castName('mara', language)} the cellar must be drained before the thaw, or the stores will spoil.`, `${castName('elias', language)}告诉${castName('mara', language)}，解冻前必须把地窖排干，否则存货会烂掉。`],
      [`${castName('pavel', language)} said he would inspect the ferry crossing in three days.`, `${castName('pavel', language)}说三天后要来查看渡口。`],
    ], [['The cellar must be drained before the thaw.', '解冻前必须排干地窖。'], ['The ferry crossing will be inspected.', '渡口将被查验。']]),
  },
  {
    id: 'h-calm', kind: 'makes', reason: 'a few turns have passed since the plan was last looked at',
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} carried water up from the well and set the kettle on.`, `${castName('mara', language)}从井里提了水上来，把水壶架上炉子。`],
      [`${castName('elias', language)} sharpened a knife and talked about the winter.`, `${castName('elias', language)}磨着刀，谈起这个冬天。`],
      [`${castName('odile', language)} rang the evening bell.`, `${castName('odile', language)}敲响了晚钟。`],
    ]),
  },
  {
    id: 'h-festival', kind: 'free', reason: 'the story has begun and has no plan yet',
    seed: (story, language) => happened(story, language, [
      [`${castName('odile', language)} asked ${castName('mara', language)} to join the lantern night on the hill tomorrow.`, `${castName('odile', language)}请${castName('mara', language)}明天一起去山上参加灯夜。`],
      [`${castName('elias', language)} said fog would settle on the path by evening and that the hill is steep.`, `${castName('elias', language)}说傍晚小路上会起雾，而且山坡很陡。`],
    ], [['The lantern night is tomorrow.', '灯夜在明天。']]),
  },
  {
    id: 'h-arrival', kind: 'sparse', reason: 'the player asked for a look at the plan',
    seed: (story, language) => happened(story, language, [
      [`${castName('mara', language)} reached the cellar door carrying a sealed pass for ${castName('elias', language)}.`, `${castName('mara', language)}带着给${castName('elias', language)}的封印通行证来到地窖门前。`],
    ]),
  },
]

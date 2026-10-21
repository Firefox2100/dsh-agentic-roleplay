import type { Dictionaries } from '../../i18n.ts'

export type SamplingFieldsKey = 'sf_master' | 'sf_characters' | 'sf_topP' | 'sf_topK' | 'sf_minP' | 'sf_frequencyPenalty' | 'sf_presencePenalty' | 'sf_repetitionPenalty' | 'sf_help'

export const dictionaries: Dictionaries<SamplingFieldsKey> = {
  en: {
    sf_master: 'Narrator temperature (0 to 2)', sf_characters: 'Characters temperature (0 to 2)', sf_topP: 'Top P (0 to 1)', sf_topK: 'Top K (0 to 1000)', sf_minP: 'Min P (0 to 1)',
    sf_frequencyPenalty: 'Frequency penalty (-2 to 2)', sf_presencePenalty: 'Presence penalty (-2 to 2)', sf_repetitionPenalty: 'Repetition penalty (0 to 2)',
    sf_help: 'How a story started from here asks its models, for that story only: its own choices at the start win. Empty suggests nothing. The values beyond temperature apply to the narrator and the characters, never to the helpers that must be exact.',
  },
  zh: {
    sf_master: '叙述者温度（0 到 2）', sf_characters: '角色温度（0 到 2）', sf_topP: 'Top P（0 到 1）', sf_topK: 'Top K（0 到 1000）', sf_minP: 'Min P（0 到 1）',
    sf_frequencyPenalty: '频率惩罚（-2 到 2）', sf_presencePenalty: '存在惩罚（-2 到 2）', sf_repetitionPenalty: '重复惩罚（0 到 2）',
    sf_help: '由此开始的故事向模型提出请求的方式，只对那个故事生效：开始时它自己的选择优先。留空表示不作建议。温度之外的值作用于叙述者和角色，不会用于需要精确的辅助者。',
  },
}

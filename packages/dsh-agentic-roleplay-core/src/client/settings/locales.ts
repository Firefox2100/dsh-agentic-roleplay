import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Dictionaries } from '../i18n.ts'

export type SettingsLocaleKey =
  | 'nav' | 'title' | 'description'
  | 'rootPath' | 'rootPathHint' | 'rootPathPlaceholder'
  | 'catalogues' | 'cataloguesHint' | 'catalogueName' | 'catalogueAddress' | 'catalogueKey' | 'catalogueKeyHint' | 'catalogueRemove' | 'catalogueAdd'
  | 'catalogueProblemName' | 'catalogueProblemAddress' | 'catalogueProblemDuplicate' | 'catalogueProblemKeyName'
  | 'catalogueKeyName' | 'catalogueKeyChecking' | 'catalogueKeySet' | 'catalogueKeyUnset' | 'catalogueKeyReadOnly' | 'catalogueKeyStore' | 'catalogueKeyClear' | 'catalogueKeyLegacy' | 'catalogueKeyMove'
  | 'authoringTools' | 'authoringToolsHint' | 'authoringToolsNone' | 'authoringKind_worldAuthoring' | 'authoringKind_presetAuthoring' | 'authoringKind_lorebookAuthoring' | 'authoringKind_worldAuthor'
  | 'overridden' | 'reset' | 'invalid'
  | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'

export const dictionaries: Dictionaries<SettingsLocaleKey> = {
  en: {
    nav: 'Role Play',
    title: 'Role Play',
    description: 'Where role play content is stored.',
    rootPath: 'Data folder',
    rootPathHint: 'Characters, sessions and their media live here. Use an absolute path or one starting with ~.',
    rootPathPlaceholder: '~/dsh-roleplay',
    catalogues: 'Catalogues',
    cataloguesHint: 'Catalogues to browse and install worlds from. Add a catalogue\'s API address, and an API key to see its private worlds.',
    catalogueName: 'Name',
    catalogueAddress: 'API address',
    catalogueKey: 'API key',
    catalogueKeyHint: 'Optional. The key is kept in DSH\'s credential store, not in this profile\'s configuration, and sent only to this catalogue\'s site. Storing or removing it takes effect at once; save the settings to keep a key name.',
    catalogueRemove: 'Remove',
    catalogueAdd: 'Add a catalogue',
    catalogueProblemName: 'Give the catalogue a name.',
    catalogueProblemAddress: 'Enter a web address like https://catalogue.example/api.',
    catalogueProblemDuplicate: 'Another catalogue has this name.',
    catalogueProblemKeyName: 'A key name has letters, digits and "_" and does not start with a digit.',
    catalogueKeyName: 'Key name',
    catalogueKeyChecking: 'checking…',
    catalogueKeySet: 'key is set',
    catalogueKeyUnset: 'no key',
    catalogueKeyReadOnly: 'its source cannot be written, so it cannot be changed here',
    catalogueKeyStore: 'Store key',
    catalogueKeyClear: 'Remove key',
    catalogueKeyLegacy: 'An earlier version saved a key as text in this profile\'s configuration. It is still used until you move it into the credential store; saving the settings after that removes the text.',
    catalogueKeyMove: 'Move it to the credential store',
    authoringTools: 'Tools for the authoring assistants',
    authoringToolsHint: 'Tools that other plugins registered for everyone (a web search, an MCP server, files) which an assistant may use, for example to look up a setting you name. An assistant has none that is not ticked here, whatever else this profile registers. A tool you tick runs without asking you each time, so tick only the ones you are comfortable letting it use. The session doctor never has any.',
    authoringToolsNone: 'No other plugin has registered tools for everyone. A tool added to one assistant\'s own preset is not listed here.',
    authoringKind_worldAuthoring: 'World authoring assistant',
    authoringKind_presetAuthoring: 'Preset authoring assistant',
    authoringKind_lorebookAuthoring: 'Lorebook authoring assistant',
    authoringKind_worldAuthor: 'World author during play (invents places, people and things the story needs)',
    overridden: 'Overridden',
    reset: 'Reset to default',
    invalid: 'Enter a folder path.',
    readOnly: 'This deployment stores settings read-only.',
    unavailable: 'Role play is not loaded, so it cannot be configured right now.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  },
  zh: {
    nav: '角色扮演',
    title: '角色扮演',
    description: '角色扮演内容的存放位置。',
    rootPath: '数据文件夹',
    rootPathHint: '角色、会话及其媒体文件都存放在这里。请填写绝对路径，或以 ~ 开头的路径。',
    rootPathPlaceholder: '~/dsh-roleplay',
    catalogues: '目录',
    cataloguesHint: '可以浏览并安装世界的目录。填写目录的 API 地址；填写 API 密钥后可以看到其中的私有世界。',
    catalogueName: '名称',
    catalogueAddress: 'API 地址',
    catalogueKey: 'API 密钥',
    catalogueKeyHint: '可不填。密钥保存在 DSH 的凭据存储中，而不是本配置里，只会发送给该目录所在的站点。存入或删除立即生效；要保留密钥名称，请保存设置。',
    catalogueRemove: '移除',
    catalogueAdd: '添加目录',
    catalogueProblemName: '请给目录起个名称。',
    catalogueProblemAddress: '请填写网址，例如 https://catalogue.example/api。',
    catalogueProblemDuplicate: '已有另一个目录使用这个名称。',
    catalogueProblemKeyName: '密钥名称由字母、数字和“_”组成，且不能以数字开头。',
    catalogueKeyName: '密钥名称',
    catalogueKeyChecking: '检查中…',
    catalogueKeySet: '已设置密钥',
    catalogueKeyUnset: '没有密钥',
    catalogueKeyReadOnly: '其来源不可写入，无法在此更改',
    catalogueKeyStore: '存入密钥',
    catalogueKeyClear: '删除密钥',
    catalogueKeyLegacy: '旧版本把密钥以文本形式保存在本配置中。在你把它移入凭据存储之前仍会继续使用；之后保存设置会删除这段文本。',
    catalogueKeyMove: '移入凭据存储',
    authoringTools: '创作助手的工具',
    authoringToolsHint: '其他插件为所有人注册的工具（网络搜索、MCP 服务器、文件等），创作助手可以使用，例如查询你提到的某个设定。没有在这里勾选的工具，助手一律没有，无论这个配置档还注册了什么。你勾选的工具会直接运行，不会每次都征求你的同意，所以只勾选你放心让它使用的工具。会话医生永远没有任何工具。',
    authoringToolsNone: '没有其他插件为所有人注册工具。加在某个助手自己的预设中的工具不会列在这里。',
    authoringKind_worldAuthoring: '世界创作助手',
    authoringKind_presetAuthoring: '预设创作助手',
    authoringKind_lorebookAuthoring: '世界书创作助手',
    authoringKind_worldAuthor: '游戏中的世界作者（为故事补充所需的地点、人物和物品）',
    overridden: '已覆盖',
    reset: '恢复默认',
    invalid: '请填写文件夹路径。',
    readOnly: '本部署的设置为只读。',
    unavailable: '角色扮演未加载，暂时无法配置。',
    save: '保存',
    saving: '保存中…',
    saveFailed: '本部署没有接受这些值，已保留供你修改。',
  },
}

export function formLabels(t: (key: SettingsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

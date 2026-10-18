import type { Dictionaries } from '../../i18n.ts'

export type ToolSwitchKey =
  | 'sw_title' | 'sw_help' | 'sw_none' | 'sw_default' | 'sw_failed' | 'sw_external' | 'sw_external_help' | 'sw_external_none'
  | 'sw_agent_gameMaster' | 'sw_agent_gameMaster_hint' | 'sw_agent_characters' | 'sw_agent_characters_hint' | 'sw_agent_records' | 'sw_agent_records_hint'
  | 'sw_tool_roll_check' | 'sw_tool_roll_check_hint' | 'sw_tool_roll_dice' | 'sw_tool_roll_dice_hint' | 'sw_tool_list_checks' | 'sw_tool_list_checks_hint'
  | 'sw_tool_recall_my_memories' | 'sw_tool_recall_my_memories_hint' | 'sw_tool_recall_my_known_entities' | 'sw_tool_recall_my_known_entities_hint' | 'sw_tool_recall_my_lore' | 'sw_tool_recall_my_lore_hint' | 'sw_tool_search_events' | 'sw_tool_search_events_hint' | 'sw_tool_list_threads' | 'sw_tool_list_threads_hint' | 'sw_tool_list_relationships' | 'sw_tool_list_relationships_hint' | 'sw_tool_list_items' | 'sw_tool_list_items_hint'

export const dictionaries: Dictionaries<ToolSwitchKey> = {
  en: {
    sw_title: 'Tools', sw_help: 'Which optional tools each kind of agent may use. A choice applies to every agent of that kind, not to one character. Tools this version does not know are left as they are and not shown.',
    sw_external: 'Tools from other plugins: {on} of {count} on', sw_external_help: 'Registered by other plugins for everyone (files, a shell, MCP servers such as a search). They are off unless you switch them on, and a tool acts with whatever access its plugin has, so switch on only what this agent should be able to do. A tool that is not registered now is kept here and has no effect.', sw_external_none: 'No tools from other plugins are registered right now. Load a plugin that registers tools for everyone (a file or shell tool, an MCP server) and they are offered here.',
    sw_none: 'No optional tools for this agent yet.', sw_default: 'default', sw_failed: 'Could not change the tools: {message}',
    sw_agent_gameMaster: 'Game master', sw_agent_gameMaster_hint: 'Decides what happens and writes the narration.',
    sw_agent_characters: 'Characters', sw_agent_characters_hint: 'Every character that is asked to act.',
    sw_agent_records: 'Record keeper', sw_agent_records_hint: 'Writes what happened into the story\'s records in the background.',
    sw_tool_roll_check: 'Roll a check', sw_tool_roll_check_hint: 'Rolls one of the world\'s checks for an uncertain attempt and reads the result with the world\'s own rules.',
    sw_tool_roll_dice: 'Roll dice', sw_tool_roll_dice_hint: 'Rolls plain dice (2d6+1, d100) for what has no check, so that no number is made up.',
    sw_tool_list_checks: 'List checks', sw_tool_list_checks_hint: 'Shows the world\'s checks and when each is used.',
    sw_tool_recall_my_memories: 'Recall memories', sw_tool_recall_my_memories_hint: 'Lets a character look up what it remembers when the scene names something its brief left out.',
    sw_tool_recall_my_known_entities: 'Recall known places and things', sw_tool_recall_my_known_entities_hint: 'Lets a character look up the places, things and people it knows of.',
    sw_tool_recall_my_lore: 'Recall lore', sw_tool_recall_my_lore_hint: 'Lets a character read the canon it explicitly knows.',
    sw_tool_search_events: 'Search events', sw_tool_search_events_hint: 'Lets the record keeper search what already happened before it writes.',
    sw_tool_list_threads: 'List open threads', sw_tool_list_threads_hint: 'Lets the record keeper see the story threads that are still open.',
    sw_tool_list_relationships: 'List relationships', sw_tool_list_relationships_hint: 'Lets the record keeper see how characters stand with each other.',
    sw_tool_list_items: 'List things', sw_tool_list_items_hint: 'Lets the record keeper see the things in the story and where they are.',
  },
  zh: {
    sw_title: '工具', sw_help: '每一类智能体可以使用哪些可选工具。选择对该类的所有智能体生效，而不是只针对某一个角色。此版本不认识的工具保持原样，也不显示。',
    sw_external: '来自其他插件的工具：{count} 个中开启 {on} 个', sw_external_help: '由其他插件为所有人注册的工具（文件、命令行、搜索之类的 MCP 服务器）。除非你开启，否则它们都是关闭的；工具以其插件所拥有的权限运行，所以只开启这个智能体应该能做的事。当前没有注册的工具会保留在这里，但不起作用。', sw_external_none: '当前没有其他插件注册的工具。加载一个为所有人注册工具的插件（文件或命令行工具、MCP 服务器）后，它们会在这里提供。',
    sw_none: '该智能体暂时没有可选工具。', sw_default: '默认', sw_failed: '无法更改工具：{message}',
    sw_agent_gameMaster: '主持人', sw_agent_gameMaster_hint: '决定发生什么，并撰写叙述。',
    sw_agent_characters: '角色', sw_agent_characters_hint: '每一个被要求行动的角色。',
    sw_agent_records: '记录员', sw_agent_records_hint: '在后台把发生的事写入故事记录。',
    sw_tool_roll_check: '进行检定', sw_tool_roll_check_hint: '为不确定的尝试掷出世界定义的检定，并按世界自己的规则解读结果。',
    sw_tool_roll_dice: '掷骰子', sw_tool_roll_dice_hint: '为没有检定的事掷普通骰子（2d6+1、d100），不让任何数字被编造。',
    sw_tool_list_checks: '列出检定', sw_tool_list_checks_hint: '显示世界的检定以及各自的使用场合。',
    sw_tool_recall_my_memories: '回忆往事', sw_tool_recall_my_memories_hint: '当场景提到简报中没有的内容时，角色可以查阅自己记得的事。',
    sw_tool_recall_my_known_entities: '回忆所知的地点与事物', sw_tool_recall_my_known_entities_hint: '角色可以查阅自己知道的地点、物品和人物。',
    sw_tool_recall_my_lore: '回忆典故', sw_tool_recall_my_lore_hint: '角色可以阅读自己明确知道的设定。',
    sw_tool_search_events: '搜索事件', sw_tool_search_events_hint: '记录员在写入前可以搜索已经发生的事。',
    sw_tool_list_threads: '列出未了线索', sw_tool_list_threads_hint: '记录员可以查看仍未了结的故事线索。',
    sw_tool_list_relationships: '列出关系', sw_tool_list_relationships_hint: '记录员可以查看角色之间的关系。',
    sw_tool_list_items: '列出物品', sw_tool_list_items_hint: '记录员可以查看故事中的物品及其位置。',
  },
}

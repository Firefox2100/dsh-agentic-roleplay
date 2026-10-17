---
title: 可选能力集成
description: 嵌入、重排序、语音、图片、模型、优先级与并发的准确契约。
---

本套件会使用原生 DSH 未提供的模型能力：嵌入、重排序、文本转语音、语音转文本和图片生成。这些能力来自另一组插件 `dsh-ai-providers`。其中，`@dsh-ai-providers/core` 定义契约，`dsh-ai-providers` 提供注册表、设置界面和已配置服务，`dsh-ai-<vendor>` 提供具体实现。它们把能力注册为 `ctx.embeddings` 等上下文服务。本套件只消费这些服务，没有它们也能运行。

## 当前使用的能力

角色回忆的重排序使用 `ctx.rerankers`。回忆先通过线索、词语和可选的语义搜索取得多于所需的候选项并融合结果。重排序服务读取当前情境和各候选项后评分，系统再结合该评分、融合检索分、重要性和新近程度选择结果，详见记忆规范。只要存在重排序服务，核心插件就会为状态插件注册记忆排序器：

```ts
ctx.roleplayState.rankMemories(async ({ situation, candidates, signal }) => {
  // candidates: the over-retrieved pool, { key, text, turn, importance }[];
  // return a Map from key to 0..1, or undefined when there is nothing to judge with
})
```

其他插件也可注册自己的实现，最后注册的实现生效。实现抛错时，回忆退回到仅使用检索结果，并在日志中记录原因；取消信号会继续向上传递。

## 对话的嵌入设置

对话设置在 `embedding.options` 中保存所选嵌入提供方允许按请求设置的参数。它是由提供方自定参数名组成的扁平值集合。向量按对话存储和比较，所以选项也属于对话。提供方通过 `@dsh-ai-providers/core` 的 `RequestOption` 描述选项，并由 `GET /ai-api/capabilities` 提供。对话设置显示全部选项；开始对话时的高级设置只显示标有 `atStart` 的选项。例如，OpenAI 提供方的向量维数必须在第一次请求前选定，因为不同维数的向量不能比较。

存在 `ctx.embeddings` 时，`host/memory/embedding-index.ts` 会使用它。写入故事索引的文本在后台以文档形式生成嵌入；角色行动时的情境和关键词查询以查询形式生成嵌入，两者都带上该对话的选项。向量通过 sqlite-vec 扩展存入会话数据库。除短暂的在途窗口外，嵌入插件不另行缓存。没有该插件时，线索和词语检索仍可正常工作。

## 语音与媒体

- 文本转语音可朗读完整回复或单条角色发言。完整回复会拆成旁白和发言，按各自配置的声音并发生成，再按故事顺序合并。声音发现是可选能力。对于 LocalAI 等不枚举声音的 OpenAI 兼容服务器，手工填写的提供方声音 ID 仍然可用。
- 语音转文本使用 DSH 的实验性语音转文本提供方契约处理完成的录音。实时转写使用另一个可选的 `streamingSpeechToText` 服务，角色扮演主机通过 `/roleplay-api/speech/capabilities` 检测它。DSH Voice Input 负责采集麦克风，并把完成的转写插入已有草稿，不会自动发送。

两项服务都在使用时查找。本套件包含 DSH Voice Input 和 SenseVoice。启用 API STT 后，其提供方与 SenseVoice 并列注册；禁用 API STT 只撤回该提供方。

- 图片生成使用可选、与提供方无关的图片服务，生成规范肖像和临时场景图。支持参考图的 OpenAI 兼容驱动在有参考图时调用编辑接口，否则调用生成接口。身份、存储、任务和界面行为见图片系统规范。

## 消费能力的规则

- 可选能力在使用时通过 `ctx.get` 查找，不作为硬性 `inject`，因此缺少能力时套件仍可加载。
- 只改善结果的能力失败时可降级，例如重排序；用户明确请求的操作失败时应直接报错，例如朗读。
- 有成本的能力按对话选择，设置放在 `memory.*` 附近；较慢的能力默认关闭。

## 语言模型

智能体使用的模型可由 AI providers 插件提供给 DSH。提供 `llm` 的提供方注册路由，再由一个适配器统一提供。角色扮演插件不依赖该方式，只会把辅助智能体的控制参数交给实际响应的服务。它在使用时查找 `ctx.aiProviders.policy`。使用 DSH 自带适配器时，适配器会忽略这些参数，插件其余部分无需改变。

控制参数包括温度，以及辅助智能体是否必须通过工具调用作答。默认温度为：游戏主持人的 `sampling.master` 为 0.7，角色的 `sampling.characters` 为 0.8，建议作者的 `sampling.suggestions` 为 0.2，创作助手的 `sampling.authoring` 为 0.4，记录员和图片作者的 `sampling.records` 为 0.1。对话设置还包含 `sampling.tools`。除工具选择外，这些项目都显示在设置表单中。导入使用 `importTemperature`，输出长度和推理级别分别使用 `importMaxTokens` 与 `importReasoning`。

## 共享繁忙资源

AI providers 插件可通过并发设置限制一种资源同时处理的请求数。角色扮演套件会声明等待优先级：本回合中的角色和世界作者即时创建的事物优先；回合后的记录员、建议、记忆索引和自动场景图排在其后；玩家主动请求的图片或录音再次获得高优先级。新回合也不会在开始前等待上一回合的记录完成，只有需要回忆或修改故事状态的操作才会等待。

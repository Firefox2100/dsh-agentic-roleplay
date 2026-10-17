---
title: 图片系统规范
description: 视觉身份、媒体路径、嵌入元数据、图库搜索、图片呈现和任务。
---

图片生成附着在已交付回合上。文字先显示，随后可由一个可取消的后台图片子智能体为该时间线节点生成一张或多张插图。规范视觉身份保存在故事状态中，生成媒体保存在磁盘上。

## 视觉身份

角色、地点和物品可包含 `visual_identity`，其中只保存稳定、与提供方无关的事实：

```json
{
  "visual_identity": {
    "global_id": "person-mira",
    "description": "A slight woman with long black hair and grey eyes.",
    "tags": ["long black hair", "grey eyes", "slight build"],
    "negative_tags": ["blue eyes", "short hair"]
  }
}
```

`global_id` 可选，并在会话内全局唯一。只要该块存在，`description` 就是必填项。当前衣着、表情、活动、伤势、光线和周围环境属于瞬时状态，不应写入身份。

开始会话时，世界定义的身份复制到 `visual_identities` 表。游玩中创建或编辑的身份属于会话状态，会跟随快照和分支。每次替换或更新都会增加版本。生成图片不作为数据库行保存。

角色编辑器在世界与会话中显示同一种身份。在世界页，它编辑角色 JSON 中的 `visual_identity` 并生成世界的规范肖像；在实时对话中，它编辑数据库里的副本并生成会话肖像。开始会话时，世界的规范实体参考图也会硬链接到会话；跨文件系统时则复制。会话因此自包含，之后修改源世界不会改变它。

## 文件

世界目录和会话目录都可作为媒体根目录，路径保持稳定：

```text
<root>/images/
  global/<global-id>/reference.png
  characters/<local-id>/reference.png
  locations/<local-id>/reference.png
  items/<local-id>/reference.png
  scenes/turn-<timeline-node>-<serial>.png
```

`global/` 命名空间避免全局 ID 与本地 `characters`、`locations`、`items`、`scenes` 冲突。实体同时拥有两种 ID 时优先使用全局 ID，否则世界使用作者定义的 ID，会话使用数字 ID。

场景文件名使用时间线节点，如 `n12`，而不是显示的回合号。重新生成可能复用回合号，但时间线节点始终唯一且稳定。末尾序号起初为两位，例如 `turn-n12-01.png`，因此同一节点可保存多张图片。

生成文件使用 PNG，因为元数据以名为 `dsh-roleplay` 的 UTF-8 `iTXt` 块嵌入。`dsh-roleplay-image/v2` JSON 保存模式、用途、创建时间、实际提示词与提供方修订后的提示词、可独立阅读的 `description`、用于再次检索的 `tags`、提供方、模型、主体及身份版本。场景图还保存回合、时间线节点和可选旁白片段。参考图的描述说明主体及稳定外观；场景图先说明已建立的时刻，再说明各主体在其中的样子。v2 之前的图片没有描述和标签，仍可读取，图库会显示其提示词。用户可在稳定路径上替换参考图。元数据用于追踪来源，不是定位文件所必需的索引。

写入先落到同目录临时文件，再原子重命名。生成参考图会替换 `reference.png`；生成场景图会使用新序号，不覆盖已有图片。

## 图库

每个角色扮演对话在 Chat 与 World 旁都有 **Gallery** 标签页。它以网格显示会话 `images/` 中的图片，可筛选全部、场景和参考图，并按新到旧排列。打开图片后会显示大图、描述、提示词、提供方修订提示词、主体、标签、模型和回合。

`GET /roleplay-api/sessions/gallery?id=` 根据文件中的信息列出图片。`host/images/gallery.ts` 读取嵌入元数据；元数据不可读时仍按文件位置列出。`.../gallery/file?id=&path=` 按列表返回的路径提供文件。路径必须位于 `images/` 内，文件必须是 PNG，且不能通过符号链接到达。

## 图片呈现、复用与导入

向玩家呈现图片的智能体是 `runImagePresenter`，提示词为 `roleplay/image-presenter`，旧称图片作者。它可以显示会话已有的图片，也可以生成新图。图片有两个来源：

- 故事图片生成功能创建的图片使用 `origin: generated`。呈现器会判断场景图是否可复用。地点、角色长期外观或可重复氛围可设为 `true`；一次性事件默认是 `false`。参考图始终可复用。
- 用户带入的图片使用 `origin: uploaded`。它们可从图库的**添加图片**加入，也可手工放入 `<session>/images/library/`。世界的 `images/library/` 会由会话继承。这些图片始终可复用。系统按文件字节识别 PNG、JPEG、WebP 和 GIF。PNG 在文件内保存元数据，其他格式使用 `<file>.json` 伴随文件。

`dsh-roleplay-image/v3` 在 v2 基础上增加 `origin`、`reusable` 和 `originalName`，用户带入的图片没有提示词。新带入的图片最初没有描述，状态为 `pending`。开启 `images.interpret` 时，能看图的模型通过 `interpretImage` 描述它。该一次性子智能体会看到图片和故事中的名称，并把 `description`、`tags` 及明确出现的 `subjects` 写回文件。

解释任务在后台逐张运行，触发点包括添加图片、读取图库和自动生成图片前。失败的图片保持 pending，图库会显示原因。默认使用对话模型，但提供方必须把它声明为 `vision`；也可用 `images.interpreterModel` 指定 `provider/model`。未声明看图能力的模型会被拒绝，不能凭空描述。只能生成字幕而不能调用工具的模型可设为 `images.captioner`：它看图并输出纯文本，再由看不到图片的对话模型整理描述、标签和主体。图库中的**编辑**可人工修正描述并写回文件。

在 `images.mode` 为 `every-turn` 且开启 `images.reuse` 时，呈现器先获得 `search_images` 和 `use_existing_image`，并被要求先搜索。模型有视觉能力时，`search_images` 会连同候选图片本身返回。图片通过附件服务保存，并作为图片块进入工具结果。OpenAI 兼容适配器会在工具消息后另发一条用户消息携带图片，因为 API 不允许在其他位置放图片。模型因此能直接比较图片与当前时刻；无视觉能力的模型按描述判断。`use_existing_image` 只接受本次搜索返回过的图片，确保呈现器有机会判断它，并要求理由说明所见内容。

搜索通过倒数排名融合两种排序。词语排序统计查询词在图片描述中的匹配数，稀有词权重更高；词也可匹配以它开头的词，中文等 CJK 文本按双字处理，并忽略功能词。查询点名图片主体时会额外加分，但这只是提示，不是筛选条件，近似结果仍会返回供模型查看。有嵌入服务时，语义排序会在后台把描述作为文档嵌入到 `images/.vectors.json`。只有描述变化或模型变化时才重建向量，查询使用余弦相似度。嵌入失败时只用词语排序。

呈现器随后选择已有图片或生成新图。选择已有图片时，`use_existing_image` 写入 `images/presented/<node>.json`，不复制原文件，因此回退与分支只保留其保留回合的呈现记录。用户通过按钮主动请求的图片始终重新生成。`images/.index.json` 按大小和修改时间记录各文件的读取结果，使列举和搜索只重读新文件或已修改文件。两个缓存都可删除，图片文件始终是事实来源。

## 图片作者

`runImagePresenter` 创建不带游戏主持人或预设工具的子智能体。其固定 persona 区分规范身份和场景瞬时状态，并禁止编造故事事实。调用方提供当前会话、媒体根目录、回合、时间线节点、图片生成服务，以及参考图或临时场景请求。

子智能体有四个专用工具：

- `list_visual_subjects` 解析可用角色、地点和物品，包括可见当前状态、已存视觉身份和参考图是否存在。
- `set_visual_identity` 建立或明确修正实体的稳定身份。
- `generate_reference_image` 生成或替换实体的规范 `reference.png`。
- `generate_transient_image` 以不会冲突的序号生成不可变场景图。

每个主体都必须已有存储身份才能生成。ID 与路径解析、规范提示词和瞬时提示词的组合、元数据写入，以及子智能体返回的相对路径记录，都由工具代码完成，不交给模型。隐藏物品的状态也会提供，避免图片作者仅因存储中存在某物就描绘被隐藏的物品。

可复用入口为 `@dsh-agentic-roleplay/core/images`。

## 回合集成

每条已交付输出都携带稳定的时间线节点 ID。对话设置可选 `off`、默认的 `manual` 或 `every-turn`，并决定临时场景图只用文本、优先使用已有规范参考图，还是强制要求参考图。强制模式缺少参考图时，会先生成参考图。已有参考图通过 `ImageGenerationOptions.references` 交给提供方。

OpenAI 兼容提供方在有参考图时调用 `/images/edits`，否则调用 `/images/generations`。LocalAI 没有 `/images/edits`，所以 `dsh-ai-localai` 仍调用 `/images/generations`，并根据 `imageReferences` 设置选择 `files`、`ref_images` 或不发送参考图。`files` 会把第一张参考图用于图生图重绘，`ref_images` 供专门支持参考图的模型使用。默认不发送，因为不接受参考图的模型可能在后端失败。

`images.highRes` 为任务请求设置 `ImageGenerationOptions.highRes`。支持的提供方先按请求尺寸生成，再把结果重绘成更大尺寸。LocalAI 会第二次调用 `/images/generations`，把首个结果放入 `files`，按 `imageHighresScale` 放大并把边长取整为 64 的倍数，可选使用 `imageHighresSteps`。这保留构图并增加细节。不支持的提供方会忽略该选项。实际验证中，LocalAI 的 Z-Image Turbo 可把 512 x 512 重绘为 768 x 768。

`ImageJobs` 对每个会话最多运行一个图片作者。更新的节点或回退会取消旧任务。提供方或作者失败不会延迟或使已交付文字失效。状态为 `absent`、`generating`、`ready` 或 `failed`。需鉴权的 HTTP 路由提供状态、开始、重试和不可变 PNG 文件。转录界面只在任务运行时轮询，并提供手工生成、重试和再生成一张。

创建分支时，系统硬链接规范参考图和属于继承时间线节点的场景图，跨文件系统时改为复制。回退只选择另一条时间线路径，不删除文件。

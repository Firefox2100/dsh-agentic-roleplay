# DSH Agentic Roleplay

Persistent, agent-driven roleplay for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). Create a world, choose who to play, and enter an evolving story whose characters can make decisions of their own.

Instead of treating roleplay as one long prompt, the bundle separates the game master, character decisions, record keeping, world authoring, and media work. The story keeps structured state for what happened, what each character perceived and remembers, where people and things are, how relationships change, and which possibilities remain open.

## What makes it different

- **Characters have their own point of view.** They act from their goals, relationships, knowledge, memories, and current situation—not from everything stored in the world.
- **The world changes without becoming a script.** Plots can provide direction and pressure, while player choices and autonomous character actions determine what actually happens.
- **Stories remain editable and durable.** Worlds are filesystem-first, sessions use SQLite, and branching or taking back does not require rebuilding the setting.
- **Your library can follow you between devices.** Optional rclone-based sync moves worlds, stories, prompts and other shared content while detecting conflicts instead of silently overwriting either copy.
- **Creation happens inside DSH.** Build worlds in the editor, ask an authoring agent for help with approval by default, import character cards, and generate portraits or scene illustrations when providers are available.
- **Media is optional.** Text play works without image, speech, embedding, or reranking services; add them when you want portraits, voiced scenes, voice input, or richer recall.

The bundle includes a complete roleplay interface, a bounded game-master loop, autonomous character and faction activity, story-time memory, relationships and knowledge, locations and items, plots and triggers, reusable avatars, world authoring, speech, and image workflows.

This project is independently maintained by [Firefox2100](https://github.com/Firefox2100). It is not an official DeepSeek Harness project.

## Documentation

- [English documentation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/intro)
- [简体中文文档](https://firefox2100.github.io/dsh-agentic-roleplay/zh-Hans/docs/intro)
- [Installation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/getting-started/installation)
- [World authoring](https://firefox2100.github.io/dsh-agentic-roleplay/docs/authoring/overview)
- [Sync between devices](https://firefox2100.github.io/dsh-agentic-roleplay/docs/playing/sync)
- [World format](https://firefox2100.github.io/dsh-agentic-roleplay/docs/world-format/overview)
- [Plugin development](https://firefox2100.github.io/dsh-agentic-roleplay/docs/developers/architecture)
- [Maintainer guide](https://firefox2100.github.io/dsh-agentic-roleplay/docs/maintainers/overview)

## Packages

| Package | Role |
|---|---|
| `@dsh-agentic-roleplay/all` | Installable bundle containing the complete experience. |
| `@dsh-agentic-roleplay/core` | UI, orchestration, authoring, media, and filesystem integration. |
| `@dsh-agentic-roleplay/state` | Standalone DSH service for session databases, repositories, recall, and model-facing record tools. |
| `dsh-roleplay-model` | Private canonical model package, bundled into the published plugins. |

## Installation

Install the complete bundle into a DSH profile:

```bash
dsh plugin --profile <profile> add @dsh-agentic-roleplay/all
```

Restart the profile, then configure the storage root under **Settings → Role Play**. AI features are supplied by compatible provider plugins; see [AI services](https://firefox2100.github.io/dsh-agentic-roleplay/docs/getting-started/ai-services).

New users can add the included *Blackwater Observatory* sample world from the Worlds page, inspect how it is built, and begin a session immediately after configuring a language model.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

Requires Node.js 22 or later and pnpm. See the [maintainer guide](https://firefox2100.github.io/dsh-agentic-roleplay/docs/maintainers/overview) before changing persisted data, the agent loop, prompts, or DSH integration.

## License

[GPL-3.0-only](LICENSE)

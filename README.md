# DSH Agentic Roleplay

Persistent, agent-driven roleplay for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). Create a world, choose who to play, and enter an evolving story whose characters can make decisions of their own.

Instead of treating roleplay as one long prompt, the bundle separates the game master, character decisions, record keeping, world authoring, and media work. The story keeps structured state for what happened, what each character perceived and remembers, where people and things are, how relationships change, and which possibilities remain open.

## What makes it different

- Characters act from their own goals, relationships, knowledge, memories, and current situation rather than everything stored in the world.
- Plots provide direction and pressure without fixing the outcome. Player choices and autonomous character actions determine what happens.
- Worlds are filesystem-first and sessions use SQLite. Checkpoints, branching, readable transcripts, and restorable archives preserve the story without rebuilding its setting.
- Optional rclone-based sync moves worlds, stories, prompts, and other shared content between devices. Conflicts are kept for review instead of silently overwriting either copy.
- World creation stays inside DSH. The editor, approval-based authoring assistant, recoverable card import, card updates, and isolated playtests cover the path from source material to a playable world.
- Media remains optional. Text play does not require image, speech, embedding, or reranking services; providers add portraits, voiced scenes, voice input, and richer recall.

The bundle includes a complete roleplay interface, a bounded game-master loop, autonomous character and faction activity, story-time memory, relationships and knowledge, locations and items, plots, triggers and world-defined commands, reusable avatars, world authoring, speech, and image workflows.

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

# DSH Agentic Roleplay

Persistent, agent-driven roleplay for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). The bundle provides a game-master loop, autonomous character agents, durable world and session state, authoring tools, multimedia services, and a dedicated roleplay interface.

## Documentation

- [English documentation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/intro)
- [简体中文文档](https://firefox2100.github.io/dsh-agentic-roleplay/zh-Hans/docs/intro)
- [Installation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/getting-started/installation)
- [World authoring](https://firefox2100.github.io/dsh-agentic-roleplay/docs/authoring/overview)
- [World format](https://firefox2100.github.io/dsh-agentic-roleplay/docs/world-format/overview)
- [Plugin development](https://firefox2100.github.io/dsh-agentic-roleplay/docs/developers/architecture)
- [Maintainer guide](https://firefox2100.github.io/dsh-agentic-roleplay/docs/maintainers/overview)

## Packages

| Package | Role |
|---|---|
| `dsh-agentic-roleplay` | Installable bundle containing the complete experience. |
| `dsh-agentic-roleplay-core` | UI, orchestration, authoring, media, and filesystem integration. |
| `dsh-roleplay-state` | Standalone DSH service for session databases, repositories, recall, and model-facing record tools. |
| `dsh-roleplay-model` | Private canonical model package, bundled into the published plugins. |

## Installation

Install the complete bundle into a DSH profile:

```bash
dsh plugin --profile <profile> add dsh-agentic-roleplay
```

Restart the profile, then configure the storage root under **Settings → Role Play**. AI features are supplied by compatible provider plugins; see [AI services](https://firefox2100.github.io/dsh-agentic-roleplay/docs/getting-started/ai-services).

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

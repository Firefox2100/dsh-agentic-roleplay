# dsh-agentic-roleplay

An agentic roleplay bundle for DeepSeek Harness.

## Packages

| Package | Role |
|---|---|
| `dsh-agentic-roleplay` | The bundle. Install this one. |
| `dsh-agentic-roleplay-core` | Plugin: roleplay UI, orchestration and storage. |
| `dsh-roleplay-state` | Session state: one SQLite database per session behind repositories. Reusable without DSH. |
| `dsh-roleplay-model` | Canonical data model shared by the packages above. Private; bundled into them, never published. |

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

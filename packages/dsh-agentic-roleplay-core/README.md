# @dsh-agentic-roleplay/core

The UI, orchestration, world authoring, media, and filesystem integration plugin behind DSH Agentic Roleplay.

It provides the game-master loop, autonomous character agents, world and session interfaces, authoring agents and tools, story compaction, speech integration, and image-generation workflows. Session data is provided by [`@dsh-agentic-roleplay/state`](https://www.npmjs.com/package/@dsh-agentic-roleplay/state).

## Install

Most users should install [`@dsh-agentic-roleplay/all`](https://www.npmjs.com/package/@dsh-agentic-roleplay/all). Install this package separately only when assembling a custom DSH profile:

```bash
dsh plugin --profile <profile> add @dsh-agentic-roleplay/state
dsh plugin --profile <profile> add @dsh-agentic-roleplay/core
```

The state package must be installed and enabled first. Installing the core package brings the state package code into the profile, but DSH activates only bundles selected explicitly.

This is an independent community project maintained by Firefox2100, not an official DSH package.

[Documentation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/intro) · [Architecture](https://firefox2100.github.io/dsh-agentic-roleplay/docs/developers/architecture) · [Source](https://github.com/Firefox2100/dsh-agentic-roleplay) · [Issues](https://github.com/Firefox2100/dsh-agentic-roleplay/issues)

Licensed under GPL-3.0-only.

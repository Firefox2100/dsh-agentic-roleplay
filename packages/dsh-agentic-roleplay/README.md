# @dsh-agentic-roleplay/all

The complete persistent, agent-driven roleplay experience for DeepSeek Harness (DSH), maintained by Firefox2100.

Create editable worlds and play stories coordinated by a game master while autonomous character agents act from their own goals, relationships, knowledge, and memories. The bundle preserves locations, items, time, factions, plots, perceptions, and consequences as structured session state rather than relying on one ever-growing chat prompt.

It installs the roleplay UI and orchestration plugin, the persistent state service, and the DSH voice-input components used by the interface. It also provides an approval-gated world-authoring assistant, reusable avatars, branching and take-back, optional speech, portraits, and scene illustrations. AI models and media services are configured separately through [DSH AI Providers](https://firefox2100.github.io/dsh-ai-providers/docs/intro).

## Install

```bash
dsh plugin --profile <profile> add @dsh-agentic-roleplay/all
```

After installation, restart the profile and configure the roleplay storage root under **Settings → Role Play**.

Start with the included *Blackwater Observatory* sample world, or create a world in the editor without leaving DSH. Only a language-model route is required for play; embeddings, reranking, images, TTS, and STT are optional enhancements.

This is an independent community project. It is not an official DSH package and is not maintained or endorsed by the DSH maintainers.

[Documentation](https://firefox2100.github.io/dsh-agentic-roleplay/docs/intro) · [Installation guide](https://firefox2100.github.io/dsh-agentic-roleplay/docs/getting-started/installation) · [Source](https://github.com/Firefox2100/dsh-agentic-roleplay) · [Issues](https://github.com/Firefox2100/dsh-agentic-roleplay/issues)

Licensed under GPL-3.0-only.

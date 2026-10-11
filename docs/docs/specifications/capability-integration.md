---
title: Optional capability integration
description: Exact embedding, reranking, speech, image, model, rules, priority, and concurrency contracts.
---

The bundle needs model capabilities that vanilla DSH does not have: embeddings, reranking,
text-to-speech, speech-to-text and image generation. They come from a separate set of plugins, `dsh-ai-providers`
(`dsh-ai-core` for the contract, `dsh-ai-providers` for the registry, the settings UI and the
configured services, `dsh-ai-<vendor>` for implementations), which put them on the DSH context as
`ctx.embeddings` and so on; this bundle only consumes them, and works without them.

## Consumed today

**Reranking the memories a character is reminded of** (`ctx.rerankers`). Recall retrieves more candidates than it
needs (by cues, words and, with embeddings, meaning; fused), and a reranking service reads the situation with each
candidate and scores it; the best are chosen by that, the fused retrieval score, importance and recency (see
`memory.md`). The core registers this as the memory ranker of the state plugin while a reranking service exists:

```ts
ctx.roleplayState.rankMemories(async ({ situation, candidates, signal }) => {
  // candidates: the over-retrieved pool, { key, text, turn, importance }[];
  // return a Map from key to 0..1, or undefined when there is nothing to judge with
})
```

Another plugin may register its own; the latest registered is used. If it throws, recall carries on by retrieval
alone and the log says why; a cancellation is passed through.

## Embedding for a chat

The chat's settings carry what the selected embedding provider lets a request set (`embedding.options`,
a flat set of values by the provider's own option names), because it is per chat that vectors are
stored and compared. The provider describes its options (`dsh-ai-core`'s `RequestOption`, served by
`GET /ai-api/capabilities`); the chat settings tab shows all of them, and the start dialog's advanced
section only those marked `atStart` (for the OpenAI provider the number of dimensions: vectors of
different sizes cannot be compared, so it is chosen before the first request).

`ctx.embeddings` is used when present (`host/memory/embedding-index.ts`): texts written to the story's
index are embedded in the background as documents, the moment a character acts (and a keyword lookup)
as a query, each with the chat's options. The vectors are stored in the session's database with the
sqlite-vec extension (see `memory.md`), so nothing is cached by the embedding plugin beyond its short
in-flight window. Without the plugin everything works on cues and words.

## Speech and media

- **Text-to-speech.** The transcript can speak a complete delivered message or one character utterance. The complete message is split into narration and utterances, sent concurrently with the configured narration/character voices, and merged in story order. Voice discovery is optional; a manually entered provider voice id remains available for OpenAI-compatible servers such as LocalAI that do not enumerate voices.
- **Speech-to-text.** Completed recordings use DSH's experimental speech-to-text provider contract.
  Realtime transcription is a separate optional `streamingSpeechToText` service; the roleplay host
  feature-detects it through `/roleplay-api/speech/capabilities`. DSH Voice Input owns microphone
  capture and inserts the completed transcript into the existing draft without sending it.

Both are optional lookups. The bundle includes DSH Voice Input and SenseVoice; an enabled API STT
provider registers alongside SenseVoice, while disabling API STT withdraws only that provider.

- **Image generation.** Canonical portraits and transient scene images use the optional provider-neutral image service. Reference-aware OpenAI-compatible drivers use edits when references exist and generations otherwise. See `images.md` for identity, storage, jobs and UI behavior.

## Rules for consuming a capability

- Optional: look it up on use (`ctx.get`), never as a hard `inject`, so the bundle loads without it.
- Fail soft where it only improves a result (ranking), loud where the user asked for it (speaking).
- Per-chat choice where it costs something (a setting next to `memory.*`), off by default if it is slow.

## Language models

The models that agents talk to are served to DSH by the AI providers plugins (a provider that offers `llm` registers routes; one adapter serves them all) instead of DSH's stock adapter. The plugin does not depend on that: it only
hands the controls of its helper agents to whichever service answers (`ctx.aiProviders.policy`, looked up on use), and works unchanged with DSH's own adapter, which ignores them. The controls are the temperature and whether the
helper must answer with a tool call (`sampling.master` 0.7 for the game master's own requests, `sampling.characters` 0.8, `sampling.suggestions` 0.8, `sampling.authoring` 0.4, `sampling.records` 0.1 (record keeper, image author), `sampling.tools` in a chat's settings, all in the settings form except the tool choice; `importTemperature` for imports). Output length and thinking of the import's agents
are `importMaxTokens` and `importReasoning`.

## Sharing a busy resource

When the AI providers plugin limits how many calls a resource serves at once (its Concurrency settings), the roleplay bundle says who is waiting: the characters and a thing the world author makes up in a turn go first, the record keeper, the suggestions, the memory index and scene images made on their own after a turn wait behind them, and a picture or a recording the player asks for goes first again. A turn also does not wait for the previous turn's records before it starts: only what recalls or changes the story does.

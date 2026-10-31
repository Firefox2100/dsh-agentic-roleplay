---
title: Optional capability integration
description: Exact embedding, reranking, speech, image, model, rules, priority, and concurrency contracts.
---

The bundle needs model capabilities that vanilla DSH does not have: embeddings, reranking,
text-to-speech, speech-to-text and image generation. They come from a separate set of plugins, `dsh-ai-providers`
(`@dsh-ai-providers/core` for the contract, `dsh-ai-providers` for the registry, the settings UI and the
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
stored and compared. The provider describes its options (`@dsh-ai-providers/core`'s `RequestOption`, served by
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

Both are optional lookups. DSH Voice Input and SenseVoice are installed separately from the roleplay
bundle, which keeps their exact package versions aligned with DSH. An enabled API STT provider registers
alongside SenseVoice, while disabling API STT withdraws only that provider.

- **Image generation.** Canonical portraits and transient scene images use the optional provider-neutral image service. Reference-aware OpenAI-compatible drivers use edits when references exist and generations otherwise. See `images.md` for identity, storage, jobs and UI behavior.

## Judging with a decision model (`ctx.decisions`)

A decision model answers typed questions about a state in one pass, as probabilities (the AI providers plugin's `DecisionService`). The bundle uses it where a language model's job is a closed yes-or-no judgement, and always as a second path next to the language model, never instead of it. Each such site has a setting in `decisions.*` and four modes:

- `llm` (the default) uses the language model, exactly as without a decision service.
- `decision` uses the decision model alone. A yes needs a probability of at least `(1 + confidence) / 2`; anything less sure counts as no.
- `hybrid` uses the decision model where it is sure (a probability of at least `(1 + confidence) / 2` or at most `(1 - confidence) / 2`) and asks the language model, and only it, about the rest.
- `shadow` asks both, acts on the language model's answer, and records whether the decision model, read the `decision` way, agreed.

The sites are the statements triggers wait on (`decisions.triggers`, one yes-or-no question per statement, all in one request, prompt `roleplay/decide-trigger`) and the check of a belief against what a character took in since (`decisions.reflection`, one question per thing that came after the belief, prompt `roleplay/decide-reflection`; a thing is held to contradict only on an answer the decision model is sure of). The questions' wording is a shipped prompt like any other, so it can be edited per world, preset or story.

Two more sites check what the game master is about to deliver, and are off unless a chat turns one on (`decisions.agency`, `decisions.refusal`; modes `off`, `llm`, `decision`, `hybrid`, `shadow`): that the narration does not give the player's character words, actions, decisions, thoughts or feelings the player's message did not state, and that the output does not step out of the story (a refusal, a warning, a disclaimer, a remark to the player). They are the `outputGate` boundary (`host/decisions/gates.ts`), called from the engine's delivery after the format's own checks; one question each (`roleplay/gate-agency`, `roleplay/gate-refusal`, the same wording for the decision model's question and as the language model's instruction), judged by whichever the mode says. The decision model's answer counts as a fault from `decisions.gateThreshold` (0.5), and a probability up to 0.15 below it is not sure (the language model's to judge in `hybrid`, no fault in `decision`): decision models give a rare fault a low probability even when they see it (measured: faults between 0.3 and 0.9, clean passages below 0.4), so these gates do not use the symmetric `decisions.confidence` of the other two sites. A fault is sent back to the game master as a refusal of `narrate`, sharing the limit of the format's refusals (`MAX_REFUSALS`, two): past it, and for an output a narrator wrote, one corrected for the game master, or an out-of-character turn, the output goes as it is. A check that cannot be made is reported once and never stops the turn.

Two more sites exist only for a decision model: a check the harness did not have, with no language model version to switch between. They are off unless a chat turns them on (`decisions.rules`, `decisions.secrets`; `off` or `on`), and then cost one more call of the decision model in the turn; off, nothing differs from before. Both use `decisions.gateThreshold` and need a decision service: without one nothing is checked, the reason is reported once, and the run is kept in the story's figures. `decisions.rules` is the `ruleCheck` boundary (`host/decisions/extras.ts`, `ruleChecks`), called by the engine when the game master calls `judge_action` with `allowed: true`: one question to the decision model for each rule of the world and of the player (`roleplay/check-rule`), the player's message as its state, in one request. A rule found likely broken makes that call fail once per turn, naming the rules, and the game master judges again; the second judgement stands. `decisions.secrets` goes through the `outputGate`, with the lore the player's character does not know (listed for others only, no knowledge edge to them, at most 16, those whose title the passage names first, 300 characters each; `hiddenFrom`): one question for each fact (`roleplay/gate-secret`) with the passage as state. A fact found given away is sent back as a refusal of `narrate` with the facts named; it is sent back once per turn, so a revelation the story means to make goes through when the game master delivers it again. Measured on 24 labelled cases per site, English and Chinese, at 0.5: Kev-9B missed none of the secrets and raised no false alarm, and missed 3 of 12 rule breaks with one false alarm; Kev-4B missed 2 secrets and 3 rule breaks.

A decision service that is missing, or that fails, never stops a story: the site's judgements go to the language model, and the reason is logged once and kept. The routing is one function (`host/decisions/route.ts`, `routeVerdicts`), shared by the sites. What each site did is added to `decisions.json` beside the story's database (runs, judgements decided, escalated, fallen back, agreed, disagreed, time per path, the latest disagreements), so taking the story back does not change it; `GET /roleplay-api/sessions/decisions?id=` serves it with the state of the service to the chat settings tab.

The decision model is asked at background priority and through the service's own concurrency capability, so a limit on it does not queue it behind language-model work.

## Rules for consuming a capability

- Optional: look it up on use (`ctx.get`), never as a hard `inject`, so the bundle loads without it.
- Fail soft where it only improves a result (ranking), loud where the user asked for it (speaking).
- A second path, not a replacement, where a model is only better in some deployments: the language model stays the default and the fallback, and a switch per site lets a user compare before relying on it.
- Per-chat choice where it costs something (a setting next to `memory.*`), off by default if it is slow.

## Language models

The models that agents talk to are served to DSH by the AI providers plugins (a provider that offers `llm` registers routes; one adapter serves them all) instead of DSH's stock adapter. The plugin does not depend on that: it only
hands the controls of its helper agents to whichever service answers (`ctx.aiProviders.policy`, looked up on use), and works unchanged with DSH's own adapter, which ignores them. The controls are the temperature and whether the
helper must answer with a tool call (`sampling.master` 0.7 for the game master's own requests, `sampling.characters` 0.8, `sampling.suggestions` 0.2, `sampling.authoring` 0.4, `sampling.records` 0.1 (record keeper, image author), `sampling.tools` in a chat's settings; `importTemperature` for import and authoring helpers). Output length, timeout, model and thinking for import and authoring helpers are controlled by `importMaxTokens`, `importTimeoutMinutes`, `importModel` and `importReasoning`. These controls are exposed in the settings forms.

Card classification can optionally use the decision capability before the language model. With `importDecisions: decision`, confident instruction/irrelevant results at `importConfidence` are accepted; uncertain or failed calls fall back to the language model. This is an optimisation, not a requirement: imports work without a decision service.

## Sharing a busy resource

When the AI providers plugin limits how many calls a resource serves at once (its Concurrency settings), the roleplay bundle says who is waiting: the characters and a thing the world author makes up in a turn go first, the record keeper, the suggestions, the memory index and scene images made on their own after a turn wait behind them, and a picture or a recording the player asks for goes first again. A turn also does not wait for the previous turn's records before it starts: only what recalls or changes the story does.

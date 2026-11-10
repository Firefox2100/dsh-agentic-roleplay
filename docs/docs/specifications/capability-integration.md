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

A third gate looks for sentences the narration already told (`decisions.repeats`, modes `off`, `strict`, `llm`, `decision`, `hybrid`, `shadow`; `host/decisions/repeats.ts`). Code finds the candidates first: sentences of at least `decisions.repeatChars` characters that one of the last `decisions.repeatTurns` turns on the story's path (the timeline, never a withdrawn alternative) or an earlier place in the same narration already told, spoken lines left alone because the game master may not change them. Only candidates are asked about (at most six), one question each (`roleplay/gate-repeat`), whether the repeat is meant (a refrain, a catchphrase, a ritual, an echo) or stale filler; the language model answers one request that numbers them. A stale one goes back to the game master through the same refusal budget as the other gates. `strict` skips every model and sends back each candidate: the cheapest, and it refuses repeats that were meant.

One more site looks at the values the story tracks (`decisions.variables`, same modes plus `off`, `llm` by default; a world that declares no values of its own costs nothing): after each turn, one question for each declared value and each person it applies to (the world, and the characters of the scene; the built-in feelings are left to the characters' own answers), whether what happened changed it. The decision model gives all of them in one request; the language model gives them as one structured list. The language model then gives the new value of those that changed, which is applied like any other change (a value outside its bounds is refused and reported). Measured on the benchmark's 23 labelled turns in both languages (40 changes to find; every other tracked value must stay as it was; three runs on the 35B with the shipped prompts), the language model found 95-97% of the changes with 93% precision, and every new value it gave was the right one. The decision model (Kev-9B) alone, and `hybrid`, which leaves it nearly all the questions, found 95% of the changes but also moved an unrelated value in about one turn of three (precision about 0.70: a knife fight tired the fighter, a speech tired the speaker): the probabilities it gives to values that changed (0.65 to 0.96) and to values that did not (up to 0.93) overlap, so no threshold separates them (at 0.9, where precision becomes acceptable, recall falls to about a third). That is why the language model is the default for this site and the other modes are not recommended with a decision model of that size. The new values are asked for in an answer schema that types each changed key by what the value is; with a free choice of types the model sometimes wrote a number as text and the story refused it. A value's update rule should say when and how it changes. In an earlier measurement, the language model invented a change in 10 of 120 judgements when told only what a value measures, and in none when the rule also said when and how it changes. The game master that was asked for a value inside a turn left it out in the live runs, which is why the questions are asked after it.

A scene picture made on its own can be replaced by a stored one (`decisions.reuse`, off by default, decision model only). Close stored pictures are found by words and meaning, then put to the decision model with their descriptions. The first picture that shows the moment is displayed again, so no new image is generated. In a benchmark of 12 moments, 8 had a fitting stored picture. The decision model found all 8 without choosing a wrong picture; the language model reading the same text found 4 and also chose none incorrectly. This result is why reuse uses the decision model rather than leaving the image presenter to judge candidates. A yes needs `decisions.reuseThreshold` (0.85), higher than the gates' cut because a wrong picture shown again is worse than a new one: on 72 asks of a 9B decision model, 0.5 chose a wrong first picture 6 times with precision 0.81, 0.8 to 0.9 never, and 0.93 found only 45% of the fitting ones.

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

## Models that share memory

The optional `offload` setting names groups of roles (`main`, `embedding`, `reranker`, `decision`, `image`, `speech`) that must not stay loaded together, and where each role other than `main` is served (a language model route of the AI providers plugin and the model's name there; `main` is the chat's own model). The roleplay plugin asks `ctx.aiModels` (looked up on use; its `status` and `unload` operations, which LocalAI and Ollama routes offer) to unload the other models of a group before a model of that role is used: the game master's and every helper's steps (`agent/pre-step`) for `main`, and the calls to `ctx.embeddings`, `ctx.rerankers`, `ctx.decisions`, `ctx.imageGeneration` and `ctx.textToSpeech` for the others. Nothing is loaded by this: the server loads a model when it is next asked. One role is remembered as possibly resident until it is unloaded or another has displaced it, so repeated use costs no calls; at the start every role counts as possibly resident and is checked with `status` before it is unloaded. Switches are serialised, and a model is not unloaded while a call that uses it is running (a request that meets a model being shut down fails): the switch waits for those calls. The check `status` can fail for a backend that cannot report it (llama.cpp on LocalAI): the model is then unloaded anyway. Helper agents (characters, the record keeper, the image presenter) make their own steps, so the story's model is made ready before each of those as well. A scene image made on its own after a turn waits for the chat's background work before it is made when images and the story model share a group. A failure to unload is reported once and never stops a turn.

## Sharing a busy resource

When the AI providers plugin limits how many calls a resource serves at once (its Concurrency settings), the roleplay bundle says who is waiting: the characters and a thing the world author makes up in a turn go first, the record keeper, the suggestions, the memory index and scene images made on their own after a turn wait behind them, and a picture or a recording the player asks for goes first again. A turn also does not wait for the previous turn's records before it starts: only what recalls or changes the story does.

## Observability

When the AI providers plugin's observability is switched on (its Observability settings; off by default), every model and capability call is recorded, and the bundle files them under the story. Each turn is one trace (named `turn N`) whose Langfuse session is the story's id; the game master's requests and every helper the turn starts (characters, record keeper, world author, suggester, chronicler and the rest) nest under it, each helper with its persona's first line as its name, its prompt as input, its result as output, and its model requests below it. A helper that runs with no turn around it (an autonomy tick, a background job after the turn ended) is a trace of its own under the same session. Each round of characters is a span of the turn (named `round`, with the characters asked as input and what they decided as output); the trace's own input is the player's message and its output is what the player was shown. An autonomy look that moved someone or ended with a message (or a refusal by the decision model) is a trace named `autonomy look` under the same session; quiet looks are not recorded. The bundle looks the tracer up on use (`ctx.get('aiTrace')`) and does nothing without it, so it still installs alone.

Traces hold the whole text of what the models were given, including a story's secrets and what a character read from a file: send them only to a server you run yourself.

The benchmark can write each row run's verdicts to a Langfuse server as scores on the story's session (`BENCH_LANGFUSE_HOST`, `BENCH_LANGFUSE_PUBLIC_KEY`, `BENCH_LANGFUSE_SECRET_KEY`): one `bench.row` score (the share of expectations that held) and one `bench.<kind>` score per kind of expectation.

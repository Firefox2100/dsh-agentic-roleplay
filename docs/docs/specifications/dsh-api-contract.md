---
title: DSH API contract
description: Exact host and browser services, private composition boundary, lifecycle operations, and upgrade checks.
---

DSH is pre-stable: its own rule is that public APIs may change between releases and every
consumer is updated with them. So the aim here is not an API that never changes but one
where an upgrade is mechanical: only what DSH exports from a package root and documents is
used, never a deep path (`.../src/*`), never an internal event, and every use is listed
below so it can be checked when DSH moves.

## Host (the plugins)

| Use | API | Where |
|---|---|---|
| Plugins, services | `Context`, `Service`, `ctx.inject`, `ctx.effect`, `ctx.provide` (cordis) | everywhere |
| Configuration | Schemastery `Config`, volatile fields, `loader/volatile-update` | `index.ts`, `host/config.ts` |
| Browser HTTP API | `ctx.webServer.register`, `ctx.connection.requestRejection` | `host/http/` |
| Profile's selected bundles (the duplicate-layer warning) | `DSH_PROFILE_DIR` (an environment fact) and the profile's own `package.json`, read only; DSH exposes no service for a profile's bundle list | `host/setup/rows.ts` |
| The chat of a session | `ctx.sessionController.create/rename`, `ctx.workspaceRegistry.create/archiveSession`, `workspace.attachSession`, `ctx.sessionPersistence` | `host/agent/` |
| Agent presets | the `@deepseek-ai/dsh-agent-preset` row with `plugins` (persona, our two plugins, a `compaction` group) | the bundle's `cordis.patch.yml` |
| Game master tools | `ctx.tools.register(defineTool(...), { when })` | `host/orchestration/tools.ts`, `@dsh-agentic-roleplay/state` |
| Prompt | `ctx.systemPrompt.section` | `orchestration.ts` |
| Prompt | `ctx.systemPrompt.suppressRuntimeContext`, `ctx.systemPrompt.context` | `helper.ts` |
| Prompt, scoped | `ctx.systemPrompt.section`/`context` registered in a preset's scope shadows the profile's contribution of the same name (empty text contributes nothing), which is how the presets keep the Web bundle's orientation text out of story prompts | `host/prompts/dev-context.ts` |
| Commands | `ctx.commands.register` (in a preset's plugin for a preset's agents), `agent.ctx.inject(['commands'], ...)` at `agent/created` (for one chat's agent), `agent.followup`, `ctx.commands.execute`/`find` with `parseCommand` (to run a line of the plugin's own from outside the input box), a name in DSH's alphabet (`[a-z][a-z0-9_-]*`) with a non-empty input hint | `host/commands/registry.ts`, `host/orchestration/player-commands.ts`, `host/checks/commands.ts`, `host/import/tools.ts` |
| Unloading a chat's agent | `ReactLoopAgent.scope` (`@deepseek-ai/dsh-agent-loop`), whose `Scope.rawDispose`/`dispose` (`@deepseek-ai/dsh-scope`) unwinds the agent's registrations; `agent/disposed` says when it has left the registry. DSH gives a caller a dispose handle only for an agent it started itself, and a chat started by the web app is not that, so this is how a replacement chat is made | `host/agent/agent-sessions.ts` |
| Turn control | `agent/pre-step` (waterfall), `agent/turn-stopping`, `agent.steer`, `exec.concludeTurn()`, `exec.agent`, `exec.signal` | `host/orchestration/hooks.ts`, `tools.ts` |
| Authoring model choice | `agent.model.current()`, `agent.model.select()` from `agent/created` | `host/authoring/turn-guard.ts` |
| Chronicler (no tools of its own) | a `runChild` child with a `submit_result` of its own (below) | `compaction/chronicler.ts` |
| Characters and record keeper (tools of their own) | **not the model-facing `subagent` tool**: the public `ctx.subagents.startActivation()` service method, with a `submit_result` tool of the child's own (see below) | `agents/child.ts` |
| Message source | merge into `MessageSourceMap` (`roleplay`) | `hooks.ts` |
| Looking up an agent | `ctx.agents.get` | `orchestration.ts` |
| Compaction | `BasicCompactionEngine` (`@deepseek-ai/dsh-compaction-basic`, default export): its documented sole hook `summarize()` and `compactRegion()`; `ctx.tokenMeter.measure(session)`; `session.surface.nodes`; `session.snapshotEvents()`; `session.header.origin` | `host/compaction/` |
| Session events | reading `turn/start`, `user/message`, `tool/result` events; writing the opening turn through `Session.create` and `ctx.sessionPersistence` | `compaction/range.ts`, `agent/opening.ts` |

## Text from outside the input box

A line typed into the input box runs whatever command is registered for that agent, DSH's own
included (`/compact`, `/goal`, `/feedback`). Text that arrives another way — the plugin's HTTP API, a
benchmark script, a playtest — is narrower: `AgentSessions.send` runs a slash line only when the name
resolves, for that chat's agent, to a handler this plugin registered (a player command, or one the
world defines), and sends anything else to the model as a message. The check is `parseCommand` plus
`ctx.commands.find` plus the handler's identity, so a later DSH release adding a built-in command
cannot change what a story's API does.

## Browser (the client plugins)

`ctx.slots` (`settings.section`, `sidebar.panellist`, `main` panels, `conversation.chat.node`,
`conversation.view`), `ctx.locale`, `ctx.configForms`, `ctx.uiConversation` (events and views),
and `uiWorkspace.openSession`. The client bundle format is the shell's module loader, checked by
`tsdown.config.ts`.

Snapshot stores are the plugin's own (`src/client/store.ts`). A `hooks` source and a `store`
registration only need the `getSnapshot`/`subscribe` pair, so the plugin never requires the shell's
store package: it is absent from `SHELL_MODULES`, and the bundle boundary rejects a runtime import.
`@deepseek-ai/dsh-client-store` stays a devDependency for types only. The slot typings name its
`PropsStore`/`StoreHandle` shapes, and losing the package makes every slot prop fall back to `any`.
Nothing imports it at runtime, so it is still erased from the bundle.

**The controls are the plugin's own copy.** The practices forbid loading a Harness Client package as
a module. If one changes between releases or throws, it blanks the slot entry. The practices allow a
copy under the plugin's own class prefix that keeps only `--dsw-alias-*` tokens. That copy is
`src/client/ui/`: `Button`, `Input`, `Switch`, `SegmentedControl`, `Modal`, `Tooltip`, `Tag`, `Toast`,
`ImageLightbox`, the settings form frame and its value field (`SettingsForm`, `SettingsValueField`,
`settings-form.ts`), and the outline icons the plugin draws. Behavior the shell got for free is kept by
the copy: the modal traps focus, closes on Escape and restores the trigger's focus; the switch is
`role="switch"` with `aria-checked`; the segmented control walks its tabs with the arrow keys; a tooltip
flips and clamps to the viewport. `@deepseek-ai/dsh-client-ui-primitives` is no longer a dependency and
not in `SHELL_MODULES`, so a runtime import of it now fails the bundle boundary check.

The two pieces of that copy with logic worth testing are plain functions, free of React and of the DOM:
`src/client/ui/place.ts` (which side a bubble lands on, when it flips and how it clamps) and
`src/client/ui/walk.ts` (which segment a tablist key moves to). `tests/client/ui/place.spec.ts` covers
both, so a behavior change there is caught without a browser.

One element is put outside the plugin's own components: an interface pack's backdrop layer, inserted as the first
child of the conversation body, with that body's scrolling element marked so it is lifted over the layer. The chat
paints its own background and offers no slot behind it, so a backdrop cannot be rendered from the plugin's subtree;
the scrolling element's class is read and checked by `tests/support/dsh-contract.spec.ts`. The lift rule and a pack's
own skin are `<style>` elements the dock component renders, not nodes appended to the document by hand.

## Helper agents

Characters, the record keeper, the world author, the faction strategist and the other one-shot helpers are *children with tools of their own*: a tool built around
Alice's memory must give Bob's agent, running at the same time, nothing of it, and a child ends by calling a `submit_result` tool after looping (so it can read, write,
check and fix). `host/agents/child.ts` (`runChild`) does this through public API only:

- **Start.** `ctx.get('subagents').startActivation({ provider: 'spawn', childId, delivery: 'caller', request: { parent, agentPreset: 'roleplay-helper', agentOptions, prompt } })`.
  The caller reserves the child's session id (`childId`) first, so what it needs to hand the child is registered under that id before the child exists. (`parent.ctx.subagents`
  throws without an `inject` on the owning plugin; `ctx.get('subagents')` does not.)
- **The preset.** `roleplay-helper` is a `@deepseek-ai/dsh-agent-preset` row in the bundle's patch (so a standalone core install has no helpers). It mounts the `core/helper`
  plugin, which gives the child its persona (a system-prompt section read by session id) and, on the public `agent/created` event, calls the child's `setup`. A preset is shared by
  every agent that uses it, so nothing per child lives in the plugin: it is looked up by the child's session id.
- **The harness' own orientation text.** The Web bundle's `harness-dev-context` plugin tells every agent where the DSH checkout is and what "this page" is: noise in a
  story prompt, and this machine's paths in the turn. `SystemPrompt` resolves a contribution by name at the nearest scope, so each preset registers `harness:source`
  and `app:web-surface` again with empty text in its own scope (`host/prompts/dev-context.ts`). The plugin keeps its profile-wide row, so every other session in the
  profile still reads that orientation; only the story's agents do not.
- **Tools of its own.** A spawned child inherits every global tool (the story's readers, DSH's working directory), so `setup` first calls `agent.ctx.tools.restrict({ allow })`
  (`allow` is only the external tools the task lets through), then registers the child's tools on `agent.ctx`, which `restrict` never touches. The `submit_result` tool, the call
  budget, the repeated-call guard and the reminders are registered the same way.
- **Costs.** Each run adds a `subagent/catalog` event to the game master's log (a few hundred bytes, also after the turn ended, so the last event of a finished turn is not always
  `turn/end`). DSH admits at most `maxActiveSubagents` children of one parent at once (default 8) and refuses the rest, so the bundle patch raises it to 32 for a round of
  characters plus the keeper, author and suggestions.
- **Tested release, ranged dependencies.** The packages declare DSH `>=0.2.2-rc.1 <0.2.3` (`engines.dsh` and the peer dependency), and the DSH sub-packages in
  `devDependencies` and the workspace override use that same range rather than one exact release, so upgrading DSH pulls them along instead of leaving them behind.
  `scripts/dsh-compat.mjs` is the one list these are derived from, and it also records the releases that were verified (`DSH_RELEASES`):
  `tests/support/dsh-contract.spec.ts` fails while the installed release is not on that list. Supporting a later patch tuple therefore means inspecting its changes,
  porting every affected integration, testing against that release, and only then adding it to `DSH_RELEASES` and widening the range.
- **Tool executor.** From 0.2.2 `dsh-tools` runs nothing by itself: a deployment mounts an executor (`dsh-base` mounts the native one), and a test that mounts the tool service mounts `@deepseek-ai/dsh-tool-executor-native` beside it. `ctx.tools.execute` takes a batch of calls.
- **Model selection.** DSH fixes the provider, model and reasoning effort before `agent/request`. Authoring presets therefore validate their configured effort when the agent is created and record it with `agent.model.select()`. They do not rewrite the deprecated request hook.
- **When DSH changes**, re-read `docs/subsystems/subagent.md` and port `runChild` to match; the real-loop tests in `tests/host/orchestration/loop.spec.ts` mount the helper
  plugin through a stand-in `agentPresets` service.

## Taking the story back, putting sessions away, deleting them

- **Replace markers.** `Session.append('user/message', ..., { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs })` over a stretch of the model's
  conversation (the public append, as DSH's own compaction does it) keeps turns out of the next request, and `surfaceOp: 'append'` adds a notice. It is accepted over a
  middle range with newer turns after it, and also inside the first step of the next turn. DSH's Chat view does not hide the rows it replaced, so the client leaves them out
  itself (`TurnsDock`, by the key DSH gives each row). Shadowed turns never come back to the conversation: going forward again is told as a notice.
- **`session/event`** (a public event) tells when a turn ends, which fixes where it stands in the log.
- **Branches.** `ctx.sessions.fork({ sessionId, atSeq, increaseTitle })` on the client (`ISessions`, the same call DSH's own branch button makes) makes the chat; on the host the
  public `agent/created` event (serial, awaited before creation resolves) carries the new agent, whose header has `isSeeded`, `parentSession` and whose session has
  `inheritedEventCount` (the cut is one before it), so the roleplay session is made before the chat is first used, and a failure refuses the fork.
- **Archive and restore** are DSH's own `workspaceRegistry.archiveSession` (with `stopActivity`) and `unarchiveSession`.
- **Deleting a chat for good is not an API of DSH.** `host/agent/purge.ts` removes the folders DSH keeps (`<store>/--<project>--/<session id>/`, one for the chat and one for each
  sub-agent session it started, found through `origin: 'subagent'` and `parentSession` in `sessionPersistence.list()`) after stopping the chat and flushing it, naming the
  folders as DSH's JSONL store does (`projectKey`, `encodeSegment`), and refusing a folder that is a link, is not named as the session, or holds no log. Its location is the
  config `sessionStorePath` (default `~/.dsh/sessions`). DSH keeps the id in its workspace accounting and its projection cache (stock DSH has no way to forget it; a cache that
  has `delete` is told); the leftover is not listed or read again (verified live). It emits `api-session/removed`, the event DSH's own controller emits. A change of the store
  layout in DSH would show first in `tests/host/agent/purge.spec.ts` and in a live delete.

## Prompts, language and messages sent for the person

- **System prompt sections** (`ctx.systemPrompt.section`) take a `text` provider `(context) => string` evaluated at each assembly; `context.agent` (an `AssembleContext` merge from `dsh-agent`) is the agent being assembled, so a section can follow the chat's language. A preset's `dsh-persona` row with `prefix: ''` shadows the deployment persona and then disappears at render, which leaves the persona section to us. `{{...}}` in a section is read as a prompt variable unless the section sets `interpolate: false`; the prompt files avoid it either way.
- **Runtime context** (`ctx.systemPrompt.suppressRuntimeContext`, `ctx.systemPrompt.context`): DSH adds a block of English runtime facts to every agent's request (the working directory, the file policy, approvals, delegation). The helper preset suppresses the optional ones and shadows the required working-directory entry with an empty one, because a helper works on the story's words and has no files. With the block, a helper asked to write Chinese often ran on until its output limit (a recorded reflection request replayed on the 35B with thinking off: one of four runs finished with the block, four of four without it).
- **`sessionController.prompt(request, signal)`** needs the `AbortSignal` (without it the call fails inside DSH with `throwIfAborted` of undefined). It sends ordinary plugin-authored messages into chats. Slash commands go through `ctx.commands.execute` instead.
- **A stored chat that starts with an opening** needs an empty `system/message` appended with `surfaceOp: 'append'` before any other surface node: the log format refuses a system prompt that follows other nodes.

## What we deliberately do not use

These are DSH services that look applicable and are not, so a later review does not have to work it out again:

- **Session projections (`ctx.sessionProjections`).** A projection folds the session log into state DSH pushes with the chat. The story lives in the session's SQLite (records, memories, timeline), not in the log, so a projection cannot carry it. The browser reads the values it needs from `/roleplay-api`.
- **The `/api` typert RPC surface.** A third-party service there needs a declared contract and generated client bindings. `/roleplay-api` registers through `webServer.register` and sits behind the same authenticated connection and `connection.requestRejection` fence; the browser never reaches it without the session's credentials.

## When upgrading DSH

Two checks run before anyone reads a guide. `tests/support/dsh-contract.spec.ts` reads the installed
declarations and fails naming the symbol that moved: `ctx.subagents.startActivation()`, `ctx.tokenMeter`,
`SessionSurface.nodes`, the `BasicCompactionEngine` export, the slot typings still coming from
`@deepseek-ai/dsh-client-store`, the conversation body's scrolling class, and the installed release being
one of `DSH_RELEASES`. `pnpm release:check` then reads the built bundles: the client bundle must keep the
shell's module format (`window.__ModuleLoader__.load({ id, ... })`) and may require only `react`,
`react/jsx-runtime`, `react-dom` and `@deepseek-ai/dsh-client-ui-slots`, and it must not mention the
primitives or the shell's store; the host bundle must leave the private model package inlined and must not
import a client package.

Then read the upgrade guides, and check each row above: typecheck first (the types are the
contract), then the real-loop tests in `tests/host/orchestration/loop.spec.ts`, which run the
actual agent loop, sub-agents, tool registry and compaction with a scripted model.

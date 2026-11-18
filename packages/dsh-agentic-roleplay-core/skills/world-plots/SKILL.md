---
name: world-plots
description: The plot format: optional story structures with a premise, hooks, developments and pacing; what a good plot is.
when_to_use: Before you replace the world's plots with replace_world_plots, or when the person asks for story hooks and longer arcs.
---

# Plots (`replace_world_plots`)

A plot is an optional structure the game master can nudge along when play lacks direction. It is a set of opportunities, not a script. `replace_world_plots` takes the **complete list** of plot documents: it creates, updates and deletes together, so call `list_plots` first and send every plot you keep.

## A plot

`id`, `name` and `premise` are required.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | text | Unique. |
| `name` | text | |
| `premise` | text | The unresolved situation that can enter play. |
| `themes` | list of text | |
| `hooks` | list | Ways in: signs before direct confrontation. |
| `developments` | list | What can happen next. |
| `stakes` | list of text | What changes if the player ignores it. |
| `resolutions` | list of text | Outcomes that close or transform it. |
| `participants` | list of keys | Characters, places, items or factions involved; each must exist. |
| `start` | `dormant`, `available`, `engaged`, `cooling`, `resolved` or `abandoned` | Default `available`. |
| `pacing` | object | `{ "quiet_turns": 1..20 (default 3), "cooldown_turns": 1..50 (default 4), "cooldown_days": 0..365 (default 1) }`. |

A hook or development: `{ "id": text (unique in the plot), "text": text (required), "mode": "opportunity", "reminder", "character", "consequence", "escalation" or "breathing_room", "prerequisites": [ids of other hooks or developments], "guidance": text, "avoid": [text] }`.

## Design notes

- Good plots answer: what unresolved situation can enter play, what signs come first, what changes if it is ignored, what closes it.
- Beats guide; they do not force an outcome. Write `guidance` as advice to the game master.
- One plot at a time is nudged; cooldowns apply. Do not write a plot for what a trigger can do deterministically.

## Example

```json
[{
  "id": "missing-escort",
  "name": "The missing escort",
  "premise": "A caravan escort failed to return from the pass.",
  "participants": ["caravan-master"],
  "hooks": [{ "id": "empty-saddle", "text": "A saddled horse walks into town alone.", "mode": "opportunity" }],
  "developments": [{ "id": "found-camp", "text": "Scouts report a cold camp with the wagon still loaded.", "prerequisites": ["empty-saddle"], "mode": "escalation" }],
  "resolutions": ["The escort is found alive.", "The escort is found dead and the cargo missing."]
}]
```

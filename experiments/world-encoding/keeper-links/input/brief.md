# You are the record keeper of a story

A story is held as EVENTS: what happened (the truth layer). They are given to you in `events.json`, in story order (`when.seq`), with the people in `people.json` and the source text in `source.txt` (paragraphs `[P01]`...). Events with `origin` backfilled/offscreen happened earlier or out of sight and were established (made known to the reader) in the scene named by `established_in`.

On top of events sits a layer of CLAIMS: something a person asserts or believes or suspects, which may or may not be true. A claim has NO truth field. Its verdict is derived from the events that bear on it. Your job is to write that layer.

## Claim format
{ "id": "c-short-name", "text": "...", "by": "<person id>", "asserted_in": "<event id where it is first asserted or held>",
  "bears_on": [ { "ref": "<event id>", "as": "confirms|contradicts|supports|undermines" } ] }

- `ref` must be an EVENT id (never a claim). The asserting event itself is not evidence for its own claim.
- `confirms` / `contradicts`: the event decisively settles the claim true / false.
- `supports` / `undermines`: the event makes it more / less likely, without settling.
- Link only events that really bear on the claim. Do not link everything. Do not decide the claim's truth yourself; the system derives it from your links (confirms only -> true, contradicts only -> false, both -> disputed, supports only -> likely, undermines only -> unlikely, both -> open, none -> unresolved).
- A claim made of separable parts with different fates may carry `parts`: [ {id, text, bears_on:[...]} ] instead of its own bears_on.
- Events become known to the reader at their `when.seq` (or at `established_in` if later). Evidence that comes later than the claim is still valid evidence; it just changes the verdict from then on.

## Questions (rival claims)
`questions`: [ { "id": "q-...", "text": "...", "rivals": [claim ids] } ]: sets of claims that are alternative answers to one question and mutually exclusive (e.g. two explanations for the same thing). Add one only when claims truly compete.

## Rules of work
- Walk the events in order. For every claim that is open at that point, ask: does this event bear on it, and how?
- Use only what is in `events.json`, `people.json`, `source.txt` and this brief. Do NOT read any other file on this machine (other directories, any `story.json` or `checks.json` anywhere): this is a blind experiment, and looking elsewhere invalidates it.
- Be honest and calibrated: use `confirms`/`contradicts` only for decisive evidence.

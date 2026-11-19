---
name: world-calendar
description: The calendar.json format and the day tokens used by holidays, routines and time conditions.
when_to_use: Before you change or replace the world's calendar with write_world_file or update_world_file (kind calendar), and whenever you write an "on" list in a routine, holiday or time condition.
---

# Calendar and day tokens (`write_world_file`, kind `calendar`)

`calendar.json` names holidays and chooses the hemisphere that defines seasons: `{ "hemisphere": "north" or "south", "holidays": [...] }`. Without it seasons follow the northern hemisphere and there are no named holidays.

A holiday: `{ "id": letters, digits, hyphens and underscores, unique, "name": text, "on": [day tokens] }`. At most 60 holidays. A holiday cannot be defined by another holiday.

## Day tokens

Used in a holiday's `on`, a character routine's `on` and a time trigger's `on`:

| Token | Meaning |
| --- | --- |
| `mon` to `sun` | A weekday |
| `jan` to `dec` | A whole month |
| `12-24` | That date every year |
| `1912-05-14` | That date once |
| `12-20..01-05` | An annual span, including across New Year |
| `1912-05-14..1912-05-15` | A one-time span |
| `dom:1`, `dom:last` | A numbered or final day of the month |
| `nth:mon:1`, `nth:fri:last` | An occurrence of a weekday in the month |
| `season:winter` | A season, by `hemisphere` |
| `holiday:founders-day` | A holiday this world declares (not inside a holiday definition) |
| `!12-25` | Exclude a matching day |

Positive entries are alternatives: one must match. Any matching `!` entry excludes the day. An empty `on` list allows every day. With `days` as well, both must allow the date.

## Example

```json
{
  "hemisphere": "north",
  "holidays": [
    { "id": "founders-day", "name": "Founder's Day", "on": ["05-14"] },
    { "id": "winter-market", "name": "Winter Market", "on": ["nth:fri:last"] }
  ]
}
```

# Ledger: The Story of an Hour

A single room and about an hour. Most of the story is one woman's changing feeling, told by a narrator who can see inside her; the other characters never share that knowledge, and the one fact that ends the story is withheld until the last paragraphs.

Each row is a unit of the source (a sentence or a clause group, `P<paragraph>.<n>`), with how the v1 encoding (current formats), the draft encoding (first evolved model, `draft/story.json`) and the v2 encoding (`v2/story.json`) hold it. `turn T rR` names the event of `v1/history.json` with that turn and round; `eNN`, `sNN`, `c-...`, `h-...`, `r-...` are ids in the draft or v2 story.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v1 (59) | 13 | 36 | 6 | 4 |
| draft (59) | 42 | 14 | 0 | 3 |
| v2 (59) | 41 | 14 | 0 | 4 |

| Ref | Source (abridged) | v1 | v1 where | draft | draft where | v2 | v2 where | Note |
|---|---|---|---|---|---|---|---|---|
| P01.1 | Knowing that Mrs. Mallard was afflicted with a heart trouble | S | lore louise-heart-trouble (text); no health field on a character | E | facts f-heart + states health | E | s01 + states health |  |
| P01.1 | great care was taken to break to her as gently as possible the news of her husband's death | S | richards intent (agenda); the manner is in the event text of turn 2 | E | event e07 manner; e05 intent | E | event e07 manner; e05 intent | Who took the care is not stated; draft keeps it as manner on the telling event. |
| P02.1 | It was her sister Josephine who told her, in broken sentences; veiled hints... | S | turn 2 r1 (the manner is in its text) | E | e07 who josephine/louise, manner | E | e07 who josephine/louise, manner |  |
| P02.2 | Her husband's friend Richards was there, too, near her. | E | turn 2 r1 perceived_by richards; relationship richards->brently 'friend' | E | e07 who richards witness | E | e07 who richards witness |  |
| P02.3 | It was he who had been in the newspaper office when intelligence of the railroad disaster was received, with Brently Mallard's name leading the list of 'killed.' | E | turn 1 r2 with item list-of-killed; place newspaper-office | E | e03 + thing list-of-killed (carries f-list) | E | e03 + thing list-of-killed (carries e03) |  |
| P02.3 | (told after the scene it precedes) | P | v1 stores events in story order only; the telling order is not kept | E | telling s02 order analepsis | P | telling: projection, not stored (the turn order is the telling) | Telling order is a draft field; v1 cannot say a thing was told late. |
| P02.4 | He had only taken the time to assure himself of its truth by a second telegram | E | turn 1 r3, item second-telegram | E | e04 + thing second-telegram | E | e04 + thing second-telegram |  |
| P02.4 | ...and had hastened to forestall any less careful, less tender friend in bearing the sad message. | S | richards intent name; the 'less careful friend' only exists in that text; move richards -> house | S | e05 intent text | S | e05 intent text | A hypothetical person who might have told her first is not an entity in either model. |
| P03.1 | She did not hear the story as many women have heard the same, with a paralyzed inability to accept its significance. | N | - | S | e08 note | S | e08 note | A comparison with 'many women' is neither an event nor a state. |
| P03.2 | She wept at once, with sudden, wild abandonment, in her sister's arms. | E | turn 2 r2 | E | e08 feeling, who louise/josephine | E | e08 feeling, who louise/josephine |  |
| P03.3 | When the storm of grief had spent itself she went away to her room alone. | S | turn 2 r3 + move; how long the grief lasted is not stored | E | e09 depart; state feeling grief e08..e12 | E | e09 depart; state feeling grief e08..e12 |  |
| P03.4 | She would have no one follow her. | S | turn 2 r3 text | S | e09 text | S | e09 text | An intention about others' behaviour; no field for a wish. |
| P04.1 | There stood, facing the open window, a comfortable, roomy armchair. | S | feature armchair of louise-room; 'facing the open window' is in its description | E | things armchair in louise-room | E | things armchair in louise-room |  |
| P04.2 | Into this she sank, pressed down by a physical exhaustion that haunted her body and seemed to reach into her soul. | S | turn 3 r1; exhaustion only in text and inner_state | E | e10; states body exhaustion e10..e13 | E | e10; states body exhaustion e10..e13 |  |
| P05.1 | She could see in the open square before her house the tops of trees that were all aquiver with the new spring life. | E | turn 3 r2 perceived witnessed | E | e11 perceive | E | e11 perceive |  |
| P05.1 | (new spring) | N | - | S | e11 when.approx spring | S | e11 when.approx spring | No season or date: starting_time must be an instant, so the model invents one. |
| P05.2 | The delicious breath of rain was in the air. | S | turn 3 r2 text | S | e11 text | S | e11 text | Smell and weather are perceptions with content; not world state of the place. |
| P05.3 | In the street below a peddler was crying his wares. | S | turn 3 r3 heard; the peddler is not a character | E | e11 who peddler source; people peddler | E | e11 who peddler source; people peddler |  |
| P05.4 | The notes of a distant song which some one was singing reached her faintly | S | turn 3 r3 heard | E | e11 who singer source | E | e11 who singer source |  |
| P05.5 | countless sparrows were twittering in the eaves | S | turn 3 r3 text | S | e11 text | S | e11 text |  |
| P05.6 | patches of blue sky ... in the west | S | turn 3 r2 text | S | e11 text | S | e11 text |  |
| P06.1 | She sat with her head thrown back upon the cushion ... quite motionless, except when a sob came up | S | turn 3 r4; public_state | E | e12 state spanning e12..e13 | E | e12 state spanning e12..e13 |  |
| P06.1 | as a child who has cried itself to sleep continues to sob in its dreams | P | - | P | - | P | - | A simile: voice, not world. |
| P07.1 | She was young, with a fair, calm face, whose lines bespoke repression and even a certain strength. | S | character appearance and summary; 'repression' as a reading of a face is in text | E | states appearance | E | states appearance |  |
| P07.2 | But now there was a dull stare in her eyes, whose gaze was fixed away off yonder on one of those patches of blue sky. | S | turn 3 r4 text | E | e12 text; state appearance | E | e12 text; state appearance |  |
| P07.3 | It was not a glance of reflection, but rather indicated a suspension of intelligent thought. | S | inner_state text | S | e12 text | S | e12 text | The narrator's reading of her mind. |
| P08.1 | There was something coming to her and she was waiting for it, fearfully. | S | turn 3 r5 text and inner_state | E | state feeling 'fearful waiting' e12..e13 | E | state feeling 'fearful waiting' e12..e13 |  |
| P08.2 | What was it? She did not know; it was too subtle and elusive to name. | N | - | S | state value text | S | state value text | A character not knowing what she feels is not a knowledge edge. |
| P08.3 | But she felt it, creeping out of the sky, reaching toward her through the sounds, the scents, the color | P | - | P | - | P | - | Figurative description of a feeling. |
| P09.1 | Now her bosom rose and fell tumultuously. She was beginning to recognize this thing ... striving to beat it back with her will | S | turn 3 r5 text | S | e13 text | S | e13 text | A struggle inside one event; no sub-steps. |
| P09.2 | When she abandoned herself a little whispered word escaped her... 'free, free, free!' | E | turn 3 r5 text; its content | E | e13 feeling / speech | E | e13 feeling / speech | Whispered to herself; nobody perceives it. |
| P09.3 | The vacant stare and the look of terror ... went from her eyes. They stayed keen and bright. Her pulses beat fast | S | public_state replaced (the old one is lost) | E | states feeling joy e13..e21 | E | states feeling joy e13..e21 |  |
| P09.4 | She did not stop to ask if it were or were not a monstrous joy that held her. | N | - | S | reading r-joy | S | reading r-joy | A thing she did not do, and a social judgement she sets aside. |
| P10.1 | She knew that she would weep again when she saw the kind, tender hands folded in death | S | belief of louise (a prediction) | E | event a01 in frame louise-anticipates, realised false | E | event h-a01 as held (not realised) |  |
| P10.2 | But she saw beyond that bitter moment a long procession of years to come that would belong to her absolutely. | S | belief of louise | E | event a02 in frame louise-anticipates | E | event h-a02 as held (not realised) |  |
| P10.3 | And she opened and spread her arms out to them in welcome. | S | turn 3 r6 text | S | e14 text | S | e14 text |  |
| P10.4 | There would be no one to live for her during those coming years; she would live for herself. There would be no powerful will bending hers... | S | belief text | E | a02; reading r-will held by louise | E | h-a02; reading r-will held by louise |  |
| P10.5 | A kind intention or a cruel intention made the act seem no less a crime as she looked upon it in that brief moment of illumination. | S | belief text | E | reading r-will | E | reading r-will |  |
| P11.1 | And yet she had loved him — sometimes. Often she had not. | S | relationship summary louise->brently; belief kind relationship | S | state relation value | S | state relation value | How often she loved him is a frequency over a marriage; no field holds it. |
| P11.2 | What did it matter! What could love, the unsolved mystery, count for in face of this possession of self-assertion | S | belief text | S | e14 text | S | e14 text |  |
| P12.1 | 'Free! Body and soul free!' she kept whispering. | E | turn 3 r7 | E | e15 speech | E | e15 speech |  |
| P13.1 | Josephine was kneeling before the closed door with her lips to the keyhole, imploring for admission. | S | turn 4 r1; the door's closedness is text (exits are open/locked/blocked) | E | e16 who josephine; place landing | E | e16 who josephine; place landing |  |
| P13.2 | 'Louise, open the door! ... you will make yourself ill. What are you doing, Louise?' | S | turn 4 r1 text; josephine's belief that she is making herself ill | E | knowledge josephine believes instead; e16 | E | knowledge josephine believes instead; e16 |  |
| P13.2 | (first use of 'Louise') | P | aliases on the character | P | - | P | - | The narrator calls her Mrs. Mallard until her sister names her: a choice of naming. |
| P14.1 | 'Go away. I am not making myself ill.' No; she was drinking in a very elixir of life through that open window. | E | turn 4 r1; josephine's perception accuracy mistaken | E | e16; knowledge josephine unaware of f-free | E | e16; knowledge josephine unaware of s05 | The irony (her words are true but not as her sister reads them) is for the reader. |
| P14.2 | Her fancy was running riot along those days ahead of her. Spring days, and summer days, and all sorts of days that would be her own. | S | turn 4 inner_state | E | a02 in frame louise-anticipates | E | h-a02 as held (not realised) |  |
| P14.3 | She breathed a quick prayer that life might be long. | E | turn 4 r2 | E | e17 | E | e17 |  |
| P14.4 | It was only yesterday she had thought with a shudder that life might be long. | S | inside the text of turn 4 r2; an event of the day before cannot be dated | E | e01 before e07 by about a day; e17 contrasts e01 | E | e01 before e07 by about a day; e17 contrasts e01 |  |
| P15.1 | She arose at length and opened the door to her sister's importunities. | E | turn 5 r1 and moves | E | e18 | E | e18 |  |
| P15.2 | There was a feverish triumph in her eyes, and she carried herself unwittingly like a goddess of Victory. | S | public_state; 'unwittingly' is not stored | E | state feeling joy; e18 | E | state feeling joy; e18 |  |
| P15.3 | She clasped her sister's waist, and together they descended the stairs. Richards stood waiting for them at the bottom. | E | turn 5 moves; perceived_by richards | E | e18 who richards witness | E | e18 who richards witness |  |
| P16.1 | Someone was opening the front door with a latchkey. It was Brently Mallard who entered, a little travel-stained, composedly carrying his grip-sack and umbrella. | E | turn 6 r1, move, items latchkey grip-sack umbrella | E | e19 things | E | e19 things | In v1 a thing's use is not an event: the key appears only as a listed item of the event. |
| P16.2 | He had been far from the scene of the accident, and did not even know there had been one. | S | turn 1 r4 (an event that states an absence); lore brently-not-in-accident; the unnamed place 'away' | E | fact f-bm-away; knowledge brently unaware of f-accident | E | s07; knowledge brently unaware of e02 |  |
| P16.3 | He stood amazed at Josephine's piercing cry; at Richards' quick motion to screen him from the view of his wife. | E | turn 6 r2 | E | e20 | E | e20 |  |
| P17.1 | But Richards was too late. | S | turn 6 r3, tag 'implied' (nothing says the event is implied) | E | e21 status implied; causes e22 | E | e21 basis implied, origin offscreen; causes e22 |  |
| P18.1 | When the doctors came they said she had died of heart disease — of the joy that kills. | S | turn 7 r2 with accuracy 'mistaken' on the doctors' perception (the encoder's judgement) | E | e23 claim f-doc-cause; reading r-cause against it | E | e23 claim c-doc-cause; reading r-cause against it |  |
| P18.1 | (she died; the moment is not narrated) | S | turn 7 r1, invented as an event; public_state 'Dead.' | E | e22 status stated-afterwards; state life dead | E | e22 origin backfilled; state life dead |  |
| P18.1 | (the true cause of death is not stated) | N | - | E | reading r-cause status implied | E | reading r-cause basis implied, origin offscreen |  |
| title | The Story of an Hour | N | clock sidecar only: invented instants | E | time.spans span-hour approx PT1H, source title | E | time.spans span-hour approx PT1H, source title |  |

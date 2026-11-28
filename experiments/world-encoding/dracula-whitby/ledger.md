# Ledger: Dracula, Chapter VII

A derelict ship comes into Whitby harbour in a storm with a dead man tied to the wheel; the log is read; a girl sleep-walks. About 5,700 words, 67 blocks, one per paragraph, so rows are clusters.

Encoded directly in v2 (see `v2/story.json`). `P<n>.<m>` is a unit inside a block; a range is an exchange or a run of entries. `e-...` events in the present of the telling, `b-...` events of the voyage told by the log, `c-...` claims, `h-...` held items, `s-...` states, `r-...` readings.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v2 (53) | 48 | 2 | 0 | 3 |

| Ref | Source (abridged) | v2 | v2 where | Note |
|---|---|---|---|---|
| P01-P05 | CHAPTER VII. CUTTING FROM “THE DAILYGRAPH,” 8 AUGUST (Pasted in Mina Murray’s Journal.) From a Correspondent. Whitby. | E | e-cutting-written (kind document, epoch none); e-cutting-pasted (after e-mina-harbour) | three layers of telling begin here: the correspondent, the paste and, inside, the log |
| P06.1 | One of the greatest and suddenest storms on record ... Saturday evening was as fine as was ever known ... holiday-makers ... Mulgrave Woods, Robin Hood’s Bay | E | e-saturday-fine |  |
| P06.2 | some of the gossips who frequent the East Cliff churchyard ... mares’-tails ... the coastguard on duty at once made report ... one old fisherman ... foretold ... a sudden storm | E | e-mares-tails |  |
| P06.3 | The approach of sunset was so very beautiful ... myriad clouds of every sunset-colour ... More than one captain made up his mind ... would remain in the harbour | S | e-sunset-watch (the colours are text) | a description, with a decision (boats stay in harbour) inside it |
| P06.4 | The wind fell away ... at midnight there was a dead calm ... The only sail noticeable was a foreign schooner with all sails set ... efforts were made to signal her to reduce sail | E | e-schooner-seen-early; e-stillness | the foolhardiness comment is text |
| P07 | “As idle as a painted ship upon a painted ocean.” | P | - | a quotation used as a figure |
| P08 | Shortly before ten o’clock the stillness ... the band on the pier ... A little after midnight came a strange sound from over the sea | E | e-stillness; e-storm-breaks (start) |  |
| P09.1 | Then without warning the tempest broke ... the waves rose in growing fury ... It was found necessary to clear the entire piers from the mass of onlookers | E | e-storm-breaks; s-storm |  |
| P09.2 | masses of sea-fog came drifting inland ... the spirits of those lost at sea were touching their living brethren with the clammy hands of death | P | s-storm (fog as a state) | the spirits figure is voice |
| P10 | Some of the scenes thus revealed were of immeasurable grandeur ... the new searchlight ... a fishing-boat ... rushed into the harbour ... a shout of joy | E | e-searchlight-sweeps | the grandeur is voice |
| P11.1 | Before long the searchlight discovered some distance away a schooner with all sails set ... the great flat reef ... “she must fetch up somewhere, if it was only in hell.” | E | e-schooner-in-danger | the old salt's line is voice |
| P11.2 | then, mirabile dictu, between the piers, leaping from wave to wave ... lashed to the helm was a corpse ... pitched herself on that accumulation of sand ... Tate Hill Pier. | E | e-demeter-beaches; s-schooner-aground; s-corpse-at-wheel |  |
| P12 | an immense dog sprang up on deck from below ... jumped from the bow on the sand. Making straight for the steep cliff ... it disappeared in the darkness | E | e-dog-leaps; s-dog-loose | whose dog it is is not said; the later reader knows more than this chapter does |
| P13.1 | no one at the moment on Tate Hill Pier ... the coastguard on duty on the eastern side ... was the first to climb on board ... recoiled at once | E | e-coastguard-boards |  |
| P13.2 | your correspondent is a fairly good runner ... By the courtesy of the chief boatman, I was ... permitted to climb on deck | E | e-correspondent-runs |  |
| P14.1 | The man was simply fastened by his hands ... a crucifix ... the cords ... had cut the flesh to the bone | E | e-corpse-examined; s-corpse-at-wheel |  |
| P14.2 | a doctor ... Surgeon J. M. Caffyn ... declared ... the man must have been dead for quite two days. In his pocket was a bottle ... the addendum to the log. | E | e-corpse-examined; c-dead-two-days |  |
| P14.3 | The coastguard said the man must have tied up his own hands, fastening the knots with his teeth. | E | e-coastguard-says; c-captain-tied-himself |  |
| P14.4 | The fact that a coastguard was the first on board may save some complications ... salvage ... mortmain ... Casabianca ... placed in the mortuary | S | e-corpse-removed (the removal); the salvage law is text | an obligation or right (salvage) with legal terms has no field |
| P15-P16 | Already the sudden storm is passing ... I shall send ... further details ... Whitby | E | e-storm-abates; h-sequel (fulfilled by e-ship-identified) |  |
| P17.1 | 9 August.--The sequel ... a Russian from Varna ... the Demeter ... silver sand ... great wooden boxes filled with mould ... consigned to a Whitby solicitor, Mr. S. F. Billington | E | e-ship-identified; c-ship-varna; s-boxes; c-storm-night-8 | the dateline and 'last night' conflict with Mina's journal; held as two open claims |
| P17.2 | this morning went aboard and formally took possession ... The Russian consul ... paid all harbour dues ... the officials of the Board of Trade have been most exacting | E | e-billington-takes-cargo |  |
| P17.3 | A good deal of interest ... the dog which landed ... S. P. C. A. ... not to be found ... may be ... on the moors ... a fierce brute | E | e-dog-missing; h-dog-found; s-dog-loose |  |
| P17.4 | Early this morning a large dog, a half-bred mastiff ... found dead in the roadway ... throat was torn away, and its belly was slit open as if with a savage claw. | E | e-mastiff-found | that the immense dog did it is only implied (the text says 'a savage opponent'); no claim is made for it |
| P18 | * * * * * | P | - | a separator |
| P19.1 | Later.--By the kindness of the Board of Trade inspector ... the log-book of the Demeter ... the paper found in the bottle ... produced at the inquest | E | e-log-read |  |
| P19.2 | It almost seems as though the captain had been seized with some kind of mania ... my statement must be taken cum grano ... the dictation of a clerk of the Russian consul, who kindly translated | E | r-mania (a reading; the provenance is in its note); knowledge correspondent read | the translation and dictation are free text of the reading, not a link |
| P20-P22 | LOG OF THE “DEMETER.” Varna to Whitby. Written 18 July, things so strange happening, that I shall keep accurate note henceforth till we land. | E | e-log-read; events b-* established in it | the log was written from 18 July: earlier entries are written after the fact, which the date line does not carry |
| P23-P25 | On 6 July we finished taking in cargo, silver sand and boxes of earth. At noon set sail. Crew, five hands ... two mates, cook, and myself (captain). | E | b-loaded; s-crew-count; s-boxes |  |
| P26-P29 | On 11 July at dawn entered Bosphorus ... Backsheesh. All correct. ... On 12 July through Dardanelles ... Want us off soon. | E | b-bosphorus; b-dardanelles | the customs officers are a group; the bribery is text |
| P30-P33 | On 13 July passed Cape Matapan. Crew dissatisfied about something ... Mate lost temper with one of them that day and struck him. | E | b-crew-withholds (conceal, from the captain); b-mate-strikes; s-crew-fear |  |
| P34-P35 | On 16 July mate reported ... Petrofsky, was missing ... did not go to bunk. ... they expected something of the kind | E | b-petrofsky-missing |  |
| P36 | Olgaren ... a tall, thin man, who was not like any of the crew, come up the companion-way ... hatchways were all closed. | E | b-olgaren-sees; b-olgaren-confides; c-stranger-aboard | the stranger is an entity with no name and no kind of being; the chapter never says what It is |
| P37-P39 | Later in the day I got together the whole crew ... we would search from stem to stern ... First mate scowled, but said nothing. | E | b-search-ship | the mate's folly speech is text |
| P40-P41 | 22 July.--Rough weather last three days ... Men seem to have forgotten their dread ... Passed Gibralter | E | b-calm |  |
| P42-P43 | 24 July.--There seems some doom over this ship ... another man lost ... sent a round robin | E | b-second-lost; r-doom | the round robin is an act, a request for a double watch: held as text |
| P44-P45 | 28 July.--Four days in hell ... Second mate volunteered to steer and watch | E | b-maelstrom |  |
| P46-P49 | 29 July.--Another tragedy ... 30 July.--Last night. Rejoiced we are nearing England ... both man of watch and steersman missing | E | b-second-mate-lost; b-two-lost; s-crew-count | the counts of who is left are text in a state |
| P50-P53 | 1 August.--Two days of fog ... They are Russian, he Roumanian. 2 August, midnight.--... a cry ... North Foreland | E | b-fog; b-another-gone; s-fog |  |
| P54.1 | 3 August.--... the mate ... whispered hoarsely, with his mouth to my ear, as though fearing the very air might hear: “It is here; I know it, now.” ... the knife went through It, empty as the air. | E | b-mate-sees-it; b-mate-whispers (conceal from the stranger) | to hide a whisper from a thing that is claimed to be insubstantial is concealment from a possible non-person |
| P54.2 | “It is in the hold, perhaps in one of those boxes. I’ll unscrew them one by one” ... they are invoiced as “clay” ... He is mad, stark, raving mad | E | b-mate-searches-hold (fulfils h-mate-opens-boxes); s-mate-mad; c-cargo-clay | the captain's judgment of madness is a state, not a claim |
| P55-P56 | It is nearly all over now ... a sudden, startled scream ... “Save me! save me!” ... sprang on the bulwark and deliberately threw himself into the sea ... It was this madman who had got rid of the men | E | b-mate-screams; b-mate-jumps; c-mate-killed-crew |  |
| P57-P58 | 4 August.--Still fog ... I saw It--Him! ... the mate was right to jump overboard | E | b-captain-sees-it; c-stranger-killed-crew |  |
| P58.2 | I shall tie my hands to the wheel when my strength begins to fail, and along with them I shall tie that which He--It!--dare not touch ... this bottle may be found | E | b-captain-resolves; h-captain-ties (fulfilled by e-corpse-examined) | what 'He--It' dare not touch is the crucifix: carried only by the dead man's observation event |
| P59-P60 | Of course the verdict was an open one ... whether or not the man himself committed the murders there is now none to say ... The folk here hold almost universally that the captain is simply a hero ... public funeral | E | e-inquest; c-captain-killed-crew; r-captain-hero; h-funeral | the funeral route (boats up the Esk, abbey steps, a hundred boat-owners) is text of the held item |
| P61 | No trace has ever been found of the great dog ... To-morrow will see the funeral; and so will end this one more “mystery of the sea.” | E | e-dog-never-found (prevents h-dog-found) | 'ever' is the writer's later view: the dispatch reads as if from after the events |
| P62-P63 | Mina Murray’s Journal. 8 August.--Lucy was very restless all night, and I, too, could not sleep. The storm was fearful | E | e-mina-night; c-storm-night-7 |  |
| P63.2 | she got up twice and dressed herself ... I awoke in time and managed to undress her without waking her ... It is a very strange thing, this sleep-walking | E | e-lucy-walk-1; e-lucy-walk-2; c-lucy-walked; s-lucy-sleepwalking; knowledge lucy unaware | the general remark about her will being thwarted is part of the state's text |
| P64-P65 | Early in the morning we both got up and went down to the harbour ... Somehow I felt glad that Jonathan was not on the sea last night, but on land. But, oh, is he on land or sea? | E | e-mina-harbour; c-jonathan-on-land (unresolved); h-jonathan-news; s-mina-anxious | the waves 'like a bullying man going through a crowd' is a figure |
| P66.1 | 10 August.--The funeral of the poor sea-captain to-day ... Every boat ... the coffin was carried by captains ... Lucy came with me | E | e-funeral (fulfils h-funeral) |  |
| P66.2 | poor old Mr. Swales was found dead this morning on our seat, his neck being broken ... a look of fear and horror ... Perhaps he had seen Death with his dying eyes! | E | e-swales-found; c-swales-fright; r-swales-saw-death | whether a link joins Mr Swales's death to the ship or the dog is not said; the reader links them |
| P66.3 | Lucy is so sweet and sensitive ... she will not admit to me that there is any cause for restlessness ... One of the men ... was followed by his dog. | E | e-lucy-upset; r-lucy-feels; knowledge lucy doubts | 'will not admit' may be concealment or lack of understanding; the text says both |
| P67 | I think it will be best for her to go to bed tired out physically, so I shall take her for a long walk by the cliffs to Robin Hood’s Bay and back. | E | e-mina-plans-walk; h-mina-walk (open) |  |

# Ledger: The Open Window

A visitor is told a ghost story by a teenager; the ghosts walk in at tea-time; a second invention covers the first. Nothing in the narration says the story is a lie until the last sentence.

Each row is a unit of the source (a sentence or a clause group, `P<paragraph>.<n>`), with how the v1 encoding (current formats), the draft encoding (first evolved model, `draft/story.json`) and the v2 encoding (`v2/story.json`) hold it. `turn T rR` names the event of `v1/history.json` with that turn and round; `eNN`, `sNN`, `c-...`, `h-...`, `r-...` are ids in the draft or v2 story.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v1 (59) | 17 | 23 | 17 | 2 |
| draft (59) | 36 | 18 | 5 | 0 |
| v2 (59) | 35 | 18 | 5 | 1 |

| Ref | Source (abridged) | v1 | v1 where | draft | draft where | v2 | v2 where | Note |
|---|---|---|---|---|---|---|---|---|
| P01.1 | 'My aunt will be down presently, Mr. Nuttel,' said a very self-possessed young lady of fifteen | E | turn 2 r1; vera age 15, personality | E | e01; states vera age, manner | E | e01; states vera age, manner |  |
| P02.1 | Framton Nuttel endeavoured to say the correct something which should duly flatter the niece ... without unduly discounting the aunt that was to come. | N | - | N | - | N | - | A social strategy that is never carried out in words. |
| P02.2 | Privately he doubted more than ever whether these formal visits ... would do much towards helping the nerve cure | S | framton start inner_state and background | E | e02; states health | E | e02; states health |  |
| P03.1 | 'I know how it will be,' his sister had said when he was preparing to migrate ... 'you will bury yourself ... I shall just give you letters of introduction' | N | - | E | b01 says, mode reported; telling s03 analepsis | E | b01 says, mode reported | v1 has the sister as a character but no past event. |
| P04.1 | Framton wondered whether Mrs. Sappleton ... came into the nice division. | N | - | E | e02 text | E | e02 text |  |
| P05.1 | 'Do you know many of the people round here?' asked the niece | E | turn 2 r2 | E | e03 says | E | e03 says |  |
| P05.2 | when she judged that they had had sufficient silent communion | N | - | N | - | N | - | Her sense of timing. |
| P06.1 | 'Hardly a soul ... My sister was staying here, at the rectory, you know, some four years ago, and she gave me letters of introduction' | E | turn 2 r2 text; relationship framton -> sister | E | e03 says; b01 | E | e03 says; b01 |  |
| P06.2 | (four years ago) | S | event text only | S | b01 text | S | b01 text | A relative time from an unnamed 'now'. |
| P07.1 | He made the last statement in a tone of distinct regret. | N | - | N | - | N | - |  |
| P08.1 | 'Then you know practically nothing about my aunt?' pursued the self-possessed young lady. | E | turn 2 r2 | E | e03 says | E | e03 says |  |
| P09.1 | 'Only her name and address,' admitted the caller. | E | turn 2 r2 perception: vera heard 'he knows nothing about my aunt' | E | e03; fact f-framton-ignorant; knowledge vera knows | E | e03; s13; knowledge vera knows | What makes the hoax possible is what Vera has learnt. |
| P09.2 | He was wondering whether Mrs. Sappleton was in the married or widowed state. | N | - | S | e03 text | S | e03 text |  |
| P09.3 | An undefinable something about the room seemed to suggest masculine habitation. | S | sitting-room description | S | states sitting-room description | S | states sitting-room description |  |
| P10.1 | 'Her great tragedy happened just three years ago,' said the child; 'that would be since your sister's time.' | E | turn 2 r3 | E | e04 says | E | e04 says |  |
| P11.1 | 'Her tragedy?' asked Framton; somehow in this restful country spot tragedies seemed out of place. | N | - | N | - | N | - |  |
| P12.1 | 'You may wonder why we keep that window wide open on an October afternoon,' said the niece, indicating a large French window that opened on to a lawn. | S | sitting-room feature French window; the day and hour invented | E | time.anchors the-day; thing french-window; state description | E | time.anchors the-day; thing french-window; state description |  |
| P13.1 | 'It is quite warm for the time of the year,' said Framton; 'but has that window got anything to do with the tragedy?' | N | - | S | states sitting-room description | S | states sitting-room description |  |
| P14.1 | 'Out through that window, three years ago to a day, her husband and her two young brothers went off for their day's shooting. They never came back. ... engulfed in a treacherous piece of bog ... Their bodies were never recovered.' | S | turn 2 r3: the event states it was invented and the perception content, marked mistaken, holds the tale | E | e04; frame vera-tale; t01; claims f-men-died, f-anniversary | E | e04; frame vera-tale; e04 says; claims c-men-died, c-anniversary |  |
| P14.2 | 'Poor aunt always thinks that they will come back some day ... That is why the window is kept open every evening till it is quite dusk.' | S | turn 2 r3 text | E | t02 realised partly; fact f-window-for-return true | E | e04 says realised partly; s10 true | The aunt really does wait for them; the tale's reason is false but the habit is true. |
| P14.3 | 'her husband with his white waterproof coat over his arm' | N | - | E | fact f-coat-arm contradicted by e10 (over his shoulders) | E | c-coat-arm contradicted by e10 (over his shoulders) | A detail that does not match what comes later. |
| P14.4 | 'Ronnie, her youngest brother, singing 'Bertie, why do you bound?' as he always did to tease her' | N | - | E | fact f-ronnie-song true; e10 claims it | E | s12 true; e10 claims it |  |
| P14.5 | Here the child's voice lost its self-possessed note and became falteringly human. | N | - | S | e04 manner: a performance | S | e04 manner: a performance |  |
| P14.6 | 'Do you know, sometimes on still, quiet evenings like this, I almost get a creepy feeling that they will all walk in through that window – ' | S | turn 2 r3 text | S | e04 says | S | e04 says |  |
| P15.1 | She broke off with a little shudder. | N | - | S | e05 text | S | e05 text |  |
| P15.2 | It was a relief to Framton when the aunt bustled into the room with a whirl of apologies for being late | E | turn 3 r1; move mrs-sappleton -> sitting-room | E | e05 | E | e05 |  |
| P16-P17 | 'I hope Vera has been amusing you?' ... 'She has been very interesting,' said Framton. | N | - | N | - | N | - | Small talk; Framton's politeness is the opposite of what he feels. |
| P18.1 | 'I hope you don't mind the open window; my husband and brothers will be home directly from shooting, and they always come in this way.' | E | turn 3 r1 perception: framton heard, accuracy mistaken | E | e06 says; claims f-men-alive, f-window-for-return | E | e06 says; claims s11, s10 |  |
| P18.2 | 'They've been out for snipe in the marshes to-day, so they'll make a fine mess over my poor carpets. So like you men-folk, isn't it?' | S | turn 1 r1: an offstage event invented so the shoot has a time and a place; tagged reported-later | E | b03 status reported, reported_by mrs-sappleton | E | b03 basis reported, origin offscreen, reported_by mrs-sappleton |  |
| P18.3 | (her words are true and confirm what Vera said in every way that matters except that the men are alive) | S | lore no-tragedy (hidden) | E | facts f-men-alive, f-window-for-return | E | s11, s10 |  |
| P19.1 | She rattled on cheerfully about the shooting and the scarcity of birds, and the prospects for duck in the winter. | S | turn 3 r2 text | S | e07 text | S | e07 text |  |
| P19.2 | To Framton it was all purely horrible. He made a desperate but only partially successful effort to turn the talk on to a less ghastly topic | S | turn 3 r2 text, perception partial | S | e07 text | S | e07 text |  |
| P19.3 | he was conscious that his hostess was giving him only a fragment of her attention, and her eyes were constantly straying past him to the open window and the lawn beyond. | E | turn 3 r2 perception content | E | e07 misread_by; state mrs-sappleton attention; knowledge framton believes f-aunt-deluded | E | e07 misread_by; state mrs-sappleton attention; knowledge framton believes c-aunt-deluded |  |
| P19.4 | It was certainly an unfortunate coincidence that he should have paid his visit on this tragic anniversary. | N | - | E | reading r-coincidence against f-anniversary | E | reading r-coincidence against c-anniversary |  |
| P20.1 | 'The doctors agree in ordering me complete rest, an absence of mental excitement, and avoidance of anything in the nature of violent physical exercise,' announced Framton | S | turn 3 r2 text; framton background | E | b02; e08 says | E | b02; e08 says |  |
| P20.2 | Framton, who laboured under the tolerably widespread delusion that total strangers ... are hungry for the least detail of one's ailments | N | - | E | reading r-framton; state disposition | E | reading r-framton; state disposition |  |
| P20.3 | 'On the matter of diet they are not so much in agreement,' he continued. | S | turn 3 r2 text | S | e08 says | S | e08 says |  |
| P21.1 | 'No?' said Mrs. Sappleton, in a voice which only replaced a yawn at the last moment. | S | turn 3 r2 text ('little attention') | S | e08 text | S | e08 text |  |
| P21.2 | Then she suddenly brightened into alert attention – but not to what Framton was saying. | S | turn 3 r3 text | S | e09 text | S | e09 text |  |
| P22.1 | 'Here they are at last!' she cried. 'Just in time for tea, and don't they look as if they were muddy up to the eyes!' | E | turn 3 r3 text | E | e09 says | E | e09 says |  |
| P23.1 | Framton shivered slightly and turned towards the niece with a look intended to convey sympathetic comprehension. | S | turn 3 r3 text | S | e09 text | S | e09 text |  |
| P23.2 | The child was staring out through the open window with dazed horror in her eyes. | S | turn 3 r3 text; nothing says it is acted | S | e09 note: acted, implied by P28-P29 | S | e09 note: acted, implied by P28-P29 |  |
| P23.3 | In a chill shock of nameless fear Framton swung round in his seat and looked in the same direction. | S | turn 3 r3 perception | S | e10 who framton witness | S | e10 who framton witness |  |
| P24.1 | In the deepening twilight three figures were walking across the lawn towards the window; they all carried guns under their arms, and one of them was additionally burdened with a white coat hung over his shoulders. A tired brown spaniel kept close at their heels. | E | turn 3 r3; items guns, white-coat; characters | E | e10; states mr-sappleton appearance, spaniel | E | e10; states mr-sappleton appearance, spaniel |  |
| P24.1 | (deepening twilight) | S | the hour only in the clock sidecar | E | e09 when approx deepening twilight | E | e09 when approx deepening twilight |  |
| P24.2 | Noiselessly they neared the house | S | turn 3 r3 perception text | S | e10 text | S | e10 text |  |
| P24.3 | and then a hoarse young voice chanted out of the dusk: 'I said, Bertie, why do you bound?' | E | turn 3 r3 text | E | e10; claims f-ronnie-song | E | e10; claims s12 | That the voice is Ronnie's is implied by P14. |
| P24.4 | (Framton takes the three for the dead men) | S | turn 3 r3 perception, accuracy mistaken | E | knowledge framton believes f-ghosts false, misreading_of e10 | E | knowledge framton believes c-ghosts false, misreading_of e10 |  |
| P25.1 | Framton grabbed wildly at his stick and hat; the hall-door, the gravel-drive, and the front gate were dimly-noted stages in his headlong retreat. | E | turn 3 r4; items stick, hat; places hall, drive, road | E | e11; things stick-hat | E | e11; things stick-hat |  |
| P25.2 | A cyclist coming along the road had to run into the hedge to avoid an imminent collision. | E | turn 3 r4; character cyclist | E | e11 who cyclist patient | E | e11 who cyclist patient |  |
| P25.3 | (why he fled: the tale, the aunt's behaviour, the sight) | N | - | E | e11 causes e10 stated, e04 implied | E | e11 causes e10 stated, e04 implied |  |
| P26.1 | 'Here we are, my dear,' said the bearer of the white mackintosh, coming in through the window; 'fairly muddy, but most of it's dry. Who was that who bolted out as we came up?' | E | turn 3 r5; moves | E | e12 says | E | e12 says |  |
| P27.1 | 'A most extraordinary man, a Mr. Nuttel,' said Mrs. Sappleton; 'could only talk about his illnesses, and dashed off without a word of good-bye or apology when you arrived.' | E | turn 3 r6 | E | e13 says | E | e13 says |  |
| P27.2 | 'One would think he had seen a ghost.' | P | - | S | e13 irony | S | e13 irony | She says the truth without knowing it. |
| P28.1 | 'I expect it was the spaniel,' said the niece calmly; 'he told me he had a horror of dogs.' | E | turn 3 r7 | E | e14 | E | e14 |  |
| P28.2 | 'He was once hunted into a cemetery somewhere on the banks of the Ganges by a pack of pariah dogs, and had to spend the night in a newly dug grave ...' | S | turn 3 r7: the event text says it was invented; the listeners' perceptions are marked mistaken | E | frame vera-tale-2; claims f-nuttel-dog-horror false | E | frame vera-tale-2; claims c-nuttel-dog-horror false |  |
| P28.3 | (why she says it: to cover the first story) | N | - | S | e14 intent, status implied-intent | S | e14 intent, basis implied, origin offscreen-intent |  |
| P29.1 | Romance at short notice was her speciality. | S | vera personality text | E | fact f-vera-invents; state habit; reading r-vera | E | s00; state habit; reading r-vera |  |
| P29.2 | (the last sentence relabels both stories as inventions) | P | - | E | telling s15 reveals f-vera-invents, f-nuttel-dog-horror | P | telling: projection, not stored (the turn order is the telling) |  |

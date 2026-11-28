# Ledger: The Adventure of the Speckled Band

A client brings a death that no one can explain; the detective's first theory is wrong; the true method is reconstructed from clues and shown at the end. About 9,800 words, so the rows are clusters of sentences or whole exchanges, not single sentences.

This work was encoded directly in v2 (see `v2/story.json`), with no v1 and no draft, so the table has one encoding. `P<n>.<m>` is a unit inside a paragraph block; a range `P35-P43` is an exchange. `e-...` and `b-...` are events (`b-` = before the first scene), `s-...` states, `c-...` claims, `h-...` held, `r-...` readings.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v2 (106) | 83 | 17 | 5 | 1 |

| Ref | Source (abridged) | v2 | v2 where | Note |
|---|---|---|---|---|
| P01.1 | In glancing over my notes of the seventy odd cases ... I cannot recall any which presented more singular features | S | e-watson-writes (when about 1891); the survey of his cases is text |  |
| P01.2 | a promise of secrecy was made at the time, from which I have only been freed during the last month by the untimely death of the lady | E | s-promise (until e-helen-dies); e-helen-dies offscreen |  |
| P01.3 | wide-spread rumors as to the death of Dr. Grimesby Roylott which tend to make the matter even more terrible than the truth | E | s-rumours; r-rumours | the rumours' content is not given; only that they exaggerate |
| P01.4 | It was early in April in the year '83 that I woke one morning to find Sherlock Holmes standing ... a quarter past seven | E | e-watson-woken (when.t 435); anchor d0 |  |
| P02 | Very sorry to knock you up, Watson ... Mrs. Hudson has been knocked up, she retorted upon me, and I on you. | N | - | Mrs Hudson's retort is an offstage exchange never recorded as an event |
| P03-P05 | What is it, then, a fire? ... a client ... I would not miss it for anything | E | e-watson-woken; held none; the client's urgency is text |  |
| P06.1 | I had no keener pleasure than in following Holmes ... rapid deductions, as swift as intuitions | E | r-method (narrator reading) |  |
| P06.2 | A lady dressed in black and heavily veiled, who had been sitting in the window, rose as we entered. | E | e-holmes-prepares; e-helen-arrives |  |
| P07.1 | Good-morning, madam ... My name is Sherlock Holmes. This is my intimate friend and associate | E | e-helen-arrives |  |
| P07.2 | Ha! I am glad to see that Mrs. Hudson has had the good sense to light the fire ... a cup of hot coffee | N | - | a fire lit and coffee offered: ordinary things with no field |
| P08-P09 | It is not cold which makes me shiver ... It is fear, Mr. Holmes. It is terror. | E | s-helen-fear (until e-helen-leaves); says |  |
| P10.1 | her face all drawn and gray, with restless, frightened eyes, like those of some hunted animal ... hair shot with premature gray | S | s-helen-looks (appearance text) | a simile inside a description |
| P11-P15 | You have come in by train this morning ... the second half of a return ticket ... mud in no less than seven places | E | e-holmes-deduces-journey; c-journey (confirmed by e-helen-confirms-journey) | an inference confirmed by the person it is about |
| P16.1 | I started from home before six, reached Leatherhead at twenty past, and came in by the first train | E | b-helen-leaves (when.t 350-440); e-helen-confirms-journey |  |
| P16.2 | I have heard of you from Mrs. Farintosh, whom you helped in the hour of her sore need | E | b-farintosh (backfilled, established in e-holmes-casebook) |  |
| P16.3 | At present it is out of my power to reward you ... in a month or six weeks I shall be married, with the control of my own income | S | h-helen-marry (the wedding); the promise to pay is not held | an obligation with a condition and a date has no home |
| P17-P18 | Holmes turned to his desk ... case-book ... Farintosh ... an opal tiara ... my profession is its own reward | E | e-holmes-casebook; b-farintosh |  |
| P19-P20 | my fears are so vague ... he to whom of all others I have a right to look for help ... looks upon all that I tell him as the fancies of a nervous woman | E | e-helen-fears; c-armitage-fancies (unresolved); knowledge helen believes | who 'he' is, is the encoder's inference from P66 |
| P21-P22 | My name is Helen Stoner, and I am living with my stepfather ... the Roylotts of Stoke Moran | E | e-helen-tells; people helen, roylott |  |
| P23.1 | The family was at one time among the richest in England ... four successive heirs ... a gambler in the days of the Regency | S | s-estate; s-lawn-hist (circumstance text) | the squandering is told as a sentence, not as events |
| P23.2 | his only son, my step-father ... took a medical degree, and went out to Calcutta ... a large practice | E | b-roylott-india (summarised) |  |
| P23.3 | he beat his native butler to death, and narrowly escaped a capital sentence ... a long term of imprisonment | E | b-butler | the butler is not an entity |
| P24.1 | When Dr. Roylott was in India he married my mother ... My sister Julia and I were twins ... two years old | E | b-marries; s-twins |  |
| P24.2 | She had a considerable sum of money ... bequeathed to Dr. Roylott entirely while we resided with him ... a certain annual sum to each of us in the event of our marriage | S | b-bequest; s-will; e-holmes-returns (the sums) | terms as text and figures; nothing sums them |
| P24.3 | my mother died, she was killed eight years ago in a railway accident near Crewe | E | b-mother-dies |  |
| P24.4 | Dr. Roylott then abandoned his attempts to establish himself in practice in London, and took us to live with him in the old ancestral house | E | b-moves-in |  |
| P25 | a terrible change came over our step-father ... ferocious quarrels ... the terror of the village | E | b-withdraws (iterative); s-roylott-nature; r-roylott-heredity |  |
| P26 | Last week he hurled the local blacksmith over a parapet ... the wandering gypsies ... a cheetah and a baboon | E | b-blacksmith; b-gypsies; b-pets-arrive; s-roylott-pets; s-roylott-friends |  |
| P27 | my poor sister Julia and I had no great pleasure in our lives. No servant would stay ... She was but thirty at the time of her death | S | s-servants; s-twins (circumstance text) |  |
| P28 | Your sister is dead, then? | E | e-holmes-attends |  |
| P29 | She died just two years ago ... an aunt ... Miss Honoria Westphail ... Julia went there at Christmas ... a half-pay major of marines ... within a fortnight of the day which had been fixed for the wedding | E | b-julia-engaged; b-no-objection; h-julia-wedding (prevented by b-julia-dies); s-julia-engaged |  |
| P30-P31 | Sherlock Holmes had been leaning back in his chair with his eyes closed ... Pray be precise as to details | E | e-holmes-attends | his posture is text |
| P32-P33 | The manor-house is very old, and only one wing is now inhabited ... three bedrooms ... Do I make myself plain? | E | s-layout; claim c-room-sealed (no communication) | 'there is no communication between them' is a claim, later contradicted |
| P34 | That fatal night Dr. Roylott had gone to his room early ... the smell of the strong Indian cigars ... She left her room ... At eleven o'clock she rose to leave me | E | b-roylott-retires; b-julia-visits (epoch julia-night) |  |
| P35-P43 | have you ever heard any one whistle in the dead of the night? ... Because during the last few nights I have always, about three in the morning, heard a low, clear whistle | E | b-julia-asks; b-julia-whistles (iterative, reported by Julia); b-julia-locks |  |
| P44-P48 | Was it your custom always to lock yourselves in at night? ... the doctor kept a cheetah and a baboon | E | s-lock-habit (until b-julia-dies) |  |
| P49.1 | I could not sleep that night. A vague feeling of impending misfortune ... twins ... subtle are the links which bind two souls | S | b-helen-wakeful; r-twins (reading) | a feeling presented as a link between the twins |
| P49.2 | there burst forth the wild scream of a terrified woman ... I seemed to hear a low whistle ... a clanging sound | E | b-julia-screams; c-whistle-julia (a claim: the hearing is hers and doubted) |  |
| P49.3 | my sister appear at the opening ... she fell to the ground ... 'Oh, my God! Helen! It was the band! The speckled band!' ... she stabbed with her finger into the air in the direction of the doctor's room | E | b-julia-emerges; b-julia-words; knowledge reader (Julia's words); c-band-snake |  |
| P49.4 | I met him hastening from his room in his dressing-gown ... poured brandy ... she slowly sank and died without having recovered her consciousness | E | b-roylott-comes; b-julia-dies |  |
| P50-P51 | are you sure about this whistle and metallic sound? ... I may possibly have been deceived | E | c-whistle-julia with knowledge helen doubts | the doubt is the holder's stance, not a bearing event |
| P52-P54 | Was your sister dressed? ... the charred stump of a match, and in her left a matchbox | E | s-julia-last; things match-stump, matchbox |  |
| P55-P57 | The coroner ... unable to find any satisfactory cause of death ... the door had been fastened upon the inner side ... The doctors examined her for [poison], but without success | E | b-inquiry; c-room-sealed (false) |  |
| P58-P59 | What do you think that this unfortunate lady died of? ... pure fear and nervous shock | E | c-julia-fear; knowledge helen believes |  |
| P60-P63 | Were there gypsies in the plantation at the time? ... the spotted handkerchiefs ... delirium | E | c-band-gypsies; s-gypsy-camp; r-delirium |  |
| P64-P65 | Holmes shook his head like a man who is far from being satisfied. 'These are very deep waters' | E | e-holmes-unsatisfied |  |
| P66.1 | Two years have passed ... A month ago ... Percy Armitage ... we are to be married in the course of the spring | E | b-armitage; s-helen-engaged; h-helen-marry (open) |  |
| P66.2 | Two days ago some repairs were started in the west wing ... I have had to move into the chamber in which my sister died | E | b-repairs-begin |  |
| P66.3 | last night ... I suddenly heard ... the low whistle ... I sprang up and lit the lamp, but nothing was to be seen | E | b-night-whistle; c-whistle-last-night |  |
| P67-P73 | You are screening your step-father ... Five little livid spots ... He is a hard man | E | e-holmes-sees-bruise; e-helen-excuses; s-helen-bruise; c-bruise-roylott | the admission is in the blush and excuse, not in words |
| P74 | There was a long silence, during which Holmes leaned his chin upon his hands and stared into the crackling fire. | S | folded into e-holmes-asks-visit |  |
| P75-P82 | would it be possible for us to see over these rooms without the knowledge of your step-father? ... I shall return by the twelve o'clock train | E | e-holmes-asks-visit; h-roylott-town; h-helen-twelve; e-helen-leaves |  |
| P83-P88 | what do you think of it all, Watson? ... then her sister must have been undoubtedly alone | E | e-holmes-theory | Watson's opinion is not recorded |
| P89-P93 | When you combine the ideas of whistles at night, the presence of a band of gypsies ... I think that there is good ground to think that the mystery may be cleared along those lines | E | c-gypsies-involved; c-clang-bar; knowledge holmes believes (until e-holmes-drops-gypsies) | a compound theory held as two claims |
| P94 | a huge man had framed himself in the aperture ... a fierce old bird of prey | S | s-roylott-looks | a figure of speech inside a description |
| P95-P108 | Which of you is Holmes? ... Holmes, the busybody! ... a decided draught | S | e-roylott-bursts-in; e-holmes-baits-roylott; c-roylott-traced | Holmes's irrelevant replies (cold, crocuses) are the wit of the scene and sit in the text |
| P109-P111 | seized the poker, and bent it into a curve ... Holmes ... straightened it out again | E | e-poker-bent; e-holmes-straightens-poker |  |
| P112 | Fancy his having the insolence to confound me with the official detective force! ... Doctors' Commons | E | e-holmes-straightens-poker; h-holmes-commons |  |
| P113-P114 | I have seen the will of the deceased wife ... not more than ₤750. Each daughter can claim an income of ₤250 | S | e-holmes-doctors-commons (offscreen); e-holmes-returns; c-roylott-motive (confirmed) | no arithmetic: 750 less 250 or 500 is not derived |
| P115.1 | At Waterloo we were fortunate in catching a train for Leatherhead ... drove for four or five miles through the lovely Surrey lanes | E | e-train-to-leatherhead; s-spring-day |  |
| P115.2 | To me at least there was a strange contrast between the sweet promise of the spring and this sinister quest | P | r-contrast (text only) | a figure |
| P116-P123 | Stoke Moran? ... the house of Dr. Grimesby Roylott ... the lady is Miss Stoner | E | e-train-to-leatherhead; s-estate-wing; e-arrive-stoke-moran |  |
| P124 | I thought it as well that this fellow should think we had come here as architects ... It may stop his gossip. | E | e-holmes-conceals-purpose (kind conceal, from roylott); knowledge roylott unaware | whether Roylott believes it is never shown |
| P125-P130 | Our client of the morning had hurried forward ... Dr. Roylott has gone to town ... he has followed me, then | E | e-arrive-stoke-moran; e-helen-returns (offscreen); c-roylott-away; e-holmes-tells-helen |  |
| P131 | The building was of gray, lichen-blotched stone ... two curving wings, like the claws of a crab ... Some scaffolding | S | s-estate-wing; things scaffolding |  |
| P132-P135 | This, I take it, belongs to the room in which you used to sleep ... there does not seem to be any very pressing need for repairs ... an excuse to move me | E | e-holmes-notes-repairs; c-repairs-pretext |  |
| P136-P139 | Now, would you have the kindness to go into your room and bar your shutters ... my theory certainly presents some difficulties | E | e-holmes-tests-shutters; s-shutters; c-band-gypsies, c-gypsies-involved, c-clang-bar undermined |  |
| P140 | A small side door led into the whitewashed corridor ... a homely little room ... worm-eaten oak | S | s-room-middle; s-corridor | description |
| P141-P146 | Where does that bell communicate with? ... Your sister asked for it, I suppose? ... No, I never heard of her using it. | E | e-bell-asked |  |
| P147 | He threw himself down upon his face with his lens ... walked over to the bed, and spent some time in staring at it | E | e-bed-clamped-seen (the clamp itself is told at P214) |  |
| P148-P151 | Why, it's a dummy ... fastened to a hook just above ... the ventilator | E | e-bell-rope-dummy; s-wiring |  |
| P152-P156 | what a fool a builder must be to open a ventilator into another room ... dummy bell-ropes, and ventilators which do not ventilate | E | e-ventilator-found; s-ventilator; claim c-room-sealed contradicted |  |
| P157 | Dr. Grimesby Roylott's chamber ... A camp-bed ... a large iron safe | S | s-roylott-room | description |
| P158-P161 | What's in here? ... My step-father's business papers ... Only once, some years ago | E | e-roylott-room-search; knowledge helen of the safe |  |
| P162-P166 | There isn't a cat in it, for example? ... a small saucer of milk ... a cheetah is just a big cat | E | e-milk-seen; s-milk |  |
| P166-P167 | He squatted down in front of the wooden chair, and examined the seat of it ... That is quite settled | E | e-chair-examined; s-chair-marks (told only at P249) |  |
| P168-P171 | a small dog-lash ... curled upon itself, and tied so as to make a loop of whip-cord ... it's a wicked world | E | e-lash-seen; s-lash | Holmes's aside about clever men and crime is a remark |
| P172 | I had never seen my friend's face so grim or his brow so dark | E | e-holmes-grim |  |
| P173-P187 | you should absolutely follow my advice ... we must spend the night in your room ... you must open the shutters ... put your lamp there as a signal to us | E | e-holmes-instructs; h-helen-signal; h-holmes-night; s-signal-lamp |  |
| P183 | You must confine yourself to your room, on pretence of a headache | S | e-holmes-conceals-plan (conceal, from roylott) | the pretence is held in the instruction event, not as the act it will be |
| P188-P193 | tell me what was the cause of my sister's death ... I think that there was probably some more tangible cause | E | e-helen-asks-cause; c-julia-fear undermined |  |
| P194 | 'GOOD-BYE, AND BE BRAVE' | N | - | a page heading of the transcription, not part of the text |
| P195.1 | leave you, for if Dr. Roylott returned and saw us ... Good-bye, and be brave | E | e-farewell |  |
| P195.2 | engaging a bedroom and sitting-room at the 'Crown Inn' ... At dusk we saw Dr. Grimesby Roylott drive past ... a sudden light spring up | E | e-crown-inn; e-roylott-drives-past (confirms c-roylott-away) |  |
| P196-P200 | I have really some scruples as to taking you to-night. There is a distinct element of danger. | E | e-holmes-warns-watson |  |
| P201-P208 | I knew that we should find a ventilator before ever we came to Stoke Moran ... I deduced a ventilator. | E | e-holmes-deduces-vent (made at t 590, told here); e-ventilator-explained; c-ventilator-expected | the one place the story is told later than it happened and Holmes's own mind is the event |
| P209-P211 | there is at least a curious coincidence of dates. A ventilator is made, a cord is hung, and a lady who sleeps in the bed dies. | E | e-ventilator-explained; b-installs (approx, after b-julia-engaged, before b-julia-dies) | the agent of the works is unnamed |
| P212-P218 | It was clamped to the floor ... Holmes, I seem to see dimly what you are hinting at ... When a doctor does go wrong, he is the first of criminals. | E | e-bed-reasoning; s-bed; c-roylott-installed; c-snake-method; knowledge reader of s-bed from para:P214 |  |
| P218 | Palmer and Pritchard were among the heads of their profession | N | r-sheba (text only) | an allusion to real poisoners, who are not in the story's world |
| P218.2 | for goodness' sake let us have a quiet pipe | N | - | an ordinary act, no field |
| P219-P221 | About nine o'clock the light ... was extinguished ... at the stroke of eleven, a single bright light shone ... That is our signal | E | e-roylott-light-out; e-signal; e-leave-inn |  |
| P222-P225 | there darted what seemed to be a hideous and distorted child ... That is the baboon. | E | e-baboon-dart; c-hideous-child; c-baboon; e-baboon-named | the perceived and the real is a pair of claims |
| P226 | perhaps we might find it upon our shoulders at any moment ... into the bedroom | S | r-cheetah-hypothetical (text only); e-enter-room | a narrator's hypothetical |
| P227-P233 | The least sound would be fatal to our plans ... We must sit without light. He would see it through the ventilator. | E | e-holmes-silence-order; e-holmes-conceals-light (conceal, from roylott) |  |
| P234 | How shall I ever forget that dreadful vigil? ... Twelve struck, and one and two and three | S | e-vigil (t 1430-1660); r-vigil | an exclamation of memory is a reading |
| P235 | the momentary gleam of a light up in the direction of the ventilator ... a very gentle, soothing sound, like that of a small jet of steam | E | e-lantern-lit; e-hiss-heard; e-roylott-sends-snake (offscreen, established at P248); e-holmes-lashes | what is going through the ventilator is never seen |
| P236-P237 | You see it, Watson? ... But I saw nothing ... a low, clear whistle | E | e-holmes-lashes; e-whistle-watson; knowledge watson unaware of the descent |  |
| P238 | the most horrible cry to which I have ever listened ... They say that away down in the village ... that cry raised the sleepers | E | e-roylott-cry (reported); e-snake-bites-roylott (offscreen) |  |
| P239-P241 | What can it mean? ... It means that it is all over ... we will enter Dr. Roylott's room | E | e-enter-roylott-room |  |
| P242 | On the table stood a dark-lantern ... Round his brow he had a peculiar yellow band, with brownish speckles | E | e-roylott-found; s-roylott-room; things |  |
| P243-P245 | The band! the speckled band! ... It is a swamp adder ... He has died within ten seconds of being bitten. | E | e-band-is-snake; e-roylott-dies (offscreen); c-band-snake (true); c-roylott-killed-by-snake (true) |  |
| P246 | he drew the dog-whip swiftly ... threw it into the iron safe, which he closed upon it | E | e-snake-into-safe; s-snake-place |  |
| P247 | Such are the true facts of the death of Dr. Grimesby Roylott ... the official inquiry ... while indiscreetly playing with a dangerous pet | E | e-aftermath (summary); c-official-finding; harrow; knowledge | the narrator's 'true facts' and his refusal to prolong the narrative are voice, kept nowhere |
| P248 | I had come to an entirely erroneous conclusion ... The idea of a snake instantly occurred to me | E | e-holmes-drops-gypsies; e-holmes-suspects-snake (both made on site, told here); c-snake-method; c-snake-trained; r-holmes-erroneous |  |
| P249 | An inspection of his chair showed me that he had been in the habit of standing on it ... The metallic clang ... was obviously caused by her step-father hastily closing the door of his safe | E | s-chair-marks; c-clang-safe; e-holmes-explains |  |
| P250-P251 | With the result of driving it through the ventilator ... I am no doubt indirectly responsible for Dr. Grimesby Roylott's death | E | e-holmes-self-blame; r-holmes-blame; causes e-snake-bites-roylott from e-holmes-lashes |  |

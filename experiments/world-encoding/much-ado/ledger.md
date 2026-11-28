# Ledger: Much Ado About Nothing (Act 2 scene 2 to Act 3 scene 2)

A villain plots to break a marriage; two overhearing scenes make two enemies lovers by false report; the scene ends with the lie that will break the marriage. About 4,600 words, 215 blocks, one per speech or stage direction, so rows are clusters of speeches.

This work was encoded directly in v2 (see `v2/story.json`), with no v1 and no draft. `P<n>.<m>` is a unit inside a block; a range is an exchange. `e-...` and `b-...` are events (`b-` = told, before the scene), `c-...` claims, `h-...` held items, `s-...` states, `r-...` readings. Overlapping rows exist where two units share a block.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v2 (69) | 63 | 5 | 0 | 1 |

| Ref | Source (abridged) | v2 | v2 where | Note |
|---|---|---|---|---|
| P01-P02 | ACT 2, SCENE II. The same. [Enter DON JOHN and BORACHIO] | E | e-john-sulks (place house, who) | the heading gives only 'the same' place; it is the house of Act 2 scene 1, outside the excerpt |
| P03 | It is so; the Count Claudio shall marry the daughter of Leonato. | E | e-john-sulks; s-wedding |  |
| P04 | Yea, my lord; but I can cross it. | E | e-borachio-offers |  |
| P05 | Any bar, any cross, any impediment will be medicinable to me: I am sick in displeasure to him ... How canst thou cross this marriage? | E | e-john-sulks; s-john-displeasure; c-john-spite (asserted) |  |
| P06-P07 | Not honestly, my lord; but so covertly that no dishonesty shall appear in me. | E | e-borachio-offers; e-plot-concealed (conceal, from four people) |  |
| P08-P09 | I think I told your lordship a year since, how much I am in the favour of Margaret ... I remember. | E | b-borachio-margaret (backfilled, established in e-borachio-margaret) | Don John's 'I remember' does not bear on the claim of capability |
| P10-P11 | I can, at any unseasonable instant of the night, appoint her to look out at her lady's chamber window. | E | e-borachio-margaret; c-margaret-window (unresolved: nothing in the excerpt tests it) |  |
| P12-P14 | The poison of that lies in you to temper. Go you to the prince ... Proof enough to misuse the prince, to vex Claudio, to undo Hero and kill Leonato. | E | e-borachio-plans (kind plan, intent deceive) | the plan's four aims are text inside the event |
| P15 | Only to despite them, I will endeavour any thing. | E | e-john-agrees; c-john-spite (confirmed) |  |
| P16 | Go, then; find me a meet hour to draw Don Pedro and the Count Claudio alone ... that jealousy shall be called assurance and all the preparation overthrown. | E | e-borachio-plans; h-window-staging; the false report is c-hero-disloyal (asserted later) | the staged scene is a future event: held, not an event |
| P17-P18 | Grow this to what adverse issue it can, I will put it in practise ... thy fee is a thousand ducats. Be you constant in the accusation | E | e-john-agrees; h-fee (held, waits on h-window-staging) | the amount (a thousand ducats) is text |
| P19-P20 | I will presently go learn their day of marriage. [Exeunt] | E | e-john-goes; h-john-learn-day (fulfilled by e-john-asks-day) |  |
| P21-P22 | ACT 2, SCENE III. LEONATO'S orchard. [Enter BENEDICK] | E | e-boy-sent (place orchard) |  |
| P23-P29 | Boy! ... In my chamber-window lies a book ... I am here already, sir. ... I would have thee hence, and here again. | E | e-boy-sent; person boy (unnamed) | the book is never used again; no thing made for it |
| P30.1 | I do much wonder that one man ... such a man is Claudio ... now is he turned orthography | S | e-benedick-soliloquy; the account of Claudio's changes is text | a description of someone else's change, with no event for it |
| P30.2 | May I be so converted ... till he have made an oyster of me, he shall never make me such a fool. | E | c-benedick-never-love; s-benedick-stance |  |
| P30.3 | One woman is fair, yet I am well; ... Rich she shall be ... her hair shall be of what colour it please God. | S | e-benedick-soliloquy; the list of requirements is text | a list of conditions on his love, never tested in the excerpt |
| P30.4 | Ha! the prince and Monsieur Love! I will hide me in the arbour. [Withdraws] | E | e-benedick-hides (conceal, from four); s-benedick-hidden |  |
| P31-P32 | [Withdraws] [Enter DON PEDRO, CLAUDIO, and LEONATO] | E | e-benedick-hides; e-pedro-spots (who) |  |
| P33-P36 | Come, shall we hear this music? ... See you where Benedick hath hid himself? ... We'll fit the kid-fox with a pennyworth. | E | e-pedro-spots (manner within hearing, intent to be overheard); knowledge don-pedro/claudio know he is hidden | the intent is a free-text field on the event |
| P37-P44 | Come, Balthasar, we'll hear that song again ... Note, notes, forsooth, and nothing. | S | e-balthasar-sings (the reluctance and the pun on 'noting') | the wordplay is text |
| P45-P48 | [Air] ... [The Song] Sigh no more, ladies, sigh no more ... | P | e-balthasar-sings (an event; the lyric is not stored) | the song's words are voice and not held |
| P46 | Now, divine air! now is his soul ravished! ... a horn for my money | E | e-benedick-mocks-song |  |
| P49-P51 | By my troth, a good song. And an ill singer, my lord. Ha, no, no, faith | E | e-pedro-arranges-serenade |  |
| P52 | An he had been a dog that should have howled thus, they would have hanged him ... the night-raven | E | e-benedick-mocks-song |  |
| P53-P56 | I pray thee, get us some excellent music; for to-morrow night we would have it at the Lady Hero's chamber-window. ... [Exit BALTHASAR] | E | e-pedro-arranges-serenade; h-serenade (open) |  |
| P57 | Come hither, Leonato. What was it you told me of to-day, that your niece Beatrice was in love with Signior Benedick? | E | e-pedro-opens; b-leonato-told-pedro (backfilled, established in e-pedro-opens) | 'staged question' is intent, a free-text field |
| P58 | O, ay: stalk on. stalk on; the fowl sits. I did never think that lady would have loved any man. | E | e-claudio-stalk (audience: Don Pedro); bears undermines on c-beatrice-loves-benedick | no stage direction marks it as an aside; the encoder set the audience |
| P59 | No, nor I neither; but most wonderful that she should so dote on Signior Benedick, whom she hath in all outward behaviors seemed ever to abhor. | E | e-leonato-asserts; c-beatrice-loves-benedick |  |
| P60 | Is't possible? Sits the wind in that corner? | E | e-benedick-doubts; knowledge benedick doubts |  |
| P61 | By my troth, my lord, I cannot tell what to think of it but that she loves him with an enraged affection | E | e-leonato-asserts |  |
| P62-P64 | May be she doth but counterfeit. ... Faith, like enough. ... O God, counterfeit! There was never counterfeit of passion | E | e-pedro-counterfeit | the devil's advocate turn is staged to make the claim credible; only the intent field says so |
| P65-P66 | Why, what effects of passion shows she? ... Bait the hook well; this fish will bite. | E | e-claudio-bait (audience: Don Pedro); bears undermines |  |
| P67-P70 | What effects, my lord? She will sit you, you heard my daughter tell you how. ... I would have sworn it had, my lord; especially against Benedick. | E | e-letter-story |  |
| P71 | I should think this a gull, but that the white-bearded fellow speaks it: knavery cannot, sure, hide himself in such reverence. | E | e-benedick-doubts; knowledge benedick doubts, source leonato | the reasoning for trusting the source is text; the stance carries the doubt |
| P72 | He hath ta'en the infection: hold it up. | E | e-claudio-infection (audience: Don Pedro) |  |
| P73-P82 | Hath she made her affection known to Benedick? ... she tore the letter into a thousand halfpence ... she will do a desperate outrage to herself | E | e-letter-story; c-letter-story (compound claim, one verdict); the letter itself is not a thing | Hero is named as the source of every detail but is not there; nothing records whether she said any of it |
| P83-P90 | It were good that Benedick knew of it by some other ... To what end? He would make but a sport of it ... Were it good, think you? | E | e-staged-debate |  |
| P91-P99 | Hero thinks surely she will die ... He is a very proper man ... As Hector, I assure you ... Christian-like fear | S | e-praise-benedick; the irony is in the wording | the praise is flattery with edges: whether each remark is meant is not stored |
| P100-P105 | Shall we go seek Benedick, and tell him of her love? ... Never tell him ... let it cool the while | E | e-staged-debate |  |
| P106 | Let there be the same net spread for her; and that must your daughter and her gentlewomen carry. The sport will be, when they hold one an opinion of another's dotage, and no such matter | E | e-pedro-sport (audience: Claudio and Leonato); h-net-for-beatrice; contradicts c-beatrice-loves-benedick, c-letter-story, c-benedick-loves-beatrice, c-no-trick | the strongest bearing in the excerpt is one line, spoken so that Benedick does not hear |
| P107 | [Exeunt DON PEDRO, CLAUDIO, and LEONATO] | E | e-party-leaves |  |
| P108.1 | This can be no trick: the conference was sadly borne. They have the truth of this from Hero. | E | e-benedick-resolves; c-no-trick (false); knowledge benedick believes |  |
| P108.2 | I did never think to marry ... I will be horribly in love with her ... the world must be peopled. | E | e-benedick-resolves; s-benedick-stance ends; h-benedick-woo; c-benedick-never-love undermined |  |
| P108.3 | Here comes Beatrice. By this day! she's a fair lady: I do spy some marks of love in her. | E | r-benedick-sees-love (a misreading), e-beatrice-dinner-scorn |  |
| P109-P115 | [Enter BEATRICE] Against my will I am sent to bid you come in to dinner ... a daw ... You have no stomach, signior: fare you well. [Exit] | E | e-beatrice-dinner-scorn; s-beatrice-stance; c-beatrice-scornful supported | the double sense of 'pains' and 'stomach' is voice |
| P116-P118 | ACT 3, SCENE I. LEONATO'S garden. ... run thee to the parlor; There shalt thou find my cousin Beatrice ... bid her steal into the pleached bower | E | e-hero-instructs-margaret (intent deceive); e-margaret-fetches (offscreen) | 'say that thou overheard'st us' is an instruction to lie, held as intent |
| P119-P120 | I'll make her come, I warrant you, presently. [Exit] | E | e-margaret-fetches (offscreen, established in e-beatrice-enters-bower) |  |
| P121 | Now, Ursula, when Beatrice doth come ... Benedick Is sick in love with Beatrice. Of this matter Is little Cupid's crafty arrow made | E | e-hero-plans (intent deceive) | the Cupid figure is voice |
| P122-P125 | [Enter BEATRICE, behind] ... like a lapwing, runs Close by the ground ... the false sweet bait that we lay for it. | E | e-beatrice-enters-bower; s-beatrice-hidden; e-hero-baits; knowledge hero/ursula know she is there | the lapwing and the angling figures are voice |
| P126-P145 | [Approaching the bower] No, truly, Ursula, she is too disdainful ... Benedick loves Beatrice so entirely ... They did entreat me to acquaint her of it ... honest slanders ... Why, every day, to-morrow. | E | e-hero-garden-talk; c-beatrice-scornful; c-benedick-loves-beatrice; c-entreaty | 'honest slanders' (P139) is a promise to defame Beatrice to Benedick: not held as an act |
| P146-P148 | She's limed, I warrant you: we have caught her, madam. ... [Exeunt HERO and URSULA] | E | e-ursula-limed; c-beatrice-caught |  |
| P149-P150 | What fire is in mine ears? ... Contempt, farewell! ... Benedick, love on; I will requite thee ... [Exit] | E | e-beatrice-soliloquy; r-beatrice-condemned; s-beatrice-stance ends; knowledge beatrice believes | the rhymed couplets are voice; the 'wild heart' tamed is a figure |
| P151-P155 | ACT 3, SCENE II. A room in LEONATO'S house ... I will only be bold with Benedick for his company; for ... his tongue is the clapper | E | e-pedro-stays; s-wedding | the room is not tied to a time; see the order note in the README |
| P156-P157 | Gallants, I am not as I have been. So say I methinks you are sadder. | E | e-benedick-admits; bears supports on c-benedick-in-love |  |
| P158-P167 | I hope he be in love. ... I have the toothache. Draw it. Hang it! ... every one can master a grief but he that has it. Yet say I, he is in love. | E | e-claudio-says-love; e-benedick-toothache; e-benedick-conceals-cause (conceal, from three) | the puns on hanging and drawing are voice |
| P168-P183 | There is no appearance of fancy in him ... a' brushes his hat o' mornings ... the old ornament of his cheek hath already stuffed tennis-balls ... his jesting spirit ... now governed by stops ... one that knows him not | E | e-teasing-benedick (an observation of five signs); s-benedick-looks | the five signs are text inside one event, not five |
| P182-P183 | Yes, and his ill conditions; and, in despite of all, dies for him. She shall be buried with her face upwards. | S | e-teasing-benedick (the allusion to Beatrice) | a hint to the audience of the staged scene: not a claim or event |
| P184-P185 | Yet is this no charm for the toothache. Old signior, walk aside with me ... which these hobby-horses must not hear. [Exeunt BENEDICK and LEONATO] | E | e-benedick-walks-aside (conceal, from two); h-benedick-speaks (open) |  |
| P186-P187 | For my life, to break with him about Beatrice. 'Tis even so. Hero and Margaret have by this played their parts with Beatrice; and then the two bears will not bite one another | E | e-claudio-says-played; c-hero-played-parts (likely: Hero in the garden, Margaret as courier); r-bears | Ursula also played a part and is not named: a claim is not exhaustive |
| P188-P194 | [Enter DON JOHN] My lord and brother, God save you! ... In private? ... yet Count Claudio may hear | E | e-john-enters |  |
| P195-P197 | Means your lordship to be married to-morrow? ... You know he does. ... I know not that, when he knows what I know. | E | e-john-asks-day (fulfils h-john-learn-day); h-wedding | he asks what he already knows; the irony is not stored |
| P198-P199 | If there be any impediment, I pray you discover it. You may think I love you not: let that appear hereafter ... in dearness of heart hath holp to effect your ensuing marriage | E | e-john-feigns-zeal (conceal, from two); c-john-zeal (false by rival: c-john-spite is true) |  |
| P200-P205 | Why, what's the matter? ... the lady is disloyal. ... Leonato's Hero, your Hero, every man's Hero ... you shall see her chamber-window entered, even the night before her wedding-day | E | e-john-accuses; c-hero-disloyal (false); h-john-shows | P203 is given to Don Pedro by the transcription; sense and the next lines make it Don John's |
| P206-P210 | May this be so? I will not think it. ... If I see any thing to-night why I should not marry her ... there will I shame her. ... I will join with thee to disgrace her. | E | e-claudio-doubts; e-claudio-vows; h-claudio-shame (waits on h-john-shows); knowledge claudio, don-pedro doubt |  |
| P208 | If you dare not trust that you see, confess not that you know: if you will follow me, I will show you enough | E | e-john-accuses; h-john-shows |  |
| P211 | I will disparage her no farther till you are my witnesses: bear it coldly but till midnight | E | e-john-sets-terms |  |
| P212-P214 | O day untowardly turned! O mischief strangely thwarting! O plague right well prevented! so will you say when you have seen the sequel. | E | e-lament; r-john-irony (a reading held by the reader) | the same line is sympathy to two hearers and triumph to the third, which the text says nowhere |
| P215 | [Exeunt] | E | e-lament |  |

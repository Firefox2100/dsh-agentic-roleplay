# Ledger: The Gift of the Magi

Two strands that only meet at the end: Della's afternoon (on the page) and Jim's afternoon (offstage, told once, in his own words, in the last paragraph). Each gift defeats the other. A narrator who talks to the reader steps in and out of the story throughout.

Each row is a unit of the source (a sentence or a clause group, `P<paragraph>.<n>`), with how the v1 encoding (current formats), the draft encoding (first evolved model, `draft/story.json`) and the v2 encoding (`v2/story.json`) hold it. `turn T rR` names the event of `v1/history.json` with that turn and round; `eNN`, `sNN`, `c-...`, `h-...`, `r-...` are ids in the draft or v2 story.

Classes: **E** encoded structurally; **S** stuffed into free text or a field not meant for it; **N** not representable (dropped); **P** projection: telling, voice or figure, not stored.

| Units | E | S | N | P |
|---|---|---|---|---|
| v1 (96) | 36 | 38 | 10 | 12 |
| draft (96) | 54 | 24 | 9 | 9 |
| v2 (96) | 51 | 25 | 9 | 11 |

| Ref | Source (abridged) | v1 | v1 where | draft | draft where | v2 | v2 where | Note |
|---|---|---|---|---|---|---|---|---|
| P01.1 | One dollar and eighty-seven cents. That was all. | E | variable cash = 187 on della (character start) | E | states della cash 187; fact f-cash-della-start | E | states della cash 187; s02 |  |
| P01.2 | And sixty cents of it was in pennies. | S | turn 1 r1 text only | N | - | N | - | A sum made of coins: neither model keeps denominations. |
| P01.3 | Pennies saved one and two at a time by bulldozing the grocer ... until one's cheeks burned with the silent imputation of parsimony | S | della background text | E | b01 iterative, who della + grocer-etc | E | b01 iterative, who della + grocer-etc |  |
| P01.4 | Three times Della counted it. | S | turn 1 r1 text | S | e01 text | S | e01 text |  |
| P01.5 | And the next day would be Christmas. | S | turn 1 r1 text; no calendar date, the year had to be invented in starting_time | E | time.anchors christmas-eve --12-24 | E | time.anchors christmas-eve --12-24 |  |
| P02.1 | There was clearly nothing to do but flop down on the shabby little couch and howl. So Della did it. | E | turn 1 r2; feature couch | E | e02 feeling | E | e02 feeling |  |
| P02.2 | Which instigates the moral reflection that life is made up of sobs, sniffles, and smiles | P | - | P | - | P | - | Narrator's aside. |
| P03.1 | While the mistress of the home is gradually subsiding from the first stage to the second, take a look at the home. | P | - | E | telling s03 mode pause | P | telling: projection, not stored (the turn order is the telling) | The narrator stops the story to describe while the crying goes on. |
| P03.2 | A furnished flat at $8 per week. | S | flat description text | S | states flat description | S | states flat description |  |
| P03.3 | It did not exactly beggar description, but it certainly had that word on the lookout for the mendicancy squad. | P | - | P | - | P | - |  |
| P04.1 | In the vestibule below was a letter-box into which no letter would go, and an electric button from which no mortal finger could coax a ring. | S | vestibule description | S | states vestibule description | S | states vestibule description |  |
| P04.2 | a card bearing the name 'Mr. James Dillingham Young.' | S | vestibule feature card | S | states vestibule description | S | states vestibule description |  |
| P05.1 | The 'Dillingham' had been flung to the breeze during a former period of prosperity when its possessor was being paid $30 per week. Now ... $20 | S | variable weekly_pay holds 2000; the earlier 3000 and the change are lost | E | states weekly_pay 3000 until e00, 2000 after; event e00 undated | E | states weekly_pay 3000 until e00, 2000 after; event e00 undated | v1 variables have a current value only. |
| P05.1 | (the letters looked blurred, as though contracting to a modest D) | P | - | P | - | P | - |  |
| P05.2 | whenever Mr. James Dillingham Young came home ... he was called 'Jim' and greatly hugged by Mrs. James Dillingham Young | S | della->jim relationship summary | E | b02 iterative | E | b02 iterative |  |
| P05.3 | already introduced to you as Della. Which is all very good. | P | - | P | - | P | - |  |
| P06.1 | Della finished her cry and attended to her cheeks with the powder rag. | E | turn 1 r2 | E | e02 | E | e02 |  |
| P06.2 | She stood by the window and looked out dully at a grey cat walking a grey fence in a grey backyard. | S | flat window feature description; turn 1 r2 text | S | e02 text | S | e02 text |  |
| P06.3 | To-morrow would be Christmas Day, and she had only $1.87 with which to buy Jim a present. | S | turn 1 r1 text, intent of della | E | e02; state intent | E | e02; state intent |  |
| P06.4 | She had been saving every penny she could for months, with this result. Twenty dollars a week doesn't go far. | S | della background text | E | b01; state weekly_pay | E | b01; state weekly_pay |  |
| P06.5 | Expenses had been greater than she had calculated. They always are. | N | - | N | - | N | - | A past cause of the shortfall and a generalisation; neither kept. |
| P06.6 | Many a happy hour she had spent planning for something nice for him. | S | della intent (quest) | S | state intent | S | state intent | The hours spent planning are a duration over past time. |
| P06.7 | Something fine and rare and sterling ... worthy of the honour of being owned by Jim. | S | intent name text | S | state intent text | S | state intent text | The standard a gift must meet is prose. |
| P07.1 | There was a pier-glass between the windows of the room. | E | feature pier-glass of flat | N | - | N | - | draft entities have no list of features of a place; only a description text. |
| P07.2 | A very thin and very agile person may, by observing his reflection in a rapid sequence of longitudinal strips, obtain a fairly accurate conception of his looks. Della, being slender, had mastered the art. | N | - | N | - | N | - | A skill is not modelled. |
| P08.1 | Suddenly she whirled from the window and stood before the glass. | E | turn 1 r3 | E | e03 | E | e03 |  |
| P08.2 | Her eyes were shining brilliantly, but her face had lost its colour within twenty seconds. | S | turn 1 r3 text | S | e03 text | S | e03 text |  |
| P08.3 | Rapidly she pulled down her hair and let it fall to its full length. | E | turn 1 r3; item hair | E | e03, thing hair | E | e03, thing hair |  |
| P09.1 | two possessions ... in which they both took a mighty pride. One was Jim's gold watch that had been his father's and his grandfather's. The other was Della's hair. | S | item descriptions (watch, hair) say so; no 'pride' or provenance field | S | states meaning for watch and hair | S | states meaning for watch and hair |  |
| P09.2 | Had the Queen of Sheba lived in the flat across the airshaft ... Had King Solomon been the janitor ... | N | - | E | h01, h02 in frame narrator-hypothetical, realised false | S | reading r-h (narrator, text only; no events) | A hypothetical used to measure a pride. |
| P10.1 | So now Della's beautiful hair fell about her, rippling and shining like a cascade of brown waters. It reached below her knee and made itself almost a garment for her. | E | variable hair 'below the knee'; item description | E | states hair below the knee | E | states hair below the knee |  |
| P10.2 | And then she did it up again nervously and quickly. Once she faltered for a minute and stood still while a tear or two splashed on the worn red carpet. | S | turn 1 r3 text | S | e03 text | S | e03 text |  |
| P11.1 | On went her old brown jacket; on went her old brown hat. | N | clothing is not in any record | N | - | N | - | Clothing is not an item the story needs, so neither model carries it. |
| P11.2 | she fluttered out the door and down the stairs to the street. | E | turn 2 r1; exits flat -> vestibule -> street | E | e04 | E | e04 |  |
| P12.1 | Where she stopped the sign read: 'Mme. Sofronie. Hair Goods of All Kinds.' One flight up Della ran, and collected herself, panting. | E | place sofronie-shop | E | place sofronie-shop; e04 | E | place sofronie-shop; e04 |  |
| P12.2 | Madame, large, too white, chilly, hardly looked the 'Sofronie.' | E | sofronie summary | S | people sofronie has a name only | S | people sofronie has a name only | draft entity sheets were kept thin; appearance would sit in a summary. |
| P12.2 | (the name does not suit her) | P | - | P | - | P | - |  |
| P13.1 | 'Will you buy my hair?' asked Della. | E | turn 2 r2 | E | e05 | E | e05 |  |
| P14.1 | 'I buy hair,' said Madame. 'Take yer hat off and let's have a sight at the looks of it.' | E | turn 2 r2; sofronie speech style | E | e05; sofronie speech | E | e05; sofronie speech |  |
| P15.1 | Down rippled the brown cascade. | S | turn 2 r2 text | S | e05 text | S | e05 text |  |
| P16.1 | 'Twenty dollars,' said Madame, lifting the mass with a practised hand. | E | turn 2 r3 variable_changes: della +2000, sofronie -2000 | E | e05 effects adjust +2000 | E | e05 effects adjust +2000 |  |
| P17.1 | 'Give it to me quick,' said Della, | E | turn 2 r2 text | E | e05 | E | e05 |  |
| P17.2 | (the cutting itself is never narrated) | S | turn 2 r3: an event had to be invented; hair item removed and given; variable hair set | E | e05 status 'partly implied'; effects transfer hair | E | e05 basis implied; effects transfer hair |  |
| P18.1 | Oh, and the next two hours tripped by on rosy wings. Forget the hashed metaphor. | S | the two hours are in the event text; the clock sidecar | E | e06 duration PT2H; time.spans span-shopping | E | e06 duration PT2H; time.spans span-shopping | The aside about the metaphor is P. |
| P18.2 | She was ransacking the stores for Jim's present. | E | turn 3 r1 | E | e06 | E | e06 |  |
| P19.1 | She found it at last. It surely had been made for Jim and no one else. There was no other like it in any of the stores | S | turn 3 r2 text; item chain unique | S | e07 text | S | e07 text |  |
| P19.2 | It was a platinum fob chain simple and chaste in design, properly proclaiming its value by substance alone and not by meretricious ornamentation | E | item chain description | S | thing chain has a name only | S | thing chain has a name only |  |
| P19.3 | As soon as she saw it she knew that it must be Jim's. It was like him. Quietness and value | S | turn 3 r2 text | S | e07 text | S | e07 text |  |
| P19.4 | Twenty-one dollars they took from her for it, and she hurried home with the 87 cents. | S | variable cash -2100; 'they' needed an invented group character 'clerks' | E | e07 effects; people clerks unnamed:true | E | e07 effects; people clerks unnamed:true | v1 had to make someone up so the money and the chain could change hands. |
| P19.5 | With that chain on his watch Jim might be properly anxious about the time in any company. | N | - | N | - | N | - | A wish about a future use. |
| P19.6 | Grand as the watch was, he sometimes looked at it on the sly on account of the old leather strap that he used in place of a chain. | S | watch description | E | b03 iterative; thing strap | E | b03 iterative; thing strap |  |
| P20.1 | When Della reached home her intoxication gave way a little to prudence and reason. | N | - | N | - | N | - | A feeling change on arrival: dropped by both. |
| P20.2 | She got out her curling irons and lighted the gas and went to work repairing the ravages made by generosity added to love. | E | turn 4 r1 | E | e08 | E | e08 |  |
| P20.3 | Which is always a tremendous task, dear friends—a mammoth task. | P | - | P | - | P | - |  |
| P21.1 | Within forty minutes her head was covered with tiny, close-lying curls that made her look wonderfully like a truant schoolboy. | E | turn 4 r1; variable hair 'close-lying curls' | E | e08 duration PT40M; state hair curls | E | e08 duration PT40M; state hair curls |  |
| P21.2 | She looked at her reflection in the mirror long, carefully, and critically. | S | turn 4 r2 text | S | e09 text | S | e09 text |  |
| P22.1 | 'If Jim doesn't kill me ... he'll say I look like a Coney Island chorus girl. But what could I do ... with a dollar and eighty-seven cents?' | S | turn 4 r2 text: a prediction in prose | E | e09; a01 and a02 in frame della-anticipates, realised false | E | e09; h-a01 and h-a02 as held (not realised) |  |
| P23.1 | At 7 o'clock the coffee was made and the frying-pan was on the back of the stove hot and ready to cook the chops. | S | turn 5 r1; the hour only in the clock sidecar | E | e10 at --12-24T19:00 | E | e10 at --12-24T19:00 |  |
| P24.1 | Jim was never late. | N | - | S | states jim habit never late | S | states jim habit never late |  |
| P24.2 | Della doubled the fob chain in her hand and sat on the corner of the table near the door that he always entered. | E | turn 5 r2; chain held by della | E | e11 | E | e11 |  |
| P24.3 | Then she heard his step on the stair away down on the first flight, and she turned white for just a moment. | S | turn 5 r2 text | S | e11 text | S | e11 text |  |
| P24.4 | She had a habit of saying little silent prayers about the simplest everyday things | N | - | S | states della habit | S | states della habit |  |
| P24.5 | 'Please God, make him think I am still pretty.' | E | turn 5 r2 text | E | e11 says | E | e11 says |  |
| P25.1 | The door opened and Jim stepped in and closed it. | E | turn 6 r1; move jim -> flat in turn 5 | E | e12 | E | e12 |  |
| P25.2 | He looked thin and very serious. Poor fellow, he was only twenty-two—and to be burdened with a family! He needed a new overcoat and he was without gloves. | E | jim age 22, appearance; the need for a coat and gloves is text | E | people jim age; states jim appearance | E | people jim age; states jim appearance |  |
| P26.1 | Jim stopped inside the door, as immovable as a setter at the scent of quail. | P | - | P | - | P | - |  |
| P26.2 | His eyes were fixed upon Della, and there was an expression in them that she could not read, and it terrified her. | E | turn 6 r2 perception content, accuracy partial | E | e13; knowledge della believes (false) of e13 | E | e13; knowledge della believes (false) of e13 |  |
| P26.3 | It was not anger, nor surprise, nor disapproval, nor horror, nor any of the sentiments that she had been prepared for. | S | turn 6 r2 text | N | - | N | - | What the look was not. |
| P27.1 | Della wriggled off the table and went for him. | S | turn 6 r3 text | S | e14 text | S | e14 text |  |
| P28.1 | 'Jim, darling, don't look at me that way. I had my hair cut off and sold it because I couldn't have lived through Christmas without giving you a present...' | E | turn 6 r3 perception content (jim told) | E | e14 says; knowledge jim knows f-della-sold-hair from e14 | E | e14 says; knowledge jim knows e05 from e14 |  |
| P29.1 | 'You've cut off your hair?' asked Jim, laboriously, as if he had not arrived at that patent fact yet | E | turn 6 r4 | E | e15 | E | e15 |  |
| P30.1 | 'Cut it off and sold it,' said Della. 'Don't you like me just as well, anyhow? I'm me without my hair, ain't I?' | E | turn 6 r4 perception content | E | e15 says | E | e15 says |  |
| P31.1 | Jim looked about the room curiously. | N | - | N | - | N | - | A small act that shows his daze. |
| P32.1 | 'You say your hair is gone?' he said, with an air almost of idiocy. | E | turn 6 r4 | E | e15 | E | e15 |  |
| P33.1 | 'You needn't look for it,' ... 'It's sold ... Maybe the hairs of my head were numbered, but nobody could ever count my love for you. Shall I put the chops on, Jim?' | S | turn 6 r4 perception content shortens it | E | e15 says | E | e15 says |  |
| P34.1 | Out of his trance Jim seemed quickly to wake. He enfolded his Della. | E | turn 6 r5 | E | e16 | E | e16 |  |
| P34.2 | For ten seconds let us regard with discreet scrutiny some inconsequential object in the other direction. Eight dollars a week or a million a year—what is the difference? ... | P | - | P | - | P | - | The narrator looks away and moralises. |
| P34.3 | The magi brought valuable gifts, but that was not among them. This dark assertion will be illuminated later on. | P | lore magi (the legend only) | E | telling s22 note: a promise about later | P | telling: projection, not stored (the turn order is the telling) |  |
| P35.1 | Jim drew a package from his overcoat pocket and threw it upon the table. | E | turn 6 r6 | E | e17 | E | e17 |  |
| P36.1 | 'Don't make any mistake, Dell, about me. I don't think there's anything in the way of a haircut or a shave or a shampoo that could make me like my girl any less. But if you'll unwrap that package you may see why you had me going a while at first.' | S | turn 6 r6 text | E | e17 says; reading r-stare; explains e13 | E | e17 says; reading r-stare; explains e13 |  |
| P37.1 | White fingers and nimble tore at the string and paper. And then an ecstatic scream of joy; and then, alas! a quick feminine change to hysterical tears and wails | E | turn 6 r7 | E | e18 | E | e18 |  |
| P37.2 | necessitating the immediate employment of all the comforting powers of the lord of the flat. | S | turn 6 r7 text | S | e18 who jim | S | e18 who jim |  |
| P38.1 | For there lay The Combs—the set of combs, side and back, that Della had worshipped for long in a Broadway window. | E | item combs | E | thing combs; states combs location; state della desire | E | thing combs; states combs location; state della desire |  |
| P38.2 | Beautiful combs, pure tortoise shell, with jewelled rims ... They were expensive combs, she knew, and her heart had simply craved and yearned over them without the least hope of possession. | S | item description; the longing in a sentence | S | state desire text | S | state desire text |  |
| P38.3 | And now, they were hers, but the tresses that should have adorned the coveted adornments were gone. | S | item_changes jim gives combs; the irony is for the reader | E | e18 effects transfer combs; facts f-gifts-useless | E | e18 effects transfer combs; s24 |  |
| P39.1 | But she hugged them to her bosom, and at length she was able to look up with dim eyes and a smile and say: 'My hair grows so fast, Jim!' | E | turn 6 r8 | E | e19 says | E | e19 says |  |
| P40.1 | And then Della leaped up like a little singed cat and cried, 'Oh, oh!' | S | turn 6 r8 text | S | e20 text | S | e20 text |  |
| P41.1 | Jim had not yet seen his beautiful present. She held it out to him eagerly upon her open palm. | E | turn 6 r8; chain; jim has not seen it (no record: absence is the default) | E | e20; knowledge jim unaware of e07 until e20 | E | e20; knowledge jim unaware of e07 until e20 |  |
| P42.1 | 'Isn't it a dandy, Jim? I hunted all over town to find it. You'll have to look at the time a hundred times a day now. Give me your watch.' | E | turn 6 r8 text | E | e20 says | E | e20 says |  |
| P43.1 | Instead of obeying, Jim tumbled down on the couch and put his hands under the back of his head and smiled. | S | turn 6 r9 text | S | e21 text | S | e21 text |  |
| P44.1 | 'Dell, let's put our Christmas presents away and keep 'em a while. They're too nice to use just at present.' | E | turn 6 r9 text | E | e21 says | E | e21 says |  |
| P44.2 | 'I sold the watch to get the money to buy your combs.' | S | turn 3 r3 and r4 are events invented for it, and v1 cannot say they were learned only now; 'reported-later' is a tag | E | e-w1, e-w2 status reported reported_by jim; telling s26 analepsis reveals f-jim-sold-watch | E | e-w1, e-w2 basis reported, origin offscreen reported_by jim |  |
| P44.3 | 'And now suppose you put the chops on.' | N | - | E | e21 says | E | e21 says |  |
| P45.1 | The magi, as you know, were wise men—wonderfully wise men—who brought gifts to the Babe in the manger. They invented the art of giving Christmas presents. | E | lore magi | P | - | P | - | draft holds no lore; this is narrator commentary. |
| P45.2 | And here I have lamely related to you the uneventful chronicle of two foolish children in a flat who most unwisely sacrificed for each other the greatest treasures of their house. | P | - | E | reading r-wise holder narrator; telling s27 commentary | E | reading r-wise holder narrator |  |
| P45.3 | But in a last word to the wise of these days let it be said that of all who give gifts these two were the wisest. They are the magi. | P | - | E | reading r-wise | E | reading r-wise |  |

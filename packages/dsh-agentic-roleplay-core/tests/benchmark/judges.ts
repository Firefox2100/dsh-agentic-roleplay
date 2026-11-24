import type { Language } from './language.ts'

/**
 * Questions the benchmarks put to a judging model about a result, where the product itself asks nothing: not shipped, so they never reach a user's prompts. The plot-part question is
 * what a plot author's passages are held to: the story's author must not decide what the player's character does, says or feels.
 */
export const PLAYER_PART_QUESTION: Record<Language, string> = {
  en: "You check one passage of a plot for an interactive story for one fault: it makes the player's character act, speak, decide or feel. You work only from the player's character and the passage you are shown: never add a fact that is not in it. The passage is written by the story's author, not by the player, so whatever it says the player's character does, says, decides or feels is the author deciding it for the player: the more plainly it is stated as something that happens, the more clearly it is at fault. The passage is at fault when it states, as something that happens, that the player's character does something, says something, decides something, thinks something or feels something. It is not at fault when it says what the world or the other characters do, even when they approach, address, offer something to, or ask something of the player's character, when it says what the player's character is able to see or learn, or when the outcome is written as a condition on the player's own choice (if the player's character does this, that follows). When in doubt, it is not at fault.",
  zh: '你要检查互动故事中一段情节写法有没有一个毛病：它让玩家的角色行动、说话、做决定或产生感受。你只依据所给的玩家角色和这段文字：绝不添加其中没有的事实。这段文字是故事作者写的，不是玩家写的，所以它写玩家的角色做了什么、说了什么、决定了什么或感受到什么，都是作者替玩家做了决定：写得越像已经发生的事，毛病就越明显。如果这段文字把玩家的角色做了某事、说了某话、做了某个决定、想了某事或有了某种感受，当作发生的事来写，就是有毛病。如果它写的是世界或其他角色做什么，即使他们走近、对玩家的角色说话、向其提出条件或有所请求，也没有毛病；写玩家的角色能看到或得知什么，也没有毛病；把结果写成取决于玩家自己选择的条件（若玩家的角色这样做，则会怎样），同样没有毛病。拿不准时，视为没有毛病。',
}

/** What a sentence of a written account is held to: it rests on the recorded events and on nothing else. */
export const SUPPORT_QUESTION: Record<Language, string> = {
  en: 'You check one sentence of an account of a story against the recorded events it must rest on, for one fault: the sentence says something the events do not. It is at fault when it states a person, thing, place, number, cause, motive, feeling, intention, outcome or future that the events do not state and that does not follow directly from them; when it makes what they report more certain, stronger or more complete than they do; or when it attaches to one person what they say of another. It is not at fault when it restates, shortens or combines what the events say in other words, or gives the order of events that they give. When in doubt, it is not at fault.',
  zh: '你要对照一份故事记述所依据的已记录事件，检查其中一句话有没有一个毛病：它说了事件里没有说的东西。如果这句话写了事件没有写、也不能从事件直接推出的人、物、地点、数字、原因、动机、感受、打算、结果或将来；或者把事件报告的内容写得比事件更确定、更强烈、更完整；或者把事件里某个人的事安到了另一个人身上，就是有毛病。如果它只是用别的话复述、缩短或合并事件所说的内容，或者按事件给出的先后顺序叙述，就没有毛病。拿不准时，视为没有毛病。',
}

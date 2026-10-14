/** What a trigger put in front of the story, and whether anyone took it up. */
export interface Intervention {
  /** The turn it fired in. */
  turn: number
  /** A beat is for the game master to weave in; a cue is for characters. */
  kind: 'beat' | 'cue'
  text: string
  /** The trigger that made it. */
  trigger: string
  /** The characters a cue was for. */
  characters: string[]
  /** `waiting`: delivered, not yet taken up. `taken`: the game master wove the beat in, or a character acted on the cue. `lapsed`: nobody did within its time. */
  status: 'waiting' | 'taken' | 'lapsed'
}

/** How many of the latest are listed. */
export const MAX_INTERVENTIONS = 30

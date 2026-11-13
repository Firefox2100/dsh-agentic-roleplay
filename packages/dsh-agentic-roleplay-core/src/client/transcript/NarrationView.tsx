import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NarrationNodeData } from './definitions.ts'
import css from './NarrationView.module.css'
import { IconPlay } from '../ui/icons.tsx'
import { Button } from '../ui/Button.tsx'
import { useMediaCapabilities } from '../media-capabilities.ts'


/** A steady colour per speaker, so a character looks the same wherever it speaks. */
function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** Characters whose portrait the host has none of, so that each line does not ask again. */
const withoutPortrait = new Set<string>()

/** The round picture of a speaker: its portrait when it has one (the story's canonical reference image), else the first letter on a colour of its own. */
function Avatar({ sessionId, character, name }: { sessionId: string; character: string; name: string }) {
  const story = sessionId.startsWith('session-') ? sessionId.slice(8) : sessionId
  const key = `${story}/${character}`
  const [missing, setMissing] = useState(withoutPortrait.has(key))
  if (!missing) {
    return <img className={`${css.avatar} ${css.avatarImage}`} data-rp="avatar" src={`roleplay-api/sessions/world/character/portrait/file?id=${encodeURIComponent(story)}&key=${encodeURIComponent(character)}`} alt="" aria-hidden="true" decoding="async" onError={() => { withoutPortrait.add(key); setMissing(true) }} />
  }
  return <div className={css.avatar} data-rp="avatar" style={{ background: `hsl(${hueOf(name)} 32% 40%)` }} aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</div>
}

/** Plays the segments of a turn as speech, narration and each speaker with its own voice; `playing` is true while the audio is being made or played. */
export function useNarrationPlayer(sessionId: string): { playing: boolean; play: (segments: NarrationNodeData['segments']) => Promise<void> } {
  const [playing, setPlaying] = useState(false)
  const play = async (segments: NarrationNodeData['segments']): Promise<void> => {
    setPlaying(true)
    try {
      const id = sessionId.startsWith('session-') ? sessionId.slice(8) : sessionId
      const state = await (await fetch(`roleplay-api/sessions/world?id=${encodeURIComponent(id)}`)).json() as { narrationVoice?: string; characters: { key: string; voice?: string }[] }
      const voices = new Map(state.characters.map(character => [character.key, character.voice]))
      const parts = segments.map(segment => ({ text: segment.text, voice: segment.type === 'utterance' ? voices.get(segment.character) : state.narrationVoice }))
      const response = await fetch('roleplay-api/speech/synthesize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts }) })
      if (!response.ok) throw new Error(await response.text())
      const url = URL.createObjectURL(await response.blob()); const audio = new Audio(url)
      audio.onended = () => { URL.revokeObjectURL(url); setPlaying(false) }; audio.onerror = () => { URL.revokeObjectURL(url); setPlaying(false) }
      await audio.play()
    } catch (error) { console.warn('roleplay: speech could not be played', error); setPlaying(false) }
  }
  return { playing, play }
}

/** The button that plays a whole turn; it sits beside the picture button under the turn. */
export function PlayTurn({ data, player, t }: { data: NarrationNodeData; player: ReturnType<typeof useNarrationPlayer>; t: TranslateNS<'roleplay.transcript'> }) {
  return <Button size="sm" disabled={player.playing} title={t('speakAll')} onClick={() => { void player.play(data.segments) }}><IconPlay aria-hidden="true" /> {t(player.playing ? 'speaking' : 'speakAll')}</Button>
}

/** What the player reads for one turn: the characters' words and the narration between them. */
export function NarrationView({ data, sessionId, t, player }: { data: NarrationNodeData; sessionId: string; t: TranslateNS<'roleplay.transcript'>; player: ReturnType<typeof useNarrationPlayer> }) {
  const { playing, play } = player
  const speech = useMediaCapabilities()?.synthesis === true
  return (
    <div className={css.output} data-testid="roleplay-narration" data-rp="narration">
      {data.ooc !== undefined && (
        <p className={data.ooc.legal ? css.oocNote : css.oocRefused} data-testid="roleplay-ooc" data-rp="ooc">
          <span className={css.oocLabel}>{t(data.ooc.question === true ? 'oocAnswer' : data.ooc.legal ? 'oocDone' : 'oocRefused')}</span> {data.ooc.note}
        </p>
      )}
      {data.segments.map((segment, index) => segment.type === 'narration'
        ? <p key={index} className={css.narration} data-rp="prose">{segment.text}</p>
        : (
          <div key={index} className={css.line} data-testid="roleplay-utterance" data-rp="utterance">
            <Avatar sessionId={sessionId} character={segment.character} name={segment.name} />
            <div className={css.speech}>
              <span className={css.name} data-rp="speaker">{segment.name}{speech && <button type="button" className={css.playLine} disabled={playing} aria-label={t('speakLine')} title={t('speakLine')} onClick={() => { void play([segment]) }}><IconPlay aria-hidden="true" /></button>}</span>
              <span className={css.words} data-rp="words">{segment.text}</span>
            </div>
          </div>
        ))}
      {data.rolls !== undefined && data.rolls.length > 0 && (
        <details className={css.dice} data-testid="roleplay-dice" data-rp="dice">
          <summary className={css.diceSummary}>{t('diceRolled', { count: String(data.rolls.length) })}</summary>
          <ul className={css.diceList}>
            {data.rolls.map(roll => <li key={roll.id} data-rp="roll">{roll.by === 'player' ? `${t('dicePlayer')} ` : ''}{roll.text}</li>)}
          </ul>
        </details>
      )}
      {data.repaired && <span className={css.note}>{t('repaired')}</span>}
    </div>
  )
}

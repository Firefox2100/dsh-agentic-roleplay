import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NarrationNodeData } from './definitions.ts'
import css from './NarrationView.module.css'

/** A steady colour per speaker, so a character looks the same wherever it speaks. */
function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** What the player reads for one turn: the characters' words and the narration between them. */
export function NarrationView({ data, sessionId, t }: { data: NarrationNodeData; sessionId: string; t: TranslateNS<'roleplay.transcript'> }) {
  const [playing, setPlaying] = useState(false)
  const play = async (segments: typeof data.segments) => {
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
  return (
    <div className={css.output} data-testid="roleplay-narration">
      <button type="button" className={css.playAll} disabled={playing} title={t('speakAll')} onClick={() => { void play(data.segments) }}>▶ {t(playing ? 'speaking' : 'speakAll')}</button>
      {data.ooc !== undefined && (
        <p className={data.ooc.legal ? css.oocNote : css.oocRefused} data-testid="roleplay-ooc">
          <span className={css.oocLabel}>{t(data.ooc.legal ? 'oocDone' : 'oocRefused')}</span> {data.ooc.note}
        </p>
      )}
      {data.segments.map((segment, index) => segment.type === 'narration'
        ? <p key={index} className={css.narration}>{segment.text}</p>
        : (
          <div key={index} className={css.line} data-testid="roleplay-utterance">
            <div className={css.avatar} style={{ background: `hsl(${hueOf(segment.name)} 32% 40%)` }} aria-hidden="true">
              {Array.from(segment.name)[0]?.toUpperCase()}
            </div>
            <div className={css.speech}>
              <span className={css.name}>{segment.name}<button type="button" className={css.playLine} disabled={playing} title={t('speakLine')} onClick={() => { void play([segment]) }}>▶</button></span>
              <span className={css.words}>{segment.text}</span>
            </div>
          </div>
        ))}
      {data.repaired && <span className={css.note}>{t('repaired')}</span>}
    </div>
  )
}

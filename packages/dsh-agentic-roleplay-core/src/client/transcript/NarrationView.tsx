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
export function NarrationView({ data, t }: { data: NarrationNodeData; t: TranslateNS<'roleplay.transcript'> }) {
  return (
    <div className={css.output} data-testid="roleplay-narration">
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
              <span className={css.name}>{segment.name}</span>
              <span className={css.words}>{segment.text}</span>
            </div>
          </div>
        ))}
      {data.repaired && <span className={css.note}>{t('repaired')}</span>}
    </div>
  )
}

export const PLOT_STATUSES = ['dormant', 'available', 'engaged', 'cooling', 'resolved', 'abandoned'] as const
export type PlotStatus = (typeof PLOT_STATUSES)[number]

export const PLOT_NUDGE_MODES = ['opportunity', 'reminder', 'character', 'consequence', 'escalation', 'breathing_room'] as const
export type PlotNudgeMode = (typeof PLOT_NUDGE_MODES)[number]

export interface PlotDevelopment {
  id: string
  text: string
  mode: PlotNudgeMode
  prerequisites: string[]
  guidance: string
  avoid: string[]
}

export interface PlotDefinition {
  id: string
  name: string
  premise: string
  themes: string[]
  hooks: PlotDevelopment[]
  developments: PlotDevelopment[]
  stakes: string[]
  resolutions: string[]
  participants: string[]
  start: PlotStatus
  pacing: {
    quietTurns: number
    cooldownTurns: number
    cooldownDays: number
  }
}

export interface PlotProgress {
  plot: PlotDefinition
  status: PlotStatus
  introduced: string[]
  rejected: string[]
  lastNudgeTurn: number
  lastNudgeAt?: number
}

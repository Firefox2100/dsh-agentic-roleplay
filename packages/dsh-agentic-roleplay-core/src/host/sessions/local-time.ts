/** An instant as the local date and time in a zone, written the way a world file writes it: `2024-05-01T08:00:00`. */
export function localInstant(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant))
  const part = (type: string): string => parts.find(entry => entry.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`
}

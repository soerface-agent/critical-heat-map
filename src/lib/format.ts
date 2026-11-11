export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (value: number) => String(value).padStart(2, '0')

/** "2024-03-29T…" → "29.03." */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
}

/** "2024-03-29T…" → "29.03.2024" */
export function fullDate(iso: string): string {
  return `${dayMonth(iso)}${iso.slice(0, 4)}`
}

/** Milliseconds → "Fri 29.03.2024 19:04:12", in local time */
export function dateTime(time: number): string {
  const date = new Date(time)
  return `${WEEKDAYS[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${clock(time)}`
}

/** Milliseconds → "19:04:12", in local time */
export function clock(time: number): string {
  const date = new Date(time)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Seconds of riding per second of playback → "Realtime", "10×", "20 min/s", "1 h/s" */
export function speedLabel(speed: number): string {
  const round = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 1 })
  if (speed === 1) return 'Realtime'
  if (speed < 60) return `${round(speed)}×`
  return speed < 3600 ? `${round(speed / 60)} min/s` : `${round(speed / 3600)} h/s`
}

/** 97 → "1 h 37" */
export function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

export function km(value: number, digits = 1): string {
  return value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Removes the date that most titles end with, since it is shown separately */
export function shortTitle(title: string): string {
  return title.replace(/\s*\d{4}-\d{2}-\d{2}$/, '')
}

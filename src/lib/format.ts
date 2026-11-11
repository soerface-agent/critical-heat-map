const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2024-03-29T…" → "29.03." */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
}

/** "2024-03-29T…" → "29.03.2024" */
export function fullDate(iso: string): string {
  return `${dayMonth(iso)}${iso.slice(0, 4)}`
}

/** "2024-03" → "Mar 2024" */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
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

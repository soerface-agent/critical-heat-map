// Kinds of events, keyed by the "type" in tracks.json

import { theme } from './theme.svelte'

export interface EventType {
  label: string
  color: string
  /** Lighter variant that stands out on the dark map */
  dark: string
}

export const EVENT_TYPES: Record<string, EventType> = {
  'critical-mass': { label: 'Critical Mass', color: '#d6266f', dark: '#f0508f' },
  radnacht: { label: 'Radnacht', color: '#2357c6', dark: '#6b9bf2' },
  'ride-of-silence': { label: 'Ride of Silence', color: '#3f3f46', dark: '#d4d4d8' },
  other: { label: 'Other', color: '#c25e00', dark: '#f39a3d' },
}

export function eventType(type: string): EventType {
  return EVENT_TYPES[type] ?? EVENT_TYPES.other
}

/** The color of an event type in the current theme */
export function eventColor(type: string): string {
  const { color, dark } = eventType(type)
  return theme.dark ? dark : color
}

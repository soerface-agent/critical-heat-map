// Kinds of events, keyed by the "type" in tracks.json

export interface EventType {
  label: string
  color: string
}

export const EVENT_TYPES: Record<string, EventType> = {
  'critical-mass': { label: 'Critical Mass', color: '#d6266f' },
  radnacht: { label: 'Radnacht', color: '#2357c6' },
  'ride-of-silence': { label: 'Ride of Silence', color: '#3f3f46' },
  other: { label: 'Other', color: '#c25e00' },
}

export function eventType(type: string): EventType {
  return EVENT_TYPES[type] ?? EVENT_TYPES.other
}

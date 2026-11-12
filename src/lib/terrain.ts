import type { Track } from './state.svelte'

const MINUTE = 60_000

/** Elevation at a time during the ride, interpolated between the samples in the middle of each minute */
function elevationAt({ elevation, from }: Track, time: number): number {
  const at = Math.min(elevation.length - 1, Math.max(0, (time - from) / MINUTE - 0.5))
  const i = Math.floor(at)
  return i + 1 < elevation.length ? elevation[i] + (elevation[i + 1] - elevation[i]) * (at - i) : elevation[i]
}

/** The highest point ridden between two times, NaN without elevations */
export function highestBetween(track: Track, from: number, to: number): number {
  if (track.elevation.length === 0) return NaN
  let highest = Math.max(elevationAt(track, from), elevationAt(track, to))
  const first = Math.max(0, Math.ceil((from - track.from) / MINUTE - 0.5))
  const last = Math.min(track.elevation.length - 1, Math.floor((to - track.from) / MINUTE - 0.5))
  for (let i = first; i <= last; i++) highest = Math.max(highest, track.elevation[i])
  return highest
}

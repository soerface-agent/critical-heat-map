// Shared between the map and scripts/build-tracks.ts, which generates tracks.geojson

export interface TrackProperties {
  /** OSM trace id */
  osm: number
  /** OSM user who uploaded the trace */
  user: string
  title: string
  /** Kind of event, e.g. "critical-mass" or "radnacht" */
  type: string
  /** Page of the trace on openstreetmap.org */
  url: string
  /** ISO timestamp of the first track point */
  start: string | null
}

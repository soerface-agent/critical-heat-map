// Shared between the app and scripts/build-tracks.ts, which generates tracks.geojson

import type { FeatureCollection, MultiLineString } from 'geojson'

/** [west, south, east, north] */
export type BBox = [number, number, number, number]

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
  start: string
  /** ISO timestamp of the last track point */
  end: string
  /** Distance ridden in km */
  km: number
  /** Minutes from the first to the last track point */
  minutes: number
  bbox: BBox
  /** Id of the city the track belongs to, see TrackCollection.cities */
  city: string
}

/** A group of tracks close to each other, named after the place where they start */
export interface City {
  id: string
  name: string
  bbox: BBox
}

/** Positions are [lon, lat, seconds since the start of the track] */
export interface TrackCollection extends FeatureCollection<MultiLineString, TrackProperties> {
  cities: City[]
}

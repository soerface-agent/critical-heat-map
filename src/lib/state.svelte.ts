// State shared by the map, the sidebar and the timeline. The time range and the hidden tracks are
// kept in the query string, the map position in the hash (by MapLibre).

import type { Map } from 'maplibre-gl'
import type { Position } from 'geojson'
import { SvelteSet } from 'svelte/reactivity'
import type { BBox, City, TrackCollection, TrackProperties } from './track-types'

export interface Track extends TrackProperties {
  coordinates: Position[][]
}

/** Inclusive range of months, as "YYYY-MM" */
export interface MonthRange {
  from: string
  to: string
}

// Seconds to draw one track during playback at 1×, and the pause after it (in the same unit)
const DRAW_SECONDS = 1.2
const HOLD = 0.25
const MONTH = /^\d{4}-\d{2}$/

export function trackMonth(track: Track): string {
  return (track.start ?? '').slice(0, 7)
}

function intersects(a: BBox, b: BBox): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3]
}

class AppState {
  collection = $state.raw<TrackCollection | null>(null)
  tracks: Track[] = $derived(
    this.collection?.features.map((feature) => ({ ...feature.properties, coordinates: feature.geometry.coordinates })) ?? [],
  )
  cities: City[] = $derived(this.collection?.cities ?? [])

  /** OSM ids of the tracks the user unchecked */
  hidden = new SvelteSet<number>()
  range = $state<MonthRange | null>(null)
  /** The visible part of the map */
  bounds = $state.raw<BBox | null>(null)
  hovered = $state<number | null>(null)
  map: Map | null = null

  /** Tracks in the map view and the time range: the ones the sidebar lists */
  listed = $derived(this.tracks.filter((track) => this.inView(track) && this.inRange(track)))
  selected = $derived(this.listed.filter((track) => !this.hidden.has(track.osm)))
  /** Tracks drawn on the map while not playing; ones outside the view are clipped by the map anyway */
  drawn = $derived(this.tracks.filter((track) => !this.hidden.has(track.osm) && this.inRange(track)))

  /** The city at the center of the map view, if any */
  city = $derived.by(() => {
    if (!this.bounds) return null
    const [west, south, east, north] = this.bounds
    const x = (west + east) / 2
    const y = (south + north) / 2
    return this.cities.find(({ bbox }) => intersects(bbox, [x, y, x, y])) ?? null
  })

  // Playback: the tracks being played, the one being drawn and how far (0–1, then the hold)
  queue = $state.raw<Track[]>([])
  index = $state(-1)
  progress = $state(0)
  playing = $state(false)
  speed = $state(1)
  current = $derived(this.index >= 0 ? (this.queue[this.index] ?? null) : null)
  #generation = 0

  inView(track: Track): boolean {
    return !this.bounds || intersects(track.bbox, this.bounds)
  }

  inRange(track: Track): boolean {
    const month = trackMonth(track)
    return !this.range || (month >= this.range.from && month <= this.range.to)
  }

  async load(url: string) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    this.collection = await response.json()
  }

  setHidden(tracks: Track[], hidden: boolean) {
    for (const track of tracks) {
      if (hidden) this.hidden.add(track.osm)
      else this.hidden.delete(track.osm)
    }
  }

  showCity(city: City) {
    this.map?.fitBounds(city.bbox, { padding: 40, duration: 800 })
  }

  play() {
    if (this.playing) return
    if (this.index < 0) {
      this.queue = this.selected
      this.index = 0
      this.progress = 0
    }
    if (this.queue.length === 0) return
    this.playing = true

    // A newer play() call, or pause() and stop(), ends this loop
    const generation = ++this.#generation
    let last = performance.now()
    const frame = (now: number) => {
      if (generation !== this.#generation) return
      this.progress += ((now - last) / 1000 / DRAW_SECONDS) * this.speed
      last = now
      if (this.progress >= 1 + HOLD) {
        this.progress = 0
        this.index += 1
      }
      if (this.index >= this.queue.length) return this.stop()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  pause() {
    this.#generation++
    this.playing = false
  }

  stop() {
    this.pause()
    this.queue = []
    this.index = -1
    this.progress = 0
  }

  /** Reads the time range and hidden tracks from the query string */
  readUrl() {
    const params = new URLSearchParams(location.search)
    const from = params.get('from')
    const to = params.get('to')
    this.range = from && to && MONTH.test(from) && MONTH.test(to) ? { from, to } : null
    this.hidden.clear()
    for (const id of params.get('hide')?.split(',') ?? []) {
      if (/^\d+$/.test(id)) this.hidden.add(Number(id))
    }
  }

  /** The query string for the time range and hidden tracks */
  query(): string {
    const params = new URLSearchParams()
    if (this.range) {
      params.set('from', this.range.from)
      params.set('to', this.range.to)
    }
    if (this.hidden.size > 0) params.set('hide', [...this.hidden].sort((a, b) => a - b).join(','))
    // Keep the commas readable
    return params.size > 0 ? '?' + params.toString().replaceAll('%2C', ',') : ''
  }
}

export const app = new AppState()

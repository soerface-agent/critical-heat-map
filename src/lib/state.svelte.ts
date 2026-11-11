// State shared by the map, the sidebar and the timeline. The hidden tracks are kept in the query
// string, the map position in the hash (by MapLibre).

import type { Map } from 'maplibre-gl'
import type { Position } from 'geojson'
import { SvelteSet } from 'svelte/reactivity'
import type { BBox, City, TrackCollection, TrackProperties } from './track-types'

export interface Track extends TrackProperties {
  /** [lon, lat, seconds since the start] */
  coordinates: Position[][]
  /** Start and end in milliseconds */
  from: number
  to: number
}

export interface TimeSpan {
  from: number
  to: number
}

const DAY = 86_400_000
/** Seconds of riding per second of playback offered in the speed menu */
export const SPEEDS = [1, 10, 60, 300, 1200, 3600]
export const MAX_SPEED = 86_400
// Pause in milliseconds after the rides of one evening, before playback skips to the next ones
const HOLD = 1000
// Seconds of playback a finished ride keeps glowing while the next ones are played
const AFTERGLOW = 3
// Smallest time span the timeline zooms in to
const MIN_SPAN = 10 * 60_000
const SIDEBAR_KEY = 'sidebar'
const HEAT_KEY = 'heat'

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage the choice only lasts for this page view
  }
}

function intersects(a: BBox, b: BBox): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3]
}

class AppState {
  collection = $state.raw<TrackCollection | null>(null)
  tracks: Track[] = $derived(
    this.collection?.features.map((feature) => ({
      ...feature.properties,
      coordinates: feature.geometry.coordinates,
      from: Date.parse(feature.properties.start),
      to: Date.parse(feature.properties.end),
    })) ?? [],
  )
  cities: City[] = $derived(this.collection?.cities ?? [])

  /** OSM ids of the tracks the user unchecked */
  hidden = new SvelteSet<number>()
  /** The visible part of the map */
  bounds = $state.raw<BBox | null>(null)
  hovered = $state<number | null>(null)
  sidebarOpen = $state(stored(SIDEBAR_KEY) !== 'closed')
  /** Show the finished rides as a heat map instead of lines in their type colors */
  heat = $state(stored(HEAT_KEY) === 'on')
  map: Map | null = null

  /** Tracks in the map view: the ones the sidebar lists */
  listed = $derived(this.tracks.filter((track) => this.inView(track)))
  selected = $derived(this.listed.filter((track) => !this.hidden.has(track.osm)))
  /** Tracks drawn on the map while not playing; ones outside the view are clipped by the map anyway */
  drawn = $derived(this.tracks.filter((track) => !this.hidden.has(track.osm)))

  /** The city at the center of the map view, if any */
  city = $derived.by(() => {
    if (!this.bounds) return null
    const [west, south, east, north] = this.bounds
    const x = (west + east) / 2
    const y = (south + north) / 2
    return this.cities.find(({ bbox }) => intersects(bbox, [x, y, x, y])) ?? null
  })

  /** All tracks, with a month of space on both sides */
  extent: TimeSpan = $derived.by(() => {
    if (this.tracks.length === 0) return { from: 0, to: 1 }
    return {
      from: Math.min(...this.tracks.map((track) => track.from)) - 31 * DAY,
      to: Math.max(...this.tracks.map((track) => track.to)) + 31 * DAY,
    }
  })
  /** The part of the timeline zoomed in to, or null for all of it */
  view = $state.raw<TimeSpan | null>(null)
  domain: TimeSpan = $derived(this.view ?? this.extent)

  // Playback: the moment shown on the map, or null to show all tracks
  time = $state<number | null>(null)
  playing = $state(false)
  speed = $state(1200)
  /** Tracks underway at the playback time, drawn as far as they got */
  riding = $derived(this.time === null ? [] : this.drawn.filter((track) => track.from <= this.time! && this.time! < track.to))
  /** Tracks drawn in full: all of them, or while playing back, the ones finished */
  finished = $derived(this.time === null ? this.drawn : this.drawn.filter((track) => track.to <= this.time!))

  /**
   * Rides that finished a moment ago, with how far their glow faded (0–1). It fades while the next
   * rides are played, so it lasts through the pause before them and the jump to them
   */
  afterglow = $derived.by(() => {
    const time = this.time
    if (time === null) return []
    const length = AFTERGLOW * 1000 * this.speed
    return this.drawn.flatMap((track) => {
      if (track.to > time) return []
      const played = this.sessions.reduce(
        (sum, session) => sum + Math.max(0, Math.min(session.to, time) - Math.max(session.from, track.to)),
        0,
      )
      return played < length ? [{ track, fade: played / length }] : []
    })
  })

  /** Spans of time in which at least one selected ride is underway, in order */
  sessions = $derived.by(() => {
    const result: TimeSpan[] = []
    for (const track of this.selected.toSorted((a, b) => a.from - b.from)) {
      const last = result.at(-1)
      if (last && track.from <= last.to) last.to = Math.max(last.to, track.to)
      else result.push({ from: track.from, to: track.to })
    }
    return result
  })

  /** Totals of the selected rides, or while playing back, of the part ridden by then */
  totals = $derived.by(() => {
    const time = this.time
    if (time === null) {
      return {
        rides: this.selected.length,
        km: this.selected.reduce((sum, track) => sum + track.km, 0),
        minutes: this.selected.reduce((sum, track) => sum + track.minutes, 0),
      }
    }
    const started = this.selected.filter((track) => track.from <= time)
    const ridden = (track: Track) => Math.min(1, (time - track.from) / (track.to - track.from))
    return {
      rides: started.length,
      km: started.reduce((sum, track) => sum + track.km * ridden(track), 0),
      minutes: started.reduce((sum, track) => sum + track.minutes * ridden(track), 0),
    }
  })
  #generation = 0

  inView(track: Track): boolean {
    return !this.bounds || intersects(track.bbox, this.bounds)
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

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen
    store(SIDEBAR_KEY, this.sidebarOpen ? 'open' : 'closed')
  }

  toggleHeat() {
    this.heat = !this.heat
    store(HEAT_KEY, this.heat ? 'on' : 'off')
  }

  showCity(city: City) {
    this.map?.fitBounds(city.bbox, { padding: 40, duration: 800 })
  }

  /** Zooms the timeline to a time span, kept within all tracks and not shorter than MIN_SPAN */
  zoomTo({ from, to }: TimeSpan) {
    const extent = this.extent
    const span = Math.min(extent.to - extent.from, Math.max(MIN_SPAN, to - from))
    const start = Math.min(extent.to - span, Math.max(extent.from, (from + to) / 2 - span / 2))
    this.view = span >= extent.to - extent.from ? null : { from: start, to: start + span }
  }

  seek(time: number) {
    this.time = Math.min(this.extent.to, Math.max(this.extent.from, time))
  }

  play() {
    if (this.playing || this.sessions.length === 0) return
    let time = this.time
    // Start over at the beginning of the timeline section in view
    if (time === null || time >= this.sessions.at(-1)!.to || time < this.domain.from || time > this.domain.to) {
      time = this.domain.from
    }
    // Between rides, go straight to the next one
    if (!this.sessions.some((session) => session.from <= time! && time! < session.to)) {
      time = (this.sessions.find((session) => session.from > time!) ?? this.sessions[0]).from
    }
    this.time = time
    this.playing = true

    // A newer play() call, or pause() and stop(), ends this loop
    const generation = ++this.#generation
    let last = performance.now()
    // When the playback reached a gap between rides
    let holdSince: number | null = null
    const frame = (now: number) => {
      if (generation !== this.#generation || this.time === null) return
      const time = this.time
      const session = this.sessions.find((session) => session.from <= time && time < session.to)
      if (session) {
        holdSince = null
        this.time = Math.min(session.to, time + Math.max(0, now - last) * this.speed)
      } else {
        holdSince ??= now
        if (now - holdSince >= HOLD) {
          const next = this.sessions.find((session) => session.from > time)
          if (!next) return this.pause()
          this.time = next.from
          holdSince = null
        }
      }
      last = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  /** Jumps to the start of the ride underway, or once there, to the previous one */
  skipBack() {
    // Within the first second of playback a ride counts as just started
    const time = (this.time ?? Infinity) - 1000 * this.speed
    const target = this.sessions.findLast((session) => session.from < time) ?? this.sessions[0]
    if (target) this.seek(target.from)
  }

  /** Jumps to the start of the next ride */
  skipForward() {
    const next = this.time === null ? undefined : this.sessions.find((session) => session.from > this.time!)
    if (next) this.seek(next.from)
  }

  pause() {
    this.#generation++
    this.playing = false
  }

  stop() {
    this.pause()
    this.time = null
  }

  /** Reads the hidden tracks from the query string */
  readUrl() {
    const params = new URLSearchParams(location.search)
    this.hidden.clear()
    for (const id of params.get('hide')?.split(',') ?? []) {
      if (/^\d+$/.test(id)) this.hidden.add(Number(id))
    }
  }

  /** The query string for the hidden tracks */
  query(): string {
    const params = new URLSearchParams()
    if (this.hidden.size > 0) params.set('hide', [...this.hidden].sort((a, b) => a - b).join(','))
    // Keep the commas readable
    return params.size > 0 ? '?' + params.toString().replaceAll('%2C', ',') : ''
  }
}

export const app = new AppState()

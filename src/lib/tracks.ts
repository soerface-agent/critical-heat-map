import * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { Feature, Position } from 'geojson'
import { EVENT_TYPES, eventColor, eventType } from './event-types'
import { fullDate, km } from './format'
import { linesBetween } from './geometry'
import { heatLines, heatSamples, type HeatSamples } from './heat'
import { app, type Track } from './state.svelte'
import type { TrackCollection } from './track-types'

const SOURCE = 'tracks'
const LAYER = 'tracks'
const HEAT = 'heat'
/** The lowest of the track layers, which other layers can be put below */
export const FIRST_TRACK_LAYER = HEAT
const PLAYBACK = 'playback'
const HEADS = 'playback-heads'
// Pixels around the cursor in which a track counts as hovered, since the lines are thin
const HIT_RADIUS = 4
// The ride being played on top of the heat map, in a color its ramp never uses
const LIVE = { light: '#1f4fbf', dark: '#7ea6f4' }
// Opacity rides that just finished start fading from
const AFTERGLOW_OPACITY = 0.7
// Outline that keeps the ride being played apart from the heat map lines it crosses
const CASING = { light: '#ffffff', dark: '#111111' }

export interface TrackStyle {
  dark: boolean
  /** Finished rides as a heat map */
  heat: boolean
  /** Whether a moment is being played back, rather than all rides shown */
  playing: boolean
}

// The track whose hover feature-state is set
let hovered: number | null = null

function typeColor(dark: boolean): ExpressionSpecification {
  const pick = ({ color, dark: darkColor }: { color: string; dark: string }) => (dark ? darkColor : color)
  return [
    'match',
    ['get', 'type'],
    ...Object.entries(EVENT_TYPES).flatMap(([type, eventType]) => [type, pick(eventType)]),
    pick(EVENT_TYPES.other),
  ] as unknown as ExpressionSpecification
}

const heatSamplesCache = new WeakMap<TrackCollection, HeatSamples>()
// Samples of the collection whose layers were added last
let samples: HeatSamples | null = null

/**
 * Adds the tracks as lines and as a heat map, initially all hidden, and the layers for playback.
 * Needs to be called again after the map style changes, since that removes all sources and layers.
 */
export function addTrackLayers(map: maplibregl.Map, collection: TrackCollection) {
  map.addSource(SOURCE, { type: 'geojson', data: collection, promoteId: 'osm' })
  samples = heatSamplesCache.get(collection) ?? heatSamples(collection)
  heatSamplesCache.set(collection, samples)
  map.addSource(HEAT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(PLAYBACK, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  // Draw the tracks above all streets but below the labels that follow them, so street names stay
  // readable. Not simply below the first label layer: the dark style has one before the streets
  const layers = map.getStyle().layers
  const lastNonSymbol = layers.findLastIndex((layer) => layer.type !== 'symbol')
  const firstSymbol = layers[lastNonSymbol + 1]?.id
  const none: ExpressionSpecification = ['in', ['get', 'osm'], ['literal', []]]
  // A route ridden once stays pale yellow, routes ridden often turn red, drawn above the others
  const byCount = (...stops: (number | string)[]) =>
    ['interpolate', ['linear'], ['get', 'count'], ...stops] as unknown as ExpressionSpecification
  map.addLayer(
    {
      id: HEAT,
      type: 'line',
      source: HEAT,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'count'] },
      paint: {
        'line-color': byCount(1, '#fcd77a', 3, '#fd9a4a', 7, '#f0592b', 14, '#c81e2c', 25, '#8c0a3c'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, byCount(1, 1.2, 25, 3), 16, byCount(1, 3, 25, 7)],
        'line-opacity': 0.9,
      },
    },
    firstSymbol,
  )
  map.addLayer(
    { id: LAYER, type: 'line', source: SOURCE, filter: none, layout: { 'line-join': 'round', 'line-cap': 'round' } },
    firstSymbol,
  )
  // Colors, widths and order come with each feature, see drawPlayback
  map.addLayer(
    {
      id: PLAYBACK,
      type: 'line',
      source: PLAYBACK,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'z'] },
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': ['get', 'opacity'],
        'line-blur': ['get', 'blur'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['*', 0.8, ['get', 'width']], 16, ['*', 1.8, ['get', 'width']]],
      },
    },
    firstSymbol,
  )
  // Where the riders are at the moment shown
  map.addLayer({
    id: HEADS,
    type: 'circle',
    source: PLAYBACK,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 7],
      'circle-stroke-color': ['get', 'stroke'],
      'circle-stroke-width': 2,
    },
  })
  hovered = null
}

/**
 * Colors the finished rides: in their type colors, or during playback in grey (faint sand on the
 * dark map, where grey and white look like streets) so the ride being played stands out, or as a
 * heat map. Hovered rides always show.
 */
export function styleTracks(map: maplibregl.Map, { dark, heat, playing }: TrackStyle) {
  const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
  const types = typeColor(dark)
  const muted = playing && !heat
  const [color, opacity]: [ExpressionSpecification | string, number] = heat
    ? [types, 0]
    : muted
      ? [dark ? '#e8c9a0' : '#76736b', dark ? 0.3 : 0.32]
      : // Lines on the dark map need more opacity to stand out as much
        [types, dark ? 0.45 : 0.35]
  map.setPaintProperty(LAYER, 'line-color', ['case', hover, types, color])
  map.setPaintProperty(LAYER, 'line-opacity', ['case', hover, 0.95, opacity])
  map.setPaintProperty(LAYER, 'line-width', [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    ['case', hover, 3, muted ? 1.2 : 1.5],
    16,
    ['case', hover, 7, muted ? 3 : 4],
  ])
  map.setLayoutProperty(HEAT, 'visibility', heat ? 'visible' : 'none')
}

/** Hover highlighting and a popup on click; call once per map */
export function bindTrackEvents(map: maplibregl.Map) {
  function tracksAt(point: maplibregl.Point): Track[] {
    // The layer is missing while a new map style loads
    if (!map.getLayer(LAYER)) return []
    const features = map.queryRenderedFeatures(
      [
        [point.x - HIT_RADIUS, point.y - HIT_RADIUS],
        [point.x + HIT_RADIUS, point.y + HIT_RADIUS],
      ],
      { layers: [LAYER] },
    )
    // A track is split into several features where it crosses tile borders
    const ids = new Set(features.map((feature) => feature.properties.osm as number))
    return app.tracks.filter((track) => ids.has(track.osm))
  }

  map.on('mousemove', (event) => {
    const tracks = tracksAt(event.point)
    app.hovered = tracks.at(-1)?.osm ?? null
    map.getCanvas().style.cursor = tracks.length > 0 ? 'pointer' : ''
  })
  map.on('mouseout', () => (app.hovered = null))

  map.on('click', (event) => {
    const tracks = tracksAt(event.point)
    if (tracks.length === 0) return
    new maplibregl.Popup({ maxWidth: '320px' })
      .setLngLat(event.lngLat)
      .setDOMContent(popupContent(tracks))
      .addTo(map)
  })
}

/** Shows only the tracks with the given ids, as lines and, if `heat` is on, as a heat map */
export function showTracks(map: maplibregl.Map, ids: number[], heat: boolean) {
  map.setFilter(LAYER, ['in', ['get', 'osm'], ['literal', ids]])
  const data = heat && samples ? heatLines(samples, ids) : { type: 'FeatureCollection' as const, features: [] }
  ;(map.getSource(HEAT) as maplibregl.GeoJSONSource).setData(data)
}

export function highlightTrack(map: maplibregl.Map, id: number | null) {
  if (hovered !== null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false })
  if (id !== null) map.setFeatureState({ source: SOURCE, id }, { hover: true })
  hovered = id
}

/**
 * Draws the rides being played as far as they got at `time`, glowing in their type colors, with a
 * dot where the riders are. On the heat map they are blue with an outline instead. Rides that just
 * finished stay in their color for a while, fading by their `fade` (0–1). Returns where the riders
 * are, in the order of `riding`.
 */
export function drawPlayback(
  map: maplibregl.Map,
  riding: Track[],
  afterglow: { track: Track; fade: number }[],
  time: number | null,
  { dark, heat }: TrackStyle,
): { track: Track; position: Position }[] {
  const features: Feature[] = []
  const heads: { track: Track; position: Position }[] = []
  const theme = dark ? 'dark' : 'light'
  const draw = (lines: Position[][], properties: { color: string; width: number; opacity: number; blur?: number }) => {
    if (lines.length === 0) return
    features.push({
      type: 'Feature',
      properties: { blur: 0, z: features.length, ...properties },
      geometry: { type: 'MultiLineString', coordinates: lines },
    })
  }
  const drawRide = (track: Track, until: number, opacity: number, live: boolean) => {
    const ridden = linesBetween(track.coordinates, -Infinity, until)
    const color = heat ? LIVE[theme] : eventType(track.type)[dark ? 'dark' : 'color']
    if (heat) draw(ridden, { color: CASING[theme], width: 8, opacity })
    // On the light map a glow needs more opacity to show as much
    else if (live) draw(ridden, { color, width: 10, opacity: dark ? 0.6 : 0.75, blur: 6 })
    draw(ridden, { color, width: heat ? 4 : 3.5, opacity })
    return { color, head: ridden.at(-1)?.at(-1) }
  }

  if (time !== null) {
    // Without the glow and dimmer, so they don't compete with the rides being played
    for (const { track, fade } of afterglow) drawRide(track, Infinity, AFTERGLOW_OPACITY * (1 - fade), false)
    for (const track of riding) {
      const { color, head } = drawRide(track, (time - track.from) / 1000, 1, true)
      if (head) {
        heads.push({ track, position: head })
        features.push({ type: 'Feature', properties: { color, stroke: CASING[theme] }, geometry: { type: 'Point', coordinates: head } })
      }
    }
  }
  ;(map.getSource(PLAYBACK) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
  return heads
}

function popupContent(tracks: Track[]): HTMLElement {
  const list = document.createElement('ul')
  list.className = 'track-list'
  for (const track of tracks) {
    const item = document.createElement('li')
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = eventColor(track.type)
    const link = document.createElement('a')
    link.href = track.url
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.textContent = track.title
    item.append(dot, link)
    const details = document.createElement('small')
    details.textContent = [track.start && fullDate(track.start), `${km(track.km)} km`].filter(Boolean).join(' · ')
    item.append(' ', details)
    list.append(item)
  }
  return list
}

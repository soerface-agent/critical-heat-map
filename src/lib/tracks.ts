import * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { Feature, MultiLineString } from 'geojson'
import { EVENT_TYPES, eventType } from './event-types'
import { fullDate, km } from './format'
import { partialLines } from './geometry'
import { app, type Track } from './state.svelte'
import type { TrackCollection } from './track-types'

const SOURCE = 'tracks'
const LAYER = 'tracks'
const PLAYBACK = 'playback'
// Pixels around the cursor in which a track counts as hovered, since the lines are thin
const HIT_RADIUS = 4

const COLOR: ExpressionSpecification = [
  'match',
  ['get', 'type'],
  ...Object.entries(EVENT_TYPES).flatMap(([type, { color }]) => [type, color]),
  EVENT_TYPES.other.color,
] as unknown as ExpressionSpecification

/** Adds the tracks as lines colored by event type, with hover highlighting and a popup on click. */
export function addTracks(map: maplibregl.Map, collection: TrackCollection) {
  map.addSource(SOURCE, { type: 'geojson', data: collection, promoteId: 'osm' })
  map.addSource(PLAYBACK, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  // Draw the tracks below the first label layer, so street names stay readable
  const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
  const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
  map.addLayer(
    {
      id: LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['in', ['get', 'osm'], ['literal', []]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': COLOR,
        'line-opacity': ['case', hover, 0.95, 0.35],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', hover, 3, 1.5], 16, ['case', hover, 7, 4]],
      },
    },
    firstSymbol,
  )
  map.addLayer(
    {
      id: PLAYBACK,
      type: 'line',
      source: PLAYBACK,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': COLOR,
        'line-opacity': 0.95,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
      },
    },
    firstSymbol,
  )

  function tracksAt(point: maplibregl.Point): Track[] {
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

/** Shows only the tracks with the given ids */
export function showTracks(map: maplibregl.Map, ids: number[]) {
  map.setFilter(LAYER, ['in', ['get', 'osm'], ['literal', ids]])
}

let hovered: number | null = null

export function highlightTrack(map: maplibregl.Map, id: number | null) {
  if (hovered !== null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false })
  if (id !== null) map.setFeatureState({ source: SOURCE, id }, { hover: true })
  hovered = id
}

/** Draws the first `progress` (0–1) of a track on top of the others, or nothing */
export function drawPlayback(map: maplibregl.Map, track: Track | null, progress: number) {
  const features: Feature<MultiLineString>[] = track
    ? [
        {
          type: 'Feature',
          properties: { type: track.type },
          geometry: { type: 'MultiLineString', coordinates: partialLines(track.coordinates, progress) },
        },
      ]
    : []
  ;(map.getSource(PLAYBACK) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
}

function popupContent(tracks: Track[]): HTMLElement {
  const list = document.createElement('ul')
  list.className = 'track-list'
  for (const track of tracks) {
    const item = document.createElement('li')
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = eventType(track.type).color
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

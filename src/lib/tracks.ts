import * as maplibregl from 'maplibre-gl'
import type { TrackProperties } from './track-types'

const SOURCE = 'tracks'
const LAYER = 'tracks'
const COLOR = '#d6266f'
// Pixels around the cursor in which a track counts as hovered, since the lines are thin
const HIT_RADIUS = 4

/** Adds the tracks from tracks.geojson as lines, with hover highlighting and a popup on click. */
export function addTracks(map: maplibregl.Map) {
  map.addSource(SOURCE, {
    type: 'geojson',
    data: `${import.meta.env.BASE_URL}tracks.geojson`,
    promoteId: 'osm',
  })

  // Draw the tracks below the first label layer, so street names stay readable
  const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
  map.addLayer(
    {
      id: LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': COLOR,
        'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.3],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
          16, ['case', ['boolean', ['feature-state', 'hover'], false], 7, 4],
        ],
      },
    },
    firstSymbol,
  )

  let hovered = new Set<number>()

  function tracksAt(point: maplibregl.Point): TrackProperties[] {
    const features = map.queryRenderedFeatures(
      [
        [point.x - HIT_RADIUS, point.y - HIT_RADIUS],
        [point.x + HIT_RADIUS, point.y + HIT_RADIUS],
      ],
      { layers: [LAYER] },
    )
    // A track is split into several features where it crosses tile borders
    const tracks = new Map<number, TrackProperties>()
    for (const feature of features) {
      const properties = feature.properties as TrackProperties
      tracks.set(properties.osm, properties)
    }
    return [...tracks.values()].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
  }

  function setHovered(ids: Set<number>) {
    for (const id of hovered) {
      if (!ids.has(id)) map.setFeatureState({ source: SOURCE, id }, { hover: false })
    }
    for (const id of ids) map.setFeatureState({ source: SOURCE, id }, { hover: true })
    hovered = ids
    map.getCanvas().style.cursor = ids.size > 0 ? 'pointer' : ''
  }

  map.on('mousemove', (event) => setHovered(new Set(tracksAt(event.point).map((track) => track.osm))))
  map.on('mouseout', () => setHovered(new Set()))

  map.on('click', (event) => {
    const tracks = tracksAt(event.point)
    if (tracks.length === 0) return
    new maplibregl.Popup({ maxWidth: '320px' })
      .setLngLat(event.lngLat)
      .setDOMContent(popupContent(tracks))
      .addTo(map)
  })
}

function popupContent(tracks: TrackProperties[]): HTMLElement {
  const list = document.createElement('ul')
  list.className = 'track-list'
  for (const track of tracks) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = track.url
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.textContent = track.title
    item.append(link)
    if (track.start) {
      const date = document.createElement('time')
      date.dateTime = track.start
      date.textContent = new Date(track.start).toLocaleDateString()
      item.append(' ', date)
    }
    list.append(item)
  }
  return list
}

import type * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification, SkySpecification } from 'maplibre-gl'

const DEM = 'terrain'
// The same tiles again: MapLibre renders hillshading better from a source of its own
const DEM_SHADE = 'terrain-shade'
const HILLSHADE = 'hillshade'
const BUILDINGS = 'buildings-3d'
// The flat buildings of the OpenFreeMap styles, hidden while they are extruded
const FLAT_BUILDINGS = 'building'
// Elevation tiles in Terrarium encoding, free and without a key; high resolution in Germany.
// Closer in, MapLibre scales up the ones of this zoom level
const DEM_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
const DEM_MAX_ZOOM = 14
// Most rides are in cities, where hills are gentle, so make them a bit steeper to be seen
const EXAGGERATION = 1.5
// Pitch the map tilts to when 3D is switched on, unless it already is
export const PITCH = 60
// Steepest pitch allowed by hand in 3D, and in 2D (MapLibre's default)
export const MAX_PITCH = { flat: 60, terrain: 85 }
// Milliseconds the map takes to tilt
const TILT = 800

const COLORS = {
  light: { building: '#eeece6', sky: '#cfe0f0', horizon: '#f4f1ea', fog: '#f4f1ea', shadow: '#5a5a5a', highlight: '#ffffff' },
  dark: { building: '#262628', sky: '#05070c', horizon: '#1a1c22', fog: '#111214', shadow: '#000000', highlight: '#6a6e7a' },
}

/** Height of a building in m from the OpenMapTiles schema, which estimates missing ones from its floors */
const height = (key: string): ExpressionSpecification => ['coalesce', ['get', key], 0]

/**
 * Switches terrain, extruded buildings and a sky on or off. Needs to be called again after the map
 * style changes, since that removes them; `before` is the first layer they go below, so they
 * don't cover the tracks.
 */
export function setThreeD(map: maplibregl.Map, on: boolean, dark: boolean, before: string | undefined) {
  const colors = COLORS[dark ? 'dark' : 'light']
  for (const id of [DEM, DEM_SHADE]) {
    if (!on || map.getSource(id)) continue
    map.addSource(id, {
      type: 'raster-dem',
      tiles: [DEM_TILES],
      tileSize: 512,
      maxzoom: DEM_MAX_ZOOM,
      encoding: 'terrarium',
      attribution: '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
    })
  }
  if (on && !map.getLayer(HILLSHADE)) {
    // Below the flat buildings, so roughly above the land and water but below the streets
    const firstAbove = map.getLayer(FLAT_BUILDINGS) ? FLAT_BUILDINGS : before
    map.addLayer(
      {
        id: HILLSHADE,
        type: 'hillshade',
        source: DEM_SHADE,
        paint: {
          'hillshade-exaggeration': dark ? 0.6 : 0.4,
          'hillshade-shadow-color': colors.shadow,
          'hillshade-highlight-color': colors.highlight,
        },
      },
      firstAbove,
    )
  }
  if (on && !map.getLayer(BUILDINGS)) {
    map.addLayer(
      {
        id: BUILDINGS,
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
          'fill-extrusion-color': colors.building,
          'fill-extrusion-height': height('render_height'),
          'fill-extrusion-base': height('render_min_height'),
          // Fade in with the zoom level, so they don't pop up
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.75],
        },
      },
      before,
    )
  }
  if (!on) {
    for (const layer of [BUILDINGS, HILLSHADE]) if (map.getLayer(layer)) map.removeLayer(layer)
  }
  if (map.getLayer(FLAT_BUILDINGS)) map.setLayoutProperty(FLAT_BUILDINGS, 'visibility', on ? 'none' : 'visible')

  map.setTerrain(on ? { source: DEM, exaggeration: EXAGGERATION } : null)
  const sky: SkySpecification = {
    'sky-color': colors.sky,
    'horizon-color': colors.horizon,
    'fog-color': colors.fog,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.8,
  }
  map.setSky(on ? sky : {})
}

/** Tilts the map when switching to 3D, and back to looking straight down, north up, when leaving it */
export function tilt(map: maplibregl.Map, on: boolean) {
  map.setMaxPitch(on ? MAX_PITCH.terrain : MAX_PITCH.flat)
  if (on && map.getPitch() < PITCH / 2) map.easeTo({ pitch: PITCH, duration: TILT })
  if (!on) map.easeTo({ pitch: 0, bearing: 0, duration: TILT })
}

// The heat map: every stretch of a track colored by how many of the shown rides passed close by.
// Drawn as lines rather than with MapLibre's heatmap layer, which renders at a quarter of the
// screen resolution and looks blocky with a radius small enough to keep neighboring streets apart.

import type { Feature, FeatureCollection, LineString, Position } from 'geojson'
import { pointsAlong } from './geometry'
import type { TrackCollection } from './track-types'

// Kilometers between the points a track is sampled at, and the size of the grid cells they are
// counted in. Rides count as passing by when they have a point in the same or a neighboring cell
const STEP = 0.02
const CELL = 0.01

interface Sample {
  position: Position
  /** OSM ids of all tracks passing close to this point, its own included */
  near: number[]
}

/** Samples of each track, by OSM id, one list per line of the track */
export type HeatSamples = Map<number, Sample[][]>

function cellOf([lon, lat]: Position): [number, number] {
  const ky = 111.32
  const kx = ky * Math.cos((lat * Math.PI) / 180)
  return [Math.floor((lon * kx) / CELL), Math.floor((lat * ky) / CELL)]
}

export function heatSamples(collection: TrackCollection): HeatSamples {
  const lines = collection.features.map((feature) => ({
    osm: feature.properties.osm,
    lines: feature.geometry.coordinates.map((line) => pointsAlong(line, STEP)),
  }))

  const cells = new Map<string, Set<number>>()
  for (const { osm, lines: points } of lines) {
    for (const point of points.flat()) {
      const key = cellOf(point).join()
      if (!cells.has(key)) cells.set(key, new Set())
      cells.get(key)!.add(osm)
    }
  }

  const samples: HeatSamples = new Map()
  for (const { osm, lines: points } of lines) {
    samples.set(
      osm,
      points.map((line) =>
        line.map((position) => {
          const [x, y] = cellOf(position)
          const near = new Set<number>()
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (const id of cells.get(`${x + dx},${y + dy}`) ?? []) near.add(id)
            }
          }
          return { position, near: [...near] }
        }),
      ),
    )
  }
  return samples
}

/** Lines of the given tracks, split where the number of shown rides passing by changes */
export function heatLines(samples: HeatSamples, ids: number[]): FeatureCollection<LineString, { count: number }> {
  const shown = new Set(ids)
  const features: Feature<LineString, { count: number }>[] = []
  const count = (sample: Sample) => sample.near.reduce((sum, id) => sum + (shown.has(id) ? 1 : 0), 0)

  for (const id of ids) {
    for (const line of samples.get(id) ?? []) {
      if (line.length < 2) continue
      let run = [line[0].position]
      let current = count(line[0])
      for (const sample of line.slice(1)) {
        run.push(sample.position)
        const next = count(sample)
        if (next !== current) {
          features.push({ type: 'Feature', properties: { count: current }, geometry: { type: 'LineString', coordinates: run } })
          run = [sample.position]
          current = next
        }
      }
      if (run.length >= 2) {
        features.push({ type: 'Feature', properties: { count: current }, geometry: { type: 'LineString', coordinates: run } })
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

// Downloads the GPX traces listed in tracks.json from openstreetmap.org, simplifies them and
// writes them as one GeoJSON file for the map. Downloads are stored in data/gpx (committed, so openstreetmap.org is only hit for new tracks).

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { gpx } from '@tmcw/togeojson'
import { DOMParser } from '@xmldom/xmldom'
import simplify from 'simplify-js'
import type { Feature, FeatureCollection, MultiLineString, Position } from 'geojson'
import type { TrackProperties } from '../src/lib/track-types.ts'

/** An entry of tracks.json */
type TrackEntry = Pick<TrackProperties, 'osm' | 'user' | 'title' | 'type'>

const CACHE_DIR = 'data/gpx'
const OUTPUT = 'public/tracks.geojson'
// Douglas-Peucker tolerance in degrees, roughly 2 m
const TOLERANCE = 0.00002
// Coordinates are rounded to this many decimals, roughly 0.1 m
const PRECISION = 6

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadGpx(id: number): Promise<string> {
  const path = `${CACHE_DIR}/${id}.gpx`
  if (await exists(path)) return readFile(path, 'utf8')

  const text = await download(`https://www.openstreetmap.org/trace/${id}/data`)
  await writeFile(path, text)
  return text
}

async function download(url: string, attempts = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    console.log(`downloading ${url}`)
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'critical-heat-map (https://code.flipdot.org/soerface/critical-heat-map)' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error}`)
      console.warn(`  failed (${error}), retrying`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

function simplifyLine(line: Position[]): Position[] {
  const points = line.map(([x, y]) => ({ x, y }))
  const factor = 10 ** PRECISION
  return simplify(points, TOLERANCE, true).map(({ x, y }) => [
    Math.round(x * factor) / factor,
    Math.round(y * factor) / factor,
  ])
}

async function buildTrack(entry: TrackEntry): Promise<Feature<MultiLineString, TrackProperties>> {
  const doc = new DOMParser().parseFromString(await loadGpx(entry.osm), 'text/xml')
  const lines: Position[][] = []
  let start: string | null = null

  for (const feature of gpx(doc as unknown as Parameters<typeof gpx>[0]).features) {
    const geometry = feature.geometry
    if (!geometry) continue
    if (geometry.type === 'LineString') lines.push(geometry.coordinates)
    else if (geometry.type === 'MultiLineString') lines.push(...geometry.coordinates)
    else continue

    const times = feature.properties?.coordinateProperties?.times
    const first = Array.isArray(times?.[0]) ? times[0][0] : times?.[0]
    if (!start && typeof first === 'string') start = first
  }
  if (lines.length === 0) throw new Error(`trace ${entry.osm} contains no track`)

  return {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: lines.map(simplifyLine).filter((line) => line.length >= 2),
    },
    properties: {
      ...entry,
      url: `https://www.openstreetmap.org/user/${encodeURIComponent(entry.user)}/traces/${entry.osm}`,
      start,
    },
  }
}

const entries: TrackEntry[] = JSON.parse(await readFile('tracks.json', 'utf8'))
await mkdir(CACHE_DIR, { recursive: true })

const features = []
let points = 0
for (const entry of entries) {
  const feature = await buildTrack(entry)
  points += feature.geometry.coordinates.reduce((sum, line) => sum + line.length, 0)
  features.push(feature)
}

const collection: FeatureCollection<MultiLineString, TrackProperties> = { type: 'FeatureCollection', features }
await writeFile(OUTPUT, JSON.stringify(collection))
console.log(`wrote ${features.length} tracks with ${points} points to ${OUTPUT}`)

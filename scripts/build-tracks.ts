// Downloads the GPX traces listed in tracks.json from openstreetmap.org, simplifies them and
// writes them as one GeoJSON file for the map. Downloads are stored in data/gpx (committed, so openstreetmap.org is only hit for new tracks).
// Tracks close to each other are grouped into cities, named by reverse geocoding with Nominatim
// (cached in data/places.json, committed as well).

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { gpx } from '@tmcw/togeojson'
import { DOMParser } from '@xmldom/xmldom'
import simplify from 'simplify-js'
import type { Feature, MultiLineString, Position } from 'geojson'
import type { BBox, City, TrackCollection, TrackProperties } from '../src/lib/track-types.ts'

/** An entry of tracks.json */
type TrackEntry = Pick<TrackProperties, 'osm' | 'user' | 'title' | 'type'>

const CACHE_DIR = 'data/gpx'
const PLACES = 'data/places.json'
const USER_AGENT = 'critical-heat-map (https://code.flipdot.org/soerface/critical-heat-map)'
const OUTPUT = 'public/tracks.geojson'
// Douglas-Peucker tolerance in degrees, roughly 2 m
const TOLERANCE = 0.00002
// Coordinates are rounded to this many decimals, roughly 0.1 m
const PRECISION = 6
// Points closer than this to the last counted one are GPS jitter, e.g. while standing at a red light
const MIN_STEP_KM = 0.008
// Tracks whose centers are closer than this belong to the same city
const CITY_RADIUS_KM = 30

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
        headers: { 'User-Agent': USER_AGENT },
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

function distanceKm([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

function lineKm(line: Position[]): number {
  let km = 0
  let last = line[0]
  for (const point of line.slice(1)) {
    const step = distanceKm(last, point)
    if (step < MIN_STEP_KM) continue
    km += step
    last = point
  }
  return km
}

function bboxOf(points: Position[]): BBox {
  const lons = points.map(([lon]) => lon)
  const lats = points.map(([, lat]) => lat)
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
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
  let end: string | null = null

  for (const feature of gpx(doc as unknown as Parameters<typeof gpx>[0]).features) {
    const geometry = feature.geometry
    if (!geometry) continue
    if (geometry.type === 'LineString') lines.push(geometry.coordinates)
    else if (geometry.type === 'MultiLineString') lines.push(...geometry.coordinates)
    else continue

    const times = feature.properties?.coordinateProperties?.times
    const flat: unknown[] = (times ?? []).flat()
    const first = flat[0]
    const last = flat.at(-1)
    if (!start && typeof first === 'string') start = first
    if (typeof last === 'string') end = last
  }
  if (lines.length === 0) throw new Error(`trace ${entry.osm} contains no track`)

  const minutes = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 60000) : 0
  const round = (value: number) => Math.round(value * 10 ** PRECISION) / 10 ** PRECISION
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
      km: Math.round(lines.reduce((sum, line) => sum + lineKm(line), 0) * 10) / 10,
      minutes,
      bbox: bboxOf(lines.flat()).map(round) as BBox,
      // Filled in by assignCities
      city: '',
    },
  }
}

type TrackFeature = Awaited<ReturnType<typeof buildTrack>>

function center([west, south, east, north]: BBox): Position {
  return [(west + east) / 2, (south + north) / 2]
}

/** Groups tracks whose centers are within CITY_RADIUS_KM of another track of the group */
function clusterTracks(features: TrackFeature[]): TrackFeature[][] {
  const clusters: TrackFeature[][] = []
  for (const feature of features) {
    const near = clusters.filter((cluster) =>
      cluster.some((other) => distanceKm(center(other.properties.bbox), center(feature.properties.bbox)) < CITY_RADIUS_KM),
    )
    const merged = [feature, ...near.flat()]
    for (const cluster of near) clusters.splice(clusters.indexOf(cluster), 1)
    clusters.push(merged)
  }
  return clusters
}

async function placeName(places: Record<string, string>, [lon, lat]: Position): Promise<string> {
  // Rounded to about 1 km, so the cache keeps working when tracks are added to a city
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
  if (places[key]) return places[key]

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`
  const result = JSON.parse(await download(url))
  const address = result.address ?? {}
  const name = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? result.name
  if (!name) throw new Error(`no place name for ${key}`)
  places[key] = name
  // Nominatim allows one request per second
  await new Promise((resolve) => setTimeout(resolve, 1100))
  return name
}

/** Sets the city of every track and returns the cities, the one with the most tracks first */
async function assignCities(features: TrackFeature[]): Promise<City[]> {
  const places: Record<string, string> = (await exists(PLACES)) ? JSON.parse(await readFile(PLACES, 'utf8')) : {}
  const clusters = clusterTracks(features).sort((a, b) => b.length - a.length)

  const cities: City[] = []
  for (const cluster of clusters) {
    // Rides usually start in the city center, while their routes may lead out of town
    const starts = cluster.map((feature) => feature.geometry.coordinates[0][0])
    const middle = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const name = await placeName(places, [middle(starts.map(([lon]) => lon)), middle(starts.map(([, lat]) => lat))])

    let id = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    while (cities.some((city) => city.id === id)) id += '-2'
    for (const feature of cluster) feature.properties.city = id
    cities.push({ id, name, bbox: bboxOf(cluster.flatMap((feature) => [feature.properties.bbox.slice(0, 2), feature.properties.bbox.slice(2)])) })
  }

  await writeFile(PLACES, JSON.stringify(places, null, 2) + '\n')
  return cities
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

// Sorted by date, which the timeline and playback rely on
features.sort((a, b) => (a.properties.start ?? '').localeCompare(b.properties.start ?? ''))
const cities = await assignCities(features)

const collection: TrackCollection = { type: 'FeatureCollection', cities, features }
await writeFile(OUTPUT, JSON.stringify(collection))
console.log(`wrote ${features.length} tracks with ${points} points in ${cities.map((city) => city.name).join(', ')} to ${OUTPUT}`)

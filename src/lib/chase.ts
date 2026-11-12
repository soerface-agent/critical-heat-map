// Following a rider in 3D: from behind and above, turned the way they ride, or from their own eyes

import * as maplibregl from 'maplibre-gl'
import type { Position } from 'geojson'
import { bearing, pointFrom } from './geometry'
import { app, type Track } from './state.svelte'
import { MAX_PITCH, PITCH } from './three-d'

export interface Rider {
  track: Track
  position: Position
}

// Meters along the ride behind and ahead of the rider between which the camera faces, so it follows
// the street rather than every wobble of the GPS, and holds still while the riders do
const BEHIND = 15
const AHEAD = 40
// Seconds in which the camera turns about two thirds of the way to the riding direction
const TURN_LAG = 0.6
// Zoom level the camera chases from at slow playback, unless zoomed by hand. At faster playback it
// rises, so the rider moves at about SCREEN_SPEED pixels per second, but not above MIN_ZOOM
const ZOOM = 17
const MIN_ZOOM = 12.5
const SCREEN_SPEED = 120
// Steepest pitch a chase starts with, taken over from the map
const CHASE_MAX_PITCH = 70
// Zooming in by hand this close switches to the rider's view, zooming out of it back to chasing,
// from a zoom level ZOOM_BACK below
const RIDER_VIEW_ZOOM = 19
const ZOOM_BACK = 1
const WORLD_SIZE = 512
const METERS_PER_DEGREE = 111_320
// Part of the map height above the rider kept free, so the camera looks ahead
const LOOK_AHEAD = 0.35
// The rider's view, in m: from this far behind the rider and this high above the ground, looking at
// the ground this far ahead of them. At eye level, the street would fill the view and the tracks
// on it would be too thin to see. Pitch it allows (looking up a hill)
const BEHIND_RIDER = 25
const ABOVE_GROUND = 9
const AHEAD_OF_RIDER = 35
const EYE_MAX_PITCH = 89
// Milliseconds the camera takes to move to a new rider or view
const MOVE = 1200

/** Angle from `from` to `to` in degrees, the short way round */
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180

/** The point `meters` from `[lon, lat]` in the direction `bearing`, backwards if negative */
function along([lon, lat]: Position, bearing: number, meters: number): maplibregl.LngLat {
  const angle = (bearing * Math.PI) / 180
  return new maplibregl.LngLat(
    lon + (meters * Math.sin(angle)) / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180)),
    lat + (meters * Math.cos(angle)) / METERS_PER_DEGREE,
  )
}

/** The direction a rider rides in, from where they were a moment ago to where they will be */
function heading(track: Track): number {
  const seconds = (app.time! - track.from) / 1000
  return bearing(pointFrom(track.coordinates, seconds, -BEHIND), pointFrom(track.coordinates, seconds, AHEAD))
}

/** The zoom level at which the rider moves at about SCREEN_SPEED pixels per second */
function zoomForSpeed(track: Track, at: Position): number {
  const metersPerSecond = (track.km * 1000) / Math.max(1, track.minutes * 60)
  const meter = maplibregl.MercatorCoordinate.fromLngLat(at as [number, number]).meterInMercatorCoordinateUnits()
  return Math.log2(SCREEN_SPEED / (metersPerSecond * meter * app.speed * WORLD_SIZE))
}

/** The zoom level chosen by hand, kept by the caller from one chase to the next */
export interface ZoomStore {
  get(): number | null
  set(zoom: number | null): void
}

/**
 * Moves the camera along with one of the riders on every frame, until the returned function is
 * called. Keeps following the same rider while they ride. Zooming, turning and tilting by hand
 * change the distance, the angle to the riding direction and the pitch the camera keeps. Zooming
 * in close switches to the rider's view, and zooming out of it back.
 */
export function chase(map: maplibregl.Map, riders: () => Rider[], riderView: boolean, zoomStore: ZoomStore): () => void {
  // Ending the previous chase eases back, which this one replaces
  map.stop()
  let followed: number | null = null
  let flying = false
  // Set by hand: turn from the riding direction, pitch
  let offset = 0
  // Steeper by hand is kept while chasing, but not the steep pitch of the rider's view
  let pitch = Math.max(PITCH, Math.min(map.getPitch(), CHASE_MAX_PITCH))
  let direction: number | null = null
  let last = performance.now()

  if (riderView) map.setMaxPitch(EYE_MAX_PITCH)
  /** The center the camera was moved to last */
  let center: [number, number] | null = null
  /** Whether the camera is being moved by this chase, rather than by hand */
  let moving = false
  // Any other change of the camera is made by hand, with a gesture or a button: recognized here,
  // since events from the mouse wheel don't tell that they come from it. Zooming, turning and
  // tilting set what the camera keeps, around the rider rather than the pointer. The rider's view
  // holds still, but zooming out leaves it, and zooming in close switches to it
  map.setTransformCameraUpdate(({ zoom, bearing, pitch: tilt }) => {
    if (moving || flying || !center) return {}
    const current = map.getZoom()
    if (riderView) {
      if (zoom < current) {
        zoomStore.set(RIDER_VIEW_ZOOM - ZOOM_BACK)
        app.setRiderView(false)
      }
      return { zoom: current, bearing: map.getBearing(), pitch: map.getPitch(), center: map.getCenter() }
    }
    if (zoom > current && zoom >= RIDER_VIEW_ZOOM) {
      zoomStore.set(RIDER_VIEW_ZOOM - ZOOM_BACK)
      app.setRiderView(true)
    } else if (zoom !== current) {
      zoomStore.set(zoom)
    }
    if (bearing !== map.getBearing() && direction !== null) offset = turn(direction, bearing)
    if (tilt !== map.getPitch()) pitch = tilt
    return { center: new maplibregl.LngLat(...center) }
  })
  /** The camera as applied last, to skip moves to where it already is, as when paused */
  let applied = ''

  const step = (now: number) => {
    // At most a quarter of a second, so the camera doesn't swing after the tab was in the background
    const seconds = Math.min(0.25, (now - last) / 1000)
    last = now
    frame = requestAnimationFrame(step)
    const current = riders()
    // Following goes on during gestures, which moving the camera doesn't stop, but not during
    // animations, which it would
    if (current.length === 0 || app.time === null || flying || map._camera.isMoving()) return
    const rider = current.find(({ track }) => track.osm === followed) ?? current[0]
    const moved = rider.track.osm !== followed
    followed = rider.track.osm

    const target = heading(rider.track)
    direction = moved || direction === null ? target : direction + turn(direction, target) * (1 - Math.exp(-seconds / TURN_LAG))
    center = rider.position as [number, number]
    const { clientHeight: height } = map.getContainer()
    let camera: maplibregl.JumpToOptions
    if (riderView) {
      // From just behind the rider to a point on the ground ahead, both above the terrain as drawn
      const eye = along(center, direction, -BEHIND_RIDER)
      const ahead = along(center, direction, AHEAD_OF_RIDER)
      camera = {
        ...map.calculateCameraOptionsFromTo(eye, (map.queryTerrainElevation(eye) ?? 0) + ABOVE_GROUND, ahead, map.queryTerrainElevation(ahead) ?? 0),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      }
    } else {
      camera = {
        center,
        zoom: zoomStore.get() ?? Math.max(MIN_ZOOM, Math.min(ZOOM, zoomForSpeed(rider.track, center))),
        bearing: direction + offset,
        pitch,
        padding: { top: height * LOOK_AHEAD, bottom: 0, left: 0, right: 0 },
      }
    }

    if (moved) {
      flying = true
      moving = true
      map.easeTo({ ...camera, duration: MOVE })
      moving = false
      map.once('moveend', () => (flying = false))
      return
    }
    const { center: at, zoom, bearing, pitch: tilt } = camera
    const key = [...maplibregl.LngLat.convert(at!).toArray(), zoom, bearing, tilt].map((value) => value!.toFixed(7)).join()
    moving = true
    if (key !== applied) map.jumpTo(camera)
    moving = false
    applied = key
  }
  let frame = requestAnimationFrame(step)

  return () => {
    cancelAnimationFrame(frame)
    map.setTransformCameraUpdate(null)
    if (riderView) map.setMaxPitch(MAX_PITCH.terrain)
    // Back to an ordinary tilted map, with the rider in the middle
    const back: maplibregl.EaseToOptions = { padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: MOVE }
    map.easeTo(riderView ? { ...back, pitch: PITCH, zoom: Math.min(map.getZoom(), ZOOM - 1) } : back)
  }
}

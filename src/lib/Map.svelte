<script lang="ts">
  import * as maplibregl from 'maplibre-gl'
  import { untrack } from 'svelte'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { app, type Track } from './state.svelte'
  import { theme } from './theme.svelte'
  import { chase, type Rider } from './chase'
  import { MAX_PITCH, setThreeD, tilt } from './three-d'
  import { FIRST_TRACK_LAYER, addTrackLayers, bindTrackEvents, drawPlayback, highlightTrack, showTracks, styleTracks, type TrackStyle } from './tracks'

  // MapLibre looks for its worker next to its own module, which Vite's dependency
  // pre-bundling moves, so point it at the worker file explicitly
  maplibregl.setWorkerUrl(workerUrl)

  const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`

  const ICON = (path: string) =>
    `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${path}</svg>`
  // Following the riders. The zoom level is chosen once per ride: so the rider moves at about
  // RIDE_SCREEN_SPEED pixels per second on screen at the ride's average speed, but not farther out
  // than the whole ride needs, nor closer than the zoom level chosen by hand
  const RIDE_SCREEN_SPEED = 150
  // Pixels kept free around a ride shown whole
  const RIDE_PADDING = 40
  // Part of the map in the middle in which the rider moves without the map following
  const FREE_AREA = 0.4
  // Seconds in which the map closes about two thirds of the way to where it follows to
  const CENTER_LAG = 0.5
  // Milliseconds the map takes to move to a ride when it starts, or to a new zoom level for it
  const RIDE_MOVE = 700
  // Zoom levels a ride has to allow closer in before the map zooms in for it; zooming out, which
  // keeps the ride on screen, happens for any difference
  const ZOOM_IN_STEP = 0.5
  // Width of the world in pixels at zoom 0
  const WORLD_SIZE = 512

  /** Buttons below the zoom controls that switch the heat map, following the riders and 3D on and off */
  class ToggleControl implements maplibregl.IControl {
    heat = this.button('Heat map', 'Show the rides as a heat map', ICON(
      '<path d="M10 18c3.3 0 5.5-2.3 5.5-5.4 0-3.4-2.6-5.2-3.6-8.6-1.9 1.3-2.6 3.3-2.4 5.2-1-.6-1.7-1.6-1.9-2.9C5.8 7.8 4.5 10 4.5 12.6 4.5 15.7 6.7 18 10 18z" stroke-linejoin="round"/>',
    ), () => app.toggleHeat())
    follow = this.button('Follow the riders', 'Move the map along with the rides being played', ICON(
      '<circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke-linecap="round"/>',
    ), () => app.toggleFollow())
    threeD = this.button('3D', 'Show terrain and buildings in 3D', ICON(
      '<path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z" stroke-linejoin="round"/><path d="M3.5 6.25L10 10l6.5-3.75M10 10v7.5" stroke-linejoin="round"/>',
    ), () => app.toggleThreeD())
    riderView = this.button("Rider's view", "Ride along at eye level, in 3D", ICON(
      '<circle cx="5" cy="13.5" r="3.2"/><circle cx="15" cy="13.5" r="3.2"/><path d="M5 13.5l3-6h5l2 6M8 7.5l2.5 6h2.5M12 5h2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    ), () => app.toggleRiderView())

    button(label: string, title: string, icon: string, onclick: () => void) {
      const button = document.createElement('button')
      button.type = 'button'
      button.title = title
      button.ariaLabel = label
      button.innerHTML = icon
      button.addEventListener('click', onclick)
      return button
    }

    onAdd() {
      const group = document.createElement('div')
      group.className = 'maplibregl-ctrl maplibregl-ctrl-group toggle-control'
      group.append(this.heat, this.follow, this.threeD, this.riderView)
      return group
    }

    onRemove() {
      this.heat.parentElement?.remove()
    }
  }

  let container: HTMLDivElement
  const toggleControl = new ToggleControl()

  $effect(() => {
    toggleControl.heat.ariaPressed = String(app.heat)
    toggleControl.follow.ariaPressed = String(app.follow)
    toggleControl.threeD.ariaPressed = String(app.threeD)
    toggleControl.riderView.ariaPressed = String(app.riderView)
    toggleControl.riderView.hidden = !app.threeD
  })
  let map = $state.raw<maplibregl.Map | null>(null)
  /** Increases whenever a map style finished loading, which removes the track layers */
  let styleLoads = $state(0)

  // MapLibre keeps the position in the hash; without one, start at the city with the most tracks
  let positioned = /^#[\d.]+\/[-\d.]+\/[-\d.]+/.test(location.hash)

  $effect(() => {
    const instance = new maplibregl.Map({
      container,
      // Untracked: a theme change swaps the style below instead of recreating the map
      style: styleUrl(untrack(() => theme.dark)),
      center: [9.4985241, 51.3156676],
      zoom: 12,
      // So a tilted map in the hash stays as steep
      maxPitch: untrack(() => (app.threeD ? MAX_PITCH.terrain : MAX_PITCH.flat)),
      hash: true,
    })
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.addControl(toggleControl, 'top-right')
    instance.addControl(new maplibregl.ScaleControl(), 'bottom-right')

    instance.on('style.load', () => styleLoads++)
    // Moving the map by hand into another city picks that city; moves made by the app, like
    // following the riders, never do
    let byHand = false
    instance.on('movestart', (event) => (byHand = event.originalEvent !== undefined))
    instance.on('moveend', () => {
      const city = byHand ? app.cityAt(instance.getCenter().toArray()) : null
      if (city) app.cityId = city.id
      byHand = false
    })
    // The zoom level chosen by hand is the closest following zooms in to
    let zoomingByHand = false
    instance.on('zoomstart', (event) => (zoomingByHand = event.originalEvent !== undefined))
    instance.on('zoomend', () => {
      if (zoomingByHand) followZoom = instance.getZoom()
      zoomingByHand = false
    })
    // Panning the map by hand while playing means looking elsewhere, so stop following until asked
    // again. Not stored, unlike the button: next time, following is on again
    instance.on('dragstart', () => {
      if (app.playing) app.follow = false
    })
    bindTrackEvents(instance)
    map = instance
    app.map = instance
    return () => {
      app.map = null
      instance.remove()
    }
  })

  // Start with the city the map shows, or the one with the most tracks
  $effect(() => {
    const first = app.cities[0]
    if (!map || !first || app.cityId !== null) return
    if (!positioned) map.fitBounds(first.bbox, { padding: 40, animate: false })
    positioned = true
    app.cityId = (app.cityAt(map.getCenter().toArray()) ?? first).id
  })

  // Switch the basemap with the theme, without reading the style state, so this only runs on changes
  let currentDark = theme.dark
  $effect(() => {
    if (map && theme.dark !== currentDark) {
      currentDark = theme.dark
      // The track layers are gone until the new style has loaded
      layers = 0
      // Without diffing, so style.load fires and the track layers are added again
      map.setStyle(styleUrl(currentDark), { diff: false })
    }
  })

  // (Re-)add the tracks once both the map style and the data are loaded
  // Increases whenever the track layers were (re-)added, so the effects below apply their state again
  let layers = $state(0)
  $effect(() => {
    if (map && styleLoads > 0 && app.collection) {
      addTrackLayers(map, app.collection)
      layers = untrack(() => layers) + 1
    }
  })

  $effect(() => {
    if (map && layers) setThreeD(map, app.threeD, theme.dark, FIRST_TRACK_LAYER)
  })

  // Tilt the map on switching 3D on or off, and when the page loads with it on but a flat map
  let currentThreeD = false
  $effect(() => {
    if (map && app.threeD !== currentThreeD) {
      currentThreeD = app.threeD
      tilt(map, currentThreeD)
    }
  })

  // As a string, so the filter is only set again when the finished tracks change, not on every frame
  let finished = $derived(app.finished.map((track) => track.osm).join(','))
  $effect(() => {
    if (map && layers) showTracks(map, finished ? finished.split(',').map(Number) : [], app.heat)
  })

  $effect(() => {
    if (map && layers) highlightTrack(map, app.hovered)
  })

  // Only changes when playback starts or stops, not with every frame
  let playing = $derived(app.time !== null)
  let style: TrackStyle = $derived({ dark: theme.dark, heat: app.heat, playing, ahead: app.threeD && app.riderView })

  $effect(() => {
    if (map && layers) styleTracks(map, style)
  })

  // Where the riders are, as drawn last, for following them
  let riders: Rider[] = []
  /** The zoom level following aims for while the riders are slow enough, null until it follows */
  let followZoom: number | null = null

  $effect(() => {
    if (map && layers) riders = drawPlayback(map, app.riding, app.afterglow, app.time, style)
  })

  // In 3D, follow one rider from behind, or from their eyes
  $effect(() => {
    if (!map || !app.threeD || !(app.follow || app.riderView) || !app.playing) return
    return chase(map, () => riders, app.riderView)
  })

  // Follow the riders on every frame, independent of the effects above, so moving the map can't
  // feed back into what is drawn
  $effect(() => {
    if (!map || app.threeD || !app.follow || !app.playing) return
    const instance = map
    followZoom ??= instance.getZoom()
    let last = performance.now()
    let flying = false
    /** The rides being followed, their extent in world units (0–1) and the zoom level for them */
    let plan: { key: string; west: number; north: number; east: number; south: number; zoom: number } | null = null

    function planFor(tracks: Track[], key: string) {
      const west = Math.min(...tracks.map((track) => track.bbox[0]))
      const south = Math.min(...tracks.map((track) => track.bbox[1]))
      const east = Math.max(...tracks.map((track) => track.bbox[2]))
      const north = Math.max(...tracks.map((track) => track.bbox[3]))
      const fit = instance.cameraForBounds([west, south, east, north], { padding: RIDE_PADDING })?.zoom ?? followZoom!
      // Average speed of the fastest ride, in world units per second of playback
      const corner = maplibregl.MercatorCoordinate.fromLngLat([west, north])
      const metersPerSecond = Math.max(...tracks.map((track) => (track.km * 1000) / Math.max(1, track.minutes * 60)))
      const speed = metersPerSecond * corner.meterInMercatorCoordinateUnits() * app.speed
      const byspeed = Math.log2(RIDE_SCREEN_SPEED / (speed * WORLD_SIZE))
      const end = maplibregl.MercatorCoordinate.fromLngLat([east, south])
      return { key, west: corner.x, north: corner.y, east: end.x, south: end.y, zoom: Math.min(followZoom!, Math.max(fit, byspeed)) }
    }

    /** Keeps a center coordinate so the map stays within the ride, or in its middle if it fits */
    const within = (value: number, low: number, high: number, half: number, pad: number) =>
      high - low + 2 * pad <= 2 * half ? (low + high) / 2 : Math.min(high + pad - half, Math.max(low - pad + half, value))

    const step = (now: number) => {
      // At most a tenth of a second, so the map doesn't leap after the tab was in the background
      const seconds = Math.min(0.1, (now - last) / 1000)
      last = now
      frame = requestAnimationFrame(step)
      if (riders.length === 0 || flying || instance.isMoving() || seconds === 0) return

      const tracks = riders.map(({ track }) => track)
      const key = `${tracks.map((track) => track.osm).join(',')}|${app.speed}|${followZoom}`
      const moved = plan?.key !== key
      if (moved) plan = planFor(tracks, key)

      const { clientWidth: width, clientHeight: height } = instance.getContainer()
      // A new ride or zoom level: one move to the ride at its zoom level, otherwise only follow
      const current = instance.getZoom()
      const zoom = moved && (plan!.zoom < current || plan!.zoom - current >= ZOOM_IN_STEP) ? plan!.zoom : current
      const scale = WORLD_SIZE * 2 ** zoom
      const center = maplibregl.MercatorCoordinate.fromLngLat(instance.getCenter())
      const dots = riders.map(({ position }) => maplibregl.MercatorCoordinate.fromLngLat(position as [number, number]))
      const xs = dots.map(({ x }) => x)
      const ys = dots.map(({ y }) => y)

      // Move only as far as needed to bring the riders back into the free area in the middle
      const [freeX, freeY] = [(width * FREE_AREA) / 2 / scale, (height * FREE_AREA) / 2 / scale]
      const follow = (value: number, low: number, high: number, free: number) =>
        value + Math.max(0, high - (value + free)) + Math.min(0, low - (value - free))
      const half = (size: number) => size / 2 / scale
      const pad = RIDE_PADDING / scale
      const x = within(follow(center.x, Math.min(...xs), Math.max(...xs), freeX), plan!.west, plan!.east, half(width), pad)
      const y = within(follow(center.y, Math.min(...ys), Math.max(...ys), freeY), plan!.north, plan!.south, half(height), pad)

      if (moved) {
        flying = true
        instance.easeTo({ center: new maplibregl.MercatorCoordinate(x, y).toLngLat(), zoom, duration: RIDE_MOVE })
        instance.once('moveend', () => (flying = false))
        return
      }
      const near = 1 - Math.exp(-seconds / CENTER_LAG)
      instance.jumpTo({
        center: new maplibregl.MercatorCoordinate(center.x + (x - center.x) * near, center.y + (y - center.y) * near).toLngLat(),
      })
    }
    let frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  })

  // After playback, following starts again from the zoom level the map then has
  $effect(() => {
    if (app.time === null) followZoom = null
  })
</script>

<div class="map" class:flat={!app.threeD} bind:this={container}></div>

<style>
  .map :global(.toggle-control button) {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
  }

  .map :global(.toggle-control button[hidden]) {
    display: none;
  }

  .map :global(.toggle-control button[aria-pressed='true']) {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* The compass only helps on a map that can be turned and tilted */
  .map.flat :global(.maplibregl-ctrl-compass) {
    display: none;
  }

  .map {
    position: absolute;
    inset: 0;
  }
</style>

<script lang="ts">
  import * as maplibregl from 'maplibre-gl'
  import { untrack } from 'svelte'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { app } from './state.svelte'
  import { theme } from './theme.svelte'
  import { addTrackLayers, bindTrackEvents, drawPlayback, highlightTrack, showTracks, styleTracks, type TrackStyle } from './tracks'
  import type { BBox } from './track-types'

  // MapLibre looks for its worker next to its own module, which Vite's dependency
  // pre-bundling moves, so point it at the worker file explicitly
  maplibregl.setWorkerUrl(workerUrl)

  const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`

  /** A button below the zoom controls that switches the heat map on and off */
  class HeatControl implements maplibregl.IControl {
    button = document.createElement('button')

    onAdd() {
      const group = document.createElement('div')
      group.className = 'maplibregl-ctrl maplibregl-ctrl-group heat-control'
      this.button.type = 'button'
      this.button.title = 'Show the rides as a heat map'
      this.button.ariaLabel = 'Heat map'
      this.button.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
        '<path d="M10 18c3.3 0 5.5-2.3 5.5-5.4 0-3.4-2.6-5.2-3.6-8.6-1.9 1.3-2.6 3.3-2.4 5.2-1-.6-1.7-1.6-1.9-2.9C5.8 7.8 4.5 10 4.5 12.6 4.5 15.7 6.7 18 10 18z" stroke-linejoin="round"/></svg>'
      this.button.addEventListener('click', () => app.toggleHeat())
      group.append(this.button)
      return group
    }

    onRemove() {
      this.button.parentElement?.remove()
    }
  }

  let container: HTMLDivElement
  const heatControl = new HeatControl()

  $effect(() => {
    heatControl.button.ariaPressed = String(app.heat)
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
      hash: true,
    })
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    instance.addControl(heatControl, 'top-right')
    instance.addControl(new maplibregl.ScaleControl(), 'bottom-right')

    const updateBounds = () => (app.bounds = instance.getBounds().toArray().flat() as BBox)
    instance.on('moveend', updateBounds)
    // Showing or hiding the sidebar resizes the map without moving it
    instance.on('resize', updateBounds)
    instance.on('load', updateBounds)
    instance.on('style.load', () => styleLoads++)
    bindTrackEvents(instance)
    map = instance
    app.map = instance
    return () => {
      app.map = null
      instance.remove()
    }
  })

  $effect(() => {
    const city = app.cities[0]
    if (map && city && !positioned) {
      map.fitBounds(city.bbox, { padding: 40, animate: false })
      positioned = true
    }
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

  // As a string, so the filter is only set again when the finished tracks change, not on every frame
  let finished = $derived(app.finished.map((track) => track.osm).join(','))
  $effect(() => {
    if (map && layers) showTracks(map, finished ? finished.split(',').map(Number) : [])
  })

  $effect(() => {
    if (map && layers) highlightTrack(map, app.hovered)
  })

  // Only changes when playback starts or stops, not with every frame
  let playing = $derived(app.time !== null)
  let style: TrackStyle = $derived({ dark: theme.dark, heat: app.heat, playing })

  $effect(() => {
    if (map && layers) styleTracks(map, style)
  })

  $effect(() => {
    if (map && layers) drawPlayback(map, app.riding, app.time, style)
  })
</script>

<div class="map" bind:this={container}></div>

<style>
  .map :global(.heat-control button) {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
  }

  .map :global(.heat-control button[aria-pressed='true']) {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .map {
    position: absolute;
    inset: 0;
  }
</style>

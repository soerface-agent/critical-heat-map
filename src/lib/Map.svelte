<script lang="ts">
  import * as maplibregl from 'maplibre-gl'
  import { untrack } from 'svelte'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { app } from './state.svelte'
  import { theme } from './theme.svelte'
  import { addTrackLayers, bindTrackEvents, drawPlayback, highlightTrack, showTracks } from './tracks'
  import type { BBox } from './track-types'

  // MapLibre looks for its worker next to its own module, which Vite's dependency
  // pre-bundling moves, so point it at the worker file explicitly
  maplibregl.setWorkerUrl(workerUrl)

  const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`

  let container: HTMLDivElement
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
      addTrackLayers(map, app.collection, currentDark)
      layers = untrack(() => layers) + 1
    }
  })

  $effect(() => {
    if (!map || !layers) return
    const shown = app.current ? app.queue.slice(0, app.index) : app.drawn
    showTracks(map, shown.map((track) => track.osm))
  })

  $effect(() => {
    if (map && layers) highlightTrack(map, app.hovered)
  })

  $effect(() => {
    if (map && layers) drawPlayback(map, app.current, app.progress)
  })
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>

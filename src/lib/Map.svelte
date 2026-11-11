<script lang="ts">
  import * as maplibregl from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { app } from './state.svelte'
  import { addTracks, drawPlayback, highlightTrack, showTracks } from './tracks'
  import type { BBox } from './track-types'

  // MapLibre looks for its worker next to its own module, which Vite's dependency
  // pre-bundling moves, so point it at the worker file explicitly
  maplibregl.setWorkerUrl(workerUrl)

  let container: HTMLDivElement
  let map = $state.raw<maplibregl.Map | null>(null)
  let ready = $state(false)

  // MapLibre keeps the position in the hash; without one, start at the city with the most tracks
  let positioned = /^#[\d.]+\/[-\d.]+\/[-\d.]+/.test(location.hash)

  $effect(() => {
    const instance = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [9.4985241, 51.3156676],
      zoom: 12,
      hash: true,
    })
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    instance.addControl(new maplibregl.ScaleControl(), 'bottom-right')

    const updateBounds = () => (app.bounds = instance.getBounds().toArray().flat() as BBox)
    instance.on('moveend', updateBounds)
    instance.on('load', () => {
      updateBounds()
      ready = true
    })
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

  // Add the tracks once both the map style and the data are loaded
  let added = $state(false)
  $effect(() => {
    if (map && ready && app.collection && !added) {
      addTracks(map, app.collection)
      added = true
    }
  })

  $effect(() => {
    if (!map || !added) return
    const shown = app.current ? app.queue.slice(0, app.index) : app.drawn
    showTracks(map, shown.map((track) => track.osm))
  })

  $effect(() => {
    if (map && added) highlightTrack(map, app.hovered)
  })

  $effect(() => {
    if (map && added) drawPlayback(map, app.current, app.progress)
  })
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>

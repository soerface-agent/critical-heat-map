<script lang="ts">
  import * as maplibregl from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { addTracks } from './tracks'

  // MapLibre looks for its worker next to its own module, which Vite's dependency
  // pre-bundling moves, so point it at the worker file explicitly
  maplibregl.setWorkerUrl(workerUrl)

  // Kassel, where most of the Critical Mass tracks are
  const KASSEL: [number, number] = [9.4985241, 51.3156676]

  let container: HTMLDivElement

  $effect(() => {
    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: KASSEL,
      zoom: 13,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left')
    map.on('load', () => addTracks(map))

    return () => map.remove()
  })
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>

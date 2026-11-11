<script lang="ts">
  import Map from './lib/Map.svelte'
</script>

<main>
  <Map />
  <h1 class="title">Critical Heat Map</h1>
</main>

<style>
  main {
    position: relative;
    height: 100%;
  }

  .title {
    position: absolute;
    top: 12px;
    left: 12px;
    margin: 0;
    padding: 6px 12px;
    font-size: 1.1rem;
    background: rgb(255 255 255 / 0.85);
    border-radius: 6px;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
  }
</style>

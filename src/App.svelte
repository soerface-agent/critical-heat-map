<script lang="ts">
  import Map from './lib/Map.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import Timeline from './lib/Timeline.svelte'
  import { app } from './lib/state.svelte'

  app.readUrl()
  app.load(`${import.meta.env.BASE_URL}tracks.geojson`)

  // Keep the query string in sync; the hash belongs to the map position
  $effect(() => {
    const query = app.query()
    history.replaceState(history.state, '', location.pathname + query + location.hash)
  })

  window.addEventListener('popstate', () => app.readUrl())

  // On narrow screens the city select only shows the name, so the title fits next to it
  const narrowQuery = matchMedia('(max-width: 720px)')
  let narrow = $state(narrowQuery.matches)
  narrowQuery.addEventListener('change', () => (narrow = narrowQuery.matches))

  function selectCity(event: Event) {
    const city = app.cities.find((city) => city.id === (event.currentTarget as HTMLSelectElement).value)
    if (city) app.showCity(city)
  }
</script>

<main>
  <section class="map-area" aria-label="Map">
    <Map />
    <div class="title-bar">
      <h1>Critical Mass Tracks</h1>
      <label class="visually-hidden" for="city">City</label>
      <select id="city" value={app.city?.id ?? ''} onchange={selectCity}>
        {#if !app.city}
          <option value="" disabled>Choose a city</option>
        {/if}
        {#each app.cities as city (city.id)}
          {@const count = app.tracks.filter((track) => track.city === city.id).length}
          <option value={city.id}>
            {narrow ? city.name : `${city.name} · ${count} ${count === 1 ? 'ride' : 'rides'}`}
          </option>
        {/each}
      </select>
    </div>
  </section>
  <Sidebar />
  <Timeline />
</main>

<style>
  main {
    display: grid;
    grid-template:
      'map side' minmax(0, 1fr)
      'timeline timeline' auto
      / minmax(0, 1fr) 380px;
    height: 100%;
  }

  .map-area {
    grid-area: map;
    position: relative;
    min-height: 0;
  }

  main > :global(aside) {
    grid-area: side;
  }

  main > :global(.timeline) {
    grid-area: timeline;
  }

  .title-bar {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100% - 80px);
    box-sizing: border-box;
    padding: 6px 8px 6px 14px;
    background: rgb(255 255 255 / 0.94);
    border-radius: 10px;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
  }

  h1 {
    margin: 0;
    font-family: var(--display);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  select {
    min-width: 0;
    min-height: 36px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }

  @media (max-width: 720px) {
    main {
      grid-template:
        'map' 55vh
        'timeline' auto
        'side' auto
        / minmax(0, 1fr);
      height: auto;
    }

    h1 {
      font-size: 17px;
    }
  }
</style>

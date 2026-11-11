<script lang="ts">
  import Map from './lib/Map.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import Timeline from './lib/Timeline.svelte'
  import { km } from './lib/format'
  import { app } from './lib/state.svelte'
  import { theme } from './lib/theme.svelte'

  const THEME_LABELS = { auto: 'Auto (system)', light: 'Light', dark: 'Dark' }
  const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' } as const

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

<main class:collapsed={!app.sidebarOpen && !narrow}>
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
      <button
        type="button"
        class="icon-button"
        aria-label="Theme: {THEME_LABELS[theme.mode]}. Switch to {THEME_LABELS[NEXT_THEME[theme.mode]]}"
        title="Theme: {THEME_LABELS[theme.mode]}"
        onclick={() => theme.cycle()}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          {#if theme.mode === 'light'}
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" stroke-linecap="round" />
          {:else if theme.mode === 'dark'}
            <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z" stroke-linejoin="round" />
          {:else}
            <circle cx="10" cy="10" r="7" />
            <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
          {/if}
        </svg>
      </button>
    </div>
    {#if !narrow}
      <button
        type="button"
        class="sidebar-toggle"
        aria-expanded={app.sidebarOpen}
        aria-controls="sidebar"
        onclick={() => app.toggleSidebar()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d={app.sidebarOpen ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'} stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {#if app.sidebarOpen}
          <span class="visually-hidden">Hide ride list</span>
        {:else}
          <span>{app.totals.rides} rides · {km(app.totals.km, 0)} km</span>
          <span class="visually-hidden">, show ride list</span>
        {/if}
      </button>
    {/if}
  </section>
  {#if app.sidebarOpen || narrow}
    <Sidebar />
  {/if}
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

  main.collapsed {
    grid-template:
      'map' minmax(0, 1fr)
      'timeline' auto
      / minmax(0, 1fr);
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
    background: var(--overlay);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }

  h1 {
    margin: 0;
    font-family: var(--display);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .icon-button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
  }

  .sidebar-toggle {
    position: absolute;
    top: 50%;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 12px 0 10px;
    border: 1px solid var(--border);
    border-right: none;
    border-radius: 10px 0 0 10px;
    background: var(--overlay);
    box-shadow: var(--shadow);
    font-size: 14px;
    font-weight: 600;
    transform: translateY(-50%);
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

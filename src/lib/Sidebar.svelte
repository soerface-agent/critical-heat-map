<script lang="ts">
  import { EVENT_TYPES, eventType } from './event-types'
  import { dayMonth, duration, km, monthLabel, shortTitle } from './format'
  import { app, type Track } from './state.svelte'

  const total = (tracks: Track[]) => tracks.reduce((sum, track) => sum + track.km, 0)

  let chips = $derived(
    Object.entries(EVENT_TYPES).map(([type, { label, color }]) => {
      const tracks = app.listed.filter((track) => track.type === type)
      return { label, color, tracks, on: tracks.length > 0 && tracks.every((track) => !app.hidden.has(track.osm)) }
    }),
  )

  // Newest year first, newest ride first
  let years = $derived.by(() => {
    const byYear = new Map<string, Track[]>()
    for (const track of app.listed.toReversed()) {
      const year = (track.start ?? '').slice(0, 4)
      byYear.set(year, [...(byYear.get(year) ?? []), track])
    }
    return [...byYear].map(([year, tracks]) => ({
      year,
      tracks,
      on: tracks.every((track) => !app.hidden.has(track.osm)),
    }))
  })

  let minutes = $derived(app.selected.reduce((sum, track) => sum + track.minutes, 0))
</script>

<aside aria-label="Rides in this map view">
  <header>
    <div class="label">In this map view</div>
    <div class="total">{km(total(app.selected), 0)} km</div>
    <div class="meta">
      {app.selected.length} of {app.listed.length} rides · {Math.round(minutes / 60)} h riding
    </div>
    {#if app.range}
      <div class="meta">{monthLabel(app.range.from)} – {monthLabel(app.range.to)}</div>
    {/if}

    <div class="chips">
      {#each chips as chip (chip.label)}
        <button
          type="button"
          class="chip"
          class:on={chip.on}
          style:--color={chip.color}
          aria-pressed={chip.on}
          disabled={chip.tracks.length === 0}
          onclick={() => app.setHidden(chip.tracks, chip.on)}
        >
          <span class="dot" aria-hidden="true"></span>{chip.label} <span class="count">{chip.tracks.length}</span>
        </button>
      {/each}
    </div>
    <div class="actions">
      <button type="button" onclick={() => app.setHidden(app.listed, false)}>Select all</button>
      <button type="button" onclick={() => app.setHidden(app.listed, true)}>None</button>
    </div>
  </header>

  <div class="list">
    {#if app.collection && app.listed.length === 0}
      <p class="empty">No rides in this part of the map or time range. Pick a city, zoom out, or clear the range.</p>
    {/if}
    {#each years as group (group.year)}
      <label class="year">
        <input type="checkbox" checked={group.on} onchange={() => app.setHidden(group.tracks, group.on)} />
        <span class="name">{group.year}</span>
        <span class="meta">
          {group.tracks.length}
          {group.tracks.length === 1 ? 'ride' : 'rides'} · {km(total(group.tracks), 0)} km
        </span>
      </label>
      {#each group.tracks as track (track.osm)}
        {@const hidden = app.hidden.has(track.osm)}
        <label
          class="ride"
          class:hidden
          class:hot={app.hovered === track.osm || app.current?.osm === track.osm}
          onpointerenter={() => (app.hovered = track.osm)}
          onpointerleave={() => (app.hovered = null)}
        >
          <input
            type="checkbox"
            checked={!hidden}
            style:accent-color={eventType(track.type).color}
            onchange={() => app.setHidden([track], !hidden)}
          />
          <span class="date">{track.start ? dayMonth(track.start) : ''}</span>
          <a class="title" href={track.url} target="_blank" rel="noreferrer">{shortTitle(track.title)}</a>
          <span class="duration">{duration(track.minutes)}</span>
          <span class="km">{km(track.km)} km</span>
        </label>
      {/each}
    {/each}
  </div>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--border);
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .total {
    font-family: var(--display);
    font-size: 40px;
    font-weight: 700;
    line-height: 1.1;
  }

  .meta {
    font-size: 14px;
    color: var(--text-2);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 500;
  }

  .chip.on {
    border-color: var(--color);
    background: var(--color);
    color: #fff;
  }

  .chip .dot {
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1.5px solid var(--color);
    border-radius: 50%;
  }

  .chip.on .dot {
    background: #fff;
  }

  .count {
    opacity: 0.8;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .actions button {
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    font-size: 13px;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  .empty {
    margin: 24px 20px;
    font-size: 14px;
    color: var(--text-2);
  }

  .year {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    background: var(--background);
    border-bottom: 1px solid var(--border);
  }

  .year .name {
    flex: 1;
    font-family: var(--display);
    font-size: 15px;
    font-weight: 600;
  }

  .year .meta {
    font-size: 13px;
  }

  .ride {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    padding: 6px 20px;
  }

  .ride.hot {
    background: var(--hover);
  }

  .ride.hidden .title,
  .ride.hidden .km {
    color: var(--muted);
  }

  input {
    width: 16px;
    height: 16px;
    margin: 0;
  }

  .year input {
    accent-color: var(--text);
  }

  .date {
    flex: none;
    width: 48px;
    font-size: 13px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    color: inherit;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:hover {
    text-decoration: underline;
  }

  .duration {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .km {
    width: 64px;
    font-size: 14px;
    font-weight: 600;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>

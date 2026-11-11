<script lang="ts">
  import { eventColor } from './event-types'
  import { fullDate, km, monthLabel, shortTitle } from './format'
  import { app, type Track } from './state.svelte'

  const DAY = 86_400_000
  // Pixels the pointer has to move before a press on the timeline becomes a brush
  const BRUSH_THRESHOLD = 5

  // The time axis spans all tracks, with a month of space on both sides
  let domain = $derived.by(() => {
    const times = app.tracks.map((track) => Date.parse(track.start ?? '')).filter(Number.isFinite)
    if (times.length === 0) return { from: 0, to: 1 }
    return { from: Math.min(...times) - 31 * DAY, to: Math.max(...times) + 31 * DAY }
  })

  const percent = (time: number) => Math.min(100, Math.max(0, ((time - domain.from) / (domain.to - domain.from)) * 100))
  const monthStart = (month: string) => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
  const monthEnd = (month: string) => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1) - 1
  const trackPosition = (track: Track) => percent(Date.parse(track.start ?? ''))

  let years = $derived.by(() => {
    const first = new Date(domain.from).getUTCFullYear()
    const last = new Date(domain.to).getUTCFullYear()
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const year = String(first + i)
      const from = Math.max(domain.from, monthStart(`${year}-01`))
      const to = Math.min(domain.to, monthEnd(`${year}-12`))
      return { year, start: percent(monthStart(`${year}-01`)), center: (percent(from) + percent(to)) / 2 }
    })
  })

  let rank = $derived(new Map(app.queue.map((track, i) => [track.osm, i])))
  let hovered = $derived(app.tracks.find((track) => track.osm === app.hovered))

  function selectYear(year: string) {
    const selected = app.range?.from === `${year}-01` && app.range?.to === `${year}-12`
    app.stop()
    app.range = selected ? null : { from: `${year}-01`, to: `${year}-12` }
  }

  let brush: { x: number; rect: DOMRect; active: boolean } | null = null

  function monthAt(x: number, rect: DOMRect): string {
    const fraction = Math.min(1, Math.max(0, (x - rect.left) / rect.width))
    return new Date(domain.from + fraction * (domain.to - domain.from)).toISOString().slice(0, 7)
  }

  function brushStart(event: PointerEvent) {
    brush = { x: event.clientX, rect: (event.currentTarget as HTMLElement).getBoundingClientRect(), active: false }
  }

  function brushMove(event: PointerEvent) {
    if (!brush) return
    if (!brush.active) {
      // A short movement is a click on a bar, not a brush
      if (Math.abs(event.clientX - brush.x) < BRUSH_THRESHOLD) return
      brush.active = true
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      app.stop()
    }
    const [from, to] = [monthAt(brush.x, brush.rect), monthAt(event.clientX, brush.rect)].sort()
    app.range = { from, to }
  }

  function brushEnd() {
    brush = null
  }
</script>

<section class="timeline" aria-label="Timeline">
  <div class="controls">
    <button
      type="button"
      class="play"
      aria-label={app.playing ? 'Pause' : 'Play selected rides'}
      onclick={() => (app.playing ? app.pause() : app.play())}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        {#if app.playing}
          <rect x="4" y="3" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="12" y="3" width="4" height="14" rx="1" fill="currentColor" />
        {:else}
          <path d="M6 3.5v13l11-6.5z" fill="currentColor" />
        {/if}
      </svg>
    </button>
    <div class="small-controls">
      <button type="button" aria-label="Playback speed" onclick={() => (app.speed = app.speed === 4 ? 1 : app.speed * 2)}>
        {app.speed}×
      </button>
      <button type="button" aria-label="Stop and show all" onclick={() => app.stop()} disabled={app.index < 0}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
      </button>
    </div>
  </div>

  <div class="axis">
    <div class="status">
      {#if app.current}
        <span class="dot" style:background={eventColor(app.current.type)}></span>
        <strong>{shortTitle(app.current.title)}</strong>
        <span>
          {app.current.start ? fullDate(app.current.start) : ''} · {km(app.current.km)} km · ride {app.index + 1} of {app.queue.length},
{km(app.totals.km, 0)} km so far
        </span>
      {:else if app.range}
        <strong>{monthLabel(app.range.from)} – {monthLabel(app.range.to)}</strong>
        <button type="button" onclick={() => (app.range = null)}>Clear range</button>
      {:else}
        <span>Drag across the timeline to pick a time range, or click a year. Double-click to clear.</span>
      {/if}
    </div>

    <!-- Pointer-only brush, cleared by double click; the year buttons and "Clear range" work by keyboard -->
    <div
      class="bars"
      role="presentation"
      title="Drag to pick a time range, double-click to clear it"
      onpointerdown={brushStart}
      onpointermove={brushMove}
      onpointerup={brushEnd}
      onpointercancel={brushEnd}
      ondblclick={() => (app.range = null)}
    >
      {#if app.range}
        <div
          class="range"
          style:left="{percent(monthStart(app.range.from))}%"
          style:width="{percent(monthEnd(app.range.to)) - percent(monthStart(app.range.from))}%"
        ></div>
      {/if}
      {#each years.slice(1) as year (year.year)}
        <div class="year-line" style:left="{year.start}%"></div>
      {/each}
      {#each app.tracks as track (track.osm)}
        {@const shown = !app.hidden.has(track.osm)}
        {@const visible = app.inView(track)}
        {@const pending = app.index >= 0 && (rank.get(track.osm) ?? Infinity) > app.index}
        <button
          type="button"
          class="bar"
          class:shown
          class:visible
          class:faded={!app.inRange(track) || (pending && visible && shown)}
          class:hot={app.hovered === track.osm || app.current?.osm === track.osm}
          style:left="{trackPosition(track)}%"
          style:--color={eventColor(track.type)}
          aria-label="{track.title}, {km(track.km)} km{visible ? '' : ', outside the map view'}"
          aria-pressed={shown}
          onclick={() => app.setHidden([track], shown)}
          onpointerenter={() => (app.hovered = track.osm)}
          onpointerleave={() => (app.hovered = null)}
        ></button>
      {/each}
      {#if app.current}
        <div class="playhead" style:left="{trackPosition(app.current)}%"></div>
      {/if}
      {#if hovered && !app.current}
        <div class="tip" style:left="{trackPosition(hovered)}%">
          {shortTitle(hovered.title)} · {hovered.start ? fullDate(hovered.start) : ''} · {km(hovered.km)} km
        </div>
      {/if}
    </div>

    <div class="years">
      {#each years as year (year.year)}
        <button
          type="button"
          style:left="{year.center}%"
          aria-label="Show {year.year} only"
          aria-pressed={app.range?.from === `${year.year}-01` && app.range?.to === `${year.year}-12`}
          onclick={() => selectYear(year.year)}>{year.year}</button
        >
      {/each}
    </div>
  </div>

</section>

<style>
  .timeline {
    display: flex;
    align-items: stretch;
    gap: 20px;
    height: 150px;
    box-sizing: border-box;
    padding: 12px 24px 10px;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  .play {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border: none;
    border-radius: 50%;
    background: var(--text);
    color: var(--surface);
  }

  .small-controls {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .small-controls button,
  .status button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 24px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }

  .axis {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 28px;
    overflow: hidden;
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
  }

  .status strong {
    color: var(--text);
  }

  .status .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .bars {
    position: relative;
    flex: 1;
    border-bottom: 1px solid var(--axis);
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    background: var(--accent-soft);
    border-inline: 2px solid var(--accent);
  }

  .year-line {
    position: absolute;
    top: 0;
    bottom: -28px;
    border-left: 1px dashed var(--border-strong);
  }

  .bar {
    position: absolute;
    bottom: 0;
    width: 9px;
    height: 14px;
    margin-left: -4px;
    padding: 0;
    box-sizing: border-box;
    background: var(--bar-muted);
    border: 1.5px solid var(--bar-muted);
    border-bottom: none;
    border-radius: 3px 3px 0 0;
  }

  .bar.visible {
    height: 40px;
    background: var(--surface);
    border-color: var(--color);
  }

  .bar.visible.shown {
    background: var(--color);
  }

  .bar.faded {
    opacity: 0.3;
  }

  .bar.hot {
    border-color: var(--text);
  }

  .playhead {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
  }

  .tip {
    position: absolute;
    bottom: 46px;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--text);
    color: var(--surface);
    font-size: 12px;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .years {
    position: relative;
    height: 22px;
  }

  .years button {
    position: absolute;
    top: 0;
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: none;
    font-size: 12px;
    font-weight: 600;
    transform: translateX(-50%);
  }

  .years button[aria-pressed='true'] {
    background: var(--accent-soft);
  }

  @media (max-width: 720px) {
    .timeline {
      flex-wrap: wrap;
      height: auto;
      gap: 12px;
      padding: 12px 16px;
    }

    .axis {
      flex-basis: 100%;
      order: 1;
    }

    .bars {
      height: 48px;
      flex: none;
    }

    .bar {
      width: 5px;
      margin-left: -2px;
    }

    .bar.visible {
      height: 32px;
    }

    .status {
      white-space: normal;
      height: auto;
      min-height: 28px;
    }
  }
</style>

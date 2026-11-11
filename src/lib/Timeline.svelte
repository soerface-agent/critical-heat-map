<script lang="ts">
  import { untrack } from 'svelte'
  import { eventColor } from './event-types'
  import { MONTHS, dateTime, fullDate, km, shortTitle } from './format'
  import SpeedMenu from './SpeedMenu.svelte'
  import { app, type TimeSpan, type Track } from './state.svelte'

  // Pixels the pointer has to move before a press on the timeline becomes a brush
  const BRUSH_THRESHOLD = 5
  // Pixels between labels on the time axis, at least
  const TICK_SPACING = 80
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  type Unit = 'year' | 'month' | 'day' | 'hour' | 'minute'
  const UNITS: Unit[] = ['year', 'month', 'day', 'hour', 'minute']
  // Steps between ticks, from fine to coarse, with their rough length
  const STEPS: [Unit, number, number][] = [
    ['minute', 1, MINUTE],
    ['minute', 2, 2 * MINUTE],
    ['minute', 5, 5 * MINUTE],
    ['minute', 10, 10 * MINUTE],
    ['minute', 30, 30 * MINUTE],
    ['hour', 1, HOUR],
    ['hour', 3, 3 * HOUR],
    ['hour', 6, 6 * HOUR],
    ['day', 1, DAY],
    ['month', 1, 30 * DAY],
    ['month', 3, 91 * DAY],
    ['year', 1, 365 * DAY],
    ['year', 2, 730 * DAY],
  ]

  const pad = (value: number) => String(value).padStart(2, '0')

  /** [year, month, day, hour, minute] in local time */
  function parts(time: number): number[] {
    const date = new Date(time)
    return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]
  }

  function fromParts([year, month, day, hour, minute]: number[]): number {
    return new Date(year, month, day, hour, minute).getTime()
  }

  /** The start of the step of `n` units that `time` falls in */
  function floorTo(time: number, unit: Unit, n: number): number {
    const values = parts(time)
    const index = UNITS.indexOf(unit)
    values[index] -= (values[index] - (unit === 'day' ? 1 : 0)) % n
    for (let i = index + 1; i < values.length; i++) values[i] = i === 2 ? 1 : 0
    return fromParts(values)
  }

  function addTo(time: number, unit: Unit, n: number): number {
    const values = parts(time)
    values[UNITS.indexOf(unit)] += n
    return fromParts(values)
  }

  function tickLabel(time: number, unit: Unit): string {
    const date = new Date(time)
    const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`
    if (unit === 'year') return String(date.getFullYear())
    // January is labeled with the year, for context
    if (unit === 'month') return date.getMonth() === 0 ? String(date.getFullYear()) : MONTHS[date.getMonth()]
    if (unit === 'day') return day
    return date.getHours() === 0 && date.getMinutes() === 0 ? day : `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  let bars: HTMLDivElement
  let axis: HTMLDivElement
  let width = $state(0)
  let domain = $derived(app.domain)
  let span = $derived(domain.to - domain.from)

  const percent = (time: number) => ((time - domain.from) / span) * 100
  const timeAt = (x: number, rect: DOMRect) => domain.from + ((x - rect.left) / rect.width) * span

  let ticks = $derived.by(() => {
    const [unit, n] = STEPS.find(([, , length]) => (length / span) * width >= TICK_SPACING) ?? STEPS.at(-1)!
    const result = []
    for (let time = floorTo(domain.from, unit, n); time < domain.to; time = addTo(time, unit, n)) {
      result.push({ time, end: addTo(time, unit, n), label: tickLabel(time, unit), zoomable: unit !== 'hour' && unit !== 'minute' })
    }
    return result
  })

  let shownTracks = $derived(app.tracks.filter((track) => track.to >= domain.from && track.from <= domain.to))
  let hovered = $derived(shownTracks.find((track) => track.osm === app.hovered))
  /** Without playback, the playhead waits after the last ride, where everything is drawn */
  let playhead = $derived(app.time ?? Math.max(...app.tracks.map((track) => track.to)))
  let riding = $derived(app.riding.find((track) => app.selected.includes(track)) ?? app.riding[0])

  const ridden = (track: Track) => Math.min(1, ((app.time ?? track.to) - track.from) / (track.to - track.from))

  // While playing, keep the playhead in view by turning the page when it leaves the zoomed-in part
  $effect(() => {
    const time = app.time
    if (!app.playing || time === null) return
    const { from, to } = untrack(() => app.domain)
    if (time < from || time > to) app.zoomTo({ from: time - (to - from) * 0.05, to: time + (to - from) * 0.95 })
  })

  // Zoom with the wheel (or pinch on a touchpad) around the pointer, scroll sideways to pan. Not
  // through onwheel, which can be passive and then can't keep the page from scrolling
  $effect(() => {
    function wheel(event: WheelEvent) {
      event.preventDefault()
      const rect = bars.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1
      const sideways = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX
      if (Math.abs(sideways) > Math.abs(event.deltaY) || event.shiftKey) {
        const shift = ((sideways * unit) / rect.width) * span
        app.zoomTo({ from: domain.from + shift, to: domain.to + shift })
      } else {
        const at = Math.min(domain.to, Math.max(domain.from, timeAt(event.clientX, rect)))
        const factor = Math.exp(event.deltaY * unit * 0.002)
        app.zoomTo({ from: at - (at - domain.from) * factor, to: at + (domain.to - at) * factor })
      }
    }
    axis.addEventListener('wheel', wheel, { passive: false })
    return () => axis.removeEventListener('wheel', wheel)
  })

  // A press on the timeline seeks there, dragging across it zooms in to the brushed span
  let press: { x: number; rect: DOMRect; onBar: boolean; active: boolean } | null = null
  let brush = $state.raw<TimeSpan | null>(null)

  function pressStart(event: PointerEvent) {
    if (event.button !== 0) return
    const onBar = (event.target as Element).closest('.bar') !== null
    press = { x: event.clientX, rect: bars.getBoundingClientRect(), onBar, active: false }
  }

  function pressMove(event: PointerEvent) {
    if (!press) return
    if (!press.active) {
      // A short movement is a click, not a brush
      if (Math.abs(event.clientX - press.x) < BRUSH_THRESHOLD) return
      press.active = true
      bars.setPointerCapture(event.pointerId)
    }
    const [from, to] = [timeAt(press.x, press.rect), timeAt(event.clientX, press.rect)].sort((a, b) => a - b)
    brush = { from, to }
  }

  function pressEnd(event: PointerEvent) {
    if (press?.active && brush) app.zoomTo(brush)
    // A click on a bar jumps to the start of the ride instead
    else if (press && !press.onBar) app.seek(timeAt(event.clientX, press.rect))
    pressCancel()
  }

  function pressCancel() {
    press = null
    brush = null
  }

  // Dragging the playhead pauses the playback until it is let go
  let scrub = $state.raw<{ rect: DOMRect; resume: boolean } | null>(null)

  function scrubStart(event: PointerEvent) {
    if (event.button !== 0) return
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    scrub = { rect: bars.getBoundingClientRect(), resume: app.playing }
    app.pause()
  }

  function scrubMove(event: PointerEvent) {
    if (scrub) app.seek(timeAt(event.clientX, scrub.rect))
  }

  function scrubEnd() {
    if (scrub?.resume) app.play()
    scrub = null
  }

  function scrubKey(event: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -0.01, ArrowRight: 0.01, PageDown: -0.1, PageUp: 0.1 }
    if (event.key in steps) app.seek(playhead + steps[event.key] * span)
    else if (event.key === 'Home') app.seek(domain.from)
    else if (event.key === 'End') app.seek(domain.to)
    else return
    event.preventDefault()
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
      <SpeedMenu />
      <button type="button" aria-label="Stop and show all" onclick={() => app.stop()} disabled={app.time === null}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
      </button>
    </div>
  </div>

  <div class="axis" bind:this={axis}>
    <div class="status">
      {#if app.time !== null}
        <strong class="clock">{dateTime(app.time)}</strong>
        {#if riding}
          <span class="dot" style:background={eventColor(riding.type)}></span>
          <span class="ride">
            <strong>{shortTitle(riding.title)}</strong>
            {km(riding.km * ridden(riding))} of {km(riding.km)} km{app.riding.length > 1 ? ` · ${app.riding.length - 1} more` : ''}
          </span>
        {/if}
        <span>ride {app.totals.rides} of {app.selected.length}, {km(app.totals.km, 0)} km so far</span>
      {:else}
        <span>Drag across the timeline or scroll on it to zoom. Click a ride or drag the playhead to jump in time.</span>
      {/if}
      {#if app.view}
        <button type="button" class="show-all" onclick={() => (app.view = null)}>Reset zoom</button>
      {/if}
    </div>

    <div class="plot">
      <!-- Pointer-only brush and seeking; the slider, the tick labels and "Reset zoom" work by keyboard -->
      <div
        class="bars"
        role="presentation"
        title="Click to jump in time, drag to zoom in, double-click to zoom out"
        bind:this={bars}
        bind:clientWidth={width}
        onpointerdown={pressStart}
        onpointermove={pressMove}
        onpointerup={pressEnd}
        onpointercancel={pressCancel}
        ondblclick={() => (app.view = null)}
      >
        {#each ticks as tick (tick.time)}
          <div class="tick-line" style:left="{percent(tick.time)}%"></div>
        {/each}
        {#if brush}
          <div class="brush" style:left="{percent(brush.from)}%" style:width="{percent(brush.to) - percent(brush.from)}%"></div>
        {/if}
        {#each shownTracks as track (track.osm)}
          {@const shown = !app.hidden.has(track.osm)}
          {@const visible = app.inView(track)}
          <button
            type="button"
            class="bar"
            class:shown
            class:visible
            class:faded={app.time !== null && track.from > app.time && visible && shown}
            class:hot={app.hovered === track.osm || app.riding.includes(track)}
            style:left="{percent(track.from)}%"
            style:width="max(var(--min-bar), {percent(track.to) - percent(track.from)}%)"
            style:--color={eventColor(track.type)}
            aria-label="Jump to {track.title}, {km(track.km)} km{visible ? '' : ', outside the map view'}{shown ? '' : ', hidden'}"
            onclick={() => app.seek(track.from)}
            onpointerenter={() => (app.hovered = track.osm)}
            onpointerleave={() => (app.hovered = null)}
          ></button>
        {/each}
        {#if app.tracks.length > 0}
          <div
            class="playhead"
            class:idle={app.time === null}
            role="slider"
            tabindex="0"
            aria-label="Playback position"
            aria-valuemin={app.extent.from}
            aria-valuemax={app.extent.to}
            aria-valuenow={playhead}
            aria-valuetext={dateTime(playhead)}
            style:left="{percent(playhead)}%"
            onpointerdown={scrubStart}
            onpointermove={scrubMove}
            onpointerup={scrubEnd}
            onpointercancel={scrubEnd}
            onkeydown={scrubKey}
          ></div>
        {/if}
      </div>
      {#if hovered && !scrub}
        <div class="tip" style:left="{Math.min(100, Math.max(0, percent(hovered.from)))}%">
          {shortTitle(hovered.title)} · {fullDate(hovered.start)} · {km(hovered.km)} km
        </div>
      {/if}
    </div>

    <div class="ticks">
      {#each ticks as tick (tick.time)}
        {#if tick.zoomable}
          <button
            type="button"
            style:left="{percent(tick.time)}%"
            aria-label="Zoom in to {tick.label}"
            onclick={() => app.zoomTo({ from: tick.time, to: tick.end })}>{tick.label}</button
          >
        {:else}
          <span style:left="{percent(tick.time)}%">{tick.label}</span>
        {/if}
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
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
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

  .clock {
    font-variant-numeric: tabular-nums;
  }

  .ride {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .status .show-all {
    margin-left: auto;
  }

  .plot {
    position: relative;
    flex: 1;
  }

  .bars {
    --min-bar: 9px;
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--axis);
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .brush {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    background: var(--accent-soft);
    border-inline: 2px solid var(--accent);
  }

  .tick-line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px dashed var(--border-strong);
  }

  .bar {
    position: absolute;
    bottom: 0;
    height: 14px;
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

  /* A wide grab area around a thin line with a knob on top */
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 15px;
    margin-left: -7px;
    cursor: ew-resize;
    touch-action: none;
  }

  .playhead::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 6px;
    width: 3px;
    background: var(--text);
  }

  .playhead::after {
    content: '';
    position: absolute;
    top: 0;
    left: 1px;
    width: 13px;
    height: 13px;
    box-sizing: border-box;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text);
  }

  .playhead.idle::before {
    opacity: 0.4;
  }

  .playhead:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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

  .ticks {
    position: relative;
    height: 22px;
    overflow: hidden;
  }

  .ticks button,
  .ticks span {
    position: absolute;
    top: 0;
    height: 22px;
    padding: 0 6px;
    border: none;
    border-radius: 4px;
    background: none;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    white-space: nowrap;
  }

  .ticks span {
    color: var(--text-2);
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

    .plot {
      height: 48px;
      flex: none;
    }

    .bars {
      --min-bar: 5px;
    }

    .bar.visible {
      height: 32px;
    }

    .status {
      flex-wrap: wrap;
      white-space: normal;
      height: auto;
      min-height: 28px;
    }
  }
</style>

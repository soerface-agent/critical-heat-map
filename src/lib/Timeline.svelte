<script lang="ts">
  import { untrack } from 'svelte'
  import { eventColor } from './event-types'
  import { MONTHS, dateTime, fullDate, km, shortTitle } from './format'
  import SpeedMenu from './SpeedMenu.svelte'
  import { app, type TimeSpan, type Track } from './state.svelte'
  import { highestBetween } from './terrain'

  // Pixels the pointer has to move before a press on the timeline becomes a drag
  const DRAG_THRESHOLD = 5
  // A click on a bar at least this wide jumps to where it was clicked, on a narrower one to its start
  const WIDE_BAR = 40
  // Pixels between labels on the time axis, at least
  const TICK_SPACING = 80
  // A bar is as high as the terrain: each column of COLUMN pixels shows the highest point ridden in
  // its time, scaled from the lowest to the highest point of the rides on the timeline. FLOOR pixels
  // under the lowest point keep every ride visible, HEADROOM pixels stay free above the highest
  const COLUMN = 2
  const FLOOR = 3
  const HEADROOM = 4
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
  let height = $state(0)
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

  /**
   * Lowest and highest point of the rides on the timeline that are in the map view (or of all on
   * the timeline, if none is), rounded to 10 m. Rides elsewhere, e.g. in a lower city, are cut off
   * at the bottom. The lowest point is the 1st percentile, so a few minutes of bad GPS altitude
   * don't flatten all the other rides
   */
  let scale = $derived.by(() => {
    const profiled = shownTracks.filter((track) => track.elevation.length > 0)
    const inView = profiled.filter((track) => app.inView(track))
    const tracks = inView.length > 0 ? inView : profiled
    if (tracks.length === 0) return null
    const elevations = tracks.flatMap((track) => track.elevation).sort((a, b) => a - b)
    return {
      low: Math.floor(elevations[Math.floor(elevations.length * 0.01)] / 10) * 10,
      high: Math.ceil(elevations.at(-1)! / 10) * 10,
    }
  })

  /**
   * The bars in pixels: their box, and the outline of the terrain within it. A ride too short to
   * show its profile becomes one column of the minimum width, as high as its highest point.
   */
  let shapes = $derived.by(() => {
    // Like the minimum width in the CSS before, narrower on phones
    const minWidth = width < 600 ? 5 : 9
    const x = (time: number) => ((time - domain.from) / span) * width
    const time = (x: number) => domain.from + (x / width) * span
    const y = (elevation: number) =>
      // Tracks without elevations are drawn half as high as the plot
      scale && !Number.isNaN(elevation)
        ? height - FLOOR - (Math.max(0, elevation - scale.low) / Math.max(1, scale.high - scale.low)) * (height - FLOOR - HEADROOM)
        : height / 2

    return shownTracks.map((track) => {
      let [left, right] = [x(track.from), x(track.to)]
      const tops: [number, number][] = []
      if (right - left < minWidth) {
        ;[left, right] = [(left + right - minWidth) / 2, (left + right + minWidth) / 2]
        tops.push([left, y(track.high)], [right, y(track.high)])
      } else {
        // Only the part on screen
        ;[left, right] = [Math.max(left, -COLUMN), Math.min(right, width + COLUMN)]
        for (let start = left; start < right; start += COLUMN) {
          const end = Math.min(right, start + COLUMN)
          const top = y(highestBetween(track, time(start), time(end)))
          tops.push([start, top], [end, top])
        }
      }
      const top = Math.min(...tops.map(([, y]) => y))
      const [w, h] = [right - left, height - top]
      const path = tops.map(([x, y]) => `L${(x - left).toFixed(1)},${(y - top).toFixed(1)}`).join('')
      return { track, left, top, width: w, height: h, d: `M0,${h.toFixed(1)}${path}L${w.toFixed(1)},${h.toFixed(1)}Z` }
    })
  })
  /** Without playback, the playhead waits after the last ride, where everything is drawn */
  let playhead = $derived(app.time ?? Math.max(...app.tracks.map((track) => track.to)))
  let riding = $derived(app.riding.find((track) => app.selected.includes(track)) ?? app.riding[0])

  const ridden = (track: Track) => Math.min(1, ((app.time ?? track.to) - track.from) / (track.to - track.from))

  // Keep the playhead in view while playing or skipping, by turning the page when it leaves the
  // zoomed-in part
  $effect(() => {
    const time = app.time
    if (time === null) return
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

  // A press on the timeline seeks there. Dragging moves the timeline, or with Shift, zooms in to
  // the brushed span. Two fingers pinch to zoom
  type Press = {
    x: number
    rect: DOMRect
    domain: TimeSpan
    onBar: boolean
    mode: 'click' | 'pan' | 'brush' | 'pinch'
    shift: boolean
  }
  let press: Press | null = null
  /** Whether the last press moved the timeline or brushed, so the click that follows it is no seek */
  let moved = false
  /** Where the pointers on the timeline are, by pointer id */
  const pointers = new Map<number, number>()
  /** Where the two fingers of a pinch started and the time under each */
  let pinch: { x: number; time: number }[] = []
  let brush = $state.raw<TimeSpan | null>(null)
  let dragging = $state(false)

  function pressStart(event: PointerEvent) {
    if (event.button !== 0) return
    pointers.set(event.pointerId, event.clientX)
    const rect = bars.getBoundingClientRect()
    if (pointers.size === 2 && press) {
      // A second finger turns any press into a pinch
      brush = null
      for (const id of pointers.keys()) bars.setPointerCapture(id)
      pinch = [...pointers.values()].map((x) => ({ x, time: timeAt(x, rect) }))
      press = { ...press, rect, domain, mode: 'pinch' }
      moved = true
      dragging = true
      return
    }
    if (pointers.size > 1) return
    const onBar = (event.target as Element).closest('.bar') !== null
    moved = false
    press = { x: event.clientX, rect, domain, onBar, mode: 'click', shift: event.shiftKey }
  }

  function pressMove(event: PointerEvent) {
    if (!press || !pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, event.clientX)
    const { rect } = press
    if (press.mode === 'pinch') {
      const [a, b] = pinch.map((finger, i) => ({ ...finger, now: [...pointers.values()][i] }))
      if (Math.abs(b.now - a.now) < 10) return
      // Keep the time under each finger under it
      const newSpan = ((b.time - a.time) / (b.now - a.now)) * rect.width
      const from = a.time - ((a.now - rect.left) / rect.width) * newSpan
      app.zoomTo({ from, to: from + newSpan })
      return
    }
    if (press.mode === 'click') {
      // A short movement is a click, not a drag
      if (Math.abs(event.clientX - press.x) < DRAG_THRESHOLD) return
      press.mode = press.shift ? 'brush' : 'pan'
      moved = true
      dragging = press.mode === 'pan'
      bars.setPointerCapture(event.pointerId)
    }
    if (press.mode === 'brush') {
      const [from, to] = [timeAt(press.x, rect), timeAt(event.clientX, rect)].sort((a, b) => a - b)
      brush = { from, to }
    } else {
      const shift = ((press.x - event.clientX) / rect.width) * (press.domain.to - press.domain.from)
      app.zoomTo({ from: press.domain.from + shift, to: press.domain.to + shift })
    }
  }

  function pressEnd(event: PointerEvent) {
    pointers.delete(event.pointerId)
    if (!press) return
    if (press.mode === 'pinch') {
      // The finger left on the timeline goes on moving it, from where it is now
      const [x] = pointers.values()
      if (x === undefined) return pressCancel()
      press = { ...press, x, domain, rect: bars.getBoundingClientRect(), mode: 'pan' }
      return
    }
    if (press.mode === 'brush' && brush) app.zoomTo(brush)
    // A click on a bar is handled by the bar, see clickBar
    else if (press.mode === 'click' && !press.onBar) app.seek(timeAt(event.clientX, press.rect))
    pressCancel()
  }

  function clickBar(event: MouseEvent, track: Track) {
    if (moved) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    // detail is 0 when the bar is pressed by keyboard
    if (event.detail > 0 && rect.width >= WIDE_BAR) app.seek(timeAt(event.clientX, bars.getBoundingClientRect()))
    else app.seek(track.from)
  }

  function pressCancel(event?: PointerEvent) {
    if (event) pointers.delete(event.pointerId)
    if (pointers.size > 0) return
    press = null
    brush = null
    dragging = false
  }

  // Dragging the playhead pauses the playback until it is let go
  let scrub = $state.raw<{ rect: DOMRect; resume: boolean } | null>(null)

  /** The ride hovered here or on the map, described in the status line unless one is being played */
  let hovered = $derived(scrub || app.playing ? undefined : app.tracks.find((track) => track.osm === app.hovered))

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
      class="skip"
      aria-label="Previous ride"
      title="Previous ride"
      disabled={app.sessions.length === 0}
      onclick={() => app.skipBack()}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
        <path d="M14 3.5v9L5.5 8z" fill="currentColor" />
      </svg>
    </button>
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
    <button
      type="button"
      class="skip"
      aria-label="Next ride"
      title="Next ride"
      disabled={app.time === null || !app.sessions.some((session) => session.from > app.time!)}
      onclick={() => app.skipForward()}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 3.5v9L10.5 8z" fill="currentColor" />
        <rect x="12" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
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
      {#if hovered}
        <span class="now">
          <span class="dot" style:background={eventColor(hovered.type)}></span>
          <span class="ride">
            <strong>{shortTitle(hovered.title)}</strong>
            {fullDate(hovered.start)} · {km(hovered.km)} km{Number.isNaN(hovered.high) ? '' : ` · ${hovered.low}–${hovered.high} m`}
          </span>
        </span>
      {:else if app.time !== null}
        <strong class="clock">{dateTime(app.time)}</strong>
        {#if riding}
          <span class="now">
            <span class="dot" style:background={eventColor(riding.type)}></span>
            <span class="ride">
              <strong>{shortTitle(riding.title)}</strong>
              {km(riding.km * ridden(riding))} of {km(riding.km)} km{app.riding.length > 1 ? ` · ${app.riding.length - 1} more` : ''}
            </span>
          </span>
        {/if}
        <span class="totals">ride {app.totals.rides} of {app.selected.length}, {km(app.totals.km, 0)} km so far</span>
      {:else}
        <span class="hint">Drag the timeline to move it, scroll or pinch to zoom, Shift-drag to zoom in on a span. Click a ride or drag the playhead to jump in time.</span>
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
        class:zoomed={app.view !== null}
        class:dragging
        title="Click to jump in time, drag to move, Shift-drag to zoom in, double-click to zoom out"
        bind:this={bars}
        bind:clientWidth={width}
        bind:clientHeight={height}
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
        {#each shapes as bar (bar.track.osm)}
          {@const track = bar.track}
          {@const shown = !app.hidden.has(track.osm)}
          {@const visible = app.inView(track)}
          <button
            type="button"
            class="bar"
            class:shown
            class:visible
            class:faded={app.time !== null && track.from > app.time && visible && shown}
            class:hot={app.hovered === track.osm || app.riding.includes(track)}
            style:left="{bar.left}px"
            style:top="{bar.top}px"
            style:width="{bar.width}px"
            style:--color={eventColor(track.type)}
            aria-label="Jump to {track.title}, {km(track.km)} km{visible ? '' : ', outside the map view'}{shown ? '' : ', hidden'}"
            onclick={(event) => clickBar(event, track)}
            onpointerenter={(event) => {
              // A finger doesn't hover, and the timeline captures it, so it would never leave
              if (event.pointerType !== 'touch') app.hovered = track.osm
            }}
            onpointerleave={() => (app.hovered = null)}
          >
            <svg width={bar.width} height={bar.height} aria-hidden="true"><path d={bar.d} /></svg>
          </button>
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
      {#if scale}
        <div class="scale" title="Bar height: elevation above sea level">
          <span style:top="{HEADROOM}px">{scale.high} m</span>
          <span style:bottom="{FLOOR}px">{scale.low} m</span>
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

  .skip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--surface);
    color: var(--text);
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
    --scale-width: 44px;
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

  .now {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .ride,
  .totals {
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
    margin-right: var(--scale-width);
  }

  .bars {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--axis);
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .bars.zoomed {
    cursor: grab;
  }

  .bars.dragging {
    cursor: grabbing;
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

  /* In the map view in its type color, hollow if unchecked, grey if elsewhere */
  .bar {
    position: absolute;
    bottom: 0;
    padding: 0;
    border: none;
    background: none;
  }

  .bar svg {
    display: block;
    overflow: visible;
  }

  .bar path {
    fill: var(--bar-muted);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .bar.visible path {
    fill: var(--surface);
    stroke: var(--color);
  }

  .bar.visible.shown path {
    fill: var(--color);
    stroke: none;
  }

  .bar.faded {
    opacity: 0.3;
  }

  .bar.hot path {
    stroke: var(--text);
  }

  .scale {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(100% + 6px);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .scale span {
    position: absolute;
    left: 0;
    line-height: 1;
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

  .ticks {
    position: relative;
    height: 22px;
    margin-right: var(--scale-width);
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

    /* Two lines of fixed height, clock and totals above the ride, so nothing moves while playing */
    .status {
      display: grid;
      grid-template:
        'clock totals reset' 20px
        'now now reset' 20px
        / auto minmax(0, 1fr) auto;
      column-gap: 8px;
      height: 40px;
    }

    .clock {
      grid-area: clock;
    }

    .totals {
      grid-area: totals;
    }

    .now {
      grid-area: now;
    }

    .status .show-all {
      grid-area: reset;
    }

    .hint {
      grid-row: 1 / 3;
      grid-column: 1 / 3;
      display: -webkit-box;
      overflow: hidden;
      white-space: normal;
      line-height: 20px;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }
</style>

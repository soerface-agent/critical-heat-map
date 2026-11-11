<script lang="ts">
  import { speedLabel } from './format'
  import { MAX_SPEED, SPEEDS, app } from './state.svelte'

  // Width of the menu in pixels, as in the styles
  const WIDTH = 200

  let trigger: HTMLButtonElement
  let menu: HTMLDivElement
  let custom = $state(String(app.speed))
  let customSpeed = $derived(Number(custom))
  let valid = $derived(Number.isFinite(customSpeed) && customSpeed > 0 && customSpeed <= MAX_SPEED)

  // The popover opens in the top layer, so it is placed above its button by hand, before it shows
  function place(event: ToggleEvent) {
    if (event.newState !== 'open') return
    custom = String(app.speed)
    const rect = trigger.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - WIDTH - 8))}px`
    menu.style.bottom = `${innerHeight - rect.top + 6}px`
  }

  function choose(speed: number) {
    app.speed = speed
    menu.hidePopover()
    trigger.focus()
  }

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (valid) choose(customSpeed)
  }
</script>

<button
  type="button"
  class="trigger"
  bind:this={trigger}
  popovertarget="speed-menu"
  aria-label="Playback speed: {speedLabel(app.speed)}"
  title="Riding time per second of playback"
>
  {speedLabel(app.speed)}
  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 5.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
</button>

<div id="speed-menu" class="menu" popover bind:this={menu} onbeforetoggle={place} aria-label="Playback speed">
  <div class="heading">Playback speed</div>
  {#each SPEEDS as speed (speed)}
    <button type="button" class="option" aria-pressed={app.speed === speed} onclick={() => choose(speed)}>
      <span>{speedLabel(speed)}</span>
      <small>{speed === 1 ? 'as ridden' : `${speed}× real time`}</small>
    </button>
  {/each}
  <form onsubmit={submit}>
    <label for="custom-speed">Custom</label>
    <div class="row">
      <input id="custom-speed" type="number" min="1" max={MAX_SPEED} step="any" inputmode="decimal" bind:value={custom} />
      <span>×</span>
      <button type="submit" disabled={!valid}>Set</button>
    </div>
    <small>{valid ? `= ${speedLabel(customSpeed)}` : `1 to ${MAX_SPEED.toLocaleString('en')}× real time`}</small>
  </form>
</div>

<style>
  .trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
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

  .menu {
    position: fixed;
    inset: auto;
    width: 200px;
    margin: 0;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  .heading,
  label {
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  label {
    display: block;
  }

  .option {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    width: 100%;
    min-height: 32px;
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 14px;
    text-align: left;
  }

  .option:hover {
    background: var(--hover);
  }

  .option[aria-pressed='true'] {
    background: var(--accent-soft);
    font-weight: 600;
  }

  small {
    font-size: 12px;
    font-weight: 400;
    color: var(--muted);
  }

  form {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }

  form small {
    display: block;
    padding: 4px 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 30px;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }

  .row button {
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 600;
  }
</style>

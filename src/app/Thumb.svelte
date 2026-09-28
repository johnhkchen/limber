<!--
  A small drawn pose for each card: enough to recognise the move at a glance.
  TODO(pipeline): swap for a rendered still of the real body at the hold (e.g. `thumb: "anatomy/thumbs/<id>.webp"`)
  once the build can make one; the slot and its size stay the same.
-->
<script lang="ts">
  let { kind, dim = false }: { kind: string; dim?: boolean } = $props();
</script>

<svg class="thumb" class:dim viewBox="0 0 80 60" aria-hidden="true">
  <line class="ground" x1="4" y1="54" x2="76" y2="54" />
  {#if kind === 'reach'}
    <line class="prop" x1="64" y1="6" x2="64" y2="54" />
    <circle class="head" cx="30" cy="12" r="5" />
    <path d="M30 18 Q28 27 31 36 M31 36 L26 54 M31 36 L36 54 M30 22 Q46 20 62 25 M30 22 L25 33" />
  {:else if kind === 'child'}
    <path d="M14 53 L38 53 L25 42 Q36 33 48 44 M48 44 L72 50" />
    <circle class="head" cx="54" cy="47" r="4.5" />
    <path class="arc" d="M64 40 q6 -2 9 2" />
  {:else if kind === 'thread'}
    <path d="M10 53 L22 53 L22 31 Q35 27 47 32 M47 32 L50 53 M45 35 Q38 44 30 49" />
    <circle class="head" cx="53" cy="41" r="4.5" />
  {:else if kind === 'book'}
    <circle class="head" cx="13" cy="45" r="4.5" />
    <path d="M19 47 L44 48 L56 40 L68 49 M22 47 L22 27" />
    <path class="arc" d="M38 40 A16 16 0 0 0 6 40" />
  {:else if kind === 'ball'}
    <line class="prop" x1="18" y1="6" x2="18" y2="54" />
    <circle class="ball" cx="23" cy="23" r="3.2" />
    <circle class="head" cx="31" cy="12" r="5" />
    <path d="M29 18 Q27 28 30 38 M30 38 L26 54 M30 38 L35 54 M29 22 L39 26 L30 31" />
  {:else}
    <circle class="head" cx="40" cy="14" r="5" />
    <path d="M40 20 L40 38 M40 38 L35 54 M40 38 L45 54 M40 24 L32 34 M40 24 L48 34" />
  {/if}
</svg>

<style>
  .thumb { width: 100%; height: 100%; display: block; }
  path, line { fill: none; stroke: var(--clay-ink-soft); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .head { fill: var(--clay-ink-soft); }
  .ground { stroke: var(--clay-border); stroke-width: 2; }
  .prop { stroke: color-mix(in srgb, var(--clay-primary) 70%, var(--clay-surface)); stroke-width: 3.5; }
  .ball { fill: #b8c43f; }
  .arc { stroke: var(--clay-primary); stroke-width: 2; stroke-dasharray: 3 3; }
  .dim { opacity: 0.45; }
</style>

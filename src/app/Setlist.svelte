<script lang="ts">
  import Thumb from './Thumb.svelte';
  import { FEEL_LABEL, isSkipped, setlist, type Notes, type ShelfItem } from './setlist';

  interface Props {
    items: ShelfItem[];
    notes: Notes;
    onopen: (id: string) => void;
    onround: () => void;
    onundo: (id: string) => void;
  }
  let { items, notes, onopen, onround, onundo }: Props = $props();

  const skippedCount = $derived(items.filter((i) => isSkipped(notes, i.entry.id)).length);
  const lastCheck = $derived(notes.checks.at(-1));
  const lastWord = { better: 'better', same: 'about the same', worse: 'worse' } as const;
</script>

<section class="setlist" aria-labelledby="setlist-title">
  <div class="lead">
    <h2 id="setlist-title">{setlist.title}</h2>
    <p class="intro">{setlist.intro}</p>
  </div>

  <div class="howto clay-surface">
    <p class="how">{setlist.howToUse}</p>
    <div class="go">
      <button class="clay-button round-btn" onclick={onround}>Do the round</button>
      <span class="note">
        {#if skippedCount}{items.length - skippedCount} moves, skipping {skippedCount}{:else}All five, one after another{/if}
      </span>
    </div>
    <p class="guide">{setlist.guideline}</p>
    {#if lastCheck}<p class="last">Last round you felt {lastWord[lastCheck.result]}.</p>{/if}
  </div>

  <ol class="shelf">
    {#each items as item, i (item.entry.id)}
      {@const e = item.entry}
      {@const feel = notes.feel[e.id]?.feel}
      {@const skip = feel === 'catch'}
      <li class="card clay-surface" class:skip class:soon={!item.exercise}>
        <div class="thumb-slot clay-well"><Thumb kind={e.thumb} dim={skip} /></div>
        <div class="body">
          <h3><span class="n">{i + 1}</span> {e.name}</h3>
          <p class="for">{e.forWhat}</p>
          <p class="meta">
            <span class="dose">{e.dose}</span>
            <span class="needs">{e.needs}</span>
          </p>
          {#if feel}
            <p class="feel feel-{feel}">
              {#if skip}Skipping for now: it brought the catch back.{:else if feel === 'helped'}This one helped. Do it again later today.{:else}{FEEL_LABEL[feel]} last time.{/if}
              {#if skip}<button class="linkish" onclick={() => onundo(e.id)}>Try it again</button>{/if}
            </p>
          {/if}
          {#if item.exercise}
            <button class="clay-button clay-button--soft open" onclick={() => onopen(e.id)} aria-label={`Watch ${e.name}`}>
              Watch it
            </button>
          {:else}
            <details class="steps">
              <summary>Moving body coming soon · read the steps</summary>
              <ol>{#each e.steps as s (s)}<li>{s}</li>{/each}</ol>
            </details>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <div class="more">
    <details class="fold clay-surface">
      <summary><h3>{setlist.avoid.title}</h3></summary>
      <ul>{#each setlist.avoid.items as a (a)}<li>{a}</li>{/each}</ul>
    </details>
    <details class="fold clay-surface" id="watch-for">
      <summary><h3>{setlist.watchFor.title}</h3></summary>
      <p>{setlist.watchFor.lead}</p>
      <ul>{#each setlist.watchFor.items as a (a)}<li>{a}</li>{/each}</ul>
      <p class="later">{setlist.watchFor.later}</p>
    </details>
  </div>
</section>

<style>
  .setlist { display: flex; flex-direction: column; gap: 16px; max-width: 1100px; width: 100%; margin: 0 auto; }
  .lead h2 { font-size: 1.45rem; line-height: 1.25; margin: 4px 0 6px; font-weight: 600; }
  .intro { margin: 0; color: var(--clay-ink-soft); line-height: 1.5; }

  .howto { display: flex; flex-direction: column; gap: 12px; }
  .how { margin: 0; font-family: var(--clay-font-display); font-size: 1.08rem; line-height: 1.45; }
  .go { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .round-btn { font-size: 1.05rem; min-height: 48px; padding: 0.7em 1.6em; }
  .note { color: var(--clay-ink-soft); font-size: 0.9rem; }
  .guide { margin: 0; font-size: 0.92rem; line-height: 1.45; color: var(--clay-ink-soft); padding-top: 10px; border-top: 1px solid var(--clay-border); }
  .last { margin: 0; font-size: 0.88rem; color: var(--clay-primary); }

  .shelf { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .card { display: grid; grid-template-columns: 84px 1fr; gap: 14px; align-items: start; }
  .thumb-slot { width: 84px; height: 64px; padding: 4px 6px; border-radius: var(--clay-radius-sm); }
  .body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .body h3 { margin: 0; font-size: 1.12rem; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
  .n { font-family: var(--clay-font-body); font-size: 0.8rem; color: var(--clay-ink-soft); font-weight: 700; }
  .for { margin: 0; line-height: 1.45; font-size: 0.95rem; }
  .meta { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.86rem; color: var(--clay-ink-soft); }
  .dose { color: var(--clay-primary); font-weight: 700; }
  .open { align-self: flex-start; margin-top: 4px; min-height: 44px; padding: 0.55em 1.2em; }
  .feel { margin: 2px 0 0; font-size: 0.86rem; line-height: 1.4; }
  .feel-helped { color: #2f7a52; }
  .feel-catch { color: #8a5a2b; }
  .feel-fine { color: var(--clay-ink-soft); }
  .skip h3, .skip .for { color: var(--clay-ink-soft); }

  .steps { font-size: 0.88rem; color: var(--clay-ink-soft); }
  .steps summary { cursor: pointer; padding: 6px 0; line-height: 1.4; }
  .steps ol { margin: 4px 0 0; padding-left: 1.2em; color: var(--clay-ink); line-height: 1.5; }
  .steps li + li { margin-top: 4px; }

  .more { display: grid; gap: 12px; margin-top: 4px; }
  .fold summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; min-height: 32px; }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary::after { content: '+'; font-size: 1.3rem; color: var(--clay-ink-soft); }
  .fold[open] summary::after { content: '–'; }
  .fold h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
  .fold ul { margin: 8px 0 0; padding-left: 1.2em; line-height: 1.5; font-size: 0.95rem; }
  .fold li + li { margin-top: 6px; }
  .fold p { margin: 10px 0 0; font-size: 0.95rem; line-height: 1.5; }
  .later { color: var(--clay-ink-soft); }

  @media (min-width: 720px) {
    .shelf { grid-template-columns: repeat(2, 1fr); }
    .more { grid-template-columns: 1fr 1fr; align-items: start; }
  }
  @media (min-width: 1040px) {
    .shelf { grid-template-columns: repeat(3, 1fr); }
    .lead h2 { font-size: 1.7rem; }
  }
</style>

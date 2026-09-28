<script lang="ts">
  import Thumb from './Thumb.svelte';
  import { FEEL_LABEL, setlist, type BreathResult, type Feel, type Notes, type SetlistEntry } from './setlist';

  interface Props {
    /** The moves in the round just done, then the ones it left out. */
    done: SetlistEntry[];
    skipped: SetlistEntry[];
    notes: Notes;
    result: BreathResult | null;
    /** What to do next, once the round shows one move helped. */
    next?: string | null;
    oncheck: (r: BreathResult) => void;
    onfeel: (id: string, f: Feel | null) => void;
    onagain: () => void;
    onclose: () => void;
    onwatch: () => void;
    onback: () => void;
  }
  let { done, skipped, notes, result, next = null, oncheck, onfeel, onagain, onclose, onwatch, onback }: Props = $props();

  const CHOICES: { r: BreathResult; label: string }[] = [
    { r: 'better', label: 'Better' },
    { r: 'same', label: 'Same' },
    { r: 'worse', label: 'Worse' },
  ];
  const FEELS: Feel[] = ['helped', 'fine', 'catch'];
  const SHORT: Record<Feel, string> = { helped: 'Helped', fine: 'Fine', catch: 'Catch came back' };
</script>

<section class="check" aria-labelledby="check-title">
  <nav class="bar">
    <button class="clay-button clay-button--soft back" onclick={onback}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      Last move
    </button>
    <span class="progress-text">Round done</span>
  </nav>

  <div class="ask clay-surface">
    <div class="lungs" aria-hidden="true"><span></span></div>
    <h2 id="check-title">{setlist.check.prompt}</h2>
    <div class="choices" role="group" aria-label="How is the deep breath now?">
      {#each CHOICES as c (c.r)}
        <button class="clay-button clay-button--soft choice choice-{c.r}" aria-pressed={result === c.r} onclick={() => oncheck(c.r)}>
          {c.label}
        </button>
      {/each}
    </div>
    {#if result}
      <p class="answer" aria-live="polite">
        {setlist.check[result]}
        {#if result === 'worse'}<button class="linkish" onclick={onwatch}>See "Watch for"</button>{/if}
      </p>
      {#if next}<p class="answer next">{next}</p>{/if}
    {/if}
  </div>

  <div class="each clay-surface">
    <h3>Each move</h3>
    <p class="sub">Tap how each one felt. Anything that brought the catch back gets skipped next time.</p>
    <ul>
      {#each done as e (e.id)}
        {@const feel = notes.feel[e.id]?.feel}
        <li>
          <div class="row-head">
            <span class="mini clay-well"><Thumb kind={e.thumb} /></span>
            <span class="name">{e.name}</span>
          </div>
          <div class="feels" role="group" aria-label={`How did ${e.name} feel?`}>
            {#each FEELS as f (f)}
              <button class="pill feel-{f}" aria-pressed={feel === f} title={FEEL_LABEL[f]} onclick={() => onfeel(e.id, feel === f ? null : f)}>
                {SHORT[f]}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
    {#if skipped.length}
      <p class="sub">Left out this round: {skipped.map((e) => e.name).join(', ')}.</p>
    {/if}
  </div>

  <div class="after">
    <button class="clay-button" onclick={onclose}>Back to all five</button>
    <button class="clay-button clay-button--soft" onclick={onagain}>Do another round</button>
  </div>
</section>

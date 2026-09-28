<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { NeutralToneMapping } from 'three';
  import Scene from './Scene.svelte';
  import Thumb from './Thumb.svelte';
  import { duration, holdOf, playedTime, repCount, sample, setCount, type Exercise } from '../core/exercise';
  import type { JointMap } from '../core/jointmap';
  import { plainName } from '../core/names';
  import { HIGHLIGHT_HEX, highlightColors } from './body';
  import { placementOf, propAnchors, withFloor } from './placement';
  import { FEEL_LABEL, cameraHint, propsFromParam, setupWords, type Feel, type SetlistEntry } from './setlist';

  interface Props {
    entry: SetlistEntry;
    exercise: Exercise | null;
    jointMap: JointMap | null;
    loadNote: string;
    feel: Feel | undefined;
    onfeel: (f: Feel | null) => void;
    onclose: () => void;
    /** Set while doing the round. */
    round?: { at: number; count: number; onnext: () => void; onback: () => void } | null;
    /** Page options: ?t, ?cam, ?muscles, ?bones, ?props. Read once when the player opens. */
    params: URLSearchParams;
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { entry, exercise, jointMap, loadNote, feel, onfeel, onclose, round = null, params, onready }: Props = $props();

  // The page options are read once; the player is re-made for each move (App keys it by id).
  // svelte-ignore state_referenced_locally
  const opts = params;
  const camParam = opts.get('cam')?.split(',').map(Number);
  const camera = camParam?.length === 3 && camParam.every(Number.isFinite) ? (camParam as [number, number, number]) : undefined;
  const hasT = opts.has('t');

  let muscleOpacity = $state(Number(opts.get('muscles') ?? 85) / 100);
  let boneOpacity = $state(Number(opts.get('bones') ?? 100) / 100);
  let showHighlight = $state(true);
  let ready = $state(false);

  // A move starts from the top and plays by itself, unless the page asked for one moment with ?t.
  let t = $state(Number(opts.get('t') ?? 0));
  // svelte-ignore state_referenced_locally
  let playing = $state(!!exercise && !hasT);

  const total = $derived(exercise ? duration(exercise) : 0);
  const frame = $derived(exercise ? sample(exercise, t) : null);
  const reps = $derived(exercise ? repCount(exercise) : 1);
  const sets = $derived(exercise ? setCount(exercise) : 1);
  const hold = $derived(exercise ? holdOf(exercise) : undefined);
  const setup = $derived(exercise ? setupWords(exercise) : null);
  const room = $derived.by(() => {
    if (!exercise) return [];
    const listed = exercise.props?.length ? exercise.props : propsFromParam(opts.get('props'));
    return withFloor(exercise, listed);
  });
  const hint = $derived(cameraHint((exercise as { camera?: unknown } | null)?.camera, entry.camera));
  const colors = $derived(highlightColors(exercise?.highlight ?? []));
  const place = $derived(frame ? placementOf(frame.root, jointMap) : null);

  // What to measure once per move: the key moments (start, each keyframe, mid-hold) to frame the
  // whole move, and the landmarks the props hang on (the gripping hand, the ball's spot).
  const samples = $derived.by(() => {
    if (!exercise) return [];
    const ex = exercise;
    const jm = jointMap;
    const at = (s: number) => {
      const f = sample(ex, s);
      return { pose: f.pose, place: placementOf(f.root, jm) };
    };
    const times = new Set<number>([0, ...ex.keyframes.map((k) => playedTime(ex, k.t))]);
    const h = holdOf(ex);
    if (h) times.add(h.from + (h.breaths * h.breathSeconds) / 2);
    const out: { pose: typeof ex.keyframes[number]['pose']; place: ReturnType<typeof placementOf>; anchors?: { key: string; landmark: string }[]; box?: boolean }[] =
      [...times].map(at);
    for (const a of propAnchors(ex, room)) out.push({ ...at(a.t), anchors: [{ key: a.key, landmark: a.landmark }], box: false });
    return out;
  });

  // Playback: a plain rAF clock. The sampler is pure, so scrubbing and playing share one path.
  $effect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const next = t + (now - last) / 1000;
      last = now;
      if (next >= total) {
        t = total;
        playing = false;
        return;
      }
      t = next;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  function toggle() {
    if (!playing && t >= total - 0.01) t = 0;
    playing = !playing;
  }

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const done = $derived(!!exercise && t >= total - 0.01);

  // How many of this rep's hold breaths are done.
  const breathsDone = $derived.by(() => {
    if (!hold || !frame) return 0;
    if (frame.phase === 'hold') return frame.breath.index - 1;
    if (frame.phase === 'rest' || done) return hold.breaths;
    return frame.authored > hold.from + 1e-6 ? hold.breaths : 0;
  });

  const breathText = $derived(
    !frame
      ? ''
      : frame.breath.direction
        ? `Breathe ${frame.breath.direction}`
        : done
          ? 'Done. Rest a moment.'
          : frame.phase === 'rest'
            ? 'Rest'
            : frame.phase === 'move'
              ? 'Move slowly'
              : '',
  );
  const lit = $derived(exercise?.highlight.map((z) => ({ za: z, hue: colors.get(z) ?? 0, ...plainName(z) })) ?? []);
  const FEELS: Feel[] = ['helped', 'fine', 'catch'];
</script>

<div class="player">
  <nav class="bar">
    <button class="clay-button clay-button--soft back" onclick={onclose}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      All five
    </button>
    {#if round}
      <div class="progress" aria-label={`Move ${round.at + 1} of ${round.count}`}>
        <span class="progress-text">{round.at + 1} of {round.count}</span>
        {#each { length: round.count } as _, i (i)}<span class="pip" class:on={i <= round.at}></span>{/each}
      </div>
    {/if}
  </nav>

  {#if exercise && frame}
    <section class="stage clay-well" aria-label="The body, doing the move. Drag to turn it.">
      <Canvas dpr={Math.min(devicePixelRatio, 2)} toneMapping={NeutralToneMapping}>
        <Scene
          pose={frame.pose}
          {place}
          {jointMap}
          {muscleOpacity}
          {boneOpacity}
          highlight={colors}
          {showHighlight}
          {room}
          {samples}
          {hint}
          {camera}
          onready={(info) => {
            ready = true;
            onready?.(info);
          }}
        />
      </Canvas>
      {#if !ready}<p class="loading">{loadNote}</p>{/if}
      <p class="hint">Drag to turn · pinch to zoom</p>
    </section>
  {:else}
    <section class="stage stage-soon clay-well" aria-label="Written steps">
      <div class="soon-thumb"><Thumb kind={entry.thumb} /></div>
      <p class="soon-note">The moving body for this one is coming soon. Here are the steps.</p>
    </section>
  {/if}

  <aside class="panel">
    <article class="move clay-surface">
      <div class="move-head">
        <h2 class="title">{entry.name}</h2>
        <span class="dose-chip clay-chip">{entry.dose}</span>
      </div>

      {#if exercise && frame}
        {#if setup}<p class="setup">Start: {setup}</p>{/if}
        <p class="cue" aria-live="polite">{frame.cue ?? ' '}</p>

        <div class="counters">
          {#if sets > 1}
            <div class="count clay-well" aria-label={`Round ${frame.set} of ${sets}`}>
              <span class="what">round</span><span class="big">{frame.set}</span><span class="of">of {sets}</span>
            </div>
          {/if}
          {#if reps > 1}
            <div class="count clay-well" aria-label={`Rep ${frame.rep} of ${reps}`}>
              <span class="what">rep</span><span class="big">{frame.rep}</span><span class="of">of {reps}</span>
            </div>
          {/if}
          {#if hold && hold.breaths > 0}
            <div class="count breaths clay-well" aria-label={`${breathsDone} of ${hold.breaths} breaths done`}>
              <span class="pips">
                {#each { length: hold.breaths } as _, i (i)}
                  <span
                    class="bpip"
                    class:done={i < breathsDone}
                    class:now={frame.phase === 'hold' && i === breathsDone}
                    style:--s={frame.phase === 'hold' && i === breathsDone ? 0.7 + frame.breath.amount * 0.5 : 1}
                  ></span>
                {/each}
              </span>
              <span class="what">{breathsDone} of {hold.breaths} breaths</span>
            </div>
          {/if}
          <p class="breath" class:in={frame.breath.direction === 'in'}>
            <span class="dot" style:transform={`scale(${0.6 + frame.breath.amount * 0.6})`}></span>
            {breathText}
          </p>
        </div>

        <div class="transport">
          <button class="clay-button play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {#if playing}
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
            {/if}
          </button>
          <input
            class="scrub"
            type="range"
            min="0"
            max={total}
            step="0.05"
            bind:value={t}
            oninput={() => (playing = false)}
            aria-label="Where in the move"
          />
          <span class="time">{clock(t)} / {clock(total)}</span>
        </div>
      {:else}
        <ol class="steps">{#each entry.steps as s (s)}<li>{s}</li>{/each}</ol>
      {/if}
    </article>

    <article class="feel clay-surface">
      <h3>How did that feel?</h3>
      <div class="feels" role="group" aria-label="How did that feel?">
        {#each FEELS as f (f)}
          <button
            class="clay-button clay-button--soft feel-btn feel-{f}"
            aria-pressed={feel === f}
            onclick={() => onfeel(feel === f ? null : f)}
          >{FEEL_LABEL[f]}</button>
        {/each}
      </div>
      {#if feel === 'catch'}<p class="feel-note">Skip this one for now. It's left out of the round.</p>
      {:else if feel === 'helped'}<p class="feel-note">Good. Come back to this one a few times today.</p>{/if}
    </article>

    {#if round}
      <div class="round-nav">
        <button class="clay-button clay-button--soft" onclick={round.onback} disabled={round.at === 0}>Back</button>
        <button class="clay-button next" class:ready={done || !exercise} onclick={round.onnext}>
          {round.at + 1 < round.count ? 'Next move' : 'Check with a breath'}
        </button>
      </div>
    {/if}

    {#if exercise}
      <article class="layers clay-surface">
        <h3>See inside</h3>
        <label class="slider">
          <span>Muscles</span>
          <input type="range" min="0" max="1" step="0.01" bind:value={muscleOpacity} />
          <output>{pct(muscleOpacity)}</output>
        </label>
        <label class="slider">
          <span>Bones</span>
          <input type="range" min="0" max="1" step="0.01" bind:value={boneOpacity} />
          <output>{pct(boneOpacity)}</output>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={showHighlight} />
          <span>Light up what this stretches</span>
        </label>
        {#if showHighlight}
          <ul class="lit">
            {#each lit as l (l.za)}
              <li class="clay-chip" title={l.za} style:--hue={HIGHLIGHT_HEX[l.hue]}>
                <span class="swatch" aria-hidden="true"></span>{l.name}{l.side ? `, ${l.side}` : ''}
              </li>
            {/each}
          </ul>
        {/if}
      </article>
    {/if}
  </aside>
</div>

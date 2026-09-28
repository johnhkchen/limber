<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { NeutralToneMapping } from 'three';
  import Scene from './Scene.svelte';
  import { duration, parseExercise, sample, type Exercise } from '../core/exercise';
  import { parseJointMap, type JointMap } from '../core/jointmap';
  import { plainName } from '../core/names';

  const base = import.meta.env.BASE_URL;

  // Exercises are data: every file in content/exercises/ is checked against the contract at build time.
  const files = import.meta.glob('/content/exercises/*.json', { eager: true, import: 'default' });
  const exercises: Exercise[] = Object.values(files).map((j) => parseExercise(j));

  const params = new URLSearchParams(location.search);
  let exerciseId = $state(params.get('ex') ?? exercises[0]?.id ?? '');
  const exercise = $derived(exercises.find((e) => e.id === exerciseId) ?? exercises[0]!);
  const total = $derived(duration(exercise));

  let t = $state(Number(params.get('t') ?? 0));
  let playing = $state(false);
  const frame = $derived(sample(exercise, t));

  const camParam = params.get('cam')?.split(',').map(Number);
  const camera = camParam?.length === 3 && camParam.every(Number.isFinite) ? (camParam as [number, number, number]) : undefined;

  let muscleOpacity = $state(Number(params.get('muscles') ?? 85) / 100);
  let boneOpacity = $state(Number(params.get('bones') ?? 100) / 100);
  let showHighlight = $state(true);

  let jointMap: JointMap | null = $state.raw(null);
  let loadNote = $state('Setting out the body…');
  let ready = $state(false);

  $effect(() => {
    fetch(`${base}anatomy/joint-map.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`joint-map ${r.status}`))))
      .then((j) => (jointMap = parseJointMap(j)))
      .catch((e) => (loadNote = `Couldn't read how the joints move (${(e as Error).message}).`));
  });

  function onready(info: { structures: number; bones: number; helpers: number; unmapped: string[] }) {
    ready = true;
    (window as unknown as { __limber: unknown }).__limber = info;
  }

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

  const breathText = $derived(
    frame.breath.direction
      ? `Breathe ${frame.breath.direction} · ${frame.breath.index} of ${frame.breath.count}`
      : frame.phase === 'move'
        ? 'Move slowly'
        : ''
  );
  const lit = $derived(exercise.highlight.map((z) => ({ za: z, ...plainName(z) })));
</script>

<div class="b28-clay page">
  <header class="top">
    <h1 class="brand">Limber</h1>
    <p class="tag">Shows you how to move so it stops hurting.</p>
  </header>

  <section class="stage clay-well" aria-label="The body, doing the move. Drag to turn it.">
    <Canvas dpr={Math.min(devicePixelRatio, 2)} toneMapping={NeutralToneMapping}>
      <Scene
        pose={frame.pose}
        {jointMap}
        {muscleOpacity}
        {boneOpacity}
        highlight={exercise.highlight}
        {showHighlight}
        {camera}
        {onready}
      />
    </Canvas>
    {#if !ready}
      <p class="loading">{loadNote}</p>
    {/if}
    <p class="hint">Drag to turn · pinch to zoom</p>
  </section>

  <aside class="panel">
    <article class="move clay-surface">
      <div class="move-head">
        {#if exercises.length > 1}
          <select class="pick" bind:value={exerciseId} aria-label="Pick a move">
            {#each exercises as e (e.id)}<option value={e.id}>{e.title ?? e.id}</option>{/each}
          </select>
        {:else}
          <h2 class="title">{exercise.title ?? exercise.id}</h2>
        {/if}
        {#if exercise.side && exercise.side !== 'both'}<span class="clay-chip">{exercise.side} side</span>{/if}
      </div>

      <p class="cue" aria-live="polite">{frame.cue ?? ' '}</p>
      <p class="breath" class:in={frame.breath.direction === 'in'}>
        <span class="dot" style:transform={`scale(${0.6 + frame.breath.amount * 0.6})`}></span>
        {breathText}
      </p>

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
    </article>

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
          {#each lit as l (l.za)}<li class="clay-chip" title={l.za}>{l.name}{l.side ? `, ${l.side}` : ''}</li>{/each}
        </ul>
      {/if}
    </article>

    <footer class="foot">
      <p>Limber is not a doctor. A stretch or mild tenderness is fine; if the sharp catch comes back, stop.</p>
      <p class="credit">
        So far the body has the head, spine, ribs and right arm down to the fingers, with the right side's back muscles.
        Body from BodyParts3D © DBCLS (CC BY-SA 2.1 JP), mixed and modified by
        <a href="https://www.z-anatomy.com" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0), shaped for Limber (CC BY-SA 4.0).
      </p>
    </footer>
  </aside>
</div>

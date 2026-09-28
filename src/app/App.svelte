<script lang="ts">
  import { tick } from 'svelte';
  import { parseJointMap, type JointMap } from '../core/jointmap';
  import BreathCheck from './BreathCheck.svelte';
  import Player from './Player.svelte';
  import Setlist from './Setlist.svelte';
  import { current, startRound, step, type Round, type RoundAction } from './round';
  import {
    isSkipped,
    loadExercises,
    readNotes,
    setFeel,
    setlist,
    shelf,
    writeNotes,
    type BreathResult,
    type Feel,
    type Notes,
  } from './setlist';

  const base = import.meta.env.BASE_URL;

  // Exercises are data: every file in content/exercises/ shows up here by itself.
  const files = import.meta.glob('/content/exercises/*.json', { eager: true, import: 'default' });
  const { exercises } = loadExercises(files);
  const items = shelf(setlist.exercises, exercises);
  const allIds = items.map((i) => i.entry.id);

  // ---------------------------------------------------------------- where we are (kept in the URL)
  //
  // ?ex=<id>                 one move
  // ?round=<n>               move n (1-based) of the round
  // ?round=check             the deep-breath check
  // ?t=…  (no ex)            the first move at that moment (older links and scripts/shots.mjs)
  type Where = { view: 'shelf' } | { view: 'move'; id: string } | { view: 'round' };

  let params = $state(new URLSearchParams(location.search));
  let notes: Notes = $state(readNotes());
  let round: Round | null = $state(null);
  let checkResult: BreathResult | null = $state(null);

  function whereFrom(p: URLSearchParams): Where {
    const r = p.get('round');
    if (r) {
      const skip = (id: string) => isSkipped(notes, id);
      let next = round ?? startRound(allIds, skip);
      next = r === 'check' ? { ...next, stage: 'check' } : step(next, { type: 'goto', at: Number(r) - 1 });
      round = next;
      return { view: 'round' };
    }
    const id = p.get('ex') ?? (p.has('t') ? exercises[0]?.id : undefined);
    if (id && items.some((i) => i.entry.id === id)) return { view: 'move', id };
    return { view: 'shelf' };
  }
  let where: Where = $state(whereFrom(new URLSearchParams(location.search)));

  function go(q: Record<string, string>, push = true) {
    const keep = new URLSearchParams();
    for (const k of ['muscles', 'bones', 'cam', 'props']) {
      const v = params.get(k);
      if (v !== null) keep.set(k, v);
    }
    for (const [k, v] of Object.entries(q)) keep.set(k, v);
    const url = `${location.pathname}${keep.size ? `?${keep}` : ''}`;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
    params = keep;
    where = whereFrom(keep);
    scrollTo({ top: 0 });
  }

  $effect(() => {
    const onpop = () => {
      params = new URLSearchParams(location.search);
      where = whereFrom(params);
    };
    addEventListener('popstate', onpop);
    return () => removeEventListener('popstate', onpop);
  });

  const toShelf = () => go({});
  async function toWatchFor() {
    go({});
    await tick();
    const d = document.getElementById('watch-for') as HTMLDetailsElement | null;
    if (d) {
      d.open = true;
      d.scrollIntoView({ block: 'start' });
    }
  }
  const openMove = (id: string) => go({ ex: id });
  function beginRound() {
    round = startRound(allIds, (id) => isSkipped(notes, id));
    checkResult = null;
    go({ round: round.stage === 'check' ? 'check' : '1' });
  }
  function roundStep(a: RoundAction) {
    if (!round) return;
    const r = step(round, a);
    round = r;
    go({ round: r.stage === 'check' ? 'check' : String(r.at + 1) }, false);
  }

  // ---------------------------------------------------------------- what you said

  function feelFor(id: string, f: Feel | null) {
    notes = setFeel(notes, id, f);
    writeNotes(notes);
  }
  function check(r: BreathResult) {
    checkResult = r;
    notes = { ...notes, checks: [...notes.checks, { result: r, at: Date.now() }] };
    writeNotes(notes);
  }

  // ---------------------------------------------------------------- the body files

  let jointMap: JointMap | null = $state.raw(null);
  let loadNote = $state('Setting out the body…');
  $effect(() => {
    fetch(`${base}anatomy/joint-map.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`joint-map ${r.status}`))))
      .then((j) => (jointMap = parseJointMap(j)))
      .catch((e) => (loadNote = `Couldn't read how the joints move (${(e as Error).message}).`));
  });
  function onready(info: { structures: number; bones: number; helpers: number; unmapped: string[] }) {
    (window as unknown as { __limber: unknown }).__limber = info;
  }

  const roundId = $derived(round && where.view === 'round' ? current(round) : null);
  const moveId = $derived(where.view === 'move' ? where.id : roundId);
  const moveItem = $derived(moveId ? items.find((i) => i.entry.id === moveId) : undefined);
  const byId = (id: string) => items.find((i) => i.entry.id === id)!.entry;
</script>

<div class="b28-clay page" class:page-player={!!moveItem}>
  <header class="top">
    <button class="brand-link" onclick={toShelf} aria-label="Limber, back to the start"><h1 class="brand">Limber</h1></button>
    <p class="tag">Shows you how to move so it stops hurting.</p>
  </header>

  <main class="main">
    {#if moveItem}
      {#key moveItem.entry.id}
        <Player
          entry={moveItem.entry}
          exercise={moveItem.exercise}
          {jointMap}
          {loadNote}
          feel={notes.feel[moveItem.entry.id]?.feel}
          onfeel={(f) => feelFor(moveItem.entry.id, f)}
          onclose={toShelf}
          round={round && where.view === 'round'
            ? { at: round.at, count: round.ids.length, onnext: () => roundStep({ type: 'next' }), onback: () => roundStep({ type: 'back' }) }
            : null}
          {params}
          {onready}
        />
      {/key}
    {:else if where.view === 'round' && round}
      <BreathCheck
        done={round.ids.map(byId)}
        skipped={round.skipped.map(byId)}
        {notes}
        result={checkResult}
        oncheck={check}
        onfeel={feelFor}
        onagain={beginRound}
        onclose={toShelf}
        onwatch={toWatchFor}
        onback={() => roundStep({ type: 'back' })}
      />
    {:else}
      <Setlist {items} {notes} onopen={openMove} onround={beginRound} onundo={(id) => feelFor(id, null)} />
    {/if}
  </main>

  <footer class="foot">
    <p>Limber is not a doctor. {setlist.guideline}</p>
    <p class="credit">
      So far the body has the head, spine, ribs and right arm down to the fingers, with the right side's back muscles.
      Body from BodyParts3D © DBCLS (CC BY-SA 2.1 JP), mixed and modified by
      <a href="https://www.z-anatomy.com" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0), shaped for Limber (CC BY-SA 4.0).
    </p>
  </footer>
</div>

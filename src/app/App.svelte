<script lang="ts">
  import { tick } from 'svelte';
  import { parseJointMap, type JointMap } from '../core/jointmap';
  import {
    RIGHT_SHOULDER_BLADE,
    currentMove,
    routineReducer,
    stageWords,
    startRoutine,
    type BreathCheck as Breath,
    type RoutineEvent,
    type RoutineState,
  } from '../core/routine';
  import BreathCheck from './BreathCheck.svelte';
  import Player from './Player.svelte';
  import Setlist from './Setlist.svelte';
  import {
    loadExercises,
    previewItem,
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

  // Exercises are data: every file in content/exercises/ shows up here by itself. Files in
  // src/app/previews/ (and content files not on the setlist yet) open only by address: ?ex=<id>.
  const files = import.meta.glob(['/content/exercises/*.json', '/src/app/previews/*.json'], { eager: true, import: 'default' });
  const { exercises } = loadExercises(files);
  const items = shelf(setlist.exercises, exercises);
  const previews = exercises.filter((e) => !items.some((i) => i.entry.id === e.id)).map(previewItem);
  const findItem = (id: string) => items.find((i) => i.entry.id === id) ?? previews.find((i) => i.entry.id === id);

  // The round is core's routine (src/core/routine.ts); the setlist lists the same five, in the same order.
  const routine = RIGHT_SHOULDER_BLADE;

  // ---------------------------------------------------------------- where we are (kept in the URL)
  //
  // ?ex=<id>                 one move (any exercise file, listed or not)
  // ?round=<n>               move n (1-based) of the round
  // ?round=check             the deep-breath check
  // ?t=…  (no ex)            the first move at that moment (older links and scripts/shots.mjs)
  type Where = { view: 'shelf' } | { view: 'move'; id: string } | { view: 'round' };

  let params = $state(new URLSearchParams(location.search));
  let notes: Notes = $state(readNotes());
  let round = $state<RoutineState | null>(null);
  /** Moves left out when the round started (they'd brought the catch back before). */
  let leftOut: string[] = $state([]);
  let checkResult: BreathResult | null = $state(null);

  const feels = (n: Notes): Record<string, Feel> => Object.fromEntries(Object.entries(n.feel).map(([id, v]) => [id, v.feel]));
  const send = (s: RoutineState, e: RoutineEvent) => routineReducer(routine, s, e);
  function freshRound(): RoutineState {
    const s = startRoutine(routine, feels(notes));
    leftOut = routine.steps.map((x) => x.exercise).filter((id) => !s.round.includes(id));
    return s;
  }

  function whereFrom(p: URLSearchParams): Where {
    const r = p.get('round');
    if (r) {
      let next = round ?? freshRound();
      if (r === 'check') next = next.stage === 'moves' ? { ...next, stage: 'check' } : next;
      else next = send(next, { type: 'goto', at: Number(r) - 1 });
      round = next;
      return { view: 'round' };
    }
    const id = p.get('ex') ?? (p.has('t') ? items.find((i) => i.exercise)?.entry.id : undefined);
    if (id && findItem(id)) return { view: 'move', id };
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
  const roundQuery = (s: RoutineState) => ({ round: s.stage === 'moves' ? String(s.at + 1) : 'check' });
  function beginRound() {
    round = freshRound();
    checkResult = null;
    go(roundQuery(round));
  }
  function roundStep(e: RoutineEvent) {
    if (!round) return;
    round = send(round, e);
    go(roundQuery(round), false);
  }

  // ---------------------------------------------------------------- what you said

  const BREATH: Record<BreathResult, Breath> = { better: 'easier', same: 'same', worse: 'worse' };

  function feelFor(id: string, f: Feel | null) {
    notes = setFeel(notes, id, f);
    writeNotes(notes);
    if (!round || where.view !== 'round') return;
    if (f) {
      // `catch` on the move you're on leaves it and goes on to the next one (core prunes it).
      const before = round;
      round = send(round, { type: 'feel', exercise: id, feel: f });
      if (round.stage !== before.stage || currentMove(routine, round) !== currentMove(routine, before)) go(roundQuery(round), false);
    } else {
      const { [id]: _, ...rest } = round.feel;
      round = { ...round, feel: rest };
    }
    // Said how a move felt after the breath check: decide again what to come back to.
    if (round.breath && round.stage !== 'moves') round = send({ ...round, stage: 'check' }, { type: 'check', breath: round.breath });
  }
  function check(r: BreathResult) {
    checkResult = r;
    notes = { ...notes, checks: [...notes.checks, { result: r, at: Date.now() }] };
    writeNotes(notes);
    if (round) round = send({ ...round, stage: 'check' }, { type: 'check', breath: BREATH[r] });
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

  // During the round the player shows core's current move; after the breath check the page stays on
  // the check (core's "repeat" favourite is named there, not opened).
  const roundId = $derived(round && where.view === 'round' && round.stage === 'moves' ? currentMove(routine, round)?.exercise ?? null : null);
  const moveId = $derived(where.view === 'move' ? where.id : roundId);
  const moveItem = $derived(moveId ? findItem(moveId) : undefined);
  const byId = (id: string) => findItem(id)!.entry;
  const doneIds = $derived(routine.steps.map((x) => x.exercise).filter((id) => !leftOut.includes(id)));
  // One helped: name it and say how often (core's stageWords, e.g. "Come back to this one a few times today (5 breaths).").
  const nextWords = $derived(round?.stage === 'repeat' && round.favourite ? `${byId(round.favourite).name}. ${stageWords(routine, round)}` : null);
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
            ? {
                at: round.at,
                count: round.round.length,
                label: stageWords(routine, round),
                onnext: () => roundStep({ type: 'next' }),
                onback: () => roundStep({ type: 'back' }),
              }
            : null}
          {params}
          {onready}
        />
      {/key}
    {:else if where.view === 'round' && round}
      <BreathCheck
        done={doneIds.map(byId)}
        skipped={leftOut.map(byId)}
        next={nextWords}
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
      The body has the whole skeleton, head to toes, with the back muscles on both sides.
      Body from BodyParts3D © DBCLS (CC BY-SA 2.1 JP), mixed and modified by
      <a href="https://www.z-anatomy.com" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0), shaped for Limber (CC BY-SA 4.0).
    </p>
  </footer>
</div>

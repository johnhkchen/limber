<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { useGltf, useMeshopt } from '@threlte/extras';
  import { untrack } from 'svelte';
  import type { Box3, Group } from 'three';
  import type { Pose } from '../core/exercise';
  import { mappedBones, toBonePoses, type JointMap } from '../core/jointmap';
  import {
    applyPose,
    bindRigOnce,
    collectStructures,
    measurePoses,
    place,
    styleStructures,
    type MeasureSample,
    type Rig,
    type Structure,
  } from './body';
  import type { Placement } from './placement';

  interface Props {
    pose: Pose;
    /** Where the whole body sits and faces (from the keyframe `root`), or null to stay as loaded. */
    place?: Placement | null;
    jointMap: JointMap | null;
    muscleOpacity: number;
    boneOpacity: number;
    /** za_name → highlight palette index. */
    highlight: ReadonlyMap<string, number>;
    showHighlight: boolean;
    /** The move's key moments (for framing) and landmark reads (for props). Measured once per change. */
    samples?: { pose: Pose; place: Placement | null; anchors?: { key: string; landmark: string }[]; box?: boolean }[];
    /** Frame only these structures (e.g. the highlights); empty = the whole body. */
    fitOnly?: ReadonlySet<string>;
    onmeasure?: (m: { box: Box3; points: Record<string, [number, number, number]> }) => void;
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { pose, place: placement = null, jointMap, muscleOpacity, boneOpacity, highlight, showHighlight, samples, fitOnly, onmeasure, onready }: Props =
    $props();

  const base = import.meta.env.BASE_URL;
  const { invalidate } = useThrelte();
  const meshoptDecoder = useMeshopt();
  const skeleton = useGltf(`${base}anatomy/skeleton.glb`, { meshoptDecoder });
  const muscles = useGltf(`${base}anatomy/muscles.glb`, { meshoptDecoder });

  let holder: Group | undefined = $state.raw();
  let structures: Structure[] = $state.raw([]);
  let rig: Rig | null = $state.raw(null);

  // Materials once both files are in.
  $effect(() => {
    if (!$skeleton || !$muscles) return;
    structures = [...collectStructures($skeleton.scene, 'skeleton'), ...collectStructures($muscles.scene, 'muscles')];
  });

  // Bind bones once the map and the files are in (once per loaded file: the loader keeps them across visits).
  $effect(() => {
    if (!$skeleton || !$muscles || !jointMap) return;
    rig = bindRigOnce([$skeleton.scene, $muscles.scene], mappedBones(jointMap), jointMap.helpers ?? []);
  });

  // See-through and highlight.
  $effect(() => {
    if (!structures.length) return;
    styleStructures(structures, {
      opacity: { skeleton: boneOpacity, bones: boneOpacity, muscles: muscleOpacity, skin: muscleOpacity * 0.6, connective: muscleOpacity },
      highlight,
      showHighlight,
    });
    invalidate();
  });

  // Framing: measure the key moments, then fall through to the current pose below.
  let measured = $state(0);
  $effect(() => {
    if (!rig || !jointMap || !holder || !structures.length || !samples?.length || !onmeasure) return;
    const jm = jointMap;
    const list: MeasureSample[] = samples.map((s) => ({ bones: toBonePoses(s.pose, jm), place: s.place, anchors: s.anchors, box: s.box }));
    const m = measurePoses(rig, jm, holder, structures, list, fitOnly);
    if (!m.box.isEmpty()) onmeasure(m);
    measured = untrack(() => measured) + 1;
  });

  // Pose.
  let reported = false;
  $effect(() => {
    void measured;
    if (!rig || !jointMap) return;
    const r = rig;
    if (holder) place(holder, placement);
    const bp = toBonePoses(pose, jointMap);
    applyPose(r, bp);
    invalidate();
    if (!reported && structures.length) {
      reported = true;
      onready?.({ structures: structures.length, bones: r.copies.size, helpers: r.helpers.length, unmapped: bp.unmapped });
    }
  });

  // Leave the cached files at REST for the next visit.
  $effect(() => {
    const r = rig;
    return () => {
      if (r) applyPose(r, { bones: {}, unmapped: [] });
    };
  });
</script>

<T.Group bind:ref={holder}>
  {#if $skeleton}
    <T is={$skeleton.scene} />
  {/if}
  {#if $muscles}
    <T is={$muscles.scene} />
  {/if}
</T.Group>

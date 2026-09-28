<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { useGltf, useMeshopt } from '@threlte/extras';
  import { untrack } from 'svelte';
  import type { Box3, Group } from 'three';
  import type { RigidTransform } from '../core/fk';
  import { mappedBones, type BonePoses, type JointMap } from '../core/jointmap';
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

  interface Props {
    /** What to pose, from core's groundPose (`g.bones`). */
    bones: BonePoses | null;
    /** Where the whole body sits and faces (`g.transform`), or null to stay as loaded. */
    transform?: RigidTransform | null;
    jointMap: JointMap | null;
    muscleOpacity: number;
    boneOpacity: number;
    /** za_name → highlight palette index. */
    highlight: ReadonlyMap<string, number>;
    showHighlight: boolean;
    /** The move's key moments, grounded by core, for framing. Measured once per change. */
    samples?: MeasureSample[];
    /** Frame only these structures (e.g. the highlights); empty = the whole body. */
    fitOnly?: ReadonlySet<string>;
    onmeasure?: (box: Box3) => void;
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { bones, transform = null, jointMap, muscleOpacity, boneOpacity, highlight, showHighlight, samples, fitOnly, onmeasure, onready }: Props =
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
    if (!rig || !holder || !structures.length || !samples?.length || !onmeasure) return;
    const box = measurePoses(rig, holder, structures, samples, fitOnly);
    if (!box.isEmpty()) onmeasure(box);
    measured = untrack(() => measured) + 1;
  });

  // Pose.
  let reported = false;
  $effect(() => {
    void measured;
    if (!rig || !bones) return;
    const r = rig;
    if (holder) place(holder, transform);
    const bp = bones;
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

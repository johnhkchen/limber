<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { useGltf, useMeshopt } from '@threlte/extras';
  import type { Pose } from '../core/exercise';
  import { mappedBones, toBonePoses, type JointMap } from '../core/jointmap';
  import { applyPose, bindRig, collectStructures, styleStructures, type Rig, type Structure } from './body';

  interface Props {
    pose: Pose;
    jointMap: JointMap | null;
    muscleOpacity: number;
    boneOpacity: number;
    highlight: string[];
    showHighlight: boolean;
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { pose, jointMap, muscleOpacity, boneOpacity, highlight, showHighlight, onready }: Props = $props();

  const base = import.meta.env.BASE_URL;
  const { invalidate } = useThrelte();
  const meshoptDecoder = useMeshopt();
  const skeleton = useGltf(`${base}anatomy/skeleton.glb`, { meshoptDecoder });
  const muscles = useGltf(`${base}anatomy/muscles.glb`, { meshoptDecoder });

  let structures: Structure[] = $state.raw([]);
  let rig: Rig | null = $state.raw(null);

  // Materials once both files are in.
  $effect(() => {
    if (!$skeleton || !$muscles) return;
    structures = [...collectStructures($skeleton.scene, 'skeleton'), ...collectStructures($muscles.scene, 'muscles')];
  });

  // Bind bones once the map and the files are in.
  $effect(() => {
    if (!$skeleton || !$muscles || !jointMap) return;
    rig = bindRig([$skeleton.scene, $muscles.scene], mappedBones(jointMap), jointMap.helpers ?? []);
  });

  // See-through and highlight.
  $effect(() => {
    if (!structures.length) return;
    styleStructures(structures, {
      opacity: { skeleton: boneOpacity, bones: boneOpacity, muscles: muscleOpacity, skin: muscleOpacity * 0.6, connective: muscleOpacity },
      highlight: new Set(highlight),
      showHighlight,
    });
    invalidate();
  });

  // Pose.
  let reported = false;
  $effect(() => {
    if (!rig || !jointMap) return;
    const r = rig;
    const bp = toBonePoses(pose, jointMap);
    applyPose(r, bp);
    invalidate();
    if (!reported && structures.length) {
      reported = true;
      onready?.({ structures: structures.length, bones: r.copies.size, helpers: r.helpers.length, unmapped: bp.unmapped });
    }
  });
</script>

{#if $skeleton}
  <T is={$skeleton.scene} />
{/if}
{#if $muscles}
  <T is={$muscles.scene} />
{/if}

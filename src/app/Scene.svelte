<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import Body from './Body.svelte';
  import type { Pose } from '../core/exercise';
  import type { JointMap } from '../core/jointmap';

  interface Props {
    pose: Pose;
    jointMap: JointMap | null;
    muscleOpacity: number;
    boneOpacity: number;
    highlight: string[];
    showHighlight: boolean;
    /** Camera start position, e.g. from `?cam=x,y,z`. */
    camera?: [number, number, number];
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { camera = [-1.05, 1.5, -1.1], ...props }: Props = $props();

  // The body faces +Z; the golden case lives on the upper back, so start behind the right shoulder.
  const target: [number, number, number] = [-0.03, 1.3, 0];
</script>

<T.PerspectiveCamera makeDefault position={camera} fov={35} near={0.05} far={20}>
  <OrbitControls
    {target}
    enableDamping
    dampingFactor={0.12}
    enablePan={false}
    minDistance={0.5}
    maxDistance={4}
    rotateSpeed={0.7}
  />
</T.PerspectiveCamera>

<!-- One warm key light from the top-left, a soft fill, no harsh rim. -->
<T.HemisphereLight args={['#fff8ee', '#b9a88f', 1.1]} />
<T.DirectionalLight position={[-2, 4, 2]} intensity={1.6} color="#fff4e6" />
<T.DirectionalLight position={[2, 2, -3]} intensity={0.7} color="#e9eef7" />

<Body {...props} />

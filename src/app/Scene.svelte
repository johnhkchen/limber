<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { Box3, Vector3, type PerspectiveCamera } from 'three';
  import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
  import Body from './Body.svelte';
  import PropsView from './Props.svelte';
  import type { RigidTransform } from '../core/fk';
  import type { ResolvedProp } from '../core/ground';
  import type { BonePoses, JointMap } from '../core/jointmap';
  import type { MeasureSample } from './body';
  import { viewDirection, type CameraHint } from './setlist';

  interface Props {
    /** From core's groundPose: what to pose and where the body goes. */
    bones: BonePoses | null;
    transform?: RigidTransform | null;
    jointMap: JointMap | null;
    muscleOpacity: number;
    boneOpacity: number;
    highlight: ReadonlyMap<string, number>;
    showHighlight: boolean;
    /** What's in the room, already placed by core (groundPose `props`). */
    room?: ResolvedProp[];
    /** Key moments of the move, grounded by core. The camera frames all of them. */
    samples?: MeasureSample[];
    hint: CameraHint;
    /** Exact camera start, e.g. from `?cam=x,y,z`. Skips the auto-fit. */
    camera?: [number, number, number];
    onready?: (info: { structures: number; bones: number; helpers: number; unmapped: string[] }) => void;
  }
  let { room = [], samples, hint, camera: fixedCam, ...body }: Props = $props();

  const { size, invalidate } = useThrelte();
  const FOV = 35;

  let cam: PerspectiveCamera | undefined = $state.raw();
  let controls: OrbitControlsImpl | undefined = $state.raw();
  let bounds = $state.raw<Box3 | null>(null);

  const fitOnly = $derived(hint.fit === 'highlight' ? new Set(body.highlight.keys()) : undefined);

  // Before anything is measured, and for `?cam=`: the old view from behind the right shoulder.
  const fallbackTarget = new Vector3(-0.03, 1.3, 0);

  /** Back the camera off along the hint's direction until the box fits the view, both ways. */
  function frame(box: Box3, aspect: number) {
    if (!cam || !controls) return;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(0.15, box.getSize(new Vector3()).length() / 2);
    const v = (FOV * Math.PI) / 180 / 2;
    const h = Math.atan(Math.tan(v) * aspect);
    const dist = (radius / Math.sin(Math.min(v, h))) * 0.92 / hint.zoom;
    const d = viewDirection(hint);
    cam.position.set(center.x + d[0] * dist, center.y + d[1] * dist, center.z + d[2] * dist);
    controls.target.copy(center);
    controls.minDistance = Math.min(0.5, dist * 0.4);
    controls.maxDistance = Math.max(4, dist * 2);
    controls.update();
    invalidate();
  }

  $effect(() => {
    if (fixedCam) {
      if (cam && controls) {
        cam.position.set(...fixedCam);
        controls.target.copy(fallbackTarget);
        controls.update();
        invalidate();
      }
      return;
    }
    if (bounds) frame(bounds, $size.width / Math.max(1, $size.height));
    else if (cam && controls) {
      // Nothing measured yet: the old view from behind the right shoulder.
      controls.target.copy(fallbackTarget);
      controls.update();
    }
  });
</script>

<T.PerspectiveCamera makeDefault bind:ref={cam} position={[-1.05, 1.5, -1.1]} fov={FOV} near={0.05} far={30}>
  <OrbitControls
    bind:ref={controls}
    target={[fallbackTarget.x, fallbackTarget.y, fallbackTarget.z]}
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

<PropsView items={room} />
<Body
  {...body}
  {samples}
  {fitOnly}
  onmeasure={(b) => (bounds = b.clone())}
/>

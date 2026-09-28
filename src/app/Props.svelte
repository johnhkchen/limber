<!--
  Simple clay stand-ins for what a move needs: floor, mat, pillow, doorframe, wall, ball.
  Metres. The body faces +Z, its left is +X, the floor is y = 0. Where each one goes comes from
  core (ground.ts groundPose `props`); this only draws them.
  Warm and matte, a touch lighter than the page, so they sit back behind the body.
-->
<script lang="ts">
  import { T } from '@threlte/core';
  import { RoundedBoxGeometry } from '@threlte/extras';
  import { BackSide, FrontSide, PlaneGeometry, EdgesGeometry } from 'three';
  import type { ResolvedProp } from '../core/ground';

  interface Props {
    items: ResolvedProp[];
  }
  let { items }: Props = $props();

  const CLAY = { color: '#e8dfd1', roughness: 0.95, metalness: 0 };
  const WOOD = { color: '#dac8ae', roughness: 0.9, metalness: 0 };
  // Mat: soft cream on a warmer clay rim, so it lifts off the floor without shouting.
  const MAT = { color: '#f6f0e5', roughness: 0.97, metalness: 0 };
  const MAT_RIM = { color: '#d8cab4', roughness: 0.95, metalness: 0 };
  const PILLOW = { color: '#fbf8f2', roughness: 0.98, metalness: 0 };
  const BALL = { color: '#c3cf4f', roughness: 0.85, metalness: 0 };
  /** Draw the mat at least this thick so its edge reads (a real one is ~5 mm). */
  const MAT_MIN = 0.012;

  const DOOR_W = 0.84;
  const DOOR_H = 2.05;
  const JAMB = 0.07;
  const WALL_H = 2.4;

  const wallEdges = new EdgesGeometry(new PlaneGeometry(WALL_H, WALL_H));
</script>

{#each items as p, i (i)}
  {#if p.kind === 'floor'}
    <T.Mesh rotation.x={-Math.PI / 2} position.y={-0.002}>
      <T.CircleGeometry args={[2.4, 72]} />
      <T.MeshStandardMaterial {...CLAY} transparent opacity={0.8} depthWrite={false} />
    </T.Mesh>
  {:else if p.kind === 'mat'}
    <!-- Core lays it along the body (pelvis to head), centred on what touches the floor. -->
    {@const h = Math.max(p.thickness, MAT_MIN)}
    <T.Group position={[p.centre[0], 0, p.centre[1]]} rotation.y={p.yaw}>
      <T.Mesh position.y={h / 2 - 0.004}>
        <T.BoxGeometry args={[p.width + 0.02, h, p.length + 0.02]} />
        <T.MeshStandardMaterial {...MAT_RIM} />
      </T.Mesh>
      <T.Mesh position.y={h / 2 - 0.002}>
        <T.BoxGeometry args={[p.width, h, p.length]} />
        <T.MeshStandardMaterial {...MAT} />
      </T.Mesh>
    </T.Group>
  {:else if p.kind === 'pillow'}
    <T.Group position={[p.centre[0], 0, p.centre[1]]} rotation.y={p.yaw}>
      <T.Mesh position.y={p.height / 2}>
        <RoundedBoxGeometry args={[p.width, p.height, p.length]} radius={Math.min(0.035, p.height / 2 - 0.001)} segments={4} />
        <T.MeshStandardMaterial {...PILLOW} />
      </T.Mesh>
    </T.Group>
  {:else if p.kind === 'doorframe'}
    <!-- The held jamb stands on core's post axis; the rest of the frame goes out to that side. -->
    {@const sx = p.side === 'left' ? 1 : -1}
    {@const far = p.x + sx * DOOR_W}
    <T.Group position.z={p.z}>
      <T.Mesh position={[p.x, DOOR_H / 2, 0]}>
        <T.BoxGeometry args={[p.radius * 2, DOOR_H, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
      <T.Mesh position={[far, DOOR_H / 2, 0]}>
        <T.BoxGeometry args={[JAMB, DOOR_H, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
      <T.Mesh position={[(p.x + far) / 2, DOOR_H + JAMB / 2, 0]}>
        <T.BoxGeometry args={[DOOR_W + JAMB, JAMB, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
    </T.Group>
  {:else if p.kind === 'wall'}
    <!-- The plane faces into the room (core's normal). From inside the room it's a soft clay wall; from
         behind it's a faint pane with an outline, so the body stays readable and the ball has something to press on. -->
    <T.Group position={[p.point[0], WALL_H / 2, p.point[2]]} rotation.y={Math.atan2(p.normal[0], p.normal[2])}>
      <T.Mesh renderOrder={-1}>
        <T.PlaneGeometry args={[WALL_H, WALL_H]} />
        <T.MeshStandardMaterial {...CLAY} transparent opacity={0.6} depthWrite={false} side={FrontSide} />
      </T.Mesh>
      <T.Mesh renderOrder={-1}>
        <T.PlaneGeometry args={[WALL_H, WALL_H]} />
        <T.MeshStandardMaterial {...CLAY} transparent opacity={0.22} depthWrite={false} side={BackSide} />
      </T.Mesh>
      <T.LineSegments geometry={wallEdges}>
        <T.LineBasicMaterial color="#b9a88f" transparent opacity={0.9} />
      </T.LineSegments>
    </T.Group>
  {:else if p.kind === 'ball' && p.centre}
    <T.Mesh position={[p.centre[0], p.centre[1], p.centre[2]]}>
      <T.SphereGeometry args={[p.diameter / 2, 32, 16]} />
      <T.MeshStandardMaterial {...BALL} />
    </T.Mesh>
  {/if}
{/each}

<!--
  Simple clay stand-ins for what a move needs: floor, mat, doorframe, wall, ball.
  Metres. The body faces +Z, its left is +X, the floor is y = 0. Where each one goes comes from
  core (ground.ts groundPose `props`); this only draws them.
  Warm and matte, a touch lighter than the page, so they sit back behind the body.
-->
<script lang="ts">
  import { T } from '@threlte/core';
  import { FrontSide } from 'three';
  import type { ResolvedProp } from '../core/ground';

  interface Props {
    items: ResolvedProp[];
    /** The body's framing box, to lay the mat under it. */
    box: { min: number[]; max: number[] } | null;
  }
  let { items, box }: Props = $props();

  const CLAY = { color: '#e8dfd1', roughness: 0.95, metalness: 0 };
  const WOOD = { color: '#dac8ae', roughness: 0.9, metalness: 0 };
  const MAT = { color: '#93a7c6', roughness: 0.95, metalness: 0 };
  const BALL = { color: '#c3cf4f', roughness: 0.85, metalness: 0 };

  const DOOR_W = 0.84;
  const DOOR_H = 2.05;
  const JAMB = 0.07;
  const WALL_H = 2.4;

  const matCenter = $derived<[number, number]>(box ? [(box.min[0]! + box.max[0]!) / 2, (box.min[2]! + box.max[2]!) / 2] : [0, 0]);
  const matAlongX = $derived(!!box && box.max[0]! - box.min[0]! > box.max[2]! - box.min[2]!);
</script>

{#each items as p, i (i)}
  {#if p.kind === 'floor'}
    <T.Mesh rotation.x={-Math.PI / 2} position.y={-0.002}>
      <T.CircleGeometry args={[2.4, 72]} />
      <T.MeshStandardMaterial {...CLAY} transparent opacity={0.8} depthWrite={false} />
    </T.Mesh>
  {:else if p.kind === 'mat'}
    <T.Mesh position={[matCenter[0], p.thickness / 2, matCenter[1]]} rotation.y={matAlongX ? Math.PI / 2 : 0}>
      <T.BoxGeometry args={[0.61, p.thickness, 1.83]} />
      <T.MeshStandardMaterial {...MAT} />
    </T.Mesh>
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
    <!-- The plane faces into the room (core's normal). Front side only, so a camera behind the wall looks through it. -->
    <T.Mesh position={[p.point[0], WALL_H / 2, p.point[2]]} rotation.y={Math.atan2(p.normal[0], p.normal[2])}>
      <T.PlaneGeometry args={[WALL_H, WALL_H]} />
      <T.MeshStandardMaterial {...CLAY} transparent opacity={0.6} depthWrite={false} side={FrontSide} />
    </T.Mesh>
  {:else if p.kind === 'ball' && p.centre}
    <T.Mesh position={[p.centre[0], p.centre[1], p.centre[2]]}>
      <T.SphereGeometry args={[p.diameter / 2, 32, 16]} />
      <T.MeshStandardMaterial {...BALL} />
    </T.Mesh>
  {/if}
{/each}

<!--
  Simple clay stand-ins for what a move needs: floor, mat, doorframe, wall, ball.
  Metres. The body faces +Z, its left is +X, the floor is y = 0. Positions come from placement.ts.
  Warm and matte, a touch lighter than the page, so they sit back behind the body.
-->
<script lang="ts">
  import { T } from '@threlte/core';
  import { FrontSide } from 'three';
  import type { ResolvedProp } from './placement';

  let { items }: { items: ResolvedProp[] } = $props();

  const CLAY = { color: '#e8dfd1', roughness: 0.95, metalness: 0 };
  const WOOD = { color: '#dac8ae', roughness: 0.9, metalness: 0 };
  const MAT = { color: '#93a7c6', roughness: 0.95, metalness: 0 };
  const BALL = { color: '#c3cf4f', roughness: 0.85, metalness: 0 };

  const DOOR_W = 0.84;
  const DOOR_H = 2.05;
  const JAMB = 0.07;

  const WALL: Record<string, { pos: (d: number) => [number, number, number]; turn: number }> = {
    behind: { pos: (d) => [0, 1.2, -d], turn: 0 },
    front: { pos: (d) => [0, 1.2, d], turn: Math.PI },
    left: { pos: (d) => [d, 1.2, 0], turn: -Math.PI / 2 },
    right: { pos: (d) => [-d, 1.2, 0], turn: Math.PI / 2 },
  };
</script>

{#each items as p, i (i)}
  {#if p.kind === 'floor'}
    <T.Mesh rotation.x={-Math.PI / 2} position.y={-0.002}>
      <T.CircleGeometry args={[2.4, 72]} />
      <T.MeshStandardMaterial {...CLAY} transparent opacity={0.8} depthWrite={false} />
    </T.Mesh>
  {:else if p.kind === 'mat'}
    <T.Mesh position={[p.center[0], p.thickness / 2, p.center[1]]} rotation.y={p.along === 'x' ? Math.PI / 2 : 0}>
      <T.BoxGeometry args={[0.61, p.thickness, 1.83]} />
      <T.MeshStandardMaterial {...MAT} />
    </T.Mesh>
  {:else if p.kind === 'doorframe'}
    <!-- The held jamb stands where the hand grips; the rest of the frame goes out to that side. -->
    {@const sx = p.side === 'left' ? 1 : -1}
    {@const near = p.grip[0] + sx * 0.03}
    {@const far = near + sx * DOOR_W}
    <T.Group position.z={p.grip[2] + 0.02}>
      <T.Mesh position={[near, DOOR_H / 2, 0]}>
        <T.BoxGeometry args={[JAMB, DOOR_H, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
      <T.Mesh position={[far, DOOR_H / 2, 0]}>
        <T.BoxGeometry args={[JAMB, DOOR_H, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
      <T.Mesh position={[(near + far) / 2, DOOR_H + JAMB / 2, 0]}>
        <T.BoxGeometry args={[DOOR_W + JAMB, JAMB, 0.12]} />
        <T.MeshStandardMaterial {...WOOD} />
      </T.Mesh>
    </T.Group>
  {:else if p.kind === 'wall'}
    {@const w = WALL[p.side]!}
    <T.Mesh position={w.pos(p.distance)} rotation.y={w.turn}>
      <T.PlaneGeometry args={[2.4, 2.4]} />
      <!-- Front side only: it faces the body, so a camera behind the wall looks straight through it. -->
      <T.MeshStandardMaterial {...CLAY} transparent opacity={0.6} depthWrite={false} side={FrontSide} />
    </T.Mesh>
  {:else if p.kind === 'ball'}
    <T.Mesh position={p.at}>
      <T.SphereGeometry args={[p.radius, 32, 16]} />
      <T.MeshStandardMaterial {...BALL} />
    </T.Mesh>
  {/if}
{/each}

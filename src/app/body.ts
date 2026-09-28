/**
 * three.js side of the body: materials per layer, see-through, highlight, and posing bones by name.
 * View code (imports three). The math it calls lives in src/core/.
 */
import * as THREE from 'three';
import { helperPose, type BonePoses, type Helper } from '../core/jointmap';

export const COLORS = {
  bone: new THREE.Color('#e9dfcf'),
  muscles: new THREE.Color('#b9634f'),
  skin: new THREE.Color('#dcc0a8'),
  connective: new THREE.Color('#d8cab0'),
  highlight: new THREE.Color('#44679b'),
} as const;

export interface Structure {
  zaName: string;
  layer: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

/** Nearest `extras.za_*` on the object or its ancestors (gltfpack moves meshes under a named parent). */
function extrasOf(o: THREE.Object3D, stop: THREE.Object3D): { za_name?: string; za_layer?: string } {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (typeof p.userData.za_name === 'string') return p.userData as { za_name: string; za_layer?: string };
    if (p === stop) break;
  }
  return {};
}

/** Give every structure its own calm material. `fallbackLayer` is used when the file has no `za_layer`. */
export function collectStructures(root: THREE.Object3D, fallbackLayer: string): Structure[] {
  const out: Structure[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const ex = extrasOf(mesh, root);
    const layer = ex.za_layer ?? fallbackLayer;
    const base = layer === 'skeleton' || layer === 'bones' ? COLORS.bone : (COLORS as Record<string, THREE.Color>)[layer] ?? COLORS.muscles;
    const material = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.78, metalness: 0 });
    material.userData.base = base;
    mesh.material = material;
    mesh.frustumCulled = false; // skinned meshes move outside their rest bounds
    out.push({ zaName: ex.za_name ?? mesh.userData.name ?? mesh.name, layer, mesh, material });
  });
  return out;
}

export interface Look {
  /** Layer → 0..1. */
  opacity: Record<string, number>;
  highlight: ReadonlySet<string>;
  /** Highlights stay visible through faded layers. */
  showHighlight: boolean;
}

export function styleStructures(list: Structure[], look: Look): void {
  for (const s of list) {
    const lit = look.showHighlight && look.highlight.has(s.zaName);
    const layerOpacity = look.opacity[s.layer] ?? 1;
    const opacity = lit ? Math.max(layerOpacity, 0.9) : layerOpacity;
    const m = s.material;
    m.color.copy(lit ? COLORS.highlight : (m.userData.base as THREE.Color));
    m.emissive.copy(lit ? COLORS.highlight : new THREE.Color(0x000000));
    m.emissiveIntensity = lit ? 0.45 : 0;
    m.opacity = opacity;
    m.transparent = opacity < 0.999;
    m.depthWrite = opacity >= 0.999;
    m.needsUpdate = true;
    s.mesh.visible = opacity > 0.01;
    s.mesh.renderOrder = lit ? 2 : m.transparent ? 1 : 0;
  }
}

/** Every copy of each named bone across the loaded files, with its REST pose. */
export interface Rig {
  copies: Map<string, THREE.Object3D[]>;
  restLocal: Map<THREE.Object3D, THREE.Quaternion>;
  restPosition: Map<THREE.Object3D, THREE.Vector3>;
  restScale: Map<THREE.Object3D, THREE.Vector3>;
  /** Stretch helpers ("bands") per loaded copy, with their REST length measured at load. */
  helpers: BoundHelper[];
  roots: THREE.Object3D[];
}

interface BoundHelper {
  spec: Helper;
  bone: THREE.Object3D;
  parent: THREE.Object3D;
  target: THREE.Object3D;
  restLength: number;
}

/**
 * Bind by the original glTF node name (`userData.name`): three.js sanitizes `.name`
 * (`Scapula.r` → `Scapular`). Each GLB carries the same joint list, so posing every copy
 * the same way acts as one shared skeleton. Call with the files at REST (as loaded).
 */
export function bindRig(roots: THREE.Object3D[], boneNames: Iterable<string>, helpers: Helper[] = []): Rig {
  const wanted = new Set(boneNames);
  const rig: Rig = { copies: new Map(), restLocal: new Map(), restPosition: new Map(), restScale: new Map(), helpers: [], roots };
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => {
      const n = o.userData.name as string | undefined;
      if (!n || !wanted.has(n) || byName.has(n)) return;
      byName.set(n, o);
      const list = rig.copies.get(n) ?? [];
      list.push(o);
      rig.copies.set(n, list);
      rig.restLocal.set(o, o.quaternion.clone());
      rig.restPosition.set(o, o.position.clone());
      rig.restScale.set(o, o.scale.clone());
    });
    for (const h of helpers) {
      const bone = byName.get(h.bone), parent = byName.get(h.parent), target = byName.get(h.target);
      if (!bone || !parent || !target) continue;
      const head = bone.getWorldPosition(new THREE.Vector3());
      const restLength = head.distanceTo(target.getWorldPosition(new THREE.Vector3()));
      rig.helpers.push({ spec: h, bone, parent, target, restLength });
    }
  }
  return rig;
}

const dq = new THREE.Quaternion();
const pPos = new THREE.Vector3();
const pQuat = new THREE.Quaternion();
const pScale = new THREE.Vector3();
const tPos = new THREE.Vector3();

/** REST · delta for every bone the pose touches; bones it doesn't touch go back to REST. Then the helpers. */
export function applyPose(rig: Rig, poses: BonePoses): void {
  for (const [name, copies] of rig.copies) {
    const bp = poses.bones[name];
    for (const o of copies) {
      const rest = rig.restLocal.get(o)!;
      o.position.copy(rig.restPosition.get(o)!);
      o.scale.copy(rig.restScale.get(o)!);
      if (!bp) {
        o.quaternion.copy(rest);
        continue;
      }
      dq.set(bp.quaternion[0], bp.quaternion[1], bp.quaternion[2], bp.quaternion[3]);
      o.quaternion.copy(rest).multiply(dq);
    }
  }
  if (!rig.helpers.length) return;
  for (const r of rig.roots) r.updateMatrixWorld(true);
  for (const h of rig.helpers) {
    h.parent.matrixWorld.decompose(pPos, pQuat, pScale);
    h.target.getWorldPosition(tPos);
    const rp = rig.restPosition.get(h.bone)!;
    const rq = rig.restLocal.get(h.bone)!;
    const out = helperPose(
      { position: [pPos.x, pPos.y, pPos.z], quaternion: [pQuat.x, pQuat.y, pQuat.z, pQuat.w], scale: pScale.x },
      { position: [rp.x, rp.y, rp.z], quaternion: [rq.x, rq.y, rq.z, rq.w] },
      [tPos.x, tPos.y, tPos.z],
      h.restLength,
      h.spec.stretch_axis_three,
      h.spec.volume_axis_three,
    );
    h.bone.quaternion.set(out.quaternion[0], out.quaternion[1], out.quaternion[2], out.quaternion[3]);
    h.bone.scale.set(out.scale[0], out.scale[1], out.scale[2]);
  }
}

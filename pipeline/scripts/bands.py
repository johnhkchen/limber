"""Muscle skin weights for Limber: "bands" (fanned stretch helper bones).

Copied into the pipeline from spike/rhomboid/weights.py (2026-09-28); assemble.py calls
weight_muscle(..., method='bands') for the muscles in SPEC. Changes from the spike: helper names use
helper_stem() (MH_RhomboidMajor_r_0), structure names come from extras za_name, and
BoneSurfaces.from_arrays() takes the REST bone geometry assemble.py already has.

Winner of the rhomboid spike (spike/rhomboid/, 2026-09-28). Use it for muscles
that run from a row of vertebrae to the scapula: rhomboid major, rhomboid
minor, levator scapulae (SPEC below; add rows for others, e.g. trapezius parts).

What it does (weight_muscle(o, arm, B, method='bands')):
  1. Attachments. For each bone SPEC allows (origin vertebrae, insertion
     scapula), the muscle verts within (closest + 2.5 mm, cap 5 mm) of that
     bone's REST surface are its contact patch. Bones farther than 5 mm are
     skipped (e.g. rhomboid major touches T1-T4, not C7/T5, in Z-Anatomy).
  2. Fibre coordinates. t = harmonic field on the mesh graph, 0 on the origin
     patches, 1 on the insertion patch. u = harmonic field of the position
     along each attachment line (principal axis, 0 = bottom, 1 = top), fixed
     on both lines, so u follows the fibres from the spine to the blade.
  3. K=4 helper bones MH_<muscle>_<k>, one per band of u: head on the origin
     line (parent = the vertebra owning most of that band's contacts), tail
     on the medial border; a non-deforming target MT_<muscle>_<k> parented to
     the scapula at the tail; STRETCH_TO (SWING_Y, VOLUME_Z, rest_length = rest
     distance), roll aligned so local Z = sheet normal => a stretched band thins
     through its thickness only, not across its width.
  4. Weights: origin share 1-smoothstep(0, .2, t), split over the vertebrae by
     harmonic partition pinned at each vertebra's own contacts; insertion share
     smoothstep(.8, 1, t) to the scapula; the rest to the helpers by linear hat
     functions over u (<= 2 helpers per vert). 3 smoothing passes, top 4,
     normalized. Contact verts stay rigid on their own bone.

Runtime (glTF / three.js): the helpers are plain joints. Export them (and
only the MH_ bones, not MT_), store per helper {parent, tail point in scapula
local space, rest_length} in extras, and each frame set the helper's matrix
with helper_runtime_matrix() (shortest-arc swing of the parent-carried frame
to the tail, scale Y by s and Z by 1/s). verify_runtime() checks that math
against Blender's constraint: max matrix-entry error 7e-5 on the 4 rhomboid
major helpers. ~12 helpers for both rhomboids + levator per side.

Measured (Z-Anatomy full-res meshes, skin scout's across-body reach pose, full
and at 50% amplitude; see spike/rhomboid/results_*.json):
  rhomboid major  c2: 21.3% edges bad, p99 stretch 5.2, max 16.5, vol 2.03
                  bands: 25.2% bad (floor, see below), p99 2.7, max 7.3,
                  vol 1.38, origin/insertion drift p95 0.44/0.27 mm
  at 50% pose     c2: 11.4% bad, vol 1.51   bands: 4.4% bad, vol 1.27
  levator         c2: 18.5% bad, vol 1.54   bands: 0.8% bad, vol 1.05
The full pose asks the rhomboid major fibres themselves to stretch 1.26-1.64x
(origin to insertion, both carried rigidly; the scapula also lifts 20 mm off
the ribs), so ~25% of edges > 1.5x is the floor for any method there; judge
by pct_tear (edges > 1.25 x max fibre stretch or < 0.67): c2 12.3%, bands 4.8%.

Known issue: at the full pose the angle of rib 6 pokes through the lower
middle of rhomboid major (18 of 2402 verts; 0 at 50%). Letting ribs carry
the deep verts did nothing. Likely goes away when the scapula is kept on the
chest wall (floating-scapula item), else needs a mid-band wrap point.
Also: rhomboid minor and major are weighted separately, so a thin gap opens
between them under protraction (a few mm, visible in renders). Weighting the
two as one sheet (shared u field and helpers) should close it; untested.

Must be called with the armature at REST (identity == REST once flattened).
Other methods (c2, c2r, bridge) are kept for comparison only.
"""
import math
import numpy as np
import bpy
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

# ---------------------------------------------------------------------------
# Which bones a muscle is allowed to follow. Origin = vertebrae (spinous
# processes), insertion = scapula. Only bones that the muscle actually touches
# (within CONTACT_MAX of the bone surface at REST) become attachments.
# ---------------------------------------------------------------------------
SPEC = {
    'Rhomboid major muscle': dict(origin=['C7', 'T1', 'T2', 'T3', 'T4', 'T5'], insertion=['Scapula']),
    'Rhomboid minor muscle': dict(origin=['C6', 'C7', 'T1'], insertion=['Scapula']),
    'Levator scapulae': dict(origin=['C1', 'C2', 'C3', 'C4'], insertion=['Scapula']),
}
CONTACT_MAX = 0.005   # a bone counts as attached if the muscle comes within 5 mm
CONTACT_BAND = 0.0025  # contact verts: within (closest distance + 2.5 mm), capped at CONTACT_MAX


def zname(o):
    """Structure name: extras za_name when the pipeline set it, else the object name."""
    return o.get('za_name', o.name)


def helper_stem(name):
    """'Rhomboid major muscle.r' -> 'RhomboidMajor_r'. Helper bones are MH_<stem>_<k>, targets MT_<stem>_<k>.
    No dots or spaces, so three.js keeps the node name as is and the two sides never collide."""
    base, side = name.rsplit('.', 1)
    words = base.replace(' muscle', '').split()
    return ''.join(w[:1].upper() + w[1:] for w in words) + '_' + side


def side_of(name):
    return name.rsplit('.', 1)[1] if '.' in name else ''


def spec_for(obj_name):
    base, side = obj_name.rsplit('.', 1)
    sp = SPEC[base]
    fix = lambda b: b + '.' + side if b in ('Scapula', 'Clavicle-X', 'Clavicle-Z') else b
    return [fix(b) for b in sp['origin']], [fix(b) for b in sp['insertion']]


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------
class BoneSurfaces:
    """REST-pose surface points (KD trees) and triangles of every rigid bone mesh, keyed by armature bone."""

    def __init__(self, arm, kids, max_pts=4000):
        import random
        random.seed(1)
        dg = bpy.context.evaluated_depsgraph_get()
        self.pts, self.kd, self.tris, self.bb = {}, {}, {}, {}
        for o in kids:
            oe = o.evaluated_get(dg); me = oe.to_mesh()
            mw = np.array(oe.matrix_world)
            co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co)
            V = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
            me.calc_loop_triangles()
            F = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get('vertices', F)
            oe.to_mesh_clear()
            b = o.parent_bone
            if b in self.tris:  # several meshes on one bone: concatenate
                V0, F0 = self.tris[b]
                self.tris[b] = (np.vstack([V0, V]), np.vstack([F0, F.reshape(-1, 3) + len(V0)]))
            else:
                self.tris[b] = (V, F.reshape(-1, 3))
        for b, (V, F) in self.tris.items():
            P = V if len(V) <= max_pts else V[np.random.RandomState(1).choice(len(V), max_pts, replace=False)]
            kd = KDTree(len(P))
            for i, p in enumerate(P): kd.insert(p, i)
            kd.balance()
            self.pts[b], self.kd[b], self.bb[b] = P, kd, (V.min(0), V.max(0))

    @classmethod
    def from_arrays(cls, verts, tris, max_pts=4000):
        """Same as __init__, from {bone: (n,3) REST world verts} and {bone: (m,3) triangle indices}."""
        self = cls.__new__(cls)
        self.pts, self.kd, self.tris, self.bb = {}, {}, {}, {}
        for b, V in verts.items():
            self.tris[b] = (V, tris[b])
            P = V if len(V) <= max_pts else V[np.random.RandomState(1).choice(len(V), max_pts, replace=False)]
            kd = KDTree(len(P))
            for i, p in enumerate(P): kd.insert(p, i)
            kd.balance()
            self.pts[b], self.kd[b], self.bb[b] = P, kd, (V.min(0), V.max(0))
        return self

    def dist(self, W, b):
        kd = self.kd[b]
        return np.array([kd.find(p)[2] for p in W])

    def near(self, W, margin):
        lo, hi = W.min(0) - margin, W.max(0) + margin
        return [b for b, (blo, bhi) in self.bb.items() if np.all(bhi >= lo) and np.all(blo <= hi)]


def world_verts(o):
    mw = np.array(o.matrix_world)
    co = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]


def edges(o):
    e = np.empty(len(o.data.edges) * 2, dtype=np.int64); o.data.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def smooth(Wt, E, n, iters=5, alpha=0.5, fixed=None):
    deg = np.zeros(n); np.add.at(deg, E[:, 0], 1); np.add.at(deg, E[:, 1], 1)
    deg = np.maximum(deg, 1)
    for _ in range(iters):
        acc = np.zeros_like(Wt)
        np.add.at(acc, E[:, 0], Wt[E[:, 1]]); np.add.at(acc, E[:, 1], Wt[E[:, 0]])
        new = (1 - alpha) * Wt + alpha * acc / deg[:, None]
        if fixed is not None:
            new[fixed] = Wt[fixed]
        Wt = new
    return Wt


def harmonic(E, n, fixed_idx, fixed_val, iters=3000, tol=1e-7):
    """Solve graph-Laplacian L x = 0 with Dirichlet values (conjugate gradient, numpy only)."""
    x = np.zeros(n); x[fixed_idx] = fixed_val
    free = np.ones(n, bool); free[fixed_idx] = False
    deg = np.zeros(n); np.add.at(deg, E[:, 0], 1); np.add.at(deg, E[:, 1], 1)

    def L(v):  # (D - A) v
        a = np.zeros(n); np.add.at(a, E[:, 0], v[E[:, 1]]); np.add.at(a, E[:, 1], v[E[:, 0]])
        return deg * v - a
    b = -L(x); b[~free] = 0
    y = np.zeros(n)
    r = b.copy(); p = r.copy(); rs = r @ r
    for _ in range(iters):
        Ap = L(p); Ap[~free] = 0
        al = rs / max(p @ Ap, 1e-30)
        y += al * p; r -= al * Ap
        rn = r @ r
        if rn < tol * tol: break
        p = r + (rn / rs) * p; rs = rn
    return x + y


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def idw(Dm, p=4, eps=0.002):
    w = 1.0 / (Dm + eps) ** p
    return w / w.sum(1, keepdims=True)


def assign(o, arm, Wt, bones, max_inf=4):
    """Write dense (n, nb) weights as vertex groups: top-4 per vertex, renormalized; add Armature modifier."""
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    idx = np.argsort(-Wt, axis=1)[:, :max_inf]
    top = np.take_along_axis(Wt, idx, 1)
    top[top < 1e-4] = 0
    top /= np.maximum(top.sum(1, keepdims=True), 1e-12)
    groups = [o.vertex_groups.new(name=b) for b in bones]
    for i in range(len(Wt)):
        for k in range(idx.shape[1]):
            if top[i, k] > 0:
                groups[idx[i, k]].add([i], float(top[i, k]), 'REPLACE')
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': o.modifiers.remove(m)
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm
    for b in bones:
        arm.data.bones[b].use_deform = True


def check_weights(o):
    n = len(o.data.vertices)
    cnt = np.zeros(n, int); tot = np.zeros(n)
    for v in o.data.vertices:
        ws = [g.weight for g in v.groups if g.weight > 1e-6]
        cnt[v.index] = len(ws); tot[v.index] = sum(ws)
    return dict(zero_weight_verts=int((tot < 1e-6).sum()), max_influences=int(cnt.max()),
                sum_err=round(float(np.abs(tot - 1).max()), 6),
                bones_used=len({o.vertex_groups[g.group].name for v in o.data.vertices for g in v.groups if g.weight > 1e-4}))


# ---------------------------------------------------------------------------
# attachments
# ---------------------------------------------------------------------------
def attachments(o, B, W):
    origin_bones, ins_bones = spec_for(zname(o))
    att = {'origin': {}, 'insertion': {}}
    notes = []
    for key, names in (('origin', origin_bones), ('insertion', ins_bones)):
        for b in names:
            if b not in B.kd: continue
            d = B.dist(W, b)
            if d.min() > CONTACT_MAX:
                notes.append('%s %.1fmm-skip' % (b, d.min() * 1000)); continue
            idx = np.where(d < min(d.min() + CONTACT_BAND, CONTACT_MAX))[0]
            att[key][b] = idx
            notes.append('%s:%d' % (b, len(idx)))
    ib = max(att['insertion'], key=lambda b: len(att['insertion'][b]))
    att['insertion_bone'] = ib
    att['insertion_all'] = np.unique(np.concatenate(list(att['insertion'].values())))
    att['origin_all'] = np.unique(np.concatenate(list(att['origin'].values())))
    return att, ' '.join(notes)


# ---------------------------------------------------------------------------
# methods
# ---------------------------------------------------------------------------
def fiber_t(W, E, att, kind='harmonic'):
    """0 at the origin patches, 1 at the insertion patch."""
    n = len(W)
    oi, ii = att['origin_all'], att['insertion_all']
    both = np.intersect1d(oi, ii)
    oi = np.setdiff1d(oi, both); ii = np.setdiff1d(ii, both)
    if kind == 'harmonic':
        fixed = np.concatenate([oi, ii]); val = np.concatenate([np.zeros(len(oi)), np.ones(len(ii))])
        return harmonic(E, n, fixed, val)
    # euclidean distance ratio
    def dist_to(idx):
        kd = KDTree(len(idx))
        for j, i in enumerate(idx): kd.insert(W[i], j)
        kd.balance()
        return np.array([kd.find(p)[2] for p in W])
    do, di = dist_to(oi), dist_to(ii)
    return do / np.maximum(do + di, 1e-9)


def origin_split(W, E, att, power=2, eps=0.003):
    """(n, n_origin_bones) partition of unity over origin vertebrae, pinned at their own contacts, harmonic between."""
    bones = list(att['origin'])
    n = len(W)
    if len(bones) == 1:
        return bones, np.ones((n, 1))
    cols = []
    allc = np.concatenate([att['origin'][b] for b in bones])
    for b in bones:
        val = np.concatenate([np.full(len(att['origin'][c]), 1.0 if c == b else 0.0) for c in bones])
        cols.append(harmonic(E, n, allc, val))
    S = np.clip(np.stack(cols, 1), 0, None)
    return bones, S / np.maximum(S.sum(1, keepdims=True), 1e-12)


def method_c2(o, arm, B, W, E, att, restrict=False, deep_rib_mm=5.0, **kw):
    if restrict:
        cands = list(att['origin']) + list(att['insertion'])
        # ribs only for deep verts that actually lie on them
        sd = side_of(zname(o))
        ribs = [b for b in B.near(W, 0.01) if b.startswith('Rib') and b.endswith('.' + sd)]
        extra = []
        for b in ribs:
            d = B.dist(W, b)
            if (d < deep_rib_mm / 1000).any(): extra.append((b, d))
        Dm = np.stack([B.dist(W, b) for b in cands] + [np.where(d < deep_rib_mm / 1000, d, 1e3) for _, d in extra], 1)
        bones = cands + [b for b, _ in extra]
    else:
        bones = B.near(W, 0.08)
        Dm = np.stack([B.dist(W, b) for b in bones], 1)
    Wt = smooth(idw(Dm), E, len(W))
    return bones, Wt, 'c2%s bones=%d' % ('r' if restrict else '', len(bones))


def method_bridge(o, arm, B, W, E, att, tkind='harmonic', lo=0.0, hi=1.0, smooth_iters=5, **kw):
    t = fiber_t(W, E, att, tkind)
    s = smoothstep(lo, hi, t)
    ob, S = origin_split(W, E, att)
    ib = att['insertion_bone']
    bones = ob + [ib]
    Wt = np.hstack([S * (1 - s)[:, None], s[:, None]])
    if smooth_iters: Wt = smooth(Wt, E, len(W), iters=int(smooth_iters))
    return bones, Wt, 'bridge t=%s lo=%.2f hi=%.2f' % (tkind, lo, hi)


def _pca_axis(P):
    c = P.mean(0); u, s, vt = np.linalg.svd(P - c, full_matrices=False)
    return c, vt


def method_bands(o, arm, B, W, E, att, K=4, ends=0.2, vol='VOLUME_Z', tkind='harmonic', **kw):
    """K helper bones, each from a point on the origin line to a point on the insertion line, STRETCH_TO."""
    K = int(K)
    t = fiber_t(W, E, att, tkind)
    oi, ii = att['origin_all'], att['insertion_all']
    # parameter along each attachment line (principal axis), 0..1
    def line_param(idx):
        c, vt = _pca_axis(W[idx]); a = vt[0]
        if a[2] < 0: a = -a       # 0 = bottom, 1 = top (both lines run roughly vertical)
        u = (W[idx] - c) @ a
        lo_, hi_ = np.percentile(u, 2), np.percentile(u, 98)
        return np.clip((u - lo_) / (hi_ - lo_), 0, 1)
    uo, ui = line_param(oi), line_param(ii)
    # per-vertex "across" coordinate u: harmonic with u fixed on both lines
    both = np.intersect1d(oi, ii)
    mo = ~np.isin(oi, both); mi = ~np.isin(ii, both)
    u = harmonic(E, len(W), np.concatenate([oi[mo], ii[mi]]), np.concatenate([uo[mo], ui[mi]]))
    _, vt_all = _pca_axis(W); normal = vt_all[2]
    heads, tails, hparents = [], [], []
    for k in range(K):
        uk = (k + 0.5) / K
        so = np.abs(uo - uk) <= 0.5 / K + 1e-6; si = np.abs(ui - uk) <= 0.5 / K + 1e-6
        if not so.any(): so = np.abs(uo - uk) == np.abs(uo - uk).min()
        if not si.any(): si = np.abs(ui - uk) == np.abs(ui - uk).min()
        h = W[oi[so]].mean(0); tl = W[ii[si]].mean(0)
        # parent vertebra: the one owning most of this band's origin contacts
        owners = {}
        for b, idx in att['origin'].items():
            owners[b] = int(np.isin(oi[so], idx).sum())
        heads.append(h); tails.append(tl); hparents.append(max(owners, key=owners.get))
    # build helper bones
    short = helper_stem(zname(o))
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    hnames = []
    ib = att['insertion_bone']
    for k in range(K):
        hn, tn = 'MH_%s_%d' % (short, k), 'MT_%s_%d' % (short, k)
        for nm in (hn, tn):
            if nm in eb: eb.remove(eb[nm])
        h = eb.new(hn); h.head = Vector(heads[k]); h.tail = Vector(tails[k]); h.parent = eb[hparents[k]]
        h.align_roll(Vector(normal)); h.use_deform = True
        tb = eb.new(tn); tb.head = Vector(tails[k]); tb.tail = Vector(tails[k]) + Vector((0, 0, 0.01)); tb.parent = eb[ib]
        tb.use_deform = False
        hnames.append(hn)
    bpy.ops.object.mode_set(mode='OBJECT')
    for k, hn in enumerate(hnames):
        pb = arm.pose.bones[hn]
        for c in list(pb.constraints): pb.constraints.remove(c)
        c = pb.constraints.new('STRETCH_TO'); c.target = arm; c.subtarget = 'MT_%s_%d' % (short, k)
        c.volume = vol; c.keep_axis = 'SWING_Y'
        c.rest_length = float(np.linalg.norm(np.array(tails[k]) - np.array(heads[k])))
    bpy.context.view_layer.update()
    # weights
    wO = 1 - smoothstep(0.0, ends, t)
    wI = smoothstep(1 - ends, 1.0, t)
    wH = np.clip(1 - wO - wI, 0, 1)
    # band split: linear hat functions over u
    centers = (np.arange(K) + 0.5) / K
    uu = np.clip(u, centers[0], centers[-1])
    hat = np.clip(1 - np.abs(uu[:, None] - centers[None]) * K, 0, 1) if K > 1 else np.ones((len(W), 1))
    hat /= np.maximum(hat.sum(1, keepdims=True), 1e-12)
    ob, S = origin_split(W, E, att)
    bones = ob + [ib] + hnames
    Wt = np.hstack([S * wO[:, None], wI[:, None], hat * wH[:, None]])
    rnote = ''
    Wt = smooth(Wt, E, len(W), iters=3)
    return bones, Wt, 'bands K=%d ends=%.2f vol=%s parents=%s%s' % (K, ends, vol, ','.join(hparents), rnote)


METHODS = {'c2': method_c2, 'c2r': lambda *a, **k: method_c2(*a, restrict=True, **k),
           'bridge': method_bridge, 'bands': method_bands}


def weight_muscle(o, arm, B, method='bands', **kw):
    """Entry point. Must be called with the armature at REST (or identity == REST)."""
    W = world_verts(o)
    E = edges(o)
    att, note = attachments(o, B, W)
    bones, Wt, n2 = METHODS[method](o, arm, B, W, E, att, **kw)
    Wt = np.clip(Wt, 0, None)
    Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-12)
    assign(o, arm, Wt, bones)
    return dict(attach=att, bones=bones, note=n2 + ' | ' + note)


# ---------------------------------------------------------------------------
# Runtime (browser) equivalent of the helper bones' STRETCH_TO. This is the
# exact math src/core/ must run per frame; verify_runtime() checks it against
# Blender's constraint so the numbers match what we measured here.
# ---------------------------------------------------------------------------
def helper_runtime_matrix(parent_world, head_local_mat, tail_in_target, target_world, rest_len, vol='VOLUME_Z'):
    """All 4x4 numpy, armature space.

    parent_world   : posed matrix of the helper's parent bone (a vertebra)
    head_local_mat : helper's rest matrix relative to its parent (parent_rest^-1 @ helper_rest)
    tail_in_target : helper tail point in the target bone's rest-local space (4-vector, w=1)
    target_world   : posed matrix of the target bone (the scapula)
    Returns the helper's posed matrix: carried by parent, swung (shortest arc) so +Y hits the
    tail, scaled Y by stretch s and the volume axis by 1/s.
    """
    M0 = parent_world @ head_local_mat
    H = M0[:3, 3]
    T = (target_world @ tail_in_target)[:3]
    d = T - H; dist = np.linalg.norm(d); dn = d / dist
    R0 = M0[:3, :3] / np.linalg.norm(M0[:3, :3], axis=0)   # strip scale carried from parent
    y0 = R0[:, 1]
    v = np.cross(y0, dn); c = float(y0 @ dn)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    Rs = np.eye(3) + K + K @ K * (1.0 / (1.0 + c))          # rotation taking y0 onto dn
    s = dist / rest_len
    b = 1.0 / s
    sx, sz = {'VOLUME_Z': (1, b), 'VOLUME_X': (b, 1), 'VOLUME_XZX': (b ** .5, b ** .5), 'NO_VOLUME': (1, 1)}[vol]
    out = np.eye(4)
    out[:3, :3] = Rs @ R0 @ np.diag([sx, s, sz])
    out[:3, 3] = H
    return out


def verify_runtime(arm):
    """Max abs difference between Blender's STRETCH_TO result and helper_runtime_matrix(), per helper."""
    res = {}
    for pb in arm.pose.bones:
        cs = [c for c in pb.constraints if c.type == 'STRETCH_TO' and pb.name.startswith('MH_')]
        if not cs: continue
        c = cs[0]
        par = pb.parent
        tgt = arm.pose.bones[c.subtarget]
        head_local = np.array(par.bone.matrix_local.inverted() @ pb.bone.matrix_local)
        tail_local = np.array(tgt.parent.bone.matrix_local.inverted() @ tgt.bone.matrix_local)[:, 3]
        pred = helper_runtime_matrix(np.array(par.matrix), head_local, tail_local, np.array(tgt.parent.matrix),
                                     c.rest_length, c.volume)
        res[pb.name] = float(np.abs(pred - np.array(pb.matrix)).max())
    return res

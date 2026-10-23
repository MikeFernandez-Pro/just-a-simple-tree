import * as THREE from 'three/webgpu'
import { liftBelow } from './wind.js'

// The wood every species is built from: crooked tubes, tapering as they go,
// with rounded tips and collars where they grow from another, and what the
// growing needs on each vertex. A species decides where the branches go

const CAP_RINGS = 3 // rings in the rounded dome closing each branch's tip
const COLLAR = 0.9 // a child's base radius / its parent's radius there
const FLARE_HEIGHT = 5 // how far up a flared base spreads / the branch's radius at its start
const FLARE_RINGS = 6 // rings up a flared base, however coarse the rest of the tube
// The branches' own sway (wind.js): how far each point of the wood flexes
// builds up along the wood from the ground, faster through thin wood, and
// its beat drifts along each branch from where it leaves its parent
const STIFF_RADIUS = 0.02 // metres: wood thinner than this flexes no more than this would
const PHASE_DRIFT = 2.5 // radians the beat drifts along a branch, give or take half
const JOINT_REACH = 0.25 // metres: a branch starting this close to the wood grows from it, flexing with it
const CELL = 0.5 // metres: the grid the wood is looked up in by
const SEARCH_RINGS = 4 // cells out from a point it looks for the nearest wood

export const UP = new THREE.Vector3(0, 1, 0)
export const SIDE = new THREE.Vector3(1, 0, 0)
// Turning on by it each time spreads things evenly round a circle or a sphere
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function createWood(params, random) {
  const positions = []
  const normals = []
  const indices = []
  // For growing: per vertex, its ring's centre, its branch's root, and
  // how far along the wood from the ground it is. For the wind: how far
  // below where it hangs from it is, on a branch that hangs
  const centers = []
  const roots = []
  const births = []
  const lifts = []
  // For the branches' own sway: per vertex, how far it flexes and its beat
  const sways = []
  // Every kink-to-kink stretch of the wood with its flex and beat at both
  // ends, and a grid of them, to find the wood nearest a point
  const stretches = []
  const grid = new Map()

  // Turn a direction a random amount around itself
  function kink(dir, amount) {
    const axis = perpendicular(dir).applyAxisAngle(dir, random() * Math.PI * 2)
    dir.applyAxisAngle(axis, (random() - 0.5) * amount)
  }

  // One branch: a crooked tube from start, tapering as it goes, segments
  // kinks long, every kink bent back towards the sky by upPull (down, when
  // it's negative). Grown from a parent, it starts as a collar as wide as
  // the parent there, heading half the parent's way, so it reads as one wood
  // instead of a stuck-in cylinder. from is how far along the wood from the
  // ground it starts. A branch that hangs swings in the wind from its start.
  // A thin one may take fewer sides than the rest. A trunk may flare at its
  // base, flare times wider again at the ground, easing back to its own
  // radius a little way up
  function branch(
    start,
    dir,
    length,
    radius,
    crookedness,
    { parent = null, from = 0, segments, taper, upPull, hangs = false, sides = params.sides, flare = 0 },
  ) {
    const points = [start]
    const radii = [parent ? parent.radius * COLLAR : radius]
    const d = parent ? parent.dir.clone().lerp(dir, 0.5).normalize() : dir.clone()
    for (let i = 1; i <= segments; i++) {
      if (parent && i === 2) d.copy(dir)
      kink(d, crookedness)
      d.addScaledVector(UP, upPull).normalize()
      points.push(points[i - 1].clone().addScaledVector(d, length / segments))
      radii.push(radius * (1 - (1 - taper) * (i / segments)))
    }
    const flareTo = flare > 0 ? Math.min((radius * FLARE_HEIGHT) / length, 0.5) : 0
    // Its flex and beat at each kink, carried on from the wood it grows
    // from, so where it joins it moves with it
    const joint = nearestWood(start, JOINT_REACH) ?? { flex: 0, phase: 0 }
    const flexes = [joint.flex]
    const phases = [joint.phase]
    const drift = PHASE_DRIFT * (0.5 + hashOf(start))
    for (let i = 1; i < points.length; i++) {
      const thickness = Math.max((radii[i - 1] + radii[i]) / 2, STIFF_RADIUS)
      flexes.push(flexes[i - 1] + points[i].distanceTo(points[i - 1]) / thickness)
      phases.push(joint.phase + (drift * i) / segments)
    }
    tube(points, radii, from, length, hangs ? start.y : undefined, sides, flare, flareTo, flexes, phases)
    for (let i = 1; i < points.length; i++) addStretch(points[i - 1], points[i], flexes[i - 1], flexes[i], phases[i - 1], phases[i])
    return { points, radii }
  }

  function addStretch(a, b, flexA, flexB, phaseA, phaseB) {
    const index = stretches.push({ a, b, flexA, flexB, phaseA, phaseB }) - 1
    const lo = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)].map((v) => Math.floor(v / CELL))
    const hi = [Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)].map((v) => Math.floor(v / CELL))
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = `${x},${y},${z}`
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(index)
        }
  }

  // The wood nearest a point, within reach: its flex and beat there, or
  // null if there's no wood that close
  const along = new THREE.Vector3()
  const closest = new THREE.Vector3()
  function nearestWood(point, reach) {
    let best = null
    let bestDistance = reach
    let bestT = 0
    const rings = Math.min(Math.ceil(reach / CELL), SEARCH_RINGS)
    const [cx, cy, cz] = [point.x, point.y, point.z].map((v) => Math.floor(v / CELL))
    const seen = new Set()
    for (let x = cx - rings; x <= cx + rings; x++)
      for (let y = cy - rings; y <= cy + rings; y++)
        for (let z = cz - rings; z <= cz + rings; z++) {
          for (const index of grid.get(`${x},${y},${z}`) ?? []) {
            if (seen.has(index)) continue
            seen.add(index)
            const stretch = stretches[index]
            along.subVectors(stretch.b, stretch.a)
            const t = THREE.MathUtils.clamp(along.dot(closest.subVectors(point, stretch.a)) / Math.max(along.lengthSq(), 1e-12), 0, 1)
            const distance = closest.copy(stretch.a).addScaledVector(along, t).distanceTo(point)
            if (distance < bestDistance) {
              best = stretch
              bestDistance = distance
              bestT = t
            }
          }
        }
    if (!best) return null
    return {
      flex: THREE.MathUtils.lerp(best.flexA, best.flexB, bestT),
      phase: THREE.MathUtils.lerp(best.phaseA, best.phaseB, bestT),
    }
  }

  function tube(kinks, kinkRadii, from, length, hangFrom, sides, flare, flareTo, kinkFlexes, kinkPhases) {
    // Subdivide: smoothness rings per kink, along a curve through the kinks,
    // so bends come out round without the branch changing shape. A flared
    // base takes rings of its own up to flareTo, the share of the way along
    // where it ends, so its curve reads at any smoothness
    const steps = (kinks.length - 1) * params.smoothness
    const curve = new THREE.CatmullRomCurve3(kinks, false, 'centripetal')
    const shares = []
    if (flareTo > 0) for (let i = 0; i < FLARE_RINGS; i++) shares.push((i / FLARE_RINGS) * flareTo)
    for (let i = 0; i <= steps; i++) if (i / steps >= flareTo) shares.push(i / steps)
    const points = []
    const radii = []
    const flexes = []
    const phases = []
    for (const share of shares) {
      points.push(curve.getPoint(share))
      const at = share * (kinks.length - 1)
      const k = Math.min(Math.floor(at), kinks.length - 2)
      const widen = share < flareTo ? 1 + flare * (1 - share / flareTo) ** 2 : 1
      radii.push(THREE.MathUtils.lerp(kinkRadii[k], kinkRadii[k + 1], at - k) * widen)
      flexes.push(THREE.MathUtils.lerp(kinkFlexes[k], kinkFlexes[k + 1], at - k))
      phases.push(THREE.MathUtils.lerp(kinkPhases[k], kinkPhases[k + 1], at - k))
    }

    const base = positions.length / 3
    const tangent = new THREE.Vector3()
    const normal = perpendicular(points[1].clone().sub(points[0]).normalize())
    const binormal = new THREE.Vector3()
    const v = new THREE.Vector3()
    const center = new THREE.Vector3()

    // A ring of vertices; bend tips its normals forward, for the cap
    function ring(radius, bend, birth, flex, phase) {
      for (let j = 0; j < sides; j++) {
        centers.push(center.x, center.y, center.z)
        roots.push(kinks[0].x, kinks[0].y, kinks[0].z)
        births.push(birth)
        lifts.push(liftBelow(hangFrom, center.y))
        sways.push(flex, phase)
        const angle = (j / sides) * Math.PI * 2
        v.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
        positions.push(center.x + v.x * radius, center.y + v.y * radius, center.z + v.z * radius)
        v.multiplyScalar(Math.cos(bend)).addScaledVector(tangent, Math.sin(bend))
        normals.push(v.x, v.y, v.z)
      }
    }

    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(i - 1, 0)]
      const b = points[Math.min(i + 1, points.length - 1)]
      tangent.subVectors(b, a).normalize()
      // Carry the previous ring's frame along, so the tube doesn't twist
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize()
      binormal.crossVectors(tangent, normal)
      center.copy(points[i])
      ring(radii[i], 0, from + shares[i] * length, flexes[i], phases[i])
    }

    // Close the tip with a rounded dome, shrinking rings down to a point
    const end = points[points.length - 1]
    const endRadius = radii[radii.length - 1]
    for (let k = 1; k <= CAP_RINGS; k++) {
      const bend = (k / CAP_RINGS) * (Math.PI / 2)
      center.copy(end).addScaledVector(tangent, endRadius * Math.sin(bend))
      ring(endRadius * Math.cos(bend), bend, from + length, flexes.at(-1), phases.at(-1))
    }

    for (let i = 0; i < points.length - 1 + CAP_RINGS; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * sides + j
        const b = base + i * sides + ((j + 1) % sides)
        indices.push(a, b, a + sides, b, b + sides, a + sides)
      }
    }
  }

  // The wood as one geometry, and how far along it the farthest tip is, so
  // a species can place its leaves' births on the same scale
  function build() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setIndex(indices)
    // For growing: distances along the wood, 0 at the ground to 1 at the
    // farthest tip
    const farthest = births.reduce((a, b) => Math.max(a, b), 1e-6)
    geometry.setAttribute('growCenter', new THREE.Float32BufferAttribute(centers, 3))
    geometry.setAttribute('growRoot', new THREE.Float32BufferAttribute(roots, 3))
    geometry.setAttribute('birth', new THREE.Float32BufferAttribute(births.map((b) => b / farthest), 1))
    // For the wind: the lift, and the branches' own sway, its flex from 0
    // at the ground to 1 at the most flexible tip. A leaf clump takes the
    // flex and beat of the wood nearest it, so it moves with its twig. With
    // no wood at all, as on a bush, each clump bobs on a beat of its own
    geometry.setAttribute('swayLift', new THREE.Float32BufferAttribute(lifts, 1))
    const most = sways.reduce((top, value, i) => (i % 2 === 0 ? Math.max(top, value) : top), 1e-6)
    geometry.setAttribute('swayDetail', new THREE.Float32BufferAttribute(sways.map((value, i) => (i % 2 === 0 ? value / most : value)), 2))
    geometry.userData.swayAt = (point) => {
      if (stretches.length === 0) return { flex: 1, phase: hashOf(point) * Math.PI * 2 }
      // Out a ring of cells at a time, most clumps being on their wood
      for (let rings = 1; rings <= SEARCH_RINGS; rings++) {
        const found = nearestWood(point, rings * CELL)
        if (found) return { flex: found.flex / most, phase: found.phase }
      }
      return { flex: 0, phase: 0 }
    }
    return { geometry, farthest }
  }

  return { branch, build }
}

// Where a branch is, which way it goes and how thick it is, a share of the
// way along its kinks, from 0 at its start to 1 at its end
export function alongBranch({ points, radii }, at) {
  const segments = points.length - 1
  const k = Math.min(Math.floor(at * segments), segments - 1)
  const f = at * segments - k
  const a = points[k]
  const b = points[k + 1]
  return {
    point: a.clone().lerp(b, f),
    dir: b.clone().sub(a).normalize(),
    radius: THREE.MathUtils.lerp(radii[k], radii[k + 1], f),
  }
}

// A direction from its compass bearing, around, and how far it rises off
// level, both in radians
export function heading(around, rise) {
  return new THREE.Vector3(Math.cos(around) * Math.cos(rise), Math.sin(rise), Math.sin(around) * Math.cos(rise))
}

// Lean a direction away from itself by angle, on the side given by around
export function splay(dir, around, angle) {
  const axis = perpendicular(dir).applyAxisAngle(dir, around)
  return dir.clone().applyAxisAngle(axis, angle)
}

// A number from 0 to 1 for a point, the same each time, drawn from no
// random, so it never moves the branches' draws
function hashOf(p) {
  const h = Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453
  return h - Math.floor(h)
}

function perpendicular(v) {
  const other = Math.abs(v.y) < 0.9 ? UP : SIDE
  return new THREE.Vector3().crossVectors(v, other).normalize()
}

// A tree's own character: how far its seed takes it from its species'
// average, drawn from a random of its own, so it never moves the branches'
// draws. vary(value, by) is value give or take by, as far as the variety
// takes it: always value at 0, anywhere in the range at 1. bearing() is a
// compass bearing, for a lean or the side a crown is heavier on
export function character(params) {
  const random = mulberry32(params.seed + 3571)
  return {
    vary: (value, by) => value + (random() * 2 - 1) * by * params.variety,
    bearing: () => random() * Math.PI * 2,
  }
}

// How much longer a branch heading around is on a crown heavier by heavy
// towards side: 1 + heavy facing it, 1 - heavy facing away
export function lopsided(around, side, heavy) {
  return 1 + heavy * Math.cos(around - side)
}

// Small seeded random, so a seed always gives the same tree
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

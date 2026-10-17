import * as THREE from 'three/webgpu'
import { liftBelow } from './wind.js'

// The wood every species is built from: crooked tubes, tapering as they go,
// with rounded tips and collars where they grow from another, and what the
// growing needs on each vertex. A species decides where the branches go

const CAP_RINGS = 3 // rings in the rounded dome closing each branch's tip
const COLLAR = 0.9 // a child's base radius / its parent's radius there

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
  // A thin one may take fewer sides than the rest
  function branch(
    start,
    dir,
    length,
    radius,
    crookedness,
    { parent = null, from = 0, segments, taper, upPull, hangs = false, sides = params.sides },
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
    tube(points, radii, from, length, hangs ? start.y : undefined, sides)
    return { points, radii }
  }

  function tube(kinks, kinkRadii, from, length, hangFrom, sides) {
    // Subdivide: smoothness rings per kink, along a curve through the kinks,
    // so bends come out round without the branch changing shape
    const steps = (kinks.length - 1) * params.smoothness
    const curve = new THREE.CatmullRomCurve3(kinks, false, 'centripetal')
    const points = []
    const radii = []
    for (let i = 0; i <= steps; i++) {
      points.push(curve.getPoint(i / steps))
      const at = (i / steps) * (kinks.length - 1)
      const k = Math.min(Math.floor(at), kinks.length - 2)
      radii.push(THREE.MathUtils.lerp(kinkRadii[k], kinkRadii[k + 1], at - k))
    }

    const base = positions.length / 3
    const tangent = new THREE.Vector3()
    const normal = perpendicular(points[1].clone().sub(points[0]).normalize())
    const binormal = new THREE.Vector3()
    const v = new THREE.Vector3()
    const center = new THREE.Vector3()

    // A ring of vertices; bend tips its normals forward, for the cap
    function ring(radius, bend, birth) {
      for (let j = 0; j < sides; j++) {
        centers.push(center.x, center.y, center.z)
        roots.push(kinks[0].x, kinks[0].y, kinks[0].z)
        births.push(birth)
        lifts.push(liftBelow(hangFrom, center.y))
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
      ring(radii[i], 0, from + (i / steps) * length)
    }

    // Close the tip with a rounded dome, shrinking rings down to a point
    const end = points[points.length - 1]
    const endRadius = radii[radii.length - 1]
    for (let k = 1; k <= CAP_RINGS; k++) {
      const bend = (k / CAP_RINGS) * (Math.PI / 2)
      center.copy(end).addScaledVector(tangent, endRadius * Math.sin(bend))
      ring(endRadius * Math.cos(bend), bend, from + length)
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
    // For the wind
    geometry.setAttribute('swayLift', new THREE.Float32BufferAttribute(lifts, 1))
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

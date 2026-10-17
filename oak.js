import * as THREE from 'three/webgpu'

// Fixed shape rules, tuned for an oak
const SEGMENTS = 4 // kinks per branch
const CAP_RINGS = 3 // rings in the rounded dome closing each branch's tip
const LENGTH_FALLOFF = 0.7 // child length / parent length
const THICKNESS_FALLOFF = 0.7 // child radius / parent radius where it grows
const TAPER = 0.6 // radius at a branch's end / at its start
const COLLAR = 0.9 // a child's base radius / its parent's radius there
const UP_PULL = 0.06 // how much every kink bends back towards the sky
const TIP_CLUMP = 0.6 // a branch tip's leaf clump radius / twig length

const UP = new THREE.Vector3(0, 1, 0)
const SIDE = new THREE.Vector3(1, 0, 0)

export function generateOak(params) {
  const random = mulberry32(params.seed)
  const positions = []
  const normals = []
  const indices = []
  // For growing: per vertex, its ring's centre, its branch's root, and
  // how far along the wood from the ground it is
  const centers = []
  const roots = []
  const births = []
  const twigs = [] // the last branches
  const boughs = [] // branches that carry others but end free, no child at their tip

  // Turn a direction a random amount around itself
  function kink(dir, amount) {
    const axis = perpendicular(dir).applyAxisAngle(dir, random() * Math.PI * 2)
    dir.applyAxisAngle(axis, (random() - 0.5) * amount)
  }

  // One branch: a crooked tube from start, tapering as it goes. Grown from a
  // parent, it starts as a collar as wide as the parent there, heading half
  // the parent's way, so it reads as one wood instead of a stuck-in cylinder
  function branch(start, dir, length, radius, crookedness, parent = null, from = 0) {
    const points = [start]
    const radii = [parent ? parent.radius * COLLAR : radius]
    const d = parent ? parent.dir.clone().lerp(dir, 0.5).normalize() : dir.clone()
    for (let i = 1; i <= SEGMENTS; i++) {
      if (parent && i === 2) d.copy(dir)
      kink(d, crookedness)
      d.addScaledVector(UP, UP_PULL).normalize()
      points.push(points[i - 1].clone().addScaledVector(d, length / SEGMENTS))
      radii.push(radius * (1 - (1 - TAPER) * (i / SEGMENTS)))
    }
    tube(points, radii, from, length)
    return { points, radii }
  }

  // A branch and everything that grows from it
  function grow(start, dir, length, radius, depth, parent, from) {
    const { points, radii } = branch(start, dir, length, radius, params.crookedness, parent, from)
    if (depth === 0) {
      twigs.push({ points, length, from })
      return
    }
    // A bough's end is a free tip unless a child grows from it
    let forked = false
    for (let c = 0; c < params.branches; c++) {
      // Children grow along the top half of their parent, not only at its tip
      const k = 2 + Math.floor(random() * (SEGMENTS - 1))
      if (k === SEGMENTS) forked = true
      const parentDir = points[k].clone().sub(points[k - 1]).normalize()
      const around = ((c + random() * 0.5) / params.branches) * Math.PI * 2
      const childDir = splay(parentDir, around, params.spread * (0.6 + random() * 0.6))
      const childLength = length * LENGTH_FALLOFF * (0.8 + random() * 0.4)
      grow(
        points[k],
        childDir,
        childLength,
        radii[k] * THICKNESS_FALLOFF,
        depth - 1,
        { dir: parentDir, radius: radii[k] },
        from + (k / SEGMENTS) * length,
      )
    }
    if (!forked) boughs.push({ points, length, from })
  }

  function tube(kinks, kinkRadii, from, length) {
    // Subdivide: smoothness rings per kink, along a curve through the kinks,
    // so bends come out round without the branch changing shape
    const sides = params.sides
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

  // A short, thick trunk that splits low into a few heavy limbs
  const trunkLength = params.size * params.splitHeight
  const trunk = branch(new THREE.Vector3(), UP, trunkLength, params.trunkThickness, params.crookedness * 0.3)
  const top = trunk.points[SEGMENTS]
  const topDir = top.clone().sub(trunk.points[SEGMENTS - 1]).normalize()
  for (let l = 0; l < params.mainLimbs; l++) {
    const around = ((l + random() * 0.5) / params.mainLimbs) * Math.PI * 2
    const dir = splay(topDir, around, params.spread * (0.8 + random() * 0.4))
    const length = params.size * (1 - params.splitHeight) * (0.7 + random() * 0.2)
    grow(
      top,
      dir,
      length,
      trunk.radii[SEGMENTS] * 0.75,
      params.levels,
      { dir: topDir, radius: trunk.radii[SEGMENTS] },
      trunkLength,
    )
  }

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

  // Leaf clumps: exactly one on every free branch tip, none at forks where a
  // child grows from the end, none anywhere else. A twig's is sized by the
  // twig, a bough's like the twigs it would carry; clump size grows them all.
  // They draw from their own random, so clump size never reshapes the
  // branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  const tips = [
    ...twigs.map((twig) => ({ points: twig.points, scale: twig.length, end: twig.from + twig.length })),
    ...boughs.map((bough) => ({ points: bough.points, scale: bough.length * LENGTH_FALLOFF, end: bough.from + bough.length })),
  ]
  for (const { points, scale, end } of tips) {
    const radius = scale * TIP_CLUMP * (0.8 + leafRandom() * 0.4) * params.clumpSize
    clumps.push({ position: points[SEGMENTS], radius, birth: end / farthest })
  }

  return { geometry, clumps }
}

// Lean a direction away from itself by angle, on the side given by around
function splay(dir, around, angle) {
  const axis = perpendicular(dir).applyAxisAngle(dir, around)
  return dir.clone().applyAxisAngle(axis, angle)
}

function perpendicular(v) {
  const other = Math.abs(v.y) < 0.9 ? UP : SIDE
  return new THREE.Vector3().crossVectors(v, other).normalize()
}

// Small seeded random, so a seed always gives the same oak
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

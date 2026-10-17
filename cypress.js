import * as THREE from 'three/webgpu'
import { alongBranch, createWood, mulberry32, UP } from './wood.js'

// Fixed shape rules, tuned for an Italian cypress: a tall, narrow flame. One
// straight trunk, with short branches all the way up it climbing steeply
// along it, one after the next round a spiral. The crown is widest a third
// of the way up and closes to a point at the top, its leaf clumps packed
// tight against the trunk

const HEIGHT = 1.32 // the tree's height / size
const TRUNK_SEGMENTS = 14 // kinks up the trunk
const TRUNK_TAPER = 0.1 // the trunk's radius at its top / at the ground
const TRUNK_PULL = 0.5 // how hard the trunk keeps to the sky
const BARE = 0.05 // how far up the trunk, of the height, the lowest branch is
const TOP = 0.95 // and the highest
const WIDEST = 0.3 // where the crown is widest, of the height
const BASE_WIDTH = 0.65 // the crown's width at the lowest branch / at its widest
const WIDTH = 0.11 // the crown's half width at its widest / the height, at slenderness 1
const BRANCH_SEGMENTS = 3 // kinks per branch
const BRANCH_TAPER = 0.4 // a branch's radius at its end / at its start
const BRANCH_THICKNESS = 0.35 // a branch's radius / the trunk's where it grows
const RISE = 1.05 // how steeply a branch climbs off level, in radians
const DROOP = 0.12 // how far each kink bends a branch down, at droop 1: below 0, up
const PAD = 0.6 // a clump's radius / the crown's half width there
const CORES = 16 // clumps stacked up the trunk, filling the crown's middle
const SMALLEST = 0.03 // the smallest clump's radius / the height
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function generateCypress(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  const height = params.size * HEIGHT

  // The crown's half width a share of the way up the tree: from the lowest
  // branch it widens to a third of the way up, then closes to nothing at
  // the top
  const halfWidth = (at) => {
    const shape =
      at < WIDEST
        ? THREE.MathUtils.lerp(BASE_WIDTH, 1, Math.max(at - BARE, 0) / (WIDEST - BARE))
        : 1 - Math.pow((at - WIDEST) / (1 - WIDEST), 1.6)
    return (height * WIDTH * Math.max(shape, 0)) / params.slenderness
  }

  // The trunk, straight
  const trunk = wood.branch(new THREE.Vector3(), UP, height, params.trunkThickness, params.crookedness * 0.2, {
    segments: TRUNK_SEGMENTS,
    taper: TRUNK_TAPER,
    upPull: TRUNK_PULL,
  })

  // The branches, from the bottom up, each turned on from the last by the
  // golden angle, so they spread evenly round the trunk. Each is as long as
  // it takes to reach the crown's edge there, climbing as it goes
  const branches = []
  const count = params.cypressBranches
  for (let i = 0; i < count; i++) {
    const at = THREE.MathUtils.lerp(BARE, TOP, (i + random() * 0.6) / count)
    const { point, dir: trunkDir, radius: trunkRadius } = alongBranch(trunk, at)
    const around = i * GOLDEN_ANGLE + (random() - 0.5) * 0.4
    const rise = RISE + (random() - 0.5) * 0.2
    const dir = new THREE.Vector3(Math.cos(around) * Math.cos(rise), Math.sin(rise), Math.sin(around) * Math.cos(rise))
    const length = Math.max((halfWidth(at) / Math.cos(rise)) * (0.8 + random() * 0.3), height * SMALLEST * 2)
    const from = at * height
    const { points } = wood.branch(point, dir, length, trunkRadius * BRANCH_THICKNESS, params.crookedness * 0.4, {
      parent: { dir: trunkDir, radius: trunkRadius },
      from,
      segments: BRANCH_SEGMENTS,
      taper: BRANCH_TAPER,
      upPull: -params.droop * DROOP,
    })
    branches.push({ points, length, from, at })
  }

  const { geometry, farthest } = wood.build()

  // Leaf clumps along each branch, sized to the crown's width where they
  // are, and a stack of them up the trunk filling its middle, up to the
  // trunk's tip. None smaller than a small tuft. Clump size grows them all.
  // They draw from their own random, so clump size never reshapes the
  // branches
  const leafRandom = mulberry32(params.seed + 7919)
  const tuft = height * SMALLEST
  const clumps = []
  for (const { points, length, from } of branches) {
    for (let k = 1; k <= BRANCH_SEGMENTS; k++) {
      const along = k / BRANCH_SEGMENTS
      const position = points[k].clone()
      const radius = Math.max(halfWidth(position.y / height) * PAD, tuft) * (0.85 + leafRandom() * 0.3)
      clumps.push({ position, radius: radius * params.clumpSize, birth: (from + along * length) / farthest })
    }
  }
  for (let s = 0; s <= CORES; s++) {
    const at = THREE.MathUtils.lerp(BARE, 0.999, s / CORES)
    const radius = Math.max(halfWidth(at) * PAD * 1.2, tuft)
    clumps.push({ position: alongBranch(trunk, at).point, radius: radius * params.clumpSize, birth: (at * height) / farthest })
  }

  return { geometry, clumps }
}

import * as THREE from 'three/webgpu'
import { alongBranch, createWood, mulberry32, UP } from './wood.js'

// Fixed shape rules, tuned for a fir: one straight trunk tapering to a
// point, ringed by whorls of branches, long at the bottom and short at the
// top, so the crown is a cone. Each branch sweeps out and droops, and
// carries a few flat pads of leaves out along it, none crowding the trunk

const HEIGHT = 1.3 // the tree's height / size
const TRUNK_SEGMENTS = 12 // kinks up the trunk
const TRUNK_TAPER = 0.08 // the trunk's radius at its top / at the ground
const TRUNK_PULL = 0.4 // how hard the trunk keeps to the sky
const BARE = 0.16 // how far up the trunk, of the height, the lowest whorl is
const TOP = 0.93 // and the highest
const BRANCH_SEGMENTS = 5 // kinks per branch
const BRANCH_TAPER = 0.35 // a branch's radius at its end / at its start
const BRANCH_THICKNESS = 0.45 // a branch's radius / the trunk's where it grows
const REACH = 0.34 // the lowest branches' length / the height
const SHORTEST = 0.18 // the highest branches' length / the lowest's
const DROOP = 0.12 // how far each kink bends down, at droop 1
const PADS = [0.4, 0.7, 1] // where a branch's clumps sit, along it from the trunk
const PAD = 0.18 // a clump's radius / its branch's length, at the first
const FLATTEN = 0.45 // a branch's clumps' height / their width: flat pads, layered
const SMALLEST = 0.03 // the smallest clump's radius / the height
const CORE = 0.3 // the clump hugging the trunk at a whorl's radius / the whorl's reach
const CORE_LARGEST = 0.05 // and at most / the height
const CORES_FROM = 0.45 // how far up the whorls, of them all, the trunk gets clumps
const LEADER = 0.045 // the lowest clump's radius on the leader, the trunk's bare top / the height
const LEADER_CLUMPS = 4 // clumps up the leader, shrinking to its tip
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function generatePine(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  const height = params.size * HEIGHT

  // The trunk, nearly straight
  const trunk = wood.branch(new THREE.Vector3(), UP, height, params.trunkThickness, params.crookedness * 0.3, {
    segments: TRUNK_SEGMENTS,
    taper: TRUNK_TAPER,
    upPull: TRUNK_PULL,
  })
  const onTrunk = (at) => alongBranch(trunk, at)

  // The whorls, from the bottom up, each turned on from the one below so
  // the branches never stack. Branches lower down reach out level and
  // droop; higher up they're shorter and point more to the sky
  const branches = []
  const cores = [] // where each whorl meets the trunk
  const whorls = params.whorls
  for (let w = 0; w < whorls; w++) {
    const t = whorls > 1 ? w / (whorls - 1) : 0
    const at = THREE.MathUtils.lerp(BARE, TOP, t) + (random() - 0.5) * (0.4 / whorls)
    const { point, dir: trunkDir, radius: trunkRadius } = onTrunk(at)
    const reach = height * REACH * THREE.MathUtils.lerp(1, SHORTEST, t)
    if (t >= CORES_FROM) cores.push({ position: point, radius: Math.min(reach * CORE, height * CORE_LARGEST), from: at * height })
    for (let b = 0; b < params.whorlBranches; b++) {
      const around = ((b + (random() - 0.5) * 0.5) / params.whorlBranches) * Math.PI * 2 + w * GOLDEN_ANGLE
      const rise = THREE.MathUtils.lerp(0.05, 0.6, t) + (random() - 0.5) * 0.2
      const dir = new THREE.Vector3(Math.cos(around) * Math.cos(rise), Math.sin(rise), Math.sin(around) * Math.cos(rise))
      const length = reach * (0.85 + random() * 0.3)
      const from = at * height
      const shape = wood.branch(point, dir, length, trunkRadius * BRANCH_THICKNESS, params.crookedness * 0.5, {
        parent: { dir: trunkDir, radius: trunkRadius },
        from,
        segments: BRANCH_SEGMENTS,
        taper: BRANCH_TAPER,
        upPull: -params.droop * DROOP,
      })
      branches.push({ shape, length, from })
    }
  }

  const { geometry, farthest } = wood.build()

  // Flat pads of leaves out along each branch, shrinking towards its tip; one
  // hugging the trunk at each of the upper whorls, where their short
  // branches would leave bare wood between them; and a few up the leader
  // above the highest whorl, shrinking to a point. None smaller than a small
  // tuft. Clump size grows them all. They draw from their own random, so
  // clump size never reshapes the branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  const tuft = height * SMALLEST
  for (const { shape, length, from } of branches) {
    for (const along of PADS) {
      const radius = Math.max(length * PAD * (1.2 - 0.5 * along), tuft) * (0.85 + leafRandom() * 0.3) * params.clumpSize
      const birth = (from + along * length) / farthest
      clumps.push({ position: alongBranch(shape, Math.min(along, 0.999)).point, radius, flatten: FLATTEN, birth })
    }
  }
  for (const { position, radius, from } of cores) {
    clumps.push({ position, radius: Math.max(radius, tuft) * params.clumpSize, birth: from / farthest })
  }
  for (let s = 0; s < LEADER_CLUMPS; s++) {
    const at = THREE.MathUtils.lerp(TOP, 1, s / (LEADER_CLUMPS - 1))
    const radius = height * LEADER * (1 - (0.7 * s) / LEADER_CLUMPS) * params.clumpSize
    clumps.push({ position: onTrunk(Math.min(at, 0.999)).point, radius, birth: (at * height) / farthest })
  }

  return { geometry, clumps }
}

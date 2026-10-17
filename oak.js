import * as THREE from 'three/webgpu'
import { createWood, mulberry32, splay, UP } from './wood.js'

// Fixed shape rules, tuned for an oak
const SEGMENTS = 4 // kinks per branch
const LENGTH_FALLOFF = 0.7 // child length / parent length
const THICKNESS_FALLOFF = 0.7 // child radius / parent radius where it grows
const TAPER = 0.6 // radius at a branch's end / at its start
const UP_PULL = 0.06 // how much every kink bends back towards the sky
const TIP_CLUMP = 0.6 // a branch tip's leaf clump radius / twig length

const SHAPE = { segments: SEGMENTS, taper: TAPER, upPull: UP_PULL }

// The oak, a short trunk splitting low into limbs that branch again. Its
// settings are the ones every species starts from, so it has none of its own
export const oak = {
  name: 'oak',
  // A round crown of three puffs on a short trunk
  icon:
    '<rect x="10.8" y="13" width="2.4" height="9" rx="0.8"/>' +
    '<circle cx="12" cy="8" r="6"/><circle cx="7" cy="11.5" r="4"/><circle cx="17" cy="11.5" r="4"/>',
  sliders: ['mainLimbs', 'levels', 'branches', 'spread', 'splitHeight'],
  settings: {},
  grow,
}

function grow(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  const twigs = [] // the last branches
  const freeTipped = [] // branches that carry others but end in a free tip, no child there

  // A branch and everything that grows from it
  function grow(start, dir, length, radius, depth, parent, from) {
    const { points, radii } = wood.branch(start, dir, length, radius, params.crookedness, { ...SHAPE, parent, from })
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
    if (!forked) freeTipped.push({ points, length, from })
  }

  // A short, thick trunk that splits low into a few heavy limbs
  const trunkLength = params.size * params.splitHeight
  const trunk = wood.branch(new THREE.Vector3(), UP, trunkLength, params.trunkThickness, params.crookedness * 0.3, SHAPE)
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

  const { geometry, farthest } = wood.build()

  // Leaf clumps: exactly one on every free branch tip, none at forks where a
  // child grows from the end, none anywhere else. A twig's is sized by the
  // twig, another branch's like the twigs it would carry; clump size grows
  // them all.
  // They draw from their own random, so clump size never reshapes the
  // branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  const tips = [
    ...twigs.map((twig) => ({ points: twig.points, scale: twig.length, end: twig.from + twig.length })),
    ...freeTipped.map((branch) => ({ points: branch.points, scale: branch.length * LENGTH_FALLOFF, end: branch.from + branch.length })),
  ]
  for (const { points, scale, end } of tips) {
    const radius = scale * TIP_CLUMP * (0.8 + leafRandom() * 0.4) * params.clumpSize
    clumps.push({ position: points[SEGMENTS], radius, birth: end / farthest })
  }

  return { geometry, clumps }
}

import * as THREE from 'three/webgpu'

// Levels of detail for the GLB: the tree as it is, then lighter copies of
// it for farther away, each grown again from the same seed, so the wood
// keeps its shape and the leaves their places. A lighter level has fewer
// sides round each branch and rings along it, flat tips, and leaves out
// the thinnest branches and the twigs. Its leaves are fewer, bigger cards,
// cut into fewer squares, on the same clumps, or on fewer, bigger clumps,
// each pair of neighbours merged into one, as many times over as merges
// says. The impostor may come after the last, as glb.js writes it.
//
// Each level is shown down to coverage, the share of the screen's height
// the sphere round the tree takes. These are the levels a page starts with:
// the panel's LOD preview (lod-preview.js) edits them in place, and the
// export reads them as it runs

export const LEVELS = [
  { coverage: 0.5 }, // the tree as it is
  { coverage: 0.25, sides: 0.6, rings: 1, cut: 0.05, caps: 1, cards: 0.5, grow: 0.5, segments: 2, merges: 0, fill: 0.5 },
  { coverage: 0.12, sides: 0.4, rings: 2, cut: 0.12, caps: 1, cards: 0.3, grow: 0.5, segments: 1, merges: 0, fill: 0.5 },
  { coverage: 0.05, sides: 0.3, rings: 2, cut: 0.25, caps: 1, cards: 0.2, grow: 0.5, segments: 1, merges: 1, fill: 0.3 },
]
export const IMPOSTOR = { coverage: 0.01 } // the impostor's level, below which the tree isn't drawn at all
const FEWEST_SIDES = 3 // round a branch, at any level
const MERGE_REACH = 1.5 // how far apart two clumps may be and still merge, the gap between them / the bigger's radius

// Whether a level is the tree as it is
export const isFull = (level) => !level.sides

// The settings a level's wood grows from
export function woodParams(params, level) {
  if (isFull(level)) return params
  return {
    ...params,
    sides: Math.max(FEWEST_SIDES, Math.round(params.sides * level.sides)),
    ringStep: level.rings,
    thinnest: level.cut,
    capRings: level.caps,
  }
}

// The settings a level's cards are scattered with: a share of them, grown
// by (all / kept) to the power grow, 0.5 covering the same area
export function leafParams(params, level) {
  if (isFull(level)) return params
  const cardsPerClump = Math.max(1, Math.round(params.cardsPerClump * level.cards))
  return { ...params, cardsPerClump, cardGrowth: (params.cardsPerClump / cardsPerClump) ** level.grow }
}

// The clumps a level's cards go on: the tree's own, or as many times over
// as merges, each clump merged with its nearest neighbour, the biggest
// first. One with no neighbour near enough stays as it is. A merged clump
// grows from keeping its pair's volume, at fill 0, to wrapping round them
// both, at 1
export function mergedClumps(clumps, level) {
  let merged = clumps
  for (let i = 0; i < (level.merges ?? 0); i++) merged = pairUp(merged, level.fill)
  return merged
}

function pairUp(clumps, fill) {
  const size = (c) => c.fullRadius ?? c.radius
  const order = clumps.map((_, i) => i).sort((a, b) => size(clumps[b]) - size(clumps[a]))
  const taken = new Uint8Array(clumps.length)
  const paired = []
  for (const i of order) {
    if (taken[i]) continue
    taken[i] = 1
    const a = clumps[i]
    let nearest = -1
    let nearestGap = MERGE_REACH * size(a)
    for (let j = 0; j < clumps.length; j++) {
      if (taken[j]) continue
      const b = clumps[j]
      const gap = a.position.distanceTo(b.position) - size(a) - size(b)
      if (gap < nearestGap) {
        nearest = j
        nearestGap = gap
      }
    }
    if (nearest < 0) {
      paired.push(a)
      continue
    }
    taken[nearest] = 1
    paired.push(merge(a, clumps[nearest], fill))
  }
  return paired
}

// Two clumps as one, at their centre by volume, between as big as keeps
// their volume and as big as wraps round them both. It hangs if either
// does, from the higher, and swings with the bigger
function merge(a, b, fill) {
  const full = (c) => c.fullRadius ?? c.radius
  const [va, vb] = [full(a) ** 3, full(b) ** 3]
  const share = vb / Math.max(va + vb, 1e-12)
  const position = a.position.clone().lerp(b.position, share)
  const grow = (ra, rb) => {
    const keeping = Math.cbrt(ra ** 3 + rb ** 3)
    const wrapping = Math.max(position.distanceTo(a.position) + ra, position.distanceTo(b.position) + rb)
    return THREE.MathUtils.lerp(keeping, wrapping, fill)
  }
  const hangs = [a.hangFrom, b.hangFrom].filter((h) => h !== undefined)
  const bigger = share > 0.5 ? b : a
  return {
    position,
    radius: grow(a.radius, b.radius),
    fullRadius: grow(full(a), full(b)),
    birth: Math.min(a.birth, b.birth),
    flatten: THREE.MathUtils.lerp(a.flatten ?? 1, b.flatten ?? 1, share),
    hangFrom: hangs.length ? Math.max(...hangs) : undefined,
    foot: a.foot && b.foot ? a.foot.clone().lerp(b.foot, share) : bigger.foot,
    swing: bigger.swing,
  }
}

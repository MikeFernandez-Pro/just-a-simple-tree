import * as THREE from 'three/webgpu'

// A tree's age, 0 to 1: a sapling, a stem and a few short limbs; at MATURE
// the tree as its settings grow it; then old, stout and gnarled. A young
// tree has grown only part of the way out along its grown tree's branches:
// each sprouts once the tree's growth reaches where it leaves its parent,
// and lengthens and thickens from there (wood.js), so the side branches and
// twigs come in as it ages. Each leaf clump grows from nothing as the
// growth nears it, riding the tip of its branch out. The branches always
// draw the same randoms and the species always makes the same clumps, so
// the same seed grows the same tree at every age, and a small step in age
// only ever makes a small change: dragging the age watches it grow

export const MATURE = 0.6 // the age at which a tree is just as its settings grow it

// At the ages in AGES, on a smooth curve through them: how far the tree has
// grown out along its branches, as a share of the way to its farthest tip,
// and each setting times these. On top of the growth, height shoots up
// while the tree is young and levels off; the trunk keeps thickening all
// its life, its foot spreading; a young tree stands on a longer stem for
// its height, with smaller clumps; an old one spreads wider and kinks more
const AGES = [0, 0.15, 0.35, MATURE, 1]
const FRONT = [0.3, 0.45, 0.72, 1, 1]
const BY_AGE = {
  size: [0.5, 0.65, 0.85, 1, 1.1],
  trunkThickness: [0.45, 0.55, 0.75, 1, 1.5],
  baseFlare: [0.15, 0.35, 0.7, 1, 1.45],
  trunkHeight: [0.5, 0.65, 0.85, 1, 1.1], // bare trunk, in metres, so it shrinks with the height
  splitHeight: [1.45, 1.3, 1.1, 1, 0.92],
  spread: [0.85, 0.9, 0.95, 1, 1.12],
  crookedness: [0.6, 0.72, 0.86, 1, 1.5],
  clumpSize: [0.8, 0.85, 0.93, 1, 0.94],
}
const CLUMP_GROWS = 0.2 // how far ahead of a clump the growth is when it starts growing / its farthest tip's distance

// The value at an age of a curve through values at AGES: monotone cubic,
// so it never overshoots between them, and its pace changes smoothly,
// never stopping at an age in AGES. At an age in AGES it's that value
// exactly, so a tree at MATURE gets exactly its own settings
function curve(values, age) {
  const n = AGES.length
  const step = (i) => (values[i + 1] - values[i]) / (AGES[i + 1] - AGES[i])
  // Each value's slope: its neighbours' steps' harmonic mean, none at a
  // peak or a level, keeping the curve between the values
  const slope = (i) => {
    if (i === 0) return step(0)
    if (i === n - 1) return step(n - 2)
    const [a, b] = [step(i - 1), step(i)]
    return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b)
  }
  let k = 0
  while (k < n - 2 && age > AGES[k + 1]) k++
  const h = AGES[k + 1] - AGES[k]
  const t = (age - AGES[k]) / h
  const [t2, t3] = [t * t, t * t * t]
  return (
    (2 * t3 - 3 * t2 + 1) * values[k] +
    (t3 - 2 * t2 + t) * h * slope(k) +
    (3 * t2 - 2 * t3) * values[k + 1] +
    (t3 - t2) * h * slope(k + 1)
  )
}

// The settings a tree grows from at its age: the page's own, with those
// above scaled for it, and front, how far it has grown
export function aged(params) {
  const age = THREE.MathUtils.clamp(params.treeAge, 0, 1)
  const grown = { ...params, front: curve(FRONT, age) }
  for (const [key, factors] of Object.entries(BY_AGE)) grown[key] = params[key] * curve(factors, age)
  return grown
}

// A species' tree at the age params give. A young one is grown twice: full
// grown first, to know how far its farthest tip reaches and where each
// clump is on it, then only as far as its age has taken it. Each clump
// keeps its full grown radius and birth, and has grown, how much of it has
// grown so far: none until the growth is near it, all once the growth has
// reached it. A clump of a branch not yet sprouted waits at its bud
export function growAged(species, params) {
  const settings = aged(params)
  if (settings.front >= 1) return species.grow(settings)
  // Only measured, not built, as it's never shown
  const full = species.grow({ ...settings, measuring: true })
  const reach = full.geometry.userData.farthest
  const young = species.grow({ ...settings, reach })
  const front = settings.front * reach
  young.clumps.forEach((clump, i) => {
    const { radius, birth } = full.clumps[i]
    const at = birth * reach
    Object.assign(clump, { radius, birth, grown: THREE.MathUtils.smoothstep(front, at - CLUMP_GROWS * reach, at) })
  })
  return young
}

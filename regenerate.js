import { attribute, float, Fn, mix, positionGeometry, uniform } from 'three/tsl'

// A new tree, with a burst: the old leaves blow away on the wind while the
// wood folds back into the ground, then the new tree grows out from the
// trunk to the tips, its leaves popping in last. Falling leaves stop leaving
// the old tree, and start again from the new one once it has grown

// 0 bare ground, 1 fully grown
export const growth = uniform(1)
// 0 leaves on the tree, 1 blown away
export const burst = uniform(0)

const UNFOLD = 0.25 // how much of the growth each ring takes to unfold

// How far along its own growth a point of the wood is, eased
function grownBy(birth) {
  const k = growth.mul(1 + UNFOLD).sub(birth).div(UNFOLD).clamp(0, 1)
  return k.mul(k).mul(float(3).sub(k.mul(2)))
}

// The wood: each ring slides out from its branch's root to its place, and
// widens as it goes
export const grownWood = Fn(() => {
  const center = attribute('growCenter', 'vec3')
  const root = attribute('growRoot', 'vec3')
  const k = grownBy(attribute('birth', 'float'))
  return mix(root, center, k).add(positionGeometry.sub(center).mul(k))
})

// A leaf card's size: none until its branch has arrived, then a quick pop
// with a little overshoot, each card on its own beat
export function grownLeaf(birth, jitter) {
  const t = growth
    .mul(1 + UNFOLD)
    .sub(birth.add(UNFOLD * 0.6).add(jitter.mul(0.08)))
    .div(0.12)
    .clamp(0, 1)
  const s = t.sub(1)
  return float(1).add(s.mul(s).mul(s.mul(2.70158).add(1.70158)))
}

const easeIn = (t) => t ** 3
const easeOut = (t) => 1 - (1 - t) ** 3

export function createRegenerate({ setSeed, falling }) {
  let busy = false

  function tween(seconds, onUpdate) {
    return new Promise((resolve) => {
      const start = performance.now()
      const frame = (now) => {
        const t = Math.min((now - start) / 1000 / seconds, 1)
        onUpdate(t)
        if (t < 1) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
  }

  async function regenerate() {
    if (busy) return
    busy = true
    falling.uniforms.spawning.value = 0

    // The leaves blow away; half a second in, the wood starts folding back
    const blow = tween(1.6, (t) => (burst.value = easeOut(t)))
    await tween(0.5, () => {})
    await tween(1.1, (t) => (growth.value = 1 - easeIn(t)))
    await blow

    // Nothing of the old tree shows: swap in the new one, and grow it
    await setSeed(1 + Math.floor(Math.random() * 9999))
    burst.value = 0
    await tween(3.2, (t) => (growth.value = easeOut(t)))

    falling.uniforms.spawning.value = 1
    busy = false
  }

  return { regenerate }
}

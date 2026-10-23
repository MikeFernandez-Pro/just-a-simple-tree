import { attribute, cos, float, floor, mx_noise_float, mx_noise_vec3, sin, time, uniform, vec2, vec3 } from 'three/tsl'

// Wind as the tutorial's Blender wind node moves the tree: a large sway of the
// branches and a small flutter of each leaf card, both driven by noise. On
// top, each branch swings on its own, more the thinner and farther out it
// is, out of step with its neighbours

export const wind = {
  strength: uniform(0.22), // how far the tree top sways, in metres
  speed: uniform(0.83), // how fast gusts travel through the tree
  frequency: uniform(0.05), // 1 / the gusts' size in metres: higher, smaller gusts and more of them
  direction: uniform(-Math.PI), // where the wind blows towards, round the trunk
  flutter: uniform(0.25), // how far each card rocks, in radians
  height: uniform(5), // the tree's height, so the sway grows towards the top
  gust: uniform(0), // a gust on top while the camera shakes: 1 blows twice as hard
  branches: uniform(0.6), // how far the most flexible tip swings on its own / the sway's strength
}

// A branch's swing: mostly along the wind and back, some across it and a
// little up and down, each at its own rate, so it never quite repeats
const SWING = [0.42, 0.31, 0.57] // swings a second: along the wind, across it, up and down
const SWING_SIZE = [0.6, 0.45, 0.2] // of the swing, each way
const ALONG_BIAS = 0.4 // of the swing, how far it leans downwind on average

// How far below where it hangs from a point is: the lift sway takes for it.
// Nothing for what doesn't hang
export function liftBelow(hangFrom, y) {
  return hangFrom === undefined ? 0 : Math.max(hangFrom - y, 0)
}

// How hard it blows now, the gust included
export const blowing = wind.strength.mul(wind.gust.add(1))

// Which way it blows, level
export const downwind = vec3(cos(wind.direction), 0, sin(wind.direction))

// The sway at a point: a noise field drifting downwind pushes it along the
// wind, with a little turbulence, more the higher up it is. How far down the
// bend reaches follows the strength: a breeze moves only the crown (height
// squared), a gale bends the whole tree from the ground (height alone). The
// root never moves. Lift raises the height it sways as: what hangs swings
// as though it stood as high above where it hangs from as it falls below.
// Swing is the branch's own, as flex, 0 to 1, and its beat (wood.js): a
// point swings as far as it flexes, harder in a gust, and the wood flexes
// and beats the same where a branch joins its parent, so the two stay
// joined. The beat only ever adds to an angle, so it may wrap round
export function sway(position, lift = float(0), swing = vec2(0)) {
  const drift = position.mul(wind.frequency).sub(downwind.mul(time.mul(wind.speed)))
  const gust = mx_noise_float(drift).add(0.6)
  const turbulence = mx_noise_vec3(drift.add(17.3)).mul(0.35)
  const reach = float(2).sub(blowing.clamp(0, 1))
  const bend = position.y.add(lift).div(wind.height).max(0).pow(reach)
  const across = vec3(downwind.z.negate(), 0, downwind.x)
  const beat = (i) => sin(time.mul(SWING[i] * Math.PI * 2).add(swing.y).add(i * 2.1)).mul(SWING_SIZE[i])
  const own = downwind
    .mul(beat(0).add(ALONG_BIAS))
    .add(across.mul(beat(1)))
    .add(vec3(0, beat(2), 0))
    .mul(swing.x.mul(gust).mul(blowing).mul(wind.branches))
  return downwind.mul(gust).add(turbulence).mul(bend.mul(blowing)).add(own)
}

// A point of the wood where it sways to, its lift and swing from the wood's
// own vertices
export function swayedWood(position) {
  return position.add(sway(position, attribute('swayLift', 'float'), attribute('swayDetail', 'vec2')))
}

// A swing's flex, 0 to 1, and its beat, wrapped round, packed into one
// number for a leaf card, ten bits each, which a float keeps exactly, and
// unpacked again in the shader
const PACK = 1024
export function packSwing({ flex, phase }) {
  const turn = (((phase / (Math.PI * 2)) % 1) + 1) % 1
  return Math.round(Math.min(Math.max(flex, 0), 1) * (PACK - 1)) * PACK + Math.round(turn * (PACK - 1))
}
export function unpackSwing(packed) {
  const whole = floor(packed.div(PACK))
  return vec2(whole.div(PACK - 1), packed.sub(whole.mul(PACK)).div(PACK - 1).mul(Math.PI * 2))
}

// A card's flutter: two small angles rocking out of phase with its
// neighbours, stronger when a gust passes
export function flutter(position, phase) {
  const t = time.mul(wind.speed).mul(6).add(phase)
  const gust = mx_noise_float(position.mul(wind.frequency).sub(time.mul(wind.speed))).add(1)
  return vec3(sin(t), sin(t.mul(1.3).add(1.7)), float(0)).mul(wind.flutter.mul(gust).mul(wind.gust.add(1)))
}

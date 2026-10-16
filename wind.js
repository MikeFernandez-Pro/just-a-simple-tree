import { cos, float, mx_noise_float, mx_noise_vec3, sin, time, uniform, vec3 } from 'three/tsl'

// Wind as the tutorial's Blender wind node moves the tree: a large sway of the
// branches and a small flutter of each leaf card, both driven by noise

export const wind = {
  strength: uniform(0.3), // how far the tree top sways, in metres
  speed: uniform(0.6), // how fast gusts travel through the tree
  frequency: uniform(0.25), // how small the gusts are: higher, more of them
  direction: uniform(-2.19159265358979), // where the wind blows towards, round the trunk
  flutter: uniform(0.3), // how far each card rocks, in radians
  height: uniform(5), // the tree's height, so the sway grows towards the top
}

// The sway at a point: a noise field drifting downwind pushes it along the
// wind, with a little turbulence, more the higher up it is. How far down the
// bend reaches follows the strength: a breeze moves only the crown (height
// squared), a gale bends the whole tree from the ground (height alone). The
// root never moves
export function sway(position) {
  const downwind = vec3(cos(wind.direction), 0, sin(wind.direction))
  const drift = position.mul(wind.frequency).sub(downwind.mul(time.mul(wind.speed)))
  const gust = mx_noise_float(drift).add(0.6)
  const turbulence = mx_noise_vec3(drift.add(17.3)).mul(0.35)
  const reach = float(2).sub(wind.strength.clamp(0, 1))
  const bend = position.y.div(wind.height).max(0).pow(reach)
  return downwind.mul(gust).add(turbulence).mul(bend.mul(wind.strength))
}

// A card's flutter: two small angles rocking out of phase with its
// neighbours, stronger when a gust passes
export function flutter(position, phase) {
  const t = time.mul(wind.speed).mul(6).add(phase)
  const gust = mx_noise_float(position.mul(wind.frequency).sub(time.mul(wind.speed))).add(1)
  return vec3(sin(t), sin(t.mul(1.3).add(1.7)), float(0)).mul(wind.flutter.mul(gust))
}

import { cos, float, mx_noise_float, mx_noise_vec3, sin, time, uniform, vec3 } from 'three/tsl'

// Wind as the tutorial's Blender wind node moves the tree: a large sway of the
// branches and a small flutter of each leaf card, both driven by noise

export const wind = {
  strength: uniform(0.22), // how far the tree top sways, in metres
  speed: uniform(0.83), // how fast gusts travel through the tree
  frequency: uniform(0.05), // how small the gusts are: higher, more of them
  direction: uniform(1.35840734641021), // where the wind blows towards, round the trunk
  flutter: uniform(0.18), // how far each card rocks, in radians
  height: uniform(5), // the tree's height, so the sway grows towards the top
  gust: uniform(0), // a gust on top while the camera shakes: 1 blows twice as hard
}

// How hard it blows now, the gust included
export const blowing = wind.strength.mul(wind.gust.add(1))

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
  const reach = float(2).sub(blowing.clamp(0, 1))
  const bend = position.y.div(wind.height).max(0).pow(reach)
  return downwind.mul(gust).add(turbulence).mul(bend.mul(blowing))
}

// A card's flutter: two small angles rocking out of phase with its
// neighbours, stronger when a gust passes
export function flutter(position, phase) {
  const t = time.mul(wind.speed).mul(6).add(phase)
  const gust = mx_noise_float(position.mul(wind.frequency).sub(time.mul(wind.speed))).add(1)
  return vec3(sin(t), sin(t.mul(1.3).add(1.7)), float(0)).mul(wind.flutter.mul(gust).mul(wind.gust.add(1)))
}

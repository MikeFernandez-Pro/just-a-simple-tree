import * as THREE from 'three/webgpu'
import {
  acesFilmicToneMapping,
  agxToneMapping,
  cineonToneMapping,
  float,
  linearToneMapping,
  neutralToneMapping,
  reinhardToneMapping,
  dot,
  Fn,
  mix,
  output,
  positionGeometry,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { sway } from './wind.js'

// Cel shading as in trungduyng's Blender anime tree tutorial ("the tutorial" in
// these comments): a Diffuse BSDF read back as a colour (Shader to RGB) and
// pushed through a colour ramp. The tutorial's Diffuse is albedo 0.8 under a
// sun of strength 5.77. Blender's diffuse is albedo x sun x cos / pi, and so is
// three's Lambert under a directional light of that intensity. Here a
// hemisphere light fills the shadows too, and the lights have colours: the ramp
// picks its band from how bright the light is, and the band is then tinted by
// the light's colour

const ALBEDO = 0.8

export const sunDirection = uniform(new THREE.Vector3(0, 1, 0))

export const sun = new THREE.DirectionalLight('#fff3df', 5.77)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -10
sun.shadow.camera.right = sun.shadow.camera.top = 10
sun.shadow.camera.near = 1
sun.shadow.camera.far = 60
sun.shadow.bias = -0.0005
sun.shadow.normalBias = 0.02

// Sky above, ground bounce below, lighting what the sun doesn't reach
export const hemisphere = new THREE.HemisphereLight('#bfd8ff', '#6b5a45', 1)

// What a shadow does to the sunlight it blocks: darkness 1 takes it all the
// way to the shadow colour, 0 leaves it untouched. Black at 1 is a plain
// shadow; a colour tints it
export const shadowColor = uniform(new THREE.Color('#2e3b5c'))
export const shadowDarkness = uniform(0.75)
export const tintShadow = Fn(([shadow]) => mix(mix(vec3(1), shadowColor, shadowDarkness), vec3(1), shadow))

// A Blender colour ramp with constant interpolation, from [position, colour]
// stops in order: each colour holds until the next stop, no blending, so the
// bands are hard-edged cel
export function ramp(value, stops) {
  let color = stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [at, next] = stops[i]
    color = mix(color, next, step(at, value))
  }
  return color
}

// The lit value through a ramp, tinted by the light's colour: the band comes
// from the light's brightness, the tint from its hue (none where no light
// reaches, so the darkest band keeps its own colour)
const LUMA = vec3(0.2126, 0.7152, 0.0722)
export function celShade(stops) {
  const value = dot(output.rgb, LUMA)
  const tint = mix(vec3(1), output.rgb.div(value.max(1e-4)), smoothstep(0, 0.02, value))
  return ramp(value, stops).mul(tint)
}

// Tone mapping, Neutral to start, done in the materials of the tree and
// leaves rather than over the whole frame, so the background and the
// floor's shadow keep exactly the colours picked
export const exposure = uniform(1)
export const TONE_MAPPINGS = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  'aces filmic': THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
}
// The type is a uniform the shader picks by, so switching is instant and
// nothing recompiles. (A ToneMappingNode's type is baked into the shader,
// and changing it after the first build doesn't reach the cached one)
export const toneMappingType = uniform(THREE.NeutralToneMapping)
const CURVES = [
  [THREE.LinearToneMapping, linearToneMapping],
  [THREE.ReinhardToneMapping, reinhardToneMapping],
  [THREE.CineonToneMapping, cineonToneMapping],
  [THREE.ACESFilmicToneMapping, acesFilmicToneMapping],
  [THREE.AgXToneMapping, agxToneMapping],
  [THREE.NeutralToneMapping, neutralToneMapping],
]
export function toneMapped(color) {
  let result = color
  for (const [type, curve] of CURVES) result = mix(result, curve(color, exposure), float(toneMappingType.equal(type)))
  return result
}

// A linear colour as a uniform, so the panel can change it
export function linear(r, g, b) {
  return uniform(new THREE.Color().setRGB(r, g, b))
}

// A lit surface read back through a ramp: Lambert under the lights, with
// their shadows, is the tutorial's Diffuse + Shader to RGB
export function celMaterial(stops) {
  const material = new THREE.MeshLambertNodeMaterial({ color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO) })
  material.outputNode = vec4(toneMapped(celShade(stops)), output.a)
  material.receivedShadowNode = tintShadow
  return material
}

// The tutorial's trunk: a three-stop brown ramp, its colours open to the panel
export const barkColors = [linear(0.031, 0.027, 0.024), linear(0.074, 0.061, 0.042), linear(0.148, 0.117, 0.068)]

export function barkMaterial() {
  const material = celMaterial([
    [0, barkColors[0]],
    [0.497, barkColors[1]],
    [1, barkColors[2]],
  ])
  // The wood sways with the wind, more towards the top
  material.positionNode = positionGeometry.add(sway(positionGeometry))
  return material
}

// The floor draws nothing but the tree's shadow, in the shadow colour at its
// darkness, so it always melts into the background
export function groundMaterial() {
  const material = new THREE.ShadowNodeMaterial()
  material.colorNode = shadowColor
  material.opacityNode = shadowDarkness
  return material
}

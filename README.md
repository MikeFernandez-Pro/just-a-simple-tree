# Just a simple tree

<img src="docs/tree.gif" width="100%" alt="An oak in blossom, a willow in autumn, a pine in frost, a bush at night and a cypress in spring, each folding away as the next grows in">

A procedural anime-style tree for three.js, exported as a `.glb`. Five
species: oak, pine, cypress, weeping willow and bush. Everything is
generated from a seed. Nothing is modelled or loaded, and the leaf textures
are painted in code at startup.

## Quick start

```sh
pnpm install
pnpm dev
```

Pick a species and a theme, tune the tree in the panel, then click
**export tree (.glb)**. The app renders with WebGPU and falls back to WebGL2.

## Using the export

The GLB holds two meshes with a plain `MeshStandardMaterial`, so it opens in
any glTF viewer or engine:

- **`wood`**: the branches, with smooth normals. A bush has none.
- **`leaves`**: alpha-masked, double-sided cards with their clumps' normals,
  so each clump shades as one soft volume. The gradient and AO are baked
  into the vertex colours for the sun at export time.

The tree is exported without wind, with its foot at the origin.

### Cel shading

Each material stores its cel ramp in its glTF `extras`, so after loading
it's in `material.userData.celRamp`: `[threshold, colour]` pairs, from
shadow to light. `celShade` rebuilds the app's look from it:

```js
gltf.scene.traverse((object) => {
  if (object.isMesh) celShade(object)
})
```

The thresholds are tuned to the app's lighting. Match it, or the bands
shift:

```js
renderer.toneMapping = THREE.NeutralToneMapping
renderer.shadowMap.enabled = true

const sun = new THREE.DirectionalLight('#fff3df', 5)
sun.position.set(23, 14, 12.5)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -10
sun.shadow.camera.right = sun.shadow.camera.top = 10
sun.shadow.bias = -0.0005 // avoids acne on the cards
sun.shadow.normalBias = 0.02
scene.add(sun, new THREE.HemisphereLight('#bfd8ff', '#6b5a45', 1))
```

<details>
<summary><code>celShade</code> for <code>WebGLRenderer</code></summary>

```js
import * as THREE from 'three'

// The cel look of Just a simple tree, on a mesh from its GLB, for
// WebGLRenderer: the light picks a colour from the ramp in the material's
// extras, tinted by the light's colour, then the vertex colours shade it
export function celShade(mesh) {
  const material = mesh.material
  const ramp = material.userData.celRamp
  if (!ramp) return
  const count = ramp.length
  material.color.setRGB(0.8, 0.8, 0.8) // the ramp's band edges expect this albedo
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rampAt = { value: ramp.map(([at]) => at) }
    shader.uniforms.rampColor = { value: ramp.map(([, hex]) => new THREE.Color(hex)) }
    shader.uniforms.shadeScale = { value: material.userData.shadeScale ?? 1 }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float rampAt[${count}];
uniform vec3 rampColor[${count}];
uniform float shadeScale;`,
      )
      // The vertex colours shade after the ramp, not the albedo
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <opaque_fragment>',
        `{
  float value = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  vec3 band = rampColor[0];
  for (int i = 1; i < ${count}; i++) band = mix(band, rampColor[i], step(rampAt[i], value));
  outgoingLight = band * mix(vec3(1.0), outgoingLight / max(value, 1e-4), smoothstep(0.0, 0.02, value));
  #ifdef USE_COLOR
    outgoingLight *= vColor.rgb * shadeScale;
  #endif
}
#include <opaque_fragment>`,
      )
  }
  material.needsUpdate = true
}
```

</details>

<details>
<summary><code>celShade</code> for <code>WebGPURenderer</code></summary>

```js
import * as THREE from 'three/webgpu'
import { attribute, color, dot, float, mix, output, smoothstep, step, vec3, vec4 } from 'three/tsl'

// The cel look of Just a simple tree, on a mesh from its GLB, for
// WebGPURenderer: the light picks a colour from the ramp in the material's
// extras, tinted by the light's colour, then the vertex colours shade it
export function celShade(mesh) {
  const old = mesh.material
  const ramp = old.userData.celRamp
  if (!ramp) return
  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(0.8, 0.8, 0.8), // the ramp's band edges expect this albedo
    map: old.map,
    alphaTest: old.alphaTest,
    side: old.side,
  })
  const value = dot(output.rgb, vec3(0.2126, 0.7152, 0.0722))
  let band = color(ramp[0][1])
  for (const [at, hex] of ramp.slice(1)) band = mix(band, color(hex), step(at, value))
  const tint = mix(vec3(1), output.rgb.div(value.max(1e-4)), smoothstep(0, 0.02, value))
  const shade = mesh.geometry.attributes.color
    ? attribute('color', 'vec3').mul(old.userData.shadeScale ?? 1)
    : float(1)
  material.outputNode = vec4(band.mul(tint).mul(shade), output.a)
  mesh.material = material
}
```

</details>

### Recolouring

Pick the colours in the app before exporting, or edit the ramp before
calling `celShade`. Change the colours and keep the thresholds:

```js
const ramp = gltf.scene.getObjectByName('leaves').material.userData.celRamp
ramp[0][1] = '#2f5d3a' // shadow
ramp[1][1] = '#5fa052' // lit
ramp[2][1] = '#c4ec84' // highlight
```

### Custom materials

Any material works. On the leaves, carry over `map`, `alphaTest`, `side`
and `vertexColors`, which hold the cut-out and the baked shading:

```js
const old = leaves.material
leaves.material = new THREE.MeshToonMaterial({
  color: '#7cc35f',
  map: old.map,
  alphaTest: old.alphaTest,
  side: old.side,
  vertexColors: old.vertexColors,
})
```


## What it does

- **The tree** grows from a seed, as one of five species, picked with the
  buttons down the left side (hover one for its name) or in the panel, all from the same
  crooked, tapered wood with rounded tips and collars where branches meet:
  - **oak**: a short trunk splitting into limbs, each branching again;
  - **pine**: one straight trunk ringed by whorls of drooping branches, long
    at the bottom and short at the top, so the crown is a tiered cone of
    flat pads of needles;
  - **cypress**: a tall, narrow flame of short branches climbing steeply
    round a spiral, widest a third of the way up;
  - **willow** (weeping willow): a short, stout trunk splitting into limbs that rise and
    spread like a fountain, hung with long thin strands that arch over and
    fall in curtains towards the ground;
  - **bush**: no wood at all and no falling leaves: a single ball of leaves
    on the ground, or, with more clumps, a low, round dome of them heaped
    up, the big ones in the middle.
- **Each seed has its own character**: besides placing every branch, it
  makes the tree taller or shorter, broader or slimmer, leaning a little and
  heavier on one side, and varies what makes its species: where the pine's
  crown starts and how it droops, where the cypress is widest and how sharp
  its tip is, how wide the willow's dome is and how long its curtains, how
  wide the bush spreads.
  **variety**, in the shape folder, sets how far: at 0 every seed grows its
  species' average tree.
- **The leaves** are flat cards scattered over leaf clumps: one at each free
  branch tip on the oak, flat pads along the pine's branches, round
  clumps packed up the cypress, and long tresses down the willow's strands,
  their leaves pointing down, and round clumps heaped up into the bush. Every species wears the same round leaves;
  the panel's texture can swap them for pointed, oak, pine-needle or willow
  leaves. They borrow the clump's normals instead of their own, so a clump
  shades like one soft ball, and go through a hard-edged cel colour ramp.
- **Ambient occlusion** is worked out per card on the CPU, treating each
  clump as a leafy volume, so the colours depend on the sun and never on the
  camera.
- **Lights**: a sun with shadows and a sky-and-ground hemisphere light; their
  colours tint the bands. The floor only draws the shadow, so it blends into
  any background colour.
- **Grass**: a small round patch at the tree's foot, after the grass of the
  Portfolio2024 island. Every blade is built in the vertex shader, bent,
  turned at random and widened when seen edge on; the patch's ragged rim
  shortens the blades into it. It leans with the wind, goes through the
  tree's cel ramp with the tree's shadow on it, and takes the theme's colours.
- **Wind** sways the whole tree and rocks each leaf card, and swings the
  willow's strands from where they hang, more towards their tips; **falling leaves**
  drift downwind and settle on the floor, simulated with a compute shader.
- **A new tree**: **generate a new tree** at the bottom, or space, picks a
  new seed. The old leaves blow away while the wood folds back into the
  ground, then the new tree grows out from the trunk to the tips, its leaves
  popping in last. Picking another species grows it in the same way.
- **Themes**: the round buttons along the top switch between blossom,
  spring, autumn, frost and night. Each sets the leaves, the wood, the
  grass, the background and the shadows. The new theme sweeps over the screen from the
  bottom left to the top right behind a ragged Perlin-noise front with a
  bright edge, while the camera shakes a little. Picking again mid-sweep
  sends a new front after the ones still going.
- **Export**: **export tree (.glb)** saves the wood and the leaves, as
  described in [Using the export](#using-the-export).
  The grass, the floor and the falling leaves stay in the app.

## The panel

Every setting lives in three's WebGPU Inspector (the button at the top
right), one section per part of the scene, each with its own colors and
debug views: the tree (theme, species, its shape, trunk and mesh with the
wireframe; the shape shows only the species' own sliders, and the bush,
which has no wood, hides the wood's sliders, wireframe and colours, and
drops no leaves, so it hides falling leaves too),
the leaves (clumps, cards, shading and normals), wind, the grass (its
size, blades, wind strength, shading and colours), falling leaves, and
the lights (background, sun, sky, shadows, tone mapping).
Each section and folder has its own reset, the filter box finds a setting by
name, and **copy config** copies every value as JSON.

The page's address always holds every setting changed from the start, so
**copy link** (or the address bar) shares this exact tree: opening the link
sets them all again.

## Files

| file | what's in it |
| --- | --- |
| `main.js` | the scene, the panel and the render loop |
| `bar.js` | the buttons at the bottom: generate a new tree and export tree |
| `themes.js` | the colour themes and the buttons along the top picking them |
| `species-buttons.js` | the buttons down the left picking the species |
| `vertex-count.js` | the card counting the vertices the export will write |
| `stickers.js` | the round sticker buttons both rows are made of |
| `transition.js` | the sweep from one theme to the next |
| `shake.js` | a theme landing: the camera's shake, the gust and the leaves knocked off |
| `icons/` | the theme buttons' icons |
| `docs/` | the GIF at the top of this README |
| `wood.js` | the wood every species is built from: branches as tubes, and the growing data |
| `oak.js` | the oak: its branching and leaf clumps, its icon, sliders and settings |
| `pine.js` | the pine: its whorls and leaf clumps, its icon, sliders and settings |
| `cypress.js` | the cypress: its spiral of climbing branches and leaf clumps, its icon, sliders and settings |
| `willow.js` | the willow: its limbs, hanging strands and leaf clumps, its icon, sliders and settings |
| `bush.js` | the bush: its leaf clumps, its icon, sliders and settings |
| `foliage.js` | the leaf cards, their shading and the painted textures |
| `shading.js` | lights, shadows, cel ramps, tone mapping, wood and floor |
| `grass.js` | the grass patch round the tree's foot |
| `wind.js` | the sway and the leaf flutter |
| `falling-leaves.js` | the falling leaves, on the GPU |
| `regenerate.js` | a new tree, from a new seed or species: the burst, and the wood and leaves growing |
| `glb.js` | the GLB export |
| `inspector-filter.js` | the filter box for the Inspector |
| `inspector-tools.js` | the reset, copy link and copy config buttons, and the link itself |

## Credits

- The leaf shading follows trungduyng's
  [Anime Tree Tutorial](https://www.youtube.com/watch?v=52sTppv7Y-E) for
  Blender: leaf cards scattered over a bush whose normals they borrow, a cel
  colour ramp, and a gradient and ambient occlusion on top. Here the cards
  are fixed in the world rather than facing the camera.
- The falling leaves build on Bruno Simon's TSL petals lesson in
  [Three.js Journey](https://threejs-journey.com).

## License

[MIT](LICENSE)

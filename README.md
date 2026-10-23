# Just a simple tree

**[Open it in your browser →](https://justasimpletree.com/)**
Nothing to install.

<img src="docs/tree.gif" width="100%" alt="An oak in blossom, a willow in autumn, a pine in frost, a bush at night and a cypress in spring, each folding away as the next grows in">

A procedural, anime-style tree for three.js, to tune in the browser and
export for your own project as a 3D model (`.glb`) or as images. There are
five species: oak, pine, cypress, weeping willow and bush. Every tree grows
from a seed: nothing is modelled or loaded, and even the leaf textures are
painted in code.

- [Quick start](#quick-start)
- [Features](#features) and [keys](#keys)
- [The panel](#the-panel), with [every control](#every-control)
- [Exporting](#exporting): [the tree's GLB](#the-trees-glb),
  [the cel look in three.js](#the-cel-look-in-threejs),
  [impostors](#impostors), [sprite sheets](#sprite-sheets)
- [Changing the code](#changing-the-code)

## Quick start

1. Open <https://justasimpletree.com/>.
2. Pick a species with the buttons down the left, and a theme with the ones
   along the top.
3. Tune the tree in the panel at the top right.
4. Click **export** at the bottom and pick what to save.

The app renders with WebGPU, and falls back to WebGL2 in browsers without
it.

To run it locally, with [pnpm](https://pnpm.io):

```sh
pnpm install
pnpm dev       # Vite dev server
pnpm build     # production build into dist/
pnpm preview   # serve the build
```

Every push to `main` is built and deployed to the live page by GitHub
Actions.

## Features

- **Five species**:
  - **oak**: a short trunk splitting into limbs that branch again;
  - **pine**: a straight trunk ringed by whorls of drooping branches, a
    tiered cone of flat pads of needles;
  - **cypress**: a tall, narrow flame of short branches climbing a spiral;
  - **willow** (weeping willow): limbs rising like a fountain, hung with
    strands falling in curtains;
  - **bush**: no wood, just a dome of leaf clumps on the ground.
- **Seeds**: the same seed and settings always grow the same tree.
  **new tree**, at the bottom, picks a new seed: the old tree shrinks into
  the ground as its leaves blow away, and the new one springs up. Each seed
  also gives its tree a character of its own, taller or shorter, broader or
  slimmer, leaning a little. **variety** sets how much; at 0 every seed
  grows its species' average shape.
- **Leaves** are leaf cards, small flat quads with leaves painted on them,
  scattered over round leaf clumps. Each card takes its clump's normals, so
  a clump shades like one soft ball, in the hard-edged colour bands of cel
  shading.
- **Your own leaves**: drop an image anywhere on the page, or click
  **load image…** in the panel. A PNG with transparency is cut out along it
  and can keep its own colours (**colors from**); any other image is read as
  white leaves on black, in the theme's colours. The image is only kept in
  your browser, so a link using it shows it on your machine alone.
- **Leaf age** runs the leaves through a year, from unfolding to a bare
  tree, the outside of the crown turning first.
- **Ambient occlusion**, the darkening deep inside the crown, is worked out
  per card on the CPU, so it follows the sun and never the camera. Cards
  buried deep in a neighbouring clump are left out, saving vertices.
- **Wind** sways the tree, swings each branch on its own, the twigs most,
  and rocks every leaf card. **Falling leaves** drift downwind and settle on
  the floor, simulated in a compute shader.
- **Grass**: a small patch at the tree's foot, after the Portfolio2024
  island's, every blade built in the vertex shader.
- **Themes**: blossom, spring, autumn, frost and night. Each sets the
  colours of the leaves, wood, grass, background and shadows, and sweeps in
  behind a ragged front that knocks the tree and shakes leaves loose.
- **Sharing**: the page's address holds every setting you've changed, so
  copying it shares this exact tree.
- **Sound**: the wind and the leaves rustling, following the tree, lofi
  music, and sounds for the themes and new trees. It starts when you click
  **enter** on the loading screen; the speaker sticker in the bottom right
  turns it off and on.

### Keys

| key | what it does |
| --- | --- |
| ← → | the previous or next theme |
| ↑ ↓ | the previous or next species |
| space | a new tree from a new seed |
| H | hides or shows the panel |
| M | turns the sound off and on |
| Esc | closes the export menu or the code window |
| Enter or space | on the loading screen, enters the page |

Keys do nothing while you're typing in a field.

## The panel

Every setting is in the panel at the top right, three's WebGPU Inspector,
in one section per part of the scene: Tree, Leaves, Wind, Grass, Falling
leaves, Lights and Export. The filter box finds a setting by name, and each
section and folder has its own reset.

Picking a theme sets every colour and the shadows' darkness. Picking a
species sets its own shape, leaf and wind settings. A reset goes back to the
current theme's and species' values.

**copy link** copies the page's address, which holds every changed setting,
and **copy config** copies every value as JSON. The settings marked *debug*
below only show how the tree is made, and stay out of the link. A number
typed into a slider's box may go past the slider's range.

### Every control

<details>
<summary><b>Tree</b>: theme, species, shape and the wood's colours</summary>

| control | what it does |
| --- | --- |
| theme | the colour theme, as the buttons along the top and the left and right arrow keys pick it |
| species | the kind of tree, as the buttons down the left and the up and down arrow keys pick it |
| **shape** | |
| seed | the number the tree grows from: the same seed and settings always grow the same tree. **new tree** and space pick a new one |
| wireframe | *debug*: the wood's mesh as lines, in place of the wood |
| **colors** | |
| shadow, mid, light | the wood's three cel bands, from the shadow side to the lit one |

The shape folder only shows the sliders the species uses. The bush, having
no wood, hides the wood's sliders, the wireframe and the wood's colours.

| slider | species | what it does |
| --- | --- | --- |
| size | all | the tree's height |
| main limbs | oak, willow | how many limbs the trunk splits into |
| levels | oak | how many times each limb branches again |
| branches | oak | how many branches grow at each fork |
| spread | oak, bush | how far the limbs, or the bush's clumps, reach out |
| droop | pine, cypress | how the branches bend: down above 0, up below it |
| whorls | pine | how many tiers of branches ring the trunk |
| branches per whorl | pine | how many branches each tier has |
| slenderness | cypress | higher grows it taller and narrower |
| branch count | cypress | how many branches climb its spiral |
| strands | willow | how many strands hang from its limbs |
| hang | willow | how far down towards the ground the strands hang |
| clumps | bush | how many leaf clumps are heaped into its dome |
| crookedness | all with wood | how much the branches kink and wander |
| trunk thickness | all with wood | how thick the trunk is, and the branches with it |
| base flare | all with wood | how much wider the trunk spreads at the ground, like roots |
| trunk height | oak, cypress | bare trunk under the oak's split or the cypress's crown, in metres |
| split height | oak | how far up the trunk the limbs split off |
| split scatter | oak | how far down the trunk the limbs may leave it: at 0, all from its top |
| sides | all with wood | sides round each branch: more smooth the cel bands' edges |
| smoothness | all with wood | rings per kink along each branch's curve |
| variety | all | how far a seed's own character takes its tree from the species' average: at 0, the average |

</details>

<details>
<summary><b>Leaves</b>: age, clumps, cards, shading and colours</summary>

| control | what it does |
| --- | --- |
| age | the leaves through a year: unfolding at 0, full grown by 0.25, turning from 0.45, bare at 1 |
| **clumps** | |
| clump size | scales every leaf clump, and its cards with it |
| evenness | takes every clump towards one size, keeping their total leaf area |
| cards per clump | how many leaf cards a clump gets; bigger clumps get more |
| show clumps | *debug*: the clumps alone, cel shaded in the leaves' colours |
| keep buried cards | *debug*: puts back the cards left out deep inside a neighbouring clump |
| **cards** | |
| texture | the leaves painted on each card: round, pointed or oak clusters, pine needles, willow leaves, or your image |
| load image… | picks an image for the leaves, as dropping one on the page does |
| colors from | for your image: the theme's colours, or the image's own |
| size | how big each card is |
| segments | how many squares each card is cut into, from 1 × 1 to 4 × 4; they only show once roundness bends them |
| roundness | how far each card wraps round its clump's sphere |
| show leaves | *debug*: hides the leaf cards |
| show texture | *debug*: off shows the bare cards |
| **shading** | |
| shadow side | how much darker the side of the crown away from the sun goes |
| ao | how much the ambient occlusion darkens the leaves deep in the crown |
| ao distance | how far out the ambient occlusion looks for leaves blocking the light |
| show normals | *debug*: the cards coloured by their normals |
| **colors** | |
| shadow, mid, light | the leaves' three cel bands |
| turned shadow, turned mid, turned light | the colours the leaves turn to as they age |
| variation | how far each clump's colours stray from its neighbours' |

</details>

<details>
<summary><b>Wind</b></summary>

| control | what it does |
| --- | --- |
| direction | which way the wind blows, round the tree |
| strength | how far the tree sways |
| speed | how fast the gusts travel through it |
| gust size | how big the gusts are, in metres: smaller ones come more often |
| leaf flutter | how far each leaf card rocks |
| branch swing | how far each branch swings on its own, the thin ones most, out of step with their neighbours; 0 moves the tree as one |

</details>

<details>
<summary><b>Grass</b></summary>

| control | what it does |
| --- | --- |
| **blades** | |
| patch radius | how far the patch reaches from the tree's foot |
| count | how many blades it has |
| height, width | each blade's size |
| wind strength | how far the blades lean in the wind |
| **shading** | |
| in shadow | how dark the grass goes in the tree's shadow |
| **colors** | |
| root, tip | the colour at the foot of a blade and at its tip |

</details>

<details>
<summary><b>Falling leaves</b>: hidden for the bush</summary>

| control | what it does |
| --- | --- |
| amount | how many leaves are falling at once |
| leaf size | how big each falling leaf is |
| fall speed | how fast they fall, in metres per second, before the wind |
| lifetime | seconds from a leaf leaving the tree to its vanishing from the floor |

</details>

<details>
<summary><b>Lights</b>: background, sun, sky and shadows</summary>

| control | what it does |
| --- | --- |
| background | the colour behind the tree |
| **sun** | |
| angle | where the sun is round the tree |
| height | how high in the sky it is |
| intensity, color | how bright it is, and its colour, which tints the bands |
| **hemisphere** | |
| intensity | how bright the sky-and-ground light is |
| sky color, ground color | its colour from above and from below |
| **shadows** | |
| color | the shadows' colour, on the floor, the grass and the tree |
| darkness | how dark they are |

</details>

<details>
<summary><b>Export</b>: how each export is made</summary>

| control | what it does |
| --- | --- |
| **tree** | |
| export | saves the tree as a GLB |
| **texture** | |
| size | the image's width and height: 1024, 2048 or 4096 pixels |
| transparent (RGBA) | a clear background instead of the theme's |
| export | saves the texture |
| **sprite sheet** | |
| views | how many views round the tree: 4, 8 or 16 |
| frame size | each view's width and height: 128, 256 or 512 pixels |
| elevation | how far above level the views look from, in degrees |
| export | saves the sprite sheet |
| **impostor** | |
| views a side | 6, 8 or 12 views a side of the atlas |
| atlas size | the atlas's width and height, from 512 to 8192 pixels |
| each view, on the GPU | read-outs: how many pixels each view gets, and how much GPU memory the atlas takes with its mipmaps |
| export | saves the impostor as a GLB |

</details>

## Exporting

**export**, at the bottom of the screen, opens a menu of four exports. The
panel's **Export** section sets how each is made and has its own **export**
button for each, which is where they are on a phone. Everything is drawn
with the tree still and fully grown, lit by the sun as it is when you
export. Files are named after the species and seed, such as `oak-8967.glb`.

| export | file | what you get |
| --- | --- | --- |
| tree | `.glb` | the tree as meshes: see [the tree's GLB](#the-trees-glb) |
| impostor | `.glb` | one quad showing pictures of the tree, for trees far away: see [impostors](#impostors) |
| texture | `.png` | the camera's view, with the floor's shadow, the grass and the falling leaves, on the theme's background or a transparent one |
| sprite sheet | `.png` | the tree from 4, 8 or 16 angles round it, for 2D and 2.5D games: see [sprite sheets](#sprite-sheets) |

### The tree's GLB

The tree's GLB holds only the wood and the leaves: no grass, floor or
falling leaves, and no wind. It's in metres, with the tree's foot at the
origin. The card in the bottom left corner shows how many vertices it will
have. Its materials are plain `MeshStandardMaterial`s, so it opens in any
glTF viewer or engine. Its meshes are:

- **`wood`**: the branches. A bush has none.
- **`leaves`**: alpha-masked, double-sided cards with their clumps' normals,
  the gradient and ambient occlusion baked into the vertex colours.
- **`young leaves`** and **`turned leaves`**: the cards still unfolding or
  already turned at the leaves' **age**, each with its own colours, there
  only when the age has some.

Its textures are PNGs. Under their transparent pixels they keep the leaves'
colours rather than black, so the leaves' edges don't darken in the
mipmaps. For smaller files, convert them, for instance with
[glTF Transform](https://gltf-transform.dev).

### The cel look in three.js

A plain material shades the tree smoothly. To get the app's hard-edged
bands back in three.js, put `celShade`, below, on every material. The
**material** button, under the panel's at the top right, shows the same
code, ready to copy.

Each material keeps its bands in its glTF `extras`, which three.js loads
into `material.userData.celRamp`: `[threshold, colour]` pairs, from shadow
to light. `celShade` builds a new material from them and leaves the old one
as it was:

```js
gltf.scene.traverse((object) => {
  if (object.isMesh) object.material = celShade(object.material)
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

const ALBEDO = 0.8 // the grey the ramp's band edges expect, lit
const LUMA = [0.2126, 0.7152, 0.0722] // the light's brightness from its red, green and blue
const TINT_FADE = 0.02 // the brightness over which the light's tint fades in from black
const EPSILON = 1e-4 // keeps the tint from dividing by nothing in the dark

// The cel look of Just a simple tree, for WebGLRenderer: a copy of a
// material from its GLB, where the light picks a colour from the ramp in
// the material's extras, tinted by the light's colour, then the vertex
// colours shade it. A material without a ramp comes back as it is
export function celShade(oldMaterial) {
  const ramp = oldMaterial.userData.celRamp
  if (!ramp) return oldMaterial
  const count = ramp.length
  const material = oldMaterial.clone()
  material.color.setRGB(ALBEDO, ALBEDO, ALBEDO)
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
  float value = dot(outgoingLight, vec3(${LUMA.join(', ')}));
  vec3 band = rampColor[0];
  for (int i = 1; i < ${count}; i++) band = mix(band, rampColor[i], step(rampAt[i], value));
  outgoingLight = band * mix(vec3(1.0), outgoingLight / max(value, ${EPSILON}), smoothstep(0.0, ${TINT_FADE}, value));
  #ifdef USE_COLOR
    outgoingLight *= vColor.rgb * shadeScale;
  #endif
}
#include <opaque_fragment>`,
      )
  }
  return material
}
```

</details>

<details>
<summary><code>celShade</code> for <code>WebGPURenderer</code></summary>

```js
import * as THREE from 'three/webgpu'
import { attribute, color, dot, float, mix, output, smoothstep, step, vec3, vec4 } from 'three/tsl'

const ALBEDO = 0.8 // the grey the ramp's band edges expect, lit
const LUMA = [0.2126, 0.7152, 0.0722] // the light's brightness from its red, green and blue
const TINT_FADE = 0.02 // the brightness over which the light's tint fades in from black
const EPSILON = 1e-4 // keeps the tint from dividing by nothing in the dark

// The cel look of Just a simple tree, for WebGPURenderer: a new material
// for one from its GLB, where the light picks a colour from the ramp in the
// material's extras, tinted by the light's colour, then the vertex colours
// shade it. A material without a ramp comes back as it is
export function celShade(oldMaterial) {
  const ramp = oldMaterial.userData.celRamp
  if (!ramp) return oldMaterial
  const material = new THREE.MeshLambertNodeMaterial({
    name: oldMaterial.name,
    color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO),
    map: oldMaterial.map,
    alphaTest: oldMaterial.alphaTest,
    side: oldMaterial.side,
  })
  const value = dot(output.rgb, vec3(...LUMA))
  let band = color(ramp[0][1])
  for (const [at, hex] of ramp.slice(1)) band = mix(band, color(hex), step(at, value))
  const tint = mix(vec3(1), output.rgb.div(value.max(EPSILON)), smoothstep(0, TINT_FADE, value))
  const shade = oldMaterial.vertexColors
    ? attribute('color', 'vec3').mul(oldMaterial.userData.shadeScale ?? 1)
    : float(1)
  material.outputNode = vec4(band.mul(tint).mul(shade), output.a)
  return material
}
```

</details>

Leaves wearing your own image in its own colours have no `celRamp`, so
`celShade` gives their material back as it is.

#### Recolouring

Pick the colours in the app before exporting, or change the ramp's colours,
but not its thresholds, before calling `celShade`:

```js
const ramp = gltf.scene.getObjectByName('leaves').material.userData.celRamp
ramp[0][1] = '#2f5d3a' // shadow
ramp[1][1] = '#5fa052' // lit
ramp[2][1] = '#c4ec84' // highlight
```

#### Other materials

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

### Impostors

An impostor is a flat stand-in for a tree far away: one quad, turned to
face the camera, showing a picture of the tree from the nearest direction.
The export holds the quad, called `impostor`, and an atlas of 6 × 6, 8 × 8
or 12 × 12 pictures from all over the sky above the tree. Its
`userData.impostor` (glTF `extras`) describes the atlas:

- `frames`: views a side. Frame `(i, j)`, from the bottom left in UV space,
  looks from the direction the hemi-octahedral map decodes from
  `(i, j) / (frames - 1) * 2 - 1`: the edges from the horizon, the middle
  from straight above.
- `center` and `radius`: the sphere round the tree, which the quad covers.
- `crops`: each view's rectangle round the tree, `crops[j * frames + i]`,
  as `[left, bottom, right, top]` in metres from the centre along the
  view's right and up. Each view is cropped to the tree and stretched to
  fill its frame.

Each view gets the atlas's size over the views a side, 256 pixels in a 2048
atlas with 8, and blurs when drawn bigger than that. The panel shows this
and the atlas's GPU memory. The sun is baked into the pictures, so leave the
impostor unrotated and your scene's sun where the app's was.

A plain glTF viewer shows only the view from the front. `impostor` turns
the quad towards the camera and shows the nearest view, popping from one to
the next without blending:

<details>
<summary><code>impostor</code> for <code>WebGLRenderer</code></summary>

```js
import * as THREE from 'three'

// An impostor from Just a simple tree, for WebGLRenderer: its quad turns to
// the view in its atlas nearest the camera's direction, and shows it
export function impostor(mesh) {
  const { frames, radius, center, crops } = mesh.userData.impostor
  mesh.frustumCulled = false
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.frames = { value: frames }
    shader.uniforms.radius = { value: radius }
    shader.uniforms.center = { value: new THREE.Vector3(...center) }
    shader.uniforms.crops = { value: crops.map((crop) => new THREE.Vector4(...crop)) }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float frames;
uniform float radius;
uniform vec3 center;
uniform vec4 crops[${frames * frames}];
varying vec2 vInFrame;`,
      )
      .replace(
        '#include <begin_vertex>',
        `// The camera's direction, kept above the horizon, to the nearest frame
vec3 eye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - center;
eye.y = max(eye.y, 0.0);
vec2 p = eye.xz / (abs(eye.x) + abs(eye.y) + abs(eye.z));
vec2 frame = clamp(floor((vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5) * (frames - 1.0) + 0.5), 0.0, frames - 1.0);
// That frame's direction, and the quad, as big as the sphere round the
// tree, turned to face it. Which corner this is comes from its UV
vec2 o = frame / (frames - 1.0) * 2.0 - 1.0;
vec2 q = vec2(o.x + o.y, o.x - o.y) * 0.5;
vec3 look = normalize(vec3(q.x, 1.0 - abs(q.x) - abs(q.y), q.y));
vec3 right = abs(look.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), look));
vec3 up = cross(look, right);
vec2 corner = vec2(uv.x * frames - (frames - 1.0), uv.y * frames) * 2.0 - 1.0;
vec3 transformed = center + (right * corner.x + up * corner.y) * radius;
// Where the corner falls in the frame's crop of the tree
vec4 crop = crops[int(frame.y * frames + frame.x + 0.5)];
vInFrame = (corner * radius - crop.xy) / (crop.zw - crop.xy);
vMapUv = (frame + vInFrame) / frames;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vInFrame;')
      .replace(
        '#include <map_fragment>',
        `// Outside the crop is the next frame's
if (any(lessThan(vInFrame, vec2(0.0))) || any(greaterThan(vInFrame, vec2(1.0)))) discard;
#include <map_fragment>`,
      )
  }
  mesh.material.needsUpdate = true
}
```

</details>

<details>
<summary><code>impostor</code> for <code>WebGPURenderer</code></summary>

```js
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cross, float, floor, modelWorldMatrixInverse, normalize, select, step, texture, uniformArray, uv, varying, vec2, vec3, vec4 } from 'three/tsl'

// An impostor from Just a simple tree, for WebGPURenderer: its quad turns to
// the view in its atlas nearest the camera's direction, and shows it
export function impostor(mesh) {
  const { frames, radius, center, crops } = mesh.userData.impostor
  const old = mesh.material
  const n = float(frames)
  const c = vec3(...center)
  // The camera's direction, kept above the horizon, to the nearest frame
  const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.sub(c)
  const above = vec3(eye.x, eye.y.max(0), eye.z)
  const p = above.xz.div(abs(above.x).add(abs(above.y)).add(abs(above.z)))
  const frame = floor(vec2(p.x.add(p.y), p.x.sub(p.y)).mul(0.5).add(0.5).mul(n.sub(1)).add(0.5)).clamp(0, n.sub(1))
  // That frame's direction, and the quad, as big as the sphere round the
  // tree, turned to face it. Which corner this is comes from its UV
  const o = frame.div(n.sub(1)).mul(2).sub(1)
  const q = vec2(o.x.add(o.y), o.x.sub(o.y)).mul(0.5)
  const look = normalize(vec3(q.x, float(1).sub(abs(q.x)).sub(abs(q.y)), q.y))
  const right = select(abs(look.y).greaterThan(0.999), vec3(1, 0, 0), normalize(cross(vec3(0, 1, 0), look)))
  const up = cross(look, right)
  const corner = vec2(uv().x.mul(n).sub(n.sub(1)), uv().y.mul(n)).mul(2).sub(1)
  // Where the corner falls in the frame's crop of the tree
  const crop = uniformArray(crops.map((crop) => new THREE.Vector4(...crop))).element(frame.y.mul(n).add(frame.x).toInt())
  const inFrame = varying(corner.mul(radius).sub(crop.xy).div(crop.zw.sub(crop.xy)))
  const view = texture(old.map, varying(frame.add(inFrame).div(n)))
  const material = new THREE.MeshBasicNodeMaterial({ alphaTest: old.alphaTest, side: old.side })
  material.positionNode = c.add(right.mul(corner.x).add(up.mul(corner.y)).mul(radius))
  material.colorNode = view
  // Outside the crop is the next frame's, so it's cut away
  const inside = step(0, inFrame.x).mul(step(inFrame.x, 1)).mul(step(0, inFrame.y)).mul(step(inFrame.y, 1))
  material.opacityNode = view.a.mul(inside)
  mesh.material = material
  mesh.frustumCulled = false
}
```

</details>

```js
const gltf = await new GLTFLoader().loadAsync('oak-8967-impostor.glb')
impostor(gltf.scene.getObjectByName('impostor'))
scene.add(gltf.scene)
```

### Sprite sheets

The frames are square, four to a row, left to right and then top to bottom.
Frame `k` of `n` looks from `k / n` of the way round the tree,
counter-clockwise seen from above, starting from the front (+z), and from
**elevation** degrees above level. Every frame has the same scale, and the
tree's foot is on the same pixel in each, centred near the bottom.

## Changing the code

Where to start:

- `oak.js`, `pine.js`, `cypress.js`, `willow.js`, `bush.js`: each species'
  shape rules, button icon, sliders and settings.
- `wood.js`: the branches, as tubes, for every species.
- `foliage.js`: the leaf cards, their textures and their ambient occlusion.
- `wind.js`: the sway, each branch's swing and the leaves' flutter.
- `shading.js`: the lights, shadows and cel colour bands.
- `themes.js`: the colour themes.
- `main.js`: the scene, the panel and the render loop.
- `glb.js` and `capture.js`: the exports.

To add a species, write its file like the others and add it to `SPECIES`
in `main.js`, which builds its button and sliders from it. There are no
tests: check a change by eye in the browser, on every species and theme,
and on WebGL2 as well as WebGPU.

## Credits

- The leaf shading follows trungduyng's
  [Anime Tree Tutorial](https://www.youtube.com/watch?v=52sTppv7Y-E) for
  Blender: leaf cards scattered over a bush whose normals they borrow, a cel
  colour ramp, and a gradient and ambient occlusion on top. Here the cards
  are fixed in the world rather than facing the camera.
- The falling leaves build on Bruno Simon's TSL petals lesson in
  [Three.js Journey](https://threejs-journey.com).
- The music is by [alex-morgan](https://pixabay.com/users/alex-morgan-54692529/)
  and [ZephiraMusic](https://pixabay.com/users/zephiramusic-54643547/), the
  whoosh and the pop by [DRAGON-STUDIO](https://pixabay.com/users/dragon-studio-38165424/),
  and the wood breaking by BOAAY, all from Pixabay. See
  [public/music/CREDITS.md](public/music/CREDITS.md) for each track.

## License

The code is [MIT](LICENSE). The music in `public/music/` and the whoosh,
wood break and pop in `public/sounds/` aren't: they're under the Pixabay Content License, which
doesn't allow distributing them on their own, so get them from Pixabay to
use them elsewhere.

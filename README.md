# Just a simple tree

**[Open it in your browser →](https://justasimpletree.com/)**
Nothing to install.

<img src="docs/tree.gif" width="100%" alt="An oak in blossom, a willow in autumn, a pine in frost, a bush at night and a cypress in spring, each folding away as the next grows in">

A procedural anime-style tree for three.js, exported as a `.glb`, a
texture, a sprite sheet or an impostor. Five
species: oak, pine, cypress, weeping willow and bush. Everything is
generated from a seed. Nothing is modelled or loaded, and the leaf textures
are painted in code at startup, unless you drop an image of your own on the
leaves.

## Quick start

Open <https://justasimpletree.com/>, pick a
species and a theme, tune the tree in the panel, then click **export** and
pick what to save. The files work in any engine or glTF viewer, not just
three.js. The app renders with WebGPU and falls back to WebGL2.

To run it locally or change the generator:

```sh
pnpm install
pnpm dev
```

The live page, at [justasimpletree.com](https://justasimpletree.com/), is built
from `main` by GitHub Actions on every push.

## Using the export

**export** opens a menu of four exports, in two groups, 3D models and
images; hover one to see what it's for. The panel's **Export** section sets
how each is made, and **export settings…** at the bottom of the menu opens
it. Each of its folders ends in its own **export** button, so you can change
a setting and export again without going back to the menu. A phone has no
**export** button in the bar, nor the vertex count, nor the **material**
button, leaving more of the screen to the tree; its exports are still in
the panel. Every image is a PNG, the GLBs' textures included: see
[GLB textures](#glb-textures).

**material**, the button under the panel's at the top right, opens the
material code that gives the tree's GLB its look back in three.js,
`celShade`, in a little editor window, with a tab for `WebGPURenderer` and
one for `WebGLRenderer`. The code scrolls and has a **copy** button, with
how to apply it underneath. It's the code in [Cel shading](#cel-shading),
read out of this README, without its comments.

- **tree** (`.glb`): the tree as you see it, as meshes, below.
- **impostor** (`.glb`): one quad and an atlas of views from all over the sky
  above the tree, for trees far away: 6, 8 or 12 views a side, 8 to start
  with, in an atlas 512 to 8192 pixels a side, 2048 to start with. See
  [Impostors](#impostors).
- **texture** (`.png`): the view from the camera, the floor's shadow, the
  grass and the falling leaves included, 1024, 2048 or 4096 pixels on its
  long side. It's RGB on the theme's background, or RGBA on a clear one
  with **transparent (RGBA)** ticked.
- **sprite sheet** (`.png`): the tree from 4, 8 or 16 bearings round it, on a
  clear background, for 2D and 2.5D games. See [Sprite sheets](#sprite-sheets).

The textures, sprites and impostor are drawn with the tree still and fully
grown, lit by the sun as it is when you export.

The tree's GLB holds its meshes with a plain `MeshStandardMaterial`, so it opens in
any glTF viewer or engine:

- **`wood`**: the branches, with smooth normals. A bush has none.
- **`leaves`**: alpha-masked, double-sided cards with their clumps' normals,
  so each clump shades as one soft volume. The gradient and AO are baked
  into the vertex colours for the sun at export time.
- **`young leaves`** and **`turned leaves`**: the cards still unfolding or
  already turned at the leaves' **age**, each mesh with its own ramp, in
  the pale or turned colours. They're only there when the age has some.
  Cards that have dropped aren't exported, and the rest are exported at
  their size for the age.

The tree is exported without wind, with its foot at the origin.

### Cel shading

Each material stores its cel ramp in its glTF `extras`, so after loading
it's in `material.userData.celRamp`: `[threshold, colour]` pairs, from
shadow to light. `celShade` takes a material and gives back a new one with
the app's look built from it, the one given left as it was:

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

Leaves wearing a dropped image in its own colours have that image as their
`map`, cut out by its leaves, and no `celRamp`, so `celShade` gives their
material back as it is.

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

### GLB textures

The GLBs write their textures, the leaves' cut-out and the impostor's
atlas, as PNGs, every pixel as drawn, which anything reads. Under the
transparent pixels they keep a colour rather than black: the nearest leaf's
for a few pixels round the edges, and the mean colour beyond. So the leaves
don't darken at their edges as the texture shrinks into its mipmaps.

For smaller files, convert the textures yourself, for instance with
[glTF Transform](https://gltf-transform.dev).

### Impostors

The impostor is a quad called `impostor`, unlit, with an atlas of views of
the tree. Its `userData.impostor` (glTF `extras`) says how the atlas is laid
out:

- `frames`: views a side. Frame `(i, j)`, `i` from the left and `j` from the
  bottom in UV space, is the view from the direction the hemi-octahedral map
  decodes from `(i, j) / (frames - 1) * 2 - 1`: the corners and edges look
  from the horizon, the middle from straight above.
- `center` and `radius`: the sphere round the tree, which the quad covers
  as it turns.
- `crops`: each view's rectangle round the tree, `crops[j * frames + i]`
  for frame `(i, j)`, as `[left, bottom, right, top]` in metres from the
  centre along the view's right and up. Each view is cropped to the tree as
  it sees it and stretched to fill its square, so none of the atlas goes on
  the empty corners round it: a third more pixels across the tree and half
  as many again up it, for the oak, than framing the sphere.

The atlas is as many pixels a side as picked, whatever the views a side, so
with 6 or 12 a frame doesn't fill a whole number of pixels. Each frame
still covers exactly `1 / frames` of the atlas in UV space.

A view has the atlas's pixels divided by the views a side: 256 in a 2048
atlas with 8 views. A tree drawn bigger than that on screen, in device
pixels, is magnified and blurs, however it was drawn. The panel shows each
view's pixels under the impostor's settings, and how much GPU memory the
atlas takes with its mipmaps: 8192 is sharp close up but takes about 360 MB,
and some phones can't load a texture that big. More
views a side turn more smoothly, but share the same pixels, so each is
smaller.

The sun's light is baked into the views as it was when you exported. Turn
an impostor and its lit side turns with it, while a mesh beside it stays lit
from the sun, so the impostor looks darker or lighter than the trees round
it. Leave impostors unturned, with your scene's sun where the app's was.

A plain viewer shows the view from the front, the quad cut to its crop.
`impostor` turns the quad towards the camera and shows the view nearest its
direction. It tells the quad's corners apart by their UVs. The views pop
from one to the next rather than blending:

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

## What it does

- **The tree** grows from a seed, as one of five species, picked with the
  buttons down the left side (hover one for its name), the up and down
  arrow keys or the panel, all from the same crooked, tapered wood with
  rounded tips and collars where branches meet, and **base flare** spreads
  any trunk out at the ground, like roots:
  - **oak**: a short trunk splitting into limbs, each branching again;
    **trunk height** raises it on bare trunk, and **split scatter** lets the
    limbs leave the trunk at their own heights rather than all from its top;
  - **pine**: one straight trunk ringed by whorls of drooping branches, long
    at the bottom and short at the top, so the crown is a tiered cone of
    flat pads of needles, thinning to a sparse point at the top;
  - **cypress**: a tall, narrow flame of short branches climbing steeply
    round a spiral, widest at its foot; **trunk height** raises
    it on bare trunk too;
  - **willow** (weeping willow): a short, stout trunk splitting into limbs that rise and
    spread like a fountain, hung with long thin strands that arch over and
    fall in curtains towards the ground;
  - **bush**: no wood at all and no falling leaves: a single ball of leaves
    on the ground, or, with more clumps, a low, round dome of them heaped
    up, the big ones in the middle.
- **Each seed has its own character**: besides placing every branch, it
  makes the tree taller or shorter, broader or slimmer, leaning a little and
  heavier on one side, and varies what makes its species: where the pine's
  crown starts and how it droops, how sharp the cypress's tip is, how wide
  the willow's dome is and how long its curtains, how wide the bush
  spreads.
  **variety**, in the shape folder, sets how far: at 0 every seed grows its
  species' average tree.
- **The leaves** are flat cards scattered over leaf clumps: one at each free
  branch tip on the oak, flat pads along the pine's branches, round
  clumps packed up the cypress, and long tresses down the willow's strands,
  their leaves pointing down, and round clumps heaped up into the bush. The
  oak, willow and bush wear round leaves, and the pine and cypress small
  willow leaves; the panel's texture can swap them for pointed, oak,
  pine-needle or willow leaves, or for **your image**: drop an image
  anywhere on the page, or **load image…**. Leaves you pick stay on when
  you pick another species. A PNG with transparency is cut out by it and keeps its own
  colours, within the cel bands, unless it's only black, white and grey; an
  image without transparency is read as white leaves on black. Both of those
  take the theme's colours. **colors from** switches
  between the two. While an image is dragged over the page, the tree turns
  into a shimmering hologram waiting for it. Once it lands, a bright line
  scans up from the ground, leaving the real tree in its new leaves below it
  and the hologram in the old ones above. The image is kept in the browser, so a link asking for it
  finds it again on the same machine. They borrow the clump's normals instead of their own, so a clump
  shades like one soft ball, and go through a hard-edged cel colour ramp.
  **evenness**, in the clumps folder, takes every clump towards one size,
  keeping their total leaf area: at 0 they're the sizes they grew, at 1
  they're all the same.
  **variation**, in the colors folder, makes each clump a little warmer or
  cooler, lighter or darker than its neighbours, so a dense crown doesn't
  run together into one blob. It's multiplied in after the cel ramp, so the
  bands stay where they are, and it goes into the GLB's vertex colours.
- **The leaves' age**, **age** at the top of the leaves' section, runs
  them through a year. At 0 they've only just unfolded: small, sparse and
  pale. By 0.25 they're full grown in the theme's colours, as they are when
  the page opens, at 0.35. From 0.45 they turn to the theme's turned
  colours, then drop, until at 1 the tree is bare. Each card goes on its
  own beat: the most open ones first, a clump's cards roughly together, so
  autumn creeps over the crown from its outside. More leaves fall while the
  tree drops them, in the turned colours, none fall from a bare tree, and
  none while it's still unfolding.
- **Ambient occlusion** is worked out per card on the CPU, treating each
  clump as a leafy volume, so the colours depend on the sun and never on the
  camera. It also leaves out the cards nobody would see: one deep inside a
  neighbouring clump, and so dark that little light reaches it, is hidden
  from nearly every side. That saves about a third of the cypress's cards,
  and a few percent of the other species'. **keep buried cards**, a debug
  view in the clumps folder, puts them back to compare.
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
- **A new tree**: **new tree** at the bottom, or space, picks a new seed,
  at any time, even while a tree is still growing. The old leaves blow
  away on the wind while the tree scales down into its foot. The moment
  the tree is gone, the new one springs up out of the ground, shooting up thin and overshooting short and wide
  before it settles, its branches shooting out and its leaves popping on in
  a soft wave from the trunk to the tips. Picking another species
  brings it up in the same way. The old tree's leaves, those blowing away
  and those still falling or lying on the floor, keep their own texture: the
  new species' leaves only come with the new tree.
- **Themes**: the round buttons along the top, or the left and right arrow
  keys, switch between blossom, spring, autumn, frost and night. Each sets
  the leaves and what they turn to, the wood, the grass, the background and
  the shadows. The new theme sweeps over the
  screen from the bottom left to the top right behind a ragged Perlin-noise
  front with a bright edge. When the front reaches the tree it hits it: the
  tree squashes and bounces back, the camera is knocked and shakes, and a
  batch of leaves drops straight down until a gust catches them and blows
  them sideways. Picking again mid-sweep sends a new front after the ones
  still going, and each front knocks its own leaves off.
- **Export**: **export** saves the tree as a GLB, a texture, a sprite
  sheet or an impostor, as
  described in [Using the export](#using-the-export). The GLB holds the wood
  and the leaves; the grass, the floor and the falling leaves stay in the app.
- **Framing**: the camera backs away as far as the whole tree needs to fit
  between the buttons round the screen's edges, so a phone held upright
  still sees the whole crown. It never comes closer than where it starts,
  so a wide screen sees the tree as before. It eases out as the tree grows
  and back as it shrinks. Once you zoom yourself the distance is yours,
  until the screen changes shape.
- **Loading**: until the scene is ready, a sapling sprouts over and over in
  a sticker saying "growing a tree…". It's in `index.html`, so it shows
  before any of the code has arrived, and stays until the frames come
  steadily. Then the sticker pops away and the page opens in a circle from
  the middle of the tree, its edge ragged with Perlin noise and lit by a
  bright line, like a theme's sweep, while the first tree springs up out of
  the ground as a new one does. The falling leaves start once it has
  grown.

## The panel

Every setting lives in three's WebGPU Inspector (the button at the top
right). H hides the Inspector, its button and all, and brings it back. A slider's box is a plain text field: a number typed into it may go
past the slider's range, the box keeping it and the slider sitting at its
nearest end, and a drag in it selects the text. The panel has one section
per part of the scene: Tree, Leaves, Wind, Grass, Falling leaves, Lights and
Export. Each section and folder has its own reset, the filter box finds a
setting by name, and **copy config** copies every value as JSON.

The page's address always holds every setting changed from the start, so
**copy link** (or the address bar) shares this exact tree: opening the link
sets them all again.

A theme sets every colour in the panel, and the shadows' darkness. A species
puts on its own size, main limbs, spread, clumps, droop, crookedness, trunk
thickness, base flare, trunk height, clump size, cards per clump, leaf
texture, card size, roundness, wind strength, leaf flutter and falling
amount. A reset goes back to the current theme's and species' values. The
debug views are only there to look at how the tree is made: they stay out of
the address, so a link always opens without them.

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
| age | the leaves through a year: unfolding at 0, full grown by 0.25, turning from 0.45, bare at 1. See [What it does](#what-it-does) |
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

## Files

| file | what's in it |
| --- | --- |
| `main.js` | the scene, the panel and the render loop |
| `bar.js` | the buttons at the bottom: new tree, and export with its menu |
| `code-view.js` | the material button and its code window, the snippets read out of this README |
| `repo-link.js` | the GitHub sticker in the bottom right corner |
| `image-drop.js` | dropping or picking an image for the leaves, and keeping it |
| `hologram.js` | the tree as a hologram while an image is dragged over the page, and the scan that puts the new leaves on |
| `themes.js` | the colour themes and the buttons along the top picking them |
| `species-buttons.js` | the buttons down the left picking the species |
| `vertex-count.js` | the card counting the vertices the export will write |
| `stickers.js` | the round sticker buttons both rows are made of |
| `transition.js` | the sweep from one theme to the next |
| `shake.js` | a theme's front hitting the tree: its squash and bounce, the camera's shake, the gust and the leaves knocked off |
| `icons/` | the theme buttons' icons |
| `docs/` | the GIF at the top of this README |
| `wood.js` | the wood every species is built from: branches as tubes, and the growing data |
| `oak.js` | the oak: its branching and leaf clumps, its icon, sliders and settings |
| `pine.js` | the pine: its whorls and leaf clumps, its icon, sliders and settings |
| `cypress.js` | the cypress: its spiral of climbing branches and leaf clumps, its icon, sliders and settings |
| `willow.js` | the willow: its limbs, hanging strands and leaf clumps, its icon, sliders and settings |
| `bush.js` | the bush: its leaf clumps, its icon, sliders and settings |
| `foliage.js` | the leaf cards, their shading, the painted textures and a dropped image's |
| `shading.js` | lights, shadows, cel ramps, Neutral tone mapping, wood and floor |
| `grass.js` | the grass patch round the tree's foot |
| `wind.js` | the sway and the leaf flutter |
| `falling-leaves.js` | the falling leaves, on the GPU |
| `reveal.js` | the page opening on the scene once it has loaded, in a ragged circle from the tree |
| `framing.js` | the camera backing away until the whole tree fits on screen |
| `regenerate.js` | a new tree, from a new seed or species: the burst, the shrink and the springy pop |
| `glb.js` | the GLB export: the tree or its impostor |
| `textures.js` | how a GLB writes its textures as PNGs |
| `bounds.js` | the tree's bounds and vertices, for the sprite sheet and the impostor |
| `capture.js` | the texture, the sprite sheet and the impostor's atlas, drawn from the scene |
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

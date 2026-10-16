# Just a simple tree

A procedural oak with anime-style leaves, in three.js with WebGPU and TSL.
Every branch and leaf is generated from a seed; nothing is modelled or
loaded, and the leaf textures are painted in code at startup.

## Run it

```sh
pnpm install
pnpm dev
```

It needs a browser with WebGPU, such as a recent Chrome or Edge.

## What it does

- **The tree** grows from a seed: a short trunk splitting into limbs, each
  branching again, crooked and tapered, with rounded tips and collars where
  branches meet.
- **The leaves** are flat cards scattered over a clump at each free branch
  tip. They borrow the clump's normals instead of their own, so a clump
  shades like one soft ball, and go through a hard-edged cel colour ramp.
- **Ambient occlusion** is worked out per card on the CPU, treating each
  clump as a leafy volume, so the colours depend on the sun and never on the
  camera.
- **Lights**: a sun with shadows and a sky-and-ground hemisphere light; their
  colours tint the bands. The floor only draws the shadow, so it blends into
  any background colour.
- **Wind** sways the whole tree and rocks each leaf card; **falling leaves**
  drift downwind and settle on the floor, simulated with a compute shader.

## The panel

Every setting lives in three's WebGPU Inspector (the button at the top
right): the tree's shape, the leaf clumps and cards, wind, falling leaves,
colours and themes, lights, shadows, tone mapping, and a few debug views.
Each section and folder has its own reset, the filter box finds a setting by
name, and **copy config** copies every value as JSON.

## Files

| file | what's in it |
| --- | --- |
| `main.js` | the scene, the panel and the render loop |
| `oak.js` | the seeded tree generator and its leaf clumps |
| `foliage.js` | the leaf cards, their shading and the painted textures |
| `shading.js` | lights, shadows, cel ramps, tone mapping, wood and floor |
| `wind.js` | the sway and the leaf flutter |
| `falling-leaves.js` | the falling leaves, on the GPU |
| `inspector-filter.js` | the filter box for the Inspector |
| `inspector-tools.js` | the reset and copy config buttons |

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

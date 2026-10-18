import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { Item } from "three/addons/inspector/ui/Item.js";
import { createValueSpan } from "three/addons/inspector/ui/utils.js";
import { addParameterFilter, setAvailable } from "./inspector-filter.js";
import {
  addCopyConfig,
  addReset,
  addShareLink,
  closeAll,
  onChangeNow,
  openSection,
  trackFolders,
} from "./inspector-tools.js";
import { oak } from "./oak.js";
import { pine } from "./pine.js";
import { cypress } from "./cypress.js";
import { willow } from "./willow.js";
import { bush } from "./bush.js";
import {
  createFoliage,
  fallingTexture,
  LEAF_TEXTURES,
  OWN_TEXTURE,
  ownLeaves,
} from "./foliage.js";
import { createImageDrop } from "./image-drop.js";
import { createFallingLeaves } from "./falling-leaves.js";
import { createGrass } from "./grass.js";
import { createRegenerate } from "./regenerate.js";
import { createBar } from "./bar.js";
import { exportGlb } from "./glb.js";
import { createCapture, download, encode, MAX_ATLAS } from "./capture.js";
import { bounds, levelsOfDetail, levelVertices, MAX_LEVELS } from "./lod.js";
import { createThemeButtons, START_THEME, THEMES } from "./themes.js";
import { createSpeciesButtons } from "./species-buttons.js";
import { createVertexCount } from "./vertex-count.js";
import { sweep, sweptBackground } from "./transition.js";
import { createShake } from "./shake.js";
import {
  barkColors,
  barkMaterial,
  exposure,
  toneMappingType,
  TONE_MAPPINGS,
  groundMaterial,
  hemisphere,
  shadowColor,
  shadowDarkness,
  sun,
  sunDirection,
} from "./shading.js";
import { swayedWood, wind } from "./wind.js";
import { positionGeometry } from "three/tsl";

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(THEMES[START_THEME].background);
// Drawn through the theme sweep; the Color stays the one the panel picks
scene.backgroundNode = sweptBackground(scene);

// A long lens flattens the tree, like a painting
const camera = new THREE.PerspectiveCamera(
  20,
  innerWidth / innerHeight,
  1,
  200,
);
camera.position.set(0, 5, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3.5, 0);
controls.enableDamping = true;
// Zoom: never into the crown, and never so far that the far plane cuts the
// tree or its shadow, which reach about 20 metres beyond what it looks at
controls.minDistance = 10;
controls.maxDistance = camera.far - 20;

// The camera never goes below the ground: it may come down to just above it,
// however far it is, and panning never takes what it looks at below it
const LOWEST = 0.2; // metres above the ground
function keepAboveGround() {
  controls.target.y = Math.max(controls.target.y, LOWEST);
  const distance = camera.position.distanceTo(controls.target);
  controls.maxPolarAngle = Math.acos(
    THREE.MathUtils.clamp((LOWEST - controls.target.y) / distance, -1, 1),
  );
}

// The sun, and a sky-and-ground fill for what it doesn't reach
scene.add(sun);
scene.add(hemisphere);

// A floor that only shows the tree's shadow, so it melts into the background
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  groundMaterial(),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const params = {
  species: "oak",
  seed: 8967,
  size: 5.27,
  trunkThickness: 0.21,
  splitHeight: 0.34,
  mainLimbs: 3,
  levels: 1,
  branches: 4,
  whorls: 9, // the pine's tiers of branches
  whorlBranches: 6,
  droop: -1,
  slenderness: 1, // the cypress's: higher, narrower
  cypressBranches: 20,
  willowStrands: 111, // the willow's hanging strands
  hang: 0.91, // how far down towards the ground they hang
  bushClumps: 1, // the bush's leaf clumps
  spread: 0.9,
  crookedness: 0.5,
  sides: 10,
  smoothness: 3,
  variety: 1, // how far each seed's own character takes its tree from its species' average
  cardsPerClump: 35,
  clumpSize: 1, // scales every leaf clump, and its cards with it
  aoDistance: 2.5, // the tutorial's AO node distance
  leafTexture: "round cluster",
  leafColors: "theme", // or "image": a dropped image's own colours
  showClumps: false,
  wireframe: false,
  leaves: true,
  showTexture: true,
  normals: "transferred",
  showNormals: false,
  sunAngle: 1.07840734641021,
  sunHeight: 0.49,
};

// A small round patch of grass at the tree's foot
const grass = createGrass();
scene.add(grass.mesh);

const tree = new THREE.Mesh(new THREE.BufferGeometry(), barkMaterial());
tree.castShadow = true;
tree.receiveShadow = true;
scene.add(tree);

// The wood's wireframe, swaying with it, to see its vertices
const wireframe = new THREE.Mesh(
  tree.geometry,
  new THREE.MeshBasicNodeMaterial({ color: "#1e1e1e", wireframe: true }),
);
wireframe.material.positionNode = swayedWood(positionGeometry);
wireframe.visible = false;
scene.add(wireframe);

// The leaf cards, and the clumps they're scattered over, hidden
const foliage = createFoliage();
scene.add(foliage.mesh, foliage.clumps);

// Leaves falling from the crown, in the foliage's colours
const falling = createFallingLeaves({
  colors: foliage.uniforms.colors,
  imageColors: foliage.uniforms.imageColors,
  crownCenter: foliage.uniforms.crownCenter,
  crownSize: foliage.uniforms.crownSize,
});
scene.add(falling.mesh);

// The leaf texture, on the cards and on what falls from them. Your image is
// one dropped on the page or picked with the panel's button: picked in the
// panel before there is one, it opens the file picker, and the leaves keep
// what they wear until an image comes. Its leaves take the theme's colours
// or its own
let own = null;
function setLeafTexture(name) {
  const mine = name === OWN_TEXTURE;
  if (mine && !own) {
    if (navigator.userActivation?.isActive) imageDrop.pick();
    return;
  }
  foliage.setLeafTexture(name, own);
  falling.setTexture(mine ? own.leaves : fallingTexture(name), own?.colors);
  showLeafColors();
}
function showLeafColors() {
  const mine = params.leafTexture === OWN_TEXTURE && own;
  foliage.uniforms.imageColors.value =
    mine && params.leafColors === "image" ? 1 : 0;
}
setLeafTexture(params.leafTexture);

// A new image puts itself on the leaves, in its own colours when it has
// transparency to cut them out with, in the theme's when it's a mask of
// white leaves on black. The one kept from last time only comes back for a
// link that asks for it
const imageDrop = createImageDrop({
  onImage: (image, { restored }) => {
    own = ownLeaves(image);
    if (!restored) {
      leafColorsControl.setValue(own.transparent ? "image" : "theme");
    }
    if (params.leafTexture === OWN_TEXTURE) setLeafTexture(OWN_TEXTURE);
    else if (!restored) leafTextureControl.setValue(OWN_TEXTURE);
  },
});

// How many vertices the GLB would hold, the wood's and the leaves', kept up
// to date as the tree is rebuilt and its cards are cut up. Each level of
// tree + LODs is counted in the panel, a moment after the tree stops
// changing, as each lighter level grows its wood and scatters its cards again
const vertexCount = createVertexCount();
const LEVELS_DELAY = 300; // milliseconds after the last change
let levelsTimer = 0;
function countVertices() {
  vertexCount.show(
    tree.geometry.attributes.position.count,
    foliage.bakedVertices(),
  );
  clearTimeout(levelsTimer);
  levelsTimer = setTimeout(countLevels, LEVELS_DELAY);
}

// Each species grows its wood and leaf clumps its own way, and brings its
// name, icon, own shape sliders and own settings
const SPECIES = { oak, pine, cypress, willow, bush };

// Sliders send a change on every step of a drag: the tree is rebuilt once
// per frame at most, with the latest values. A leaf setting that leaves the
// clumps where they are only scatters the cards again. While a new tree is
// on its way, the old one is held until it has folded away
let rebuildWanted = false;
let leavesWanted = false;
let held = false;
function requestRebuild() {
  rebuildWanted = true;
}
function requestLeaves() {
  leavesWanted = true;
}
function rebuildIfWanted() {
  if (held) return;
  // Cleared first, so a rebuild that fails isn't tried again every frame
  const regrow = rebuildWanted;
  const rescatter = leavesWanted;
  rebuildWanted = leavesWanted = false;
  if (regrow) rebuild();
  else if (rescatter) scatterLeaves();
}

let grown;
function rebuild() {
  grown = SPECIES[params.species].grow(params);
  tree.geometry.dispose();
  tree.geometry = grown.geometry;
  wireframe.geometry = grown.geometry;
  // The sway grows towards the top of the wood, or of the leaves on a bush
  // that has none
  grown.geometry.computeBoundingBox();
  wind.height.value = grown.geometry.attributes.position.count
    ? grown.geometry.boundingBox.max.y
    : Math.max(...grown.clumps.map((c) => c.position.y + c.radius));
  scatterLeaves();
}

function scatterLeaves() {
  foliage.update(grown.clumps, params);
  countVertices();
}

function placeSun() {
  const h = params.sunHeight;
  const a = params.sunAngle;
  sunDirection.value.set(
    Math.cos(h) * Math.sin(a),
    Math.sin(h),
    Math.cos(h) * Math.cos(a),
  );
  sun.position.copy(sunDirection.value).multiplyScalar(30);
}

placeSun();
rebuild();

// Controls live in three's WebGPU Inspector, in its Parameters tab. Each
// section holds everything about its part, its colours and its debug views
// included
renderer.inspector = new Inspector();

// A ramp's colours, one picker each on the uniforms' own colours (the
// Inspector reads and writes them as sRGB hex). Returns the pickers, so a
// theme can set them
function addRamp(folder, uniforms, names) {
  return uniforms.map((uniform, i) =>
    folder.addColor(uniform, "value").name(names[i]),
  );
}
// A theme picked from the panel or a button sweeps in from the bottom left
// (transition.js). When its front reaches the tree, it hits it: the tree
// squashes and bounces back, the camera is knocked and shakes, and a gust
// blows through the tree and knocks a handful of leaves off it (shake.js).
// Picks stack: each sends its own sweep after the ones still going, and each
// front lands its own hit. The panel's controls take the theme at once,
// through what it binds, so they show it and the address keeps it. While the
// page opens, a theme lands at once: the first one, then one from its address
let themeSeconds = 0;
let themeName = START_THEME;
const shake = createShake({
  camera,
  falling,
  tree: [tree, wireframe, foliage.mesh, foliage.clumps],
  leaves: foliage.mesh,
  crownCenter: foliage.uniforms.crownCenter,
});
function pickTheme(name) {
  themeName = name;
  themeButtons.show(name);
  if (themeSeconds) {
    sweep(themeSeconds);
    shake.start(themeSeconds);
  }
  for (const [control, value] of themeBindings) {
    control.setValue(value(THEMES[name]));
  }
}

// A new tree, with a burst, from a new seed or a new species. When the old
// tree has folded away, the new one is rebuilt at once, not left for the
// next frame
const { regrow } = createRegenerate({
  hold: (on) => {
    held = on;
    if (!on) rebuildIfWanted();
  },
  falling,
});
// A new seed: from the button at the bottom or space, even while a tree
// grows. It resolves once the latest tree has grown. It goes through its
// slider, so the panel shows it
function newTree() {
  seedControl.setValue(1 + Math.floor(Math.random() * 9999));
  return regrow();
}

const treeSection = renderer.inspector.createParameters("Tree");
trackFolders(treeSection);
// The Inspector runs onChange a tick after a change. Picking a theme, a
// species or a seed sets off more changes, so those run at once, with onChangeNow
// A theme sets the wood's colours here, the leaves' in their section, and
// the background and shadows in the lights'. The buttons at the top left pick
// it here too, so the panel and the address follow them
const themeControl = onChangeNow(
  treeSection.add({ theme: START_THEME }, "theme", Object.keys(THEMES)),
  pickTheme,
);
const themeButtons = createThemeButtons({
  onPick: (name) => themeControl.setValue(name),
});
themeButtons.show(START_THEME);
// The species picks the shape rules; only its own sliders show in the shape
// folder. The buttons down the left pick it here too, so the panel and the
// address follow them. Once the page has opened, a species picked grows in
// as a new tree does
let speciesRegrows = false;
const speciesControl = treeSection.add(
  params,
  "species",
  Object.keys(SPECIES),
);
const speciesButtons = createSpeciesButtons({
  species: SPECIES,
  onPick: (name) => speciesControl.setValue(name),
});
// The tree's shape, its trunk and its mesh in one folder. The mesh: sides
// round each branch, and rings per kink along a curve through them. Its
// normals are smooth; more sides smooth the edges of the cel bands too. The
// wireframe shows its vertices, alone
const shape = treeSection.addFolder("shape");
const seedControl = onChangeNow(
  shape.add(params, "seed", 1, 9999, 1),
  requestRebuild,
);
// Every shape slider, in the panel's order: its range, its step and its
// name, where those differ from a slider's own. A species shows the ones it
// lists as its own, and the ones no species lists show for all
const SHAPE_SLIDERS = {
  size: { min: 2, max: 8 },
  mainLimbs: { min: 3, max: 6, step: 1, name: "main limbs" },
  levels: { min: 0, max: 4, step: 1 },
  branches: { min: 2, max: 5, step: 1 },
  spread: { min: 0.3, max: 1.3 },
  droop: { min: -1, max: 1 }, // how the conifers' branches bend: down past 0, up below it
  whorls: { min: 3, max: 16, step: 1 },
  whorlBranches: { min: 3, max: 9, step: 1, name: "branches per whorl" },
  slenderness: { min: 0.5, max: 2 },
  cypressBranches: { min: 10, max: 90, step: 1, name: "branch count" },
  willowStrands: { min: 20, max: 300, step: 1, name: "strands" },
  hang: { min: 0.1, max: 1 },
  bushClumps: { min: 1, max: 20, step: 1, name: "clumps" },
  crookedness: { min: 0, max: 1.5 },
  trunkThickness: { min: 0.1, max: 0.6, name: "trunk thickness" },
  splitHeight: { min: 0.15, max: 0.6, name: "split height" },
  sides: { min: 3, max: 24, step: 1 },
  smoothness: { min: 1, max: 8, step: 1 },
  variety: { min: 0, max: 1 },
};
const shapeControls = {};
for (const [key, { min, max, step, name = key }] of Object.entries(
  SHAPE_SLIDERS,
)) {
  shapeControls[key] = shape
    .add(params, key, min, max, step)
    .name(name)
    .onChange(requestRebuild);
}
// A slider may belong to more than one species, like the droop or the main
// limbs. A species without wood, the bush, hides everything that only
// changes the wood too: these sliders, the wireframe and the wood's colours.
// One that drops no leaves, the bush again, has none falling, not even
// those a theme's gust knocks off, and hides their section
const ownSliders = new Set(Object.values(SPECIES).flatMap((s) => s.sliders));
const woodControls = ["crookedness", "trunkThickness", "sides", "smoothness"].map(
  (key) => shapeControls[key],
);
function showSpecies() {
  const {
    sliders,
    woodless = false,
    dropsLeaves = true,
  } = SPECIES[params.species];
  for (const key of ownSliders) {
    setAvailable(shapeControls[key], sliders.includes(key));
  }
  for (const control of woodControls) setAvailable(control, !woodless);
  if (woodless) wireframeControl.setValue(false);
  setAvailable(fall, dropsLeaves);
  falling.mesh.visible = dropsLeaves;
}
// The settings a species puts on when it's picked, among those they all
// share, the way a theme puts on its colours: its own where it gives them,
// the page's starting ones, the oak's, where it doesn't. Each is marked as
// one with speciesSetting as its control is made
const speciesSettings = {};
const startingSettings = {};
function speciesSetting(key, control) {
  speciesSettings[key] = control;
  startingSettings[key] = control.getValue();
  return control;
}
const SHAPE_SETTINGS = [
  "size",
  "mainLimbs",
  "spread",
  "bushClumps",
  "droop",
  "crookedness",
  "trunkThickness",
];
for (const key of SHAPE_SETTINGS) speciesSetting(key, shapeControls[key]);
const speciesDefault = (key) =>
  SPECIES[params.species].settings[key] ?? startingSettings[key];
onChangeNow(speciesControl, () => {
  speciesButtons.show(params.species);
  showSpecies();
  for (const [key, control] of Object.entries(speciesSettings)) {
    control.setValue(speciesDefault(key));
  }
  requestRebuild();
  if (speciesRegrows) regrow();
});
speciesButtons.show(params.species);
// The debug views, kept out of the page's address, so a reload or a shared
// link always starts without them
const debugControls = [];
function debugView(control) {
  debugControls.push(control);
  return control;
}

const wireframeControl = debugView(shape.add(params, "wireframe")).onChange(
  (v) => {
    wireframe.visible = v;
    tree.visible = !v;
  },
);
const woodColors = treeSection.addFolder("colors");
const woodPickers = addRamp(woodColors, barkColors, [
  "shadow",
  "mid",
  "light",
]);
woodControls.push(wireframeControl, woodColors);

// The buttons at the bottom: a new tree, and exporting it, from a menu in
// two groups, 3D models and images, each choice's purpose in its tooltip:
// the tree as a GLB for a plain MeshStandardMaterial (the README has the snippet
// that puts the cel look back), on its own or with its levels of detail,
// lighter copies for farther away and an impostor last if asked; a picture
// from the camera; a sprite sheet of views round it; or an impostor, a quad
// showing an atlas of views over the sky above it. How each goes is set in
// the panel's Export section, which the menu's last choice opens
const exportParams = {
  levels: 3, // tree + LODs': the tree and its lighter copies
  impostorLevel: true,
  pictureSize: "2048",
  imageFormat: "png", // the picture's and the sprite sheet's, png or webp
  pictureAlpha: false, // RGBA on a clear background, rather than RGB on the theme's
  spriteAngles: "8",
  spriteSize: "256",
  spriteElevation: 10, // degrees above level
  impostorFrames: "8",
  impostorSize: "256",
};
const capture = createCapture({
  renderer,
  scene,
  loop: frame,
  scenery: [ground, grass.mesh, falling.mesh],
  tree: [tree, wireframe, foliage.mesh, foliage.clumps],
});
const fileName = (kind, extension) =>
  `${params.species}-${params.seed}${kind ? `-${kind}` : ""}.${extension}`;
// The impostor's atlas, its frames no bigger than the atlas allows
async function impostorOf() {
  const sphere = bounds(tree.geometry, foliage);
  const frames = Number(exportParams.impostorFrames);
  const size = Math.min(
    Number(exportParams.impostorSize),
    Math.floor(MAX_ATLAS / frames),
  );
  const atlas = await capture.impostor(sphere, { frames, size });
  return { atlas, frames, center: sphere.center, radius: sphere.radius };
}
const EXPORTS = [
  {
    group: "3D models",
    label: "tree",
    use: "the tree as you see it, for Blender, Unity, Godot or three.js",
    run: async () =>
      exportGlb({
        levels: [{ wood: tree.geometry, leaves: foliage.bake() }],
        foliage,
        barkColors,
        species: params.species,
        seed: params.seed,
      }),
  },
  {
    group: "3D models",
    label: "tree + LODs",
    use: "the tree and lighter copies of it for farther away, for games",
    run: async () =>
      exportGlb({
        levels: levelsOfDetail({
          count: exportParams.levels,
          params,
          grow: (lighter) => SPECIES[params.species].grow(lighter),
          wood: tree.geometry,
          clumps: grown.clumps,
          foliage,
        }),
        impostor: exportParams.impostorLevel ? await impostorOf() : null,
        foliage,
        barkColors,
        species: params.species,
        seed: params.seed,
        name: fileName("lods", "glb"),
      }),
  },
  {
    group: "images",
    label: "picture",
    use: "this view, as you see it",
    run: async () => {
      const canvas = await capture.picture(camera, {
        size: Number(exportParams.pictureSize),
        transparent: exportParams.pictureAlpha,
      });
      const { blob, extension } = await encode(
        canvas,
        exportParams.imageFormat,
      );
      download(blob, fileName("", extension));
    },
  },
  {
    group: "images",
    label: "sprite sheet",
    use: "views all round the tree, for 2D games",
    run: async () => {
      const count = Number(exportParams.spriteAngles);
      const size = Math.min(
        Number(exportParams.spriteSize),
        Math.floor(MAX_ATLAS / 4),
      );
      const { canvas } = await capture.sprites(
        bounds(tree.geometry, foliage),
        {
          count,
          size,
          elevation: THREE.MathUtils.degToRad(exportParams.spriteElevation),
        },
      );
      const { blob, extension } = await encode(
        canvas,
        exportParams.imageFormat,
      );
      download(blob, fileName(`sprites-${count}`, extension));
    },
  },
  {
    group: "3D models",
    label: "impostor",
    use: "a flat card that looks 3D, for trees far away",
    run: async () =>
      exportGlb({
        levels: [],
        impostor: await impostorOf(),
        foliage,
        barkColors,
        species: params.species,
        seed: params.seed,
        name: fileName("impostor", "glb"),
      }),
  },
];
const bar = createBar({
  onNewTree: newTree,
  exports: EXPORTS,
  onSettings: () => {
    openSection(renderer.inspector, exporting);
    countLevels();
  },
});

// The keys: space grows a new tree, left and right step through the themes,
// as their buttons run along the top, and up and down through the species,
// as theirs run down the left side, round from either end. Each goes through
// the panel's control, as a click does. Not while a field in the panel has
// them, nor while the export menu is open, its choices taking the arrows.
// Held down, an arrow steps once
const KEY_STEPS = {
  ArrowLeft: ["theme", -1],
  ArrowRight: ["theme", 1],
  ArrowUp: ["species", -1],
  ArrowDown: ["species", 1],
};
const stepped = (keys, current, by) =>
  keys[(keys.indexOf(current) + by + keys.length) % keys.length];
addEventListener("keydown", (e) => {
  const field = e.target.closest?.("input, select, textarea");
  if (field) return;
  if (e.code === "Space") {
    e.preventDefault();
    bar.newTree();
    return;
  }
  const step = KEY_STEPS[e.key];
  if (!step || e.altKey || e.ctrlKey || e.metaKey || bar.menuOpen()) return;
  e.preventDefault();
  if (e.repeat) return;
  const [what, by] = step;
  if (what === "theme") {
    const themes = Object.keys(THEMES);
    themeControl.setValue(stepped(themes, themeControl.getValue(), by));
  } else {
    const species = Object.keys(SPECIES);
    speciesControl.setValue(stepped(species, params.species, by));
  }
});

const leafSection = renderer.inspector.createParameters("Leaves");
// The clumps the cards are scattered over, one on each free branch tip:
// clump size grows them all, and bigger clumps get more cards
const clumps = leafSection.addFolder("clumps");
speciesSetting(
  "clumpSize",
  clumps
    .add(params, "clumpSize", 0.3, 3)
    .name("clump size")
    .onChange(requestRebuild),
);
speciesSetting(
  "cardsPerClump",
  clumps
    .add(params, "cardsPerClump", 1, 160, 1)
    .name("cards per clump")
    .onChange(requestLeaves),
);
debugView(clumps.add(params, "showClumps"))
  .name("show clumps")
  .onChange((v) => (foliage.clumps.visible = v));
const cards = leafSection.addFolder("cards");
debugView(cards.add(params, "leaves"))
  .name("show leaves")
  .onChange(foliage.setShown);
const leafTextureControl = speciesSetting(
  "leafTexture",
  cards
    .add(params, "leafTexture", LEAF_TEXTURES)
    .name("texture")
    .onChange(setLeafTexture),
);
cards.add({ "load image…": imageDrop.pick }, "load image…");
const leafColorsControl = cards
  .add(params, "leafColors", ["theme", "image"])
  .name("colors from")
  .onChange(showLeafColors);
debugView(cards.add(params, "showTexture"))
  .name("show texture")
  .onChange((v) => (foliage.uniforms.textured.value = v ? 1 : 0));
speciesSetting(
  "cardSize",
  cards.add(foliage.uniforms.cardSize, "value", 0.1, 3).name("size"),
);
// How many squares each card is cut into, and how far they wrap round their
// clump's sphere. Segments only show once roundness bends them
const SEGMENTS = { "1 × 1": 1, "2 × 2": 2, "3 × 3": 3, "4 × 4": 4 };
cards
  .add({ segments: "2 × 2" }, "segments", Object.keys(SEGMENTS))
  .onChange((name) => {
    foliage.setSegments(SEGMENTS[name]);
    countVertices();
  });
speciesSetting(
  "roundness",
  cards.add(foliage.uniforms.roundness, "value", 0, 1).name("roundness"),
);
const leafShading = leafSection.addFolder("shading");
leafShading
  .add(foliage.uniforms.shadowSide, "value", 0, 1, 0.005)
  .name("shadow side");
leafShading.add(foliage.uniforms.ao, "value", 0, 1).name("ao");
leafShading
  .add(params, "aoDistance", 0.25, 6)
  .name("ao distance")
  .onChange(requestLeaves);
debugView(
  leafShading.add(params, "normals", ["transferred", "flat card"]),
).onChange(
  (v) => (foliage.uniforms.flatNormals.value = v === "flat card" ? 1 : 0),
);
debugView(leafShading.add(params, "showNormals"))
  .name("show normals")
  .onChange((v) => (foliage.uniforms.showNormals.value = v ? 1 : 0));
const leafPickers = addRamp(
  leafSection.addFolder("colors"),
  foliage.uniforms.colors,
  ["shadow", "mid", "light"],
);

const breeze = renderer.inspector.createParameters("Wind");
breeze.add(wind.direction, "value", -Math.PI, Math.PI).name("direction");
speciesSetting(
  "wind",
  breeze.add(wind.strength, "value", 0, 1).name("strength"),
);
breeze.add(wind.speed, "value", 0, 3).name("speed");
breeze.add(wind.frequency, "value", 0.05, 1).name("gust size");
speciesSetting(
  "flutter",
  breeze.add(wind.flutter, "value", 0, 1).name("leaf flutter"),
);

// The patch round the tree's foot: its size and blades, how hard the wind
// blows it, and its shading
const lawn = renderer.inspector.createParameters("Grass");
const blades = lawn.addFolder("blades");
blades.add(grass.uniforms.radius, "value", 0.5, 5).name("patch radius");
blades
  .add(
    { count: grass.mesh.geometry.instanceCount },
    "count",
    0,
    grass.CAPACITY,
    1,
  )
  .onChange(grass.setCount);
blades.add(grass.uniforms.height, "value", 0.05, 1).name("height");
blades.add(grass.uniforms.width, "value", 0.01, 0.2).name("width");
blades.add(grass.uniforms.wind, "value", 0, 3).name("wind strength");
const lawnShading = lawn.addFolder("shading");
lawnShading.add(grass.uniforms.shade, "value", 0, 1).name("in shadow");
const grassPickers = addRamp(lawn.addFolder("colors"), grass.uniforms.colors, [
  "root",
  "tip",
]);

const fall = renderer.inspector.createParameters("Falling leaves");
speciesSetting(
  "falling",
  fall
    .add(falling.uniforms.amount, "value", 0, falling.MAX_LEAVES, 1)
    .name("amount"),
);
fall.add(falling.uniforms.size, "value", 0.05, 0.8).name("leaf size");
fall.add(falling.uniforms.fallSpeed, "value", 0.1, 3).name("fall speed");
fall.add(falling.uniforms.lifetime, "value", 3, 40).name("lifetime");

// The lights' colours reach the tree and leaves: their cel band follows the
// light's brightness, their tint its colour
const light = renderer.inspector.createParameters("Lights");
// The background, as picked: tone mapping runs in the tree's materials, not
// over the frame. The floor only draws shadow, so it follows on its own
const backgroundPicker = light.addColor(scene, "background").name("background");
const sunFolder = light.addFolder("sun");
sunFolder
  .add(params, "sunAngle", -Math.PI, Math.PI)
  .name("angle")
  .onChange(placeSun);
sunFolder.add(params, "sunHeight", 0.1, 1.5).name("height").onChange(placeSun);
sunFolder.add(sun, "intensity", 0, 15).name("intensity");
sunFolder.addColor(sun, "color").name("color");
const skyFolder = light.addFolder("hemisphere");
skyFolder.add(hemisphere, "intensity", 0, 5).name("intensity");
skyFolder.addColor(hemisphere, "color").name("sky color");
skyFolder.addColor(hemisphere, "groundColor").name("ground color");
const shadowFolder = light.addFolder("shadows");
const shadowColorPicker = shadowFolder
  .addColor(shadowColor, "value")
  .name("color");
const darknessControl = shadowFolder
  .add(shadowDarkness, "value", 0, 1)
  .name("darkness");
// Tone mapping of the tree and leaves: its type, and its exposure
const toneFolder = light.addFolder("tone mapping");
toneFolder
  .add({ type: "neutral" }, "type", Object.keys(TONE_MAPPINGS))
  .name("type")
  .onChange((name) => (toneMappingType.value = TONE_MAPPINGS[name]));
toneFolder.add(exposure, "value", 0.1, 3).name("exposure");

// How the export menu's choices are made: the images' format, PNG or a
// lossless WebP; the tree's levels of detail, and
// an impostor as its last; the picture's size and background; the sprite
// sheet's views, their size and how far above level they look from; the
// impostor's views a side and their size
const exporting = renderer.inspector.createParameters("Export");
exporting
  .add(exportParams, "imageFormat", ["png", "webp"])
  .name("image format");
const modelFolder = exporting.addFolder("tree + LODs");
modelFolder
  .add(exportParams, "levels", 2, MAX_LEVELS, 1)
  .name("levels of detail")
  .onChange(countLevels);
modelFolder
  .add(exportParams, "impostorLevel")
  .name("impostor level")
  .onChange(countLevels);
// Under them, how many vertices each level would hold, the first being the
// tree itself. They're only counted while the folder is open, and when it
// opens
const IMPOSTOR_VERTICES = 4; // its one quad's
const levelRows = Array.from({ length: MAX_LEVELS + 1 }, () => {
  const name = createValueSpan();
  const value = createValueSpan();
  const row = new Item(name, value);
  modelFolder.paramList.add(row);
  setAvailable(row, false);
  return { row, name, value };
});
function countLevels() {
  if (!exporting.paramList.isOpen || !modelFolder.paramList.isOpen) return;
  const counts = levelVertices({
    count: exportParams.levels,
    params,
    grow: (lighter) => SPECIES[params.species].grow(lighter),
    wood: tree.geometry,
    clumps: grown.clumps,
    foliage,
  });
  const levels = counts.map((vertices, i) => [`LOD${i}`, vertices]);
  if (exportParams.impostorLevel) {
    levels.push([`LOD${counts.length} impostor`, IMPOSTOR_VERTICES]);
  }
  levelRows.forEach(({ row, name, value }, i) => {
    setAvailable(row, i < levels.length);
    if (i >= levels.length) return;
    name.textContent = levels[i][0];
    value.textContent = `${levels[i][1].toLocaleString("en-US")} vertices`;
  });
}
for (const group of [exporting, modelFolder]) {
  group.paramList.itemRow.addEventListener("click", countLevels);
}
const pictureFolder = exporting.addFolder("picture");
pictureFolder
  .add(exportParams, "pictureSize", ["1024", "2048", "4096"])
  .name("size");
pictureFolder
  .add(exportParams, "pictureAlpha")
  .name("transparent (RGBA)");
const spriteFolder = exporting.addFolder("sprite sheet");
spriteFolder
  .add(exportParams, "spriteAngles", ["4", "8", "16"])
  .name("views");
spriteFolder
  .add(exportParams, "spriteSize", ["128", "256", "512"])
  .name("frame size");
spriteFolder
  .add(exportParams, "spriteElevation", 0, 60, 1)
  .name("elevation");
const impostorFolder = exporting.addFolder("impostor");
impostorFolder
  .add(exportParams, "impostorFrames", ["6", "8", "12", "16"])
  .name("views a side");
impostorFolder
  .add(exportParams, "impostorSize", ["128", "256", "512"])
  .name("frame size");

// Every control a theme sets, and its value in a theme. The page starts in
// its first theme
const themeBindings = [
  ...leafPickers.map((picker, i) => [picker, (theme) => theme.leaves[i]]),
  ...woodPickers.map((picker, i) => [picker, (theme) => theme.wood[i]]),
  ...grassPickers.map((picker, i) => [picker, (theme) => theme.grass[i]]),
  [backgroundPicker, (theme) => theme.background],
  [shadowColorPicker, (theme) => theme.shadow.color],
  [darknessControl, (theme) => theme.shadow.darkness],
];
pickTheme(START_THEME);
const sections = [
  treeSection,
  leafSection,
  breeze,
  lawn,
  fall,
  light,
  exporting,
];
showSpecies();
// The controls a theme or species sets, and where it puts them now
const following = new Map([
  ...Object.entries(speciesSettings).map(([key, control]) => [
    control,
    () => speciesDefault(key),
  ]),
  ...themeBindings.map(([control, value]) => [
    control,
    () => value(THEMES[themeName]),
  ]),
]);
// A reset button under each section, and a copy-config button always in view
// under them all. What a theme sets resets to the theme picked now, not to
// the one the page opened on, and reset keeps the theme. What a species sets
// resets to the species picked now, and reset keeps the species too
const themed = new Map([
  [themeControl, () => themeName],
  [speciesControl, () => params.species],
  ...following,
]);
sections.forEach((section) => addReset(section, themed));
addCopyConfig(renderer.inspector, sections);
// The address keeps every changed value but the debug views, so a link
// brings back this tree. What a theme or species sets counts as changed
// when it's away from where they put it, since the link puts them on first
addShareLink(sections, debugControls, following);
// Then the image kept from last time, for a link that asks for your image
imageDrop.restore();
// Now the address has landed, a theme picked eases in, and a species picked
// grows in
themeSeconds = 0.85;
speciesRegrows = true;

// Every section and folder starts closed, and so does the panel: the
// Inspector opens it as soon as parameters are added. Its button at the top
// right opens it
sections.forEach(closeAll);
renderer.inspector.profiler.hide();

// A filter box at the top of the Parameters tab
addParameterFilter(renderer.inspector);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// The page behind the canvas in the background's colour, and the browser's
// bars too where it tints them, so the edges a phone leaves round the canvas
// (beside the notch, under the home bar) match it instead of showing white.
// On a dark background, like night's, the buttons' shadows go black so they
// still stand out
const themeColor = document.querySelector('meta[name="theme-color"]');
let pageColor = -1;
function matchPage() {
  if (scene.background.getHex() === pageColor) return;
  pageColor = scene.background.getHex();
  const color = `#${scene.background.getHexString()}`;
  document.documentElement.style.background = document.body.style.background =
    color;
  themeColor.content = color;
  const { r, g, b } = scene.background;
  document.documentElement.classList.toggle(
    "dark",
    0.2126 * r + 0.7152 * g + 0.0722 * b < 0.05,
  );
}

renderer.setAnimationLoop(frame);
function frame() {
  matchPage();
  keepAboveGround();
  controls.update();
  shake.update(performance.now());
  rebuildIfWanted();
  falling.update(renderer);
  shake.draw(performance.now(), () => renderer.render(scene, camera));
}

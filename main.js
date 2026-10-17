import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { addParameterFilter, setAvailable } from "./inspector-filter.js";
import {
  addCopyConfig,
  addReset,
  addShareLink,
  closeAll,
  onChangeNow,
  trackFolders,
} from "./inspector-tools.js";
import { oak } from "./oak.js";
import { pine } from "./pine.js";
import { cypress } from "./cypress.js";
import { willow } from "./willow.js";
import { bush } from "./bush.js";
import { createFoliage, fallingTexture, LEAF_TEXTURES } from "./foliage.js";
import { createFallingLeaves } from "./falling-leaves.js";
import { createGrass } from "./grass.js";
import { createRegenerate } from "./regenerate.js";
import { createBar } from "./bar.js";
import { exportGlb } from "./glb.js";
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
  crownCenter: foliage.uniforms.crownCenter,
  crownSize: foliage.uniforms.crownSize,
});
scene.add(falling.mesh);

// The leaf texture, on the cards and on what falls from them
function setLeafTexture(name) {
  foliage.setLeafTexture(name);
  falling.setTexture(fallingTexture(name));
}
setLeafTexture(params.leafTexture);

// How many vertices the GLB would hold, the wood's and the leaves', kept up
// to date as the tree is rebuilt and its cards are cut up
const vertexCount = createVertexCount();
function countVertices() {
  vertexCount.show(
    tree.geometry.attributes.position.count,
    foliage.bakedVertices(),
  );
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
// (transition.js), and the camera shakes a little as it does, a gust blows
// through the tree and knocks a handful of leaves off it (shake.js). Picks
// stack: each sends its own sweep after the ones still going. The panel's
// controls take the theme at once, through what it binds, so they show it
// and the address keeps it. While the page opens, a theme lands at once: the
// first one, then one from its address
let themeSeconds = 0;
let themeName = START_THEME;
const shake = createShake({ camera, falling });
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

// The buttons at the bottom: a new tree, and the tree as a GLB for a plain
// MeshStandardMaterial (the README has the snippet that puts the cel look
// back)
const bar = createBar({
  onNewTree: newTree,
  onSave: () =>
    exportGlb({
      tree,
      foliage,
      barkColors,
      species: params.species,
      seed: params.seed,
    }),
});

addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  bar.newTree();
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
speciesSetting(
  "leafTexture",
  cards
    .add(params, "leafTexture", LEAF_TEXTURES)
    .name("texture")
    .onChange(setLeafTexture),
);
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
const sections = [treeSection, leafSection, breeze, lawn, fall, light];
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

renderer.setAnimationLoop(() => {
  matchPage();
  keepAboveGround();
  controls.update();
  shake.blow(performance.now());
  rebuildIfWanted();
  falling.update(renderer);
  shake.draw(performance.now(), () => renderer.render(scene, camera));
});

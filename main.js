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
  plainSliderBoxes,
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
  twigsShow,
} from "./foliage.js";
import { createImageDrop } from "./image-drop.js";
import { createFallingLeaves } from "./falling-leaves.js";
import { createGrass } from "./grass.js";
import { createRegenerate } from "./regenerate.js";
import { reveal } from "./reveal.js";
import { createBar } from "./bar.js";
import { createCodeView } from "./code-view.js";
import { createRepoLink } from "./repo-link.js";
import { createSound } from "./sound.js";
import { exportGlb } from "./glb.js";
import { createCapture, download, encode, MAX_ATLAS } from "./capture.js";
import { bounds, vertices } from "./bounds.js";
import { createThemeButtons, START_THEME, THEMES } from "./themes.js";
import { createSpeciesButtons } from "./species-buttons.js";
import { createVertexCount } from "./vertex-count.js";
import { createTimeSliders } from "./time-sliders.js";
import { sweep, sweptBackground } from "./transition.js";
import { createShake } from "./shake.js";
import { createFraming } from "./framing.js";
import { scanUp, showHologram, updateHologram } from "./hologram.js";
import {
  barkColors,
  barkMaterial,
  groundMaterial,
  hemisphere,
  shadowColor,
  shadowDarkness,
  sun,
  sunDirection,
} from "./shading.js";
import { swayedWood, wind } from "./wind.js";
import { growAged, MATURE } from "./tree-age.js";
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
// however far it is, and panning never takes what it looks at below it. Nor
// does it ever look quite level: it always looks down on the tree a little
const LOWEST = 0.2; // metres above the ground
const LEAST_TILT = THREE.MathUtils.degToRad(5); // how far down it looks, at the least
function keepAboveGround() {
  controls.target.y = Math.max(controls.target.y, LOWEST);
  const distance = camera.position.distanceTo(controls.target);
  controls.maxPolarAngle = Math.min(
    Math.acos(
      THREE.MathUtils.clamp((LOWEST - controls.target.y) / distance, -1, 1),
    ),
    Math.PI / 2 - LEAST_TILT,
  );
}

// The camera backs away as far as the whole tree needs to fit on screen,
// between the theme buttons along the top, the species down the left and
// the bar at the bottom, a phone's narrow screen most of all
const edgeOf = (selector) =>
  document.querySelector(selector)?.getBoundingClientRect();
const framing = createFraming({
  camera,
  controls,
  // The age and season card takes the right edge, or, in the bottom corner
  // of a narrow screen, the bottom
  clear: () => {
    const time = edgeOf(".time");
    const cornered = time && time.top > innerHeight / 2;
    return {
      top: edgeOf(".themes")?.bottom ?? 0,
      bottom:
        innerHeight -
        Math.min(
          edgeOf(".bar")?.top ?? innerHeight,
          cornered ? time.top : innerHeight,
        ),
      left: edgeOf(".species")?.right ?? 0,
      right: time && !cornered ? innerWidth - time.left : 0,
    };
  },
});

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
  seed: 8263,
  treeAge: MATURE, // 0 a sapling to 1 old; at MATURE the tree is as the other settings grow it
  size: 4.87,
  trunkThickness: 0.21,
  baseFlare: 1.69, // how much wider the trunk spreads at the ground, like roots
  trunkHeight: 0, // bare trunk under the oak's split or the cypress's crown, in metres
  splitHeight: 0.41,
  splitScatter: 0, // how far down the trunk the oak's limbs may leave it: at 0, all from its top
  mainLimbs: 3,
  levels: 1,
  branches: 5,
  whorls: 9, // the pine's tiers of branches
  whorlBranches: 6,
  droop: -1,
  slenderness: 1, // the cypress's: higher, narrower
  cypressBranches: 20,
  willowStrands: 111, // the willow's hanging strands
  hang: 0.8, // how far down towards the ground they hang
  bushClumps: 1, // the bush's leaf clumps
  spread: 0.89,
  crookedness: 0.34,
  sides: 10,
  smoothness: 1,
  twigs: 5, // twigs grown into a leaf clump of average size, for its leaves to hang from
  variety: 1, // how far each seed's own character takes its tree from its species' average
  cardsPerClump: 35,
  cardSize: 0.92, // grows the cards without adding any
  roundness: 0.58, // how far cards wrap round their clump
  clumpSize: 1, // scales every leaf clump, and its cards with it
  clumpEvenness: 0, // 0 leaves the clumps the sizes they grew, 1 makes them all one size
  aoDistance: 2.5, // the tutorial's AO node distance
  leafTexture: "round cluster",
  leafColors: "theme", // or "image": a dropped image's own colours
  showClumps: false,
  keepBuried: false, // keeps the cards buried deep in a neighbouring clump, to compare
  wireframe: false,
  leaves: true,
  showTexture: true,
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

// Leaves falling from the crown, in the foliage's colours, as many as its
// age sheds
const falling = createFallingLeaves({
  colors: foliage.uniforms.colors,
  turnedColors: foliage.uniforms.turned,
  imageColors: foliage.uniforms.imageColors,
  age: foliage.uniforms.age,
  crownCenter: foliage.uniforms.crownCenter,
  crownSize: foliage.uniforms.crownSize,
});
scene.add(falling.mesh);

// The leaf texture, on the cards and on what falls from them. Your image is
// one dropped on the page or picked with the panel's button: picked in the
// panel before there is one, it opens the file picker, and the leaves keep
// what they wear until an image comes. Its leaves take the theme's colours
// or its own. While a new tree is on its way, the old one keeps its leaves
// as they blow away, and the new ones go on with the new tree
let own = null;
let held = false; // while the old tree is held until it has folded away
let leafTextureWaiting = false;
function setLeafTexture(name) {
  const mine = name === OWN_TEXTURE;
  if (mine && !own) {
    if (navigator.userActivation?.isActive) imageDrop.pick();
    return;
  }
  leafTextureWaiting = held;
  if (held) return;
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
// The cards' size and roundness wait for the new tree the same way, or the
// old tree's leaves would take a new species' as they blow away
let cardLookWaiting = false;
function setCardLook() {
  cardLookWaiting = held;
  if (held) return;
  foliage.uniforms.cardSize.value = params.cardSize;
  foliage.uniforms.roundness.value = params.roundness;
}
setCardLook();

// A new image puts itself on the leaves, in its own colours when it has
// transparency to cut them out with and colours to keep, in the theme's
// when it's a mask of white leaves on black or only black and white. The
// one kept from last time only comes back for a link that asks for it.
// While one is dragged over the page, the tree turns into a hologram
// waiting for it, and once it lands a scan climbs from the ground to the
// top of the crown, putting the new leaves on as it goes
const imageDrop = createImageDrop({
  onDragging: showHologram,
  onImage: (image, { restored }) => {
    own = ownLeaves(image);
    if (!restored) {
      foliage.holdLeaves();
      const { crownCenter, crownSize } = foliage.uniforms;
      scanUp(crownCenter.value.y + crownSize.value.y);
      leafColorsControl.setValue(
        own.transparent && !own.grey ? "image" : "theme",
      );
    }
    if (params.leafTexture === OWN_TEXTURE) setLeafTexture(OWN_TEXTURE);
    else if (!restored) leafTextureControl.setValue(OWN_TEXTURE);
  },
});

// How many vertices the GLB would hold, the wood's and the leaves', kept up
// to date as the tree is rebuilt and its cards are cut up
const vertexCount = createVertexCount();
// How much of the tree is in leaf, for the leaves' sound, worked out with
// the vertex count as both change with the same things
let leafiness = 1;
function countVertices() {
  leafiness = foliage.leafiness();
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

const SMALLEST_CLUMP = 1e-4; // metres: a clump not grown yet, so nothing divides by its radius

// Evenness takes every clump's radius towards one size for them all, the
// one that keeps their total area: 0 leaves them as they grew, 1 makes them
// all that size
function evenOut(clumps, evenness) {
  const even = Math.sqrt(
    clumps.reduce((sum, c) => sum + c.radius * c.radius, 0) /
      Math.max(clumps.length, 1),
  );
  for (const clump of clumps)
    clump.radius = THREE.MathUtils.lerp(clump.radius, even, evenness);
}

let grown;
// Twigs are only grown when the season shows them: through summer every
// leaf is out at its place, hiding them, and none hangs from them, and they
// take as long to build as the rest of the tree. twigsBuilt is whether the
// tree shown has them
let twigsBuilt = false;
const twigsWanted = () => twigsShow(foliage.uniforms.age.value);
function rebuild() {
  // The tree as far as its age has grown it
  const species = SPECIES[params.species];
  grown = growAged(species, params);
  evenOut(grown.clumps, params.clumpEvenness);
  // A young tree's clumps are only as big as they've grown, keeping their
  // full radius for how many cards and twigs they get, so those never
  // change with the age, they only grow out with their clump
  for (const clump of grown.clumps) {
    clump.fullRadius = clump.radius;
    clump.radius = Math.max(clump.radius * (clump.grown ?? 1), SMALLEST_CLUMP);
  }
  // Each clump swings with the wood nearest it, and has twigs grown into
  // it, for its leaves to hang from
  grown.clumps.forEach((clump, i) => {
    clump.swing = grown.geometry.userData.swayAt(clump.position, i);
  });
  twigsBuilt = twigsWanted();
  if (!species.woodless && twigsBuilt)
    grown.geometry = grown.geometry.userData.withTwigs(
      grown.clumps,
      params.twigs,
    );
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
  framing.fit(bounds(tree.geometry, foliage).box);
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
    sound.play("whoosh");
  }
  for (const [control, value] of themeBindings) {
    control.setValue(value(THEMES[name]));
  }
}

// A new tree, with a burst, from a new seed or a new species. When the old
// tree has folded away, the new one is rebuilt at once, not left for the
// next frame
const { regrow, waitToAppear, appear } = createRegenerate({
  hold: (on) => {
    held = on;
    if (on) return;
    // Before the rebuild, which sizes the vertex count and framing by them
    if (cardLookWaiting) setCardLook();
    rebuildIfWanted();
    if (leafTextureWaiting) setLeafTexture(params.leafTexture);
  },
  falling,
  onSpringUp: () => sound.play("pop"),
});
// The first tree waits in the ground until the page is revealed
waitToAppear();
// A new tree, from a new seed or species, is knocked down by a sweep: one
// comes through with its whoosh, as a theme's does but in the theme the page
// already has, so only its bright front shows, and the moment it reaches
// the tree it hits it, and the tree breaks. While the page opens, the tree
// changes at once
function breakTree() {
  if (!themeSeconds) return regrow();
  sweep(themeSeconds);
  sound.play("whoosh");
  return regrow(shake.start(themeSeconds));
}
// A new seed: from the button at the bottom or space, even while a tree
// grows. It resolves once the latest tree has grown. It goes through its
// slider, so the panel shows it
function newTree() {
  seedControl.setValue(1 + Math.floor(Math.random() * 9999));
  return breakTree();
}

// A slider's box is a plain text field: a number typed into it may go past
// the slider's range, and a drag in it selects text
plainSliderBoxes();
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
const speciesControl = treeSection.add(params, "species", Object.keys(SPECIES));
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
  treeAge: { min: 0, max: 1, name: "tree age" },
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
  baseFlare: { min: 0, max: 2, name: "base flare" },
  trunkHeight: { min: 0, max: 3, name: "trunk height" },
  splitHeight: { min: 0.15, max: 0.6, name: "split height" },
  splitScatter: { min: 0, max: 1, name: "split scatter" },
  sides: { min: 3, max: 24, step: 1 },
  smoothness: { min: 1, max: 8, step: 1 },
  twigs: { min: 0, max: 12, step: 1 },
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
const woodControls = [
  "crookedness",
  "trunkThickness",
  "baseFlare",
  "sides",
  "smoothness",
  "twigs",
].map((key) => shapeControls[key]);
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
  "baseFlare",
  "trunkHeight",
];
for (const key of SHAPE_SETTINGS) speciesSetting(key, shapeControls[key]);
const speciesDefault = (key, species = params.species) =>
  SPECIES[species].settings[key] ?? startingSettings[key];
// The leaves follow the species too, unless you picked others, painted or
// your image: those stay on through a change of species
let speciesWas = params.species;
onChangeNow(speciesControl, () => {
  speciesButtons.show(params.species);
  showSpecies();
  const leavesPicked =
    params.leafTexture !== speciesDefault("leafTexture", speciesWas);
  speciesWas = params.species;
  for (const [key, control] of Object.entries(speciesSettings)) {
    if (key === "leafTexture" && leavesPicked) continue;
    control.setValue(speciesDefault(key));
  }
  requestRebuild();
  if (speciesRegrows) breakTree();
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
const woodPickers = addRamp(woodColors, barkColors, ["shadow", "mid", "light"]);
woodControls.push(wireframeControl, woodColors);

// The buttons at the bottom: a new tree, and exporting it, from a menu in
// two groups, 3D models and images, each choice's purpose in its tooltip:
// the tree as a GLB for a plain MeshStandardMaterial (the README has the snippet
// that puts the cel look back); a texture from the camera; a sprite sheet
// of views round it; or an impostor, a quad showing an atlas of views over
// the sky above it. How each goes is set in the panel's Export section,
// which the menu's last choice opens
const exportParams = {
  textureSize: "2048",
  textureAlpha: false, // RGBA on a clear background, rather than RGB on the theme's
  spriteAngles: "8",
  spriteSize: "256",
  spriteElevation: 10, // degrees above level
  impostorFrames: "8",
  impostorAtlas: "2048",
};
// An impostor's atlas sizes, pixels a side, and its views a side. More
// views share the same pixels: past 12 each gets too few to be worth the
// smoother turn
const ATLAS_SIZES = ["512", "1024", "2048", "4096", "8192"];
const IMPOSTOR_FRAMES = ["6", "8", "12"];
const capture = createCapture({
  renderer,
  scene,
  loop: frame,
  scenery: [ground, grass.mesh, falling.mesh],
  tree: [tree, wireframe, foliage.mesh, foliage.clumps],
});
const fileName = (kind, extension) =>
  `${params.species}-${params.seed}${kind ? `-${kind}` : ""}.${extension}`;
// An impostor's atlas, frames views a side in size pixels a side, each
// view cropped to the tree
async function impostorOf(frames, size) {
  const sphere = bounds(tree.geometry, foliage);
  frames = Number(frames);
  const { canvas: atlas, crops } = await capture.impostor(sphere, {
    frames,
    size: Number(size),
    points: vertices(tree.geometry, foliage),
  });
  return {
    atlas,
    frames,
    crops,
    center: sphere.center,
    radius: sphere.radius,
  };
}
const EXPORTS = [
  {
    group: "3D models",
    label: "tree",
    use: "the tree as you see it, for Blender, Unity, Godot or three.js",
    run: async () =>
      exportGlb({
        tree: { wood: tree.geometry, leaves: foliage.bake() },
        barkColors,
        species: params.species,
        seed: params.seed,
      }),
  },
  {
    group: "images",
    label: "texture",
    use: "this view, as you see it",
    run: async () => {
      const canvas = await capture.texture(camera, {
        size: Number(exportParams.textureSize),
        transparent: exportParams.textureAlpha,
      });
      download(await encode(canvas), fileName("", "png"));
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
      const { canvas } = await capture.sprites(bounds(tree.geometry, foliage), {
        count,
        size,
        elevation: THREE.MathUtils.degToRad(exportParams.spriteElevation),
      });
      download(await encode(canvas), fileName(`sprites-${count}`, "png"));
    },
  },
  {
    group: "3D models",
    label: "impostor",
    use: "a flat card that looks 3D, for trees far away",
    run: async () =>
      exportGlb({
        impostor: await impostorOf(
          exportParams.impostorFrames,
          exportParams.impostorAtlas,
        ),
        barkColors,
        species: params.species,
        seed: params.seed,
        name: fileName("impostor", "glb"),
      }),
  },
];
// The material code a GLB needs to look as it did here, from its button
// under the Inspector's, the way to the repo, and the sound of the wind
// and the leaves beside it
const codeView = createCodeView();
createRepoLink();
const sound = createSound({ leafiness: () => leafiness });
const bar = createBar({
  onNewTree: newTree,
  exports: EXPORTS,
  onSettings: () => openSection(renderer.inspector, exporting),
});

// The keys: space grows a new tree, left and right step through the themes,
// as their buttons run along the top, and up and down through the species,
// as theirs run down the left side, round from either end, H hides the
// panel and M turns the sound off and on. Each goes through
// the panel's control, as a click does. Not while a field in the panel has
// them, nor while the export menu is open, its choices taking the arrows,
// nor while the material code is open, its keys scrolling the code.
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
  // Until the page is entered, Enter or space enters it, once it's ready,
  // and no other key does anything
  if (!entered) {
    if (e.key === "Enter" || e.code === "Space") {
      e.preventDefault();
      enter();
    }
    return;
  }
  const field = e.target.closest?.("input, select, textarea");
  if (field || codeView.isOpen()) return;
  if (e.code === "Space") {
    e.preventDefault();
    bar.newTree();
    return;
  }
  if (e.code === "KeyM" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
    sound.toggle();
    return;
  }
  // H hides the Inspector, its button and all, for a clean screen to film
  if (e.code === "KeyH" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
    renderer.inspector.setVisible(!renderer.inspector.getVisible());
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
// The season, the leaves' age through the year: unfolding small and pale,
// summer, turning to the turned colours, then dropping until the tree is
// bare. Dropped cards don't export
const seasonControl = leafSection
  .add(foliage.uniforms.age, "value", 0, 1)
  .name("season")
  .onChange(() => {
    countVertices();
    // Into or out of summer, the twigs' wood is built or left out
    if (twigsWanted() !== twigsBuilt) requestRebuild();
  });
// The tree's age and the season, on screen too, at the right edge
createTimeSliders({ age: shapeControls.treeAge, season: seasonControl });
// The clumps the cards are scattered over, one on each free branch tip:
// clump size grows them all, and bigger clumps get more cards. Evenness
// takes them all towards one size, keeping their total area, without
// reshaping the branches, but with the twigs grown again to fit them
const clumps = leafSection.addFolder("clumps");
speciesSetting(
  "clumpSize",
  clumps
    .add(params, "clumpSize", 0.3, 3)
    .name("clump size")
    .onChange(requestRebuild),
);
clumps
  .add(params, "clumpEvenness", 0, 1)
  .name("evenness")
  .onChange(requestRebuild);
speciesSetting(
  "cardsPerClump",
  clumps
    .add(params, "cardsPerClump", 1, 160, 1)
    .name("cards per clump")
    .onChange(requestLeaves),
);
debugView(clumps.add(params, "showClumps"))
  .name("show clumps")
  .onChange(foliage.setClumpsShown);
// Cards buried deep in a neighbouring clump are left out, hidden as they are
// by its own; this keeps them, to see that the crown looks the same
debugView(clumps.add(params, "keepBuried"))
  .name("keep buried cards")
  .onChange(requestLeaves);
const cards = leafSection.addFolder("cards");
debugView(cards.add(params, "leaves"))
  .name("show leaves")
  .onChange(foliage.setShown);
// Each species has its own leaves, but the texture you pick, painted or your
// image, stays on through a change of species
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
  cards.add(params, "cardSize", 0.1, 3).name("size").onChange(setCardLook),
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
  cards
    .add(params, "roundness", 0, 1)
    .name("roundness")
    .onChange(setCardLook),
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
debugView(leafShading.add(params, "showNormals"))
  .name("show normals")
  .onChange((v) => (foliage.uniforms.showNormals.value = v ? 1 : 0));
const leafColorsFolder = leafSection.addFolder("colors");
const leafPickers = addRamp(leafColorsFolder, foliage.uniforms.colors, [
  "shadow",
  "mid",
  "light",
]);
const turnedPickers = addRamp(leafColorsFolder, foliage.uniforms.turned, [
  "turned shadow",
  "turned mid",
  "turned light",
]);
// Each clump a little warmer or cooler, lighter or darker than the others,
// so the crown doesn't run together into one blob
leafColorsFolder
  .add(foliage.uniforms.variation, "value", 0, 1)
  .name("variation");

const breeze = renderer.inspector.createParameters("Wind");
breeze.add(wind.direction, "value", -Math.PI, Math.PI).name("direction");
speciesSetting(
  "wind",
  breeze.add(wind.strength, "value", 0, 1).name("strength"),
);
breeze.add(wind.speed, "value", 0, 3).name("speed");
// The gusts' size in metres, the noise's frequency turned over, so a higher
// slider gives bigger gusts
breeze
  .add({ size: 1 / wind.frequency.value }, "size", 1, 20)
  .name("gust size")
  .onChange((size) => (wind.frequency.value = 1 / size));
speciesSetting(
  "flutter",
  breeze.add(wind.flutter, "value", 0, 1).name("leaf flutter"),
);
// How far each branch swings on its own, the thin ones most
breeze.add(wind.branches, "value", 0, 2).name("branch swing");

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

// How the export menu's choices are made, everything written as PNGs: the
// texture's size and background; the sprite sheet's views, their size and
// how far above level they look from; the impostor's views a side and its
// atlas's size. Each has its own folder, the tree's only its button, and
// each folder ends in an export button doing what its choice in the menu
// does, through the bar, so one export still runs at a time
const exporting = renderer.inspector.createParameters("Export");
function exportButton(folder, label) {
  const { run } = EXPORTS.find((choice) => choice.label === label);
  folder.add({ export: () => bar.run(run) }, "export");
}
exportButton(exporting.addFolder("tree"), "tree");
// Under an impostor's views and atlas, what they give: how many pixels a
// view has, which is as big as the tree can stand on screen before it
// blurs, and how much GPU memory the atlas takes with its mipmaps
function atlasNote(folder, framesKey, atlasKey) {
  const rows = ["each view", "on the GPU"].map((label) => {
    const value = createValueSpan();
    const row = new Item(label, value);
    folder.paramList.add(row);
    return { row, value };
  });
  const update = () => {
    const size = Number(exportParams[atlasKey]);
    const view = Math.floor(size / Number(exportParams[framesKey]));
    const bytes = (size * size * 4 * 4) / 3;
    rows[0].value.textContent = `${view} px`;
    rows[1].value.textContent = `${Math.round(bytes / 2 ** 20)} MB`;
  };
  update();
  return { rows: rows.map(({ row }) => row), update };
}
const textureFolder = exporting.addFolder("texture");
textureFolder
  .add(exportParams, "textureSize", ["1024", "2048", "4096"])
  .name("size");
textureFolder.add(exportParams, "textureAlpha").name("transparent (RGBA)");
exportButton(textureFolder, "texture");
const spriteFolder = exporting.addFolder("sprite sheet");
spriteFolder.add(exportParams, "spriteAngles", ["4", "8", "16"]).name("views");
spriteFolder
  .add(exportParams, "spriteSize", ["128", "256", "512"])
  .name("frame size");
spriteFolder.add(exportParams, "spriteElevation", 0, 60, 1).name("elevation");
exportButton(spriteFolder, "sprite sheet");
const impostorFolder = exporting.addFolder("impostor");
const impostorFramesControl = impostorFolder
  .add(exportParams, "impostorFrames", IMPOSTOR_FRAMES)
  .name("views a side");
const impostorAtlasControl = impostorFolder
  .add(exportParams, "impostorAtlas", ATLAS_SIZES)
  .name("atlas size");
const impostorNote = atlasNote(
  impostorFolder,
  "impostorFrames",
  "impostorAtlas",
);
impostorFramesControl.onChange(impostorNote.update);
impostorAtlasControl.onChange(impostorNote.update);
exportButton(impostorFolder, "impostor");

// Every control a theme sets, and its value in a theme. The page starts in
// its first theme
const themeBindings = [
  ...leafPickers.map((picker, i) => [picker, (theme) => theme.leaves[i]]),
  ...turnedPickers.map((picker, i) => [picker, (theme) => theme.turned[i]]),
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
// The leaves' season was once their age
addShareLink(sections, debugControls, following, {
  "Leaves/age": "Leaves/season",
});
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
  framing.resize();
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

// The loader in index.html, there from the first paint, turns into an
// enter button once the frames come steadily: the first ones build the
// shaders, and a few in the GPU can stall for a second or two. Entering,
// with a click or Enter or space, opens a ragged circle from the middle of
// the tree, the tree springing up through it, and the click lets the sound
// start
const STEADY_FRAMES = 30; // quick frames in a row before the page opens
const QUICK = 50; // milliseconds, the longest a frame may take and still count as quick
const MOST_WAIT = 10000; // milliseconds after the first frame it opens anyway
let firstFrame = null;
let lastFrame = null;
let steadyFrames = 0;
let loading = true;
function waitForSteadyFrames() {
  const now = performance.now();
  firstFrame ??= now;
  steadyFrames =
    lastFrame !== null && now - lastFrame < QUICK ? steadyFrames + 1 : 0;
  lastFrame = now;
  if (steadyFrames < STEADY_FRAMES && now - firstFrame < MOST_WAIT) return;
  loading = false;
  doneLoading();
}
let ready = false;
let entered = false;
function doneLoading() {
  const loader = document.getElementById("loader");
  if (!loader) return;
  ready = true;
  loader.classList.add("ready");
  loader.setAttribute("aria-label", "the tree is ready");
  loader.querySelector(".card").addEventListener("click", enter);
}
function enter() {
  const loader = document.getElementById("loader");
  if (!ready || entered || !loader) return;
  entered = true;
  sound.begin();
  const middle = controls.target.clone().project(camera);
  reveal(loader, {
    x: ((middle.x + 1) / 2) * innerWidth,
    y: ((1 - middle.y) / 2) * innerHeight,
    onAppear: appear,
  });
}

renderer.setAnimationLoop(frame);
function frame() {
  matchPage();
  keepAboveGround();
  controls.update();
  framing.update(performance.now());
  sound.update();
  shake.update(performance.now());
  updateHologram(performance.now());
  rebuildIfWanted();
  falling.update(renderer);
  shake.draw(performance.now(), () => renderer.render(scene, camera));
  if (loading) waitForSteadyFrames();
}

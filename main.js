import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { addParameterFilter, setAvailable } from "./inspector-filter.js";
import {
  addCopyConfig,
  addReset,
  addShareLink,
  closeAll,
  trackFolders,
} from "./inspector-tools.js";
import { generateOak } from "./oak.js";
import { generatePine } from "./pine.js";
import { generateCypress } from "./cypress.js";
import { generateWillow } from "./willow.js";
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
import { sway, wind } from "./wind.js";
import {
  attribute,
  instancedBufferAttribute,
  positionGeometry,
  vec3,
} from "three/tsl";

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
  spread: 0.9,
  crookedness: 0.5,
  sides: 10,
  smoothness: 3,
  cardsPerClump: 35,
  clumpSize: 1, // scales every leaf clump, and its cards with it
  aoDistance: 2.5, // the tutorial's AO node distance
  leavesTexture: "round cluster",
  emitters: false,
  wireframe: false,
  leaves: true,
  brush: true,
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
wireframe.material.positionNode = positionGeometry.add(
  sway(positionGeometry, attribute("swayLift", "float")),
);
wireframe.visible = false;
scene.add(wireframe);

const foliage = createFoliage();
scene.add(foliage.mesh);

// Leaves falling from the crown, in the foliage's colours
const falling = createFallingLeaves({
  colors: foliage.uniforms.colors,
  crownCenter: foliage.uniforms.crownCenter,
  crownSize: foliage.uniforms.crownSize,
});
foliage.setBrush(params.leavesTexture);
falling.setTexture(fallingTexture(params.leavesTexture));
scene.add(falling.mesh);

// The leaf clumps the cards are scattered over; hidden, but handy to see.
// Each is a sphere, or a pad when its species flattens it, or a tress when
// it stretches it, swaying with the wood
const MAX_CLUMPS = 8192;
const clumpData = new THREE.InstancedBufferAttribute(
  new Float32Array(MAX_CLUMPS * 4),
  4,
); // centre, radius
clumpData.setUsage(THREE.DynamicDrawUsage);
const clumpShape = new THREE.InstancedBufferAttribute(
  new Float32Array(MAX_CLUMPS * 2),
  2,
); // flatten, and how far below where it hangs from it is
clumpShape.setUsage(THREE.DynamicDrawUsage);
const clumpNode = instancedBufferAttribute(clumpData);
const clumpShapeNode = instancedBufferAttribute(clumpShape);
const clumpMaterial = new THREE.MeshLambertNodeMaterial({ color: "#4f7a3a" });
clumpMaterial.positionNode = clumpNode.xyz
  .add(sway(clumpNode.xyz, clumpShapeNode.y))
  .add(
    positionGeometry
      .mul(vec3(1, clumpShapeNode.x, 1))
      .mul(clumpNode.w),
  );
const emitters = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 3),
  clumpMaterial,
);
emitters.frustumCulled = false;
emitters.visible = false;
emitters.count = 0;
scene.add(emitters);

// How many vertices the GLB would hold, the wood's and the leaves', kept up
// to date as the tree is rebuilt and its cards are cut up
const vertexCount = createVertexCount();
function countVertices() {
  vertexCount.show(
    tree.geometry.attributes.position.count,
    foliage.bakedVertices(),
  );
}

// Each species grows its wood and leaf clumps its own way
const SPECIES = {
  oak: generateOak,
  pine: generatePine,
  cypress: generateCypress,
  willow: generateWillow,
};

// Sliders send a change on every step of a drag: the tree is rebuilt once
// per frame at most, with the latest values
let rebuildWanted = false;
function requestRebuild() {
  rebuildWanted = true;
}
function rebuildIfWanted() {
  if (!rebuildWanted) return;
  rebuildWanted = false;
  rebuild();
}

function rebuild() {
  const grown = SPECIES[params.species](params);
  tree.geometry.dispose();
  tree.geometry = grown.geometry;
  wireframe.geometry = grown.geometry;
  grown.geometry.computeBoundingBox();
  wind.height.value = grown.geometry.boundingBox.max.y;

  foliage.update(grown.clumps, params);
  foliage.mesh.visible &&= params.leaves;

  emitters.count = Math.min(grown.clumps.length, MAX_CLUMPS);
  for (let i = 0; i < emitters.count; i++) {
    const { position, radius, flatten = 1, hangFrom } = grown.clumps[i];
    clumpData.array.set([position.x, position.y, position.z, radius], i * 4);
    const lift = hangFrom === undefined ? 0 : Math.max(hangFrom - position.y, 0);
    clumpShape.array.set([flatten, lift], i * 2);
  }
  clumpData.needsUpdate = true;
  clumpShape.needsUpdate = true;

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
// The scene starts in its first theme
const startTheme = THEMES[START_THEME];
startTheme.leaves.forEach((hex, i) =>
  foliage.uniforms.colors[i].value.set(hex),
);
startTheme.trunk.forEach((hex, i) => barkColors[i].value.set(hex));
startTheme.grass.forEach((hex, i) => grass.uniforms.colors[i].value.set(hex));
shadowColor.value.set(startTheme.shadow.color);
shadowDarkness.value = startTheme.shadow.darkness;

// A theme picked from the panel or a button sweeps in from the bottom left
// (transition.js), and the camera shakes a little as it does, a gust blows
// through the tree and knocks a handful of leaves off it. Picks stack:
// each sends its own sweep after the ones still going. The panel's controls
// take the theme at once, so they show it and the address keeps it. While
// the page opens, a theme from its address lands at once
let themeSeconds = 0;
let themeName = START_THEME;
function pickTheme(name) {
  const theme = THEMES[name];
  themeName = name;
  themeButtons.show(name);
  if (themeSeconds) {
    sweep(themeSeconds);
    shakeFrom = performance.now();
    falling.shake();
  }
  theme.leaves.forEach((hex, i) => leafPickers[i].setValue(hex));
  theme.trunk.forEach((hex, i) => trunkPickers[i].setValue(hex));
  theme.grass.forEach((hex, i) => grassPickers[i].setValue(hex));
  backgroundPicker.setValue(theme.background);
  shadowColorPicker.setValue(theme.shadow.color);
  darknessControl.setValue(theme.shadow.darkness);
}

// The shake: the camera jitters round where it is, a few centimetres and a
// fraction of a degree, sharply at first and dying away over the sweep. It's
// added for the frame drawn and taken off after, so the controls never see it
const SHAKE = 0.02; // metres at its strongest
const ROLL = 0.0015; // radians of roll at its strongest
let shakeFrom = -Infinity;
const shakeOffset = new THREE.Vector3();
const shakeAxis = new THREE.Vector3();
const shakeSaved = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
};
function shakeCamera(now) {
  const t = (now - shakeFrom) / 1000 / themeSeconds;
  if (!(t >= 0 && t < 1)) return false;
  const strength = Math.min(t / 0.06, 1) * (1 - t) ** 2;
  const s = now / 1000;
  // A few sines at odd rates, so it never quite repeats
  const x = Math.sin(s * 47) + 0.5 * Math.sin(s * 83 + 1.3);
  const y = Math.sin(s * 53 + 2.1) + 0.5 * Math.sin(s * 71 + 0.4);
  const r = Math.sin(s * 39 + 0.7);
  shakeSaved.position.copy(camera.position);
  shakeSaved.quaternion.copy(camera.quaternion);
  camera.updateMatrixWorld();
  shakeOffset
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .multiplyScalar(x * SHAKE * strength);
  camera.position.add(shakeOffset);
  shakeOffset
    .setFromMatrixColumn(camera.matrixWorld, 1)
    .multiplyScalar(y * SHAKE * strength);
  camera.position.add(shakeOffset);
  camera.rotateOnAxis(shakeAxis.set(0, 0, 1), r * ROLL * strength);
  camera.updateMatrixWorld();
  return true;
}
// The gust: the wind blows harder for a moment, rising quickly and dying
// away slowly, so the tree swings out and settles after the shake
const GUST = 2; // how much harder it blows at its strongest: 2 is three times
const GUST_SECONDS = 2.5;
function gustTree(now) {
  const t = (now - shakeFrom) / 1000 / GUST_SECONDS;
  const rise = Math.min(t / 0.12, 1);
  wind.gust.value =
    t >= 0 && t < 1 ? GUST * rise * rise * (3 - 2 * rise) * (1 - t) ** 2 : 0;
}
function unshakeCamera() {
  camera.position.copy(shakeSaved.position);
  camera.quaternion.copy(shakeSaved.quaternion);
  camera.updateMatrixWorld();
}
// A new tree from a new seed, with a burst: from the button at the bottom or
// space. The seed goes through its slider, so the panel shows it
const { regenerate } = createRegenerate({
  setSeed: (seed) => {
    seedControl.setValue(seed);
    // The slider's onChange runs on the next tick: the rebuild is done then,
    // not left for the next frame
    return new Promise((resolve) =>
      setTimeout(() => {
        rebuildIfWanted();
        resolve();
      }),
    );
  },
  falling,
});

const treeSection = renderer.inspector.createParameters("Tree");
trackFolders(treeSection);
// A theme sets the trunk's colours here, the leaves' in their section, and
// the background and shadows in the lights'. The buttons at the top left pick
// it here too, so the panel and the address follow them
const themeControl = treeSection
  .add({ theme: START_THEME }, "theme", Object.keys(THEMES))
  .onChange(pickTheme);
const themeButtons = createThemeButtons({
  onPick: (name) => themeControl.setValue(name),
});
themeButtons.show(START_THEME);
// The species picks the shape rules; only its own sliders show in the shape
// folder. The oak splits low into limbs that branch again; the pine is one
// trunk ringed by whorls of drooping branches; the cypress is a narrow flame
// of short climbing branches; the willow is a dome of limbs hung with long
// strands of leaves. The buttons down the left pick it here too, so
// the panel and the address follow them
const speciesControl = treeSection.add(
  params,
  "species",
  Object.keys(SPECIES),
);
const speciesButtons = createSpeciesButtons({
  species: Object.keys(SPECIES),
  onPick: (name) => speciesControl.setValue(name),
});
// The tree's shape, its trunk and its mesh in one folder. The mesh: sides
// round each branch, and rings per kink along a curve through them. Its
// normals are smooth; more sides smooth the edges of the cel bands too. The
// wireframe shows its vertices, alone
const shape = treeSection.addFolder("shape");
const seedControl = shape.add(params, "seed", 1, 9999, 1).onChange(requestRebuild);
const sizeControl = shape
  .add(params, "size", 2, 8)
  .onChange(requestRebuild);
// The oak's and the willow's limbs
const mainLimbsControl = shape
  .add(params, "mainLimbs", 3, 6, 1)
  .name("main limbs")
  .onChange(requestRebuild);
const oakControls = [
  mainLimbsControl,
  shape.add(params, "levels", 0, 4, 1).onChange(requestRebuild),
  shape.add(params, "branches", 2, 5, 1).onChange(requestRebuild),
  shape.add(params, "spread", 0.3, 1.3).onChange(requestRebuild),
];
// How the conifers' branches bend: down past 0, up below it
const droopControl = shape
  .add(params, "droop", -1, 1)
  .onChange(requestRebuild);
const pineControls = [
  droopControl,
  shape.add(params, "whorls", 3, 16, 1).onChange(requestRebuild),
  shape
    .add(params, "whorlBranches", 3, 9, 1)
    .name("branches per whorl")
    .onChange(requestRebuild),
];
const cypressControls = [
  droopControl,
  shape.add(params, "slenderness", 0.5, 2).onChange(requestRebuild),
  shape
    .add(params, "cypressBranches", 10, 90, 1)
    .name("branch count")
    .onChange(requestRebuild),
];
const willowControls = [
  mainLimbsControl,
  shape
    .add(params, "willowStrands", 20, 300, 1)
    .name("strands")
    .onChange(requestRebuild),
  shape.add(params, "hang", 0.1, 1).onChange(requestRebuild),
];
const crookednessControl = shape
  .add(params, "crookedness", 0, 1.5)
  .onChange(requestRebuild);
const trunkThicknessControl = shape
  .add(params, "trunkThickness", 0.1, 0.6)
  .name("trunk thickness")
  .onChange(requestRebuild);
oakControls.push(
  shape
    .add(params, "splitHeight", 0.15, 0.6)
    .name("split height")
    .onChange(requestRebuild),
);
shape.add(params, "sides", 3, 24, 1).onChange(requestRebuild);
shape.add(params, "smoothness", 1, 8, 1).onChange(requestRebuild);
const speciesControls = {
  oak: oakControls,
  pine: pineControls,
  cypress: cypressControls,
  willow: willowControls,
};
// A control may belong to more than one species, like the droop or the
// main limbs
function showSpecies() {
  const shown = speciesControls[params.species];
  for (const control of new Set(Object.values(speciesControls).flat())) {
    setAvailable(control, shown.includes(control));
  }
}
// Each species' own settings among those they share, put on when it's
// picked, the way a theme puts on its colours. The controls are tied to them
// once they all exist, further down
const OAK_DEFAULTS = {
  crookedness: 0.5,
  clumpSize: 1,
  cardsPerClump: 35,
  texture: "round cluster",
  cardSize: 0.92,
  roundness: 0.58,
  flutter: 0.25,
  falling: 277,
  droop: -1, // the oak has none
  mainLimbs: 3,
  size: 5.27,
  trunkThickness: 0.21,
  wind: 0.22,
};
const SPECIES_DEFAULTS = {
  oak: OAK_DEFAULTS,
  pine: {
    crookedness: 0.45,
    clumpSize: 1.25,
    cardsPerClump: 13,
    texture: "round cluster",
    cardSize: 0.77,
    roundness: 0,
    flutter: 0.09,
    falling: 70,
    droop: -1,
    mainLimbs: 3, // the pine has none
    size: 5.27,
    trunkThickness: 0.21,
    wind: 0.22,
  },
  cypress: {
    crookedness: 0.5,
    clumpSize: 1.03,
    cardsPerClump: 35,
    texture: "round cluster",
    cardSize: 0.92,
    roundness: 0,
    flutter: 0.07,
    falling: 70,
    droop: -0.16,
    mainLimbs: 3, // the cypress has none
    size: 5.27,
    trunkThickness: 0.21,
    wind: 0.22,
  },
  // Tall and slender, its strands in a few big cards each, and swaying
  // gently, since its strands swing more than the rest of the wood
  willow: {
    crookedness: 0.72,
    clumpSize: 0.9,
    cardsPerClump: 4,
    texture: "round cluster",
    cardSize: 2.05,
    roundness: 0.27,
    flutter: 0.12,
    falling: 150,
    droop: -1, // the willow's strands hang by hang instead
    mainLimbs: 5,
    size: 6.82,
    trunkThickness: 0.11,
    wind: 0.17,
  },
};
let speciesSettings = {};
const speciesDefault = (key) => SPECIES_DEFAULTS[params.species][key];
speciesControl.onChange(() => {
  speciesButtons.show(params.species);
  showSpecies();
  for (const [key, control] of Object.entries(speciesSettings)) {
    control.setValue(speciesDefault(key));
  }
  requestRebuild();
});
speciesButtons.show(params.species);
showSpecies();
// The debug views, kept out of the page's address, so a reload or a shared
// link always starts without them
const debugControls = [];
function debugView(control) {
  debugControls.push(control);
  return control;
}

debugView(shape.add(params, "wireframe")).onChange((v) => {
  wireframe.visible = v;
  tree.visible = !v;
});
const trunkPickers = addRamp(treeSection.addFolder("colors"), barkColors, [
  "shadow",
  "mid",
  "light",
]);

// The buttons at the bottom: a new tree, and the
// tree as a GLB for a plain MeshStandardMaterial (the README has the snippet
// that puts the cel look back)
const bar = createBar({
  onNewTree: regenerate,
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
const clumpSizeControl = clumps
  .add(params, "clumpSize", 0.3, 3)
  .name("clump size")
  .onChange(requestRebuild);
const cardsPerClumpControl = clumps
  .add(params, "cardsPerClump", 1, 160, 1)
  .name("cards per clump")
  .onChange(requestRebuild);
debugView(clumps.add(params, "emitters"))
  .name("show emitters")
  .onChange((v) => (emitters.visible = v));
const cards = leafSection.addFolder("cards");
debugView(cards.add(params, "leaves"))
  .name("show leaves")
  .onChange((v) => (foliage.mesh.visible = v && foliage.mesh.count > 0));
const textureControl = cards
  .add(params, "leavesTexture", LEAF_TEXTURES)
  .name("texture")
  .onChange((name) => {
    foliage.setBrush(name);
    falling.setTexture(fallingTexture(name));
  });
debugView(cards.add(params, "brush"))
  .name("brush texture")
  .onChange((v) => (foliage.uniforms.brush.value = v ? 1 : 0));
const cardSizeControl = cards
  .add(foliage.uniforms.particleSize, "value", 0.1, 3)
  .name("size");
// How many squares each card is cut into, and how far they wrap round their
// clump's sphere. Segments only show once roundness bends them
const SEGMENTS = { "1 × 1": 1, "2 × 2": 2, "3 × 3": 3, "4 × 4": 4 };
cards
  .add({ segments: "2 × 2" }, "segments", Object.keys(SEGMENTS))
  .onChange((name) => {
    foliage.setSegments(SEGMENTS[name]);
    countVertices();
  });
const roundnessControl = cards
  .add(foliage.uniforms.roundness, "value", 0, 1)
  .name("roundness");
const leafShading = leafSection.addFolder("shading");
leafShading
  .add(foliage.uniforms.shadowSide, "value", 0, 1, 0.005)
  .name("shadow side");
leafShading.add(foliage.uniforms.ao, "value", 0, 1).name("ao");
leafShading
  .add(params, "aoDistance", 0.25, 6)
  .name("ao distance")
  .onChange(requestRebuild);
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
  ["core", "shadow", "mid", "light"],
);

const breeze = renderer.inspector.createParameters("Wind");
breeze.add(wind.direction, "value", -Math.PI, Math.PI).name("direction");
const windControl = breeze
  .add(wind.strength, "value", 0, 1)
  .name("strength");
breeze.add(wind.speed, "value", 0, 3).name("speed");
breeze.add(wind.frequency, "value", 0.05, 1).name("gust size");
const flutterControl = breeze
  .add(wind.flutter, "value", 0, 1)
  .name("leaf flutter");

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
const fallingControl = fall
  .add(falling.uniforms.amount, "value", 0, falling.MAX_LEAVES, 1)
  .name("amount");
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

// A reset button under each section, and a copy-config button always in view
// under them all. What a theme sets resets to the theme picked now, not to
// the one the page opened on, and reset keeps the theme. What a species sets
// resets to the species picked now, and reset keeps the species too
speciesSettings = {
  crookedness: crookednessControl,
  clumpSize: clumpSizeControl,
  cardsPerClump: cardsPerClumpControl,
  texture: textureControl,
  cardSize: cardSizeControl,
  roundness: roundnessControl,
  flutter: flutterControl,
  falling: fallingControl,
  droop: droopControl,
  mainLimbs: mainLimbsControl,
  size: sizeControl,
  trunkThickness: trunkThicknessControl,
  wind: windControl,
};
const sections = [treeSection, leafSection, breeze, lawn, fall, light];
const theme = () => THEMES[themeName];
const themed = new Map([
  [themeControl, () => themeName],
  [speciesControl, () => params.species],
  ...Object.entries(speciesSettings).map(([key, control]) => [
    control,
    () => speciesDefault(key),
  ]),
  ...leafPickers.map((picker, i) => [picker, () => theme().leaves[i]]),
  ...trunkPickers.map((picker, i) => [picker, () => theme().trunk[i]]),
  ...grassPickers.map((picker, i) => [picker, () => theme().grass[i]]),
  [backgroundPicker, () => theme().background],
  [shadowColorPicker, () => theme().shadow.color],
  [darknessControl, () => theme().shadow.darkness],
]);
sections.forEach((section) => addReset(section, themed));
addCopyConfig(renderer.inspector, sections);
// The address keeps every changed value but the debug views, so a link
// brings back this tree
addShareLink(sections, debugControls);
// Once the address has landed, a theme picked eases in
setTimeout(() => (themeSeconds = 0.85));

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
let pageColor = "";
function matchPage() {
  const color = `#${scene.background.getHexString()}`;
  if (color === pageColor) return;
  pageColor = color;
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
  gustTree(performance.now());
  rebuildIfWanted();
  falling.update(renderer);
  const shaken = shakeCamera(performance.now());
  renderer.render(scene, camera);
  if (shaken) unshakeCamera();
});

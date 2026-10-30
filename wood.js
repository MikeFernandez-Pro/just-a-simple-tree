import * as THREE from 'three/webgpu'
import { liftBelow } from './wind.js'

// The wood every species is built from: crooked tubes, tapering as they go,
// with rounded tips and collars where they grow from another, and what the
// growing needs on each vertex. A species decides where the branches go

const CAP_RINGS = 3 // rings in the rounded dome closing each branch's tip
const COLLAR = 0.9 // a child's base radius / its parent's radius there
const FLARE_HEIGHT = 5 // how far up a flared base spreads / the branch's radius at its start
const FLARE_RINGS = 6 // rings up a flared base, however coarse the rest of the tube
// The branches' own sway (wind.js): how far each point of the wood flexes
// builds up along the wood from the ground, faster through thin wood, and
// its beat drifts along each branch from where it leaves its parent
const STIFF_RADIUS = 0.02 // metres: wood thinner than this flexes no more than this would
const PHASE_DRIFT = 2.5 // radians the beat drifts along a branch, give or take half
const JOINT_REACH = 0.25 // metres: a branch starting this close to the wood grows from it, flexing with it
const CELL = 0.5 // metres: the grid the wood is looked up in by
const SEARCH_RINGS = 4 // cells out from a point it looks for the nearest wood
const BLEND_NEAR = 2 // how far out the wood blended into the nearest goes / the nearest's distance
const BLEND_REACH = 0.05 // metres it goes out past that, so wood right at a point still blends
// A young tree: how its branches grow in, from where they sprout
const SPROUT_SPEED = 1.5 // how fast a branch lengthens once sprouted / how fast the tree's growth goes on
const YOUNG_THICKNESS = 0.35 // a branch's thickness just sprouted / full grown
const MIN_LENGTH = 1e-4 // metres: a branch shorter than this hasn't sprouted yet
// Twigs: thin wood grown out from each leaf clump's centre into it, for its
// leaves to hang from. Hidden in summer, they show while the leaves unfold,
// once they thin in autumn and on the bare tree
const TWIG_REACH = 0.75 // how far a twig reaches / its clump's radius
const TWIG_THICKNESS = 0.025 // a twig's radius at its base / its clump's radius
const TWIG_THINNER = 0.6 // the thickest a twig can be / the wood's radius where it grows
const TWIG_TAPER = 0.4 // radius at a twig's tip / at its base
const TWIG_SEGMENTS = 3 // kinks per twig
const TWIG_SIDES = 3 // the most sides a twig takes, its tip a point rather than a dome
const TWIG_LIFT = 0.15 // how much every kink of a twig bends towards the sky, or down in a clump that hangs
const TWIG_AHEAD = 0.8 // how far twigs lean the way the wood they grow from goes / their spread round the clump
const TWIG_CROOKED = 2 // how much more a twig kinks than a branch

export const UP = new THREE.Vector3(0, 1, 0)
export const SIDE = new THREE.Vector3(1, 0, 0)
// Turning on by it each time spreads things evenly round a circle or a sphere
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function createWood(params, random) {
  const positions = numbers(Float32Array)
  const normals = numbers(Float32Array)
  const indices = numbers(Uint32Array)
  // For growing: per vertex, its ring's centre, its branch's root, and
  // how far along the wood from the ground it is, and how far the farthest
  // vertex is, the farthest tip. For the wind: how far below where it hangs
  // from it is, on a branch that hangs
  const centers = numbers(Float32Array)
  const roots = numbers(Float32Array)
  const births = numbers(Float32Array)
  let farthestBirth = 1e-6
  const lifts = numbers(Float32Array)
  // For the branches' own sway: per vertex, how far it flexes and its beat
  const sways = numbers(Float32Array)
  // Every kink-to-kink stretch of the wood with its flex and beat at both
  // ends, and a grid of them, to find the wood nearest a point
  const stretches = []
  const grid = new Map()
  // Each branch's beat drifts by a draw of its own, one per branch in the
  // order they're made, so it's the same at every age. Taken from where the
  // branch starts, it would change wholly at the smallest move, and the
  // branches would twitch in the wind as the age is dragged
  const driftRandom = mulberry32(params.seed + 2903)
  // With params.measuring, no wood is built, only how far along it the
  // farthest tip is, which is all growAged wants of a full grown tree
  let farthestEnd = 0
  // The top of the tree, in metres: the highest point of every branch and
  // twig, drawn or not, so the wind (wind.js) sways the tree as the same
  // height at every level of detail, where the thinnest wood is left out
  let top = 0
  // A lighter level of detail (lod.js) leaves out the tube of any branch
  // thinner than params.thinnest of the thickest, the trunk, made first,
  // takes every params.ringStep-th kink for its rings, and closes its tips
  // with params.capRings rings. The branches are all still worked out, so
  // the clumps, the sway and the twigs' kinks stay where they were
  let thickest = null
  const thinnest = params.thinnest ?? 0
  const ringStep = params.ringStep ?? 1
  const capRings = params.capRings ?? CAP_RINGS

  // Turn a direction a random amount around itself, the turn's way measured
  // round it from square, a direction square to it
  function kink(dir, amount, rand = random, square = perpendicular(dir)) {
    const axis = square.clone().applyAxisAngle(dir, rand() * Math.PI * 2)
    dir.applyAxisAngle(axis, (rand() - 0.5) * amount)
  }

  // One branch: a crooked tube from start, tapering as it goes, segments
  // kinks long, every kink bent back towards the sky by upPull (down, when
  // it's negative). Grown from a parent, it starts as a collar as wide as
  // the parent there, heading half the parent's way, so it reads as one wood
  // instead of a stuck-in cylinder. from is how far along the wood from the
  // ground it starts. A branch that hangs swings in the wind from its start.
  // A thin one may take fewer sides than the rest. A trunk may flare at its
  // base, flare times wider again at the ground, easing back to its own
  // radius a little way up. On a tree younger than mature it's as long and
  // as thick as it has grown by then, or not there at all, but it always
  // draws the same randoms, so the branches after it never move
  function branch(
    start,
    dir,
    fullLength,
    fullRadius,
    crookedness,
    { parent = null, from = 0, segments, taper, upPull, hangs = false, sides = params.sides, flare = 0 },
  ) {
    const length = grownLength(from, fullLength)
    const radius = fullRadius * THREE.MathUtils.lerp(YOUNG_THICKNESS, 1, length / fullLength)
    const points = [start]
    const radii = [parent ? parent.radius * COLLAR : radius]
    const d = parent ? parent.dir.clone().lerp(dir, 0.5).normalize() : dir.clone()
    // One that hangs sweeps from setting off outwards to hanging straight
    // down, right through the turn from squaring to the sky to SIDE, so its
    // kinks' turns are measured from one direction square to it, carried
    // along it, or it would swing as the tree ages. It's taken square to the
    // way it sets off, which is never near upright
    const square = hangs ? perpendicular(dir) : undefined
    for (let i = 1; i <= segments; i++) {
      if (parent && i === 2) d.copy(dir)
      square?.addScaledVector(d, -square.dot(d)).normalize()
      kink(d, crookedness, random, square)
      d.addScaledVector(UP, upPull).normalize()
      points.push(points[i - 1].clone().addScaledVector(d, length / segments))
      radii.push(radius * (1 - (1 - taper) * (i / segments)))
    }
    // Only measuring the tree, its farthest tip is all that's wanted of it
    if (params.measuring) {
      if (length >= MIN_LENGTH) farthestEnd = Math.max(farthestEnd, from + length)
      return { points, radii }
    }
    const flareTo = flare > 0 ? Math.min((radius * FLARE_HEIGHT) / length, 0.5) : 0
    // Its flex and beat at each kink, carried on from the wood it grows
    // from, so where it joins it moves with it. The drift grows in with the
    // branch, so one just sprouted beats with the wood it grows from
    const joint = nearestWood(start, JOINT_REACH) ?? { flex: 0, phase: 0 }
    const flexes = [joint.flex]
    const phases = [joint.phase]
    const drift = PHASE_DRIFT * (0.5 + driftRandom()) * (length / fullLength)
    for (let i = 1; i < points.length; i++) {
      const thickness = Math.max((radii[i - 1] + radii[i]) / 2, STIFF_RADIUS)
      flexes.push(flexes[i - 1] + points[i].distanceTo(points[i - 1]) / thickness)
      phases.push(joint.phase + (drift * i) / segments)
    }
    // One not grown yet is all at its start, where it'll sprout
    if (length < MIN_LENGTH) return { points, radii }
    thickest ??= fullRadius
    if (fullRadius >= thinnest * thickest) {
      const [k, r, f, p] = [points, radii, flexes, phases].map((list) => everyNth(list, ringStep))
      tube(k, r, from, length, hangs ? start.y : undefined, sides, params.smoothness, capRings, flare, flareTo, f, p)
    } else farthestBirth = Math.max(farthestBirth, from + length)
    for (const point of points) top = Math.max(top, point.y)
    for (let i = 1; i < points.length; i++)
      addStretch(points[i - 1], points[i], flexes[i - 1], flexes[i], phases[i - 1], phases[i], radii[i - 1], radii[i])
    return { points, radii }
  }

  // How long a branch from from, fullLength long on the grown tree, is at
  // the tree's age: none until the tree's growth reaches where it starts,
  // then lengthening faster than the growth goes on, until it's full grown.
  // The growth is params.front of the way to params.reach, the farthest tip
  // of the tree full grown; with no reach, every branch is full grown
  function grownLength(from, fullLength) {
    if (params.reach === undefined) return fullLength
    return THREE.MathUtils.clamp((params.front * params.reach - from) * SPROUT_SPEED, 0, fullLength)
  }

  function addStretch(a, b, flexA, flexB, phaseA, phaseB, radiusA, radiusB) {
    const index = stretches.push({ a, b, flexA, flexB, phaseA, phaseB, radiusA, radiusB }) - 1
    const lo = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)].map((v) => Math.floor(v / CELL))
    const hi = [Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)].map((v) => Math.floor(v / CELL))
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = cellKey(x, y, z)
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(index)
        }
  }

  // The wood nearest a point, within reach: its flex, beat, radius and
  // direction there, or null if there's no wood that close
  const along = new THREE.Vector3()
  // Each stretch is marked with the search it was last looked at in, so
  // one in several cells is only measured once
  let search = 0
  // It's a blend of every stretch about as near as the nearest, the nearer
  // counting for more, so as the wood grows and another stretch comes to be
  // the nearest, it slides over to it rather than jumping
  function nearestWood(point, reach) {
    const found = []
    let nearest = reach
    const rings = Math.min(Math.ceil(reach / CELL), SEARCH_RINGS)
    const [cx, cy, cz] = [point.x, point.y, point.z].map((v) => Math.floor(v / CELL))
    search++
    for (let x = cx - rings; x <= cx + rings; x++)
      for (let y = cy - rings; y <= cy + rings; y++)
        for (let z = cz - rings; z <= cz + rings; z++) {
          const cell = grid.get(cellKey(x, y, z))
          if (!cell) continue
          for (const index of cell) {
            const stretch = stretches[index]
            if (stretch.search === search) continue
            stretch.search = search
            // Measured in plain numbers, as it's done for every stretch near
            // every branch, clump and twig
            const { a, b } = stretch
            const [ax, ay, az] = [b.x - a.x, b.y - a.y, b.z - a.z]
            const [px, py, pz] = [point.x - a.x, point.y - a.y, point.z - a.z]
            const t = THREE.MathUtils.clamp((ax * px + ay * py + az * pz) / Math.max(ax * ax + ay * ay + az * az, 1e-12), 0, 1)
            const distance = Math.hypot(px - ax * t, py - ay * t, pz - az * t)
            if (distance >= reach) continue
            found.push({ stretch, t, distance })
            nearest = Math.min(nearest, distance)
          }
        }
    if (!found.length) return null
    const near = nearest * BLEND_NEAR + BLEND_REACH
    const blend = { flex: 0, phase: 0, radius: 0, dir: new THREE.Vector3() }
    let total = 0
    for (const { stretch, t, distance } of found) {
      if (distance >= near) continue
      const weight = (1 - distance / near) ** 2
      const { lerp } = THREE.MathUtils
      blend.flex += weight * lerp(stretch.flexA, stretch.flexB, t)
      blend.phase += weight * lerp(stretch.phaseA, stretch.phaseB, t)
      blend.radius += weight * lerp(stretch.radiusA, stretch.radiusB, t)
      blend.dir.addScaledVector(along.subVectors(stretch.b, stretch.a).normalize(), weight)
      total += weight
    }
    blend.flex /= total
    blend.phase /= total
    blend.radius /= total
    if (blend.dir.lengthSq() > 1e-12) blend.dir.normalize()
    else blend.dir.copy(UP)
    return blend
  }

  function tube(kinks, kinkRadii, from, length, hangFrom, sides, smoothness, capRings, flare, flareTo, kinkFlexes, kinkPhases) {
    // Subdivide: smoothness rings per kink, along a curve through the kinks,
    // so bends come out round without the branch changing shape. A flared
    // base takes rings of its own up to flareTo, the share of the way along
    // where it ends, so its curve reads at any smoothness
    const steps = (kinks.length - 1) * smoothness
    // With a ring at each kink and no more, as on a twig, the rings are
    // the kinks themselves, with no curve to work out
    const curve = smoothness === 1 && flareTo === 0 ? null : new THREE.CatmullRomCurve3(kinks, false, 'centripetal')
    const shares = []
    if (flareTo > 0) for (let i = 0; i < FLARE_RINGS; i++) shares.push((i / FLARE_RINGS) * flareTo)
    for (let i = 0; i <= steps; i++) if (i / steps >= flareTo) shares.push(i / steps)
    const points = []
    const radii = []
    const flexes = []
    const phases = []
    for (const share of shares) {
      points.push(curve ? curve.getPoint(share) : kinks[Math.round(share * (kinks.length - 1))])
      const at = share * (kinks.length - 1)
      const k = Math.min(Math.floor(at), kinks.length - 2)
      const widen = share < flareTo ? 1 + flare * (1 - share / flareTo) ** 2 : 1
      radii.push(THREE.MathUtils.lerp(kinkRadii[k], kinkRadii[k + 1], at - k) * widen)
      flexes.push(THREE.MathUtils.lerp(kinkFlexes[k], kinkFlexes[k + 1], at - k))
      phases.push(THREE.MathUtils.lerp(kinkPhases[k], kinkPhases[k + 1], at - k))
    }

    const base = positions.length / 3
    const tangent = new THREE.Vector3()
    const normal = perpendicular(points[1].clone().sub(points[0]).normalize())
    const binormal = new THREE.Vector3()
    const v = new THREE.Vector3()
    const center = new THREE.Vector3()

    // A ring of vertices; bend tips its normals forward, for the cap
    function ring(radius, bend, birth, flex, phase) {
      farthestBirth = Math.max(farthestBirth, birth)
      const lift = liftBelow(hangFrom, center.y)
      const [cosBend, sinBend] = [Math.cos(bend), Math.sin(bend)]
      for (let j = 0; j < sides; j++) {
        centers.push3(center.x, center.y, center.z)
        roots.push3(kinks[0].x, kinks[0].y, kinks[0].z)
        births.push(birth)
        lifts.push(lift)
        sways.push2(flex, phase)
        const angle = (j / sides) * Math.PI * 2
        v.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
        positions.push3(center.x + v.x * radius, center.y + v.y * radius, center.z + v.z * radius)
        v.multiplyScalar(cosBend).addScaledVector(tangent, sinBend)
        normals.push3(v.x, v.y, v.z)
      }
    }

    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(i - 1, 0)]
      const b = points[Math.min(i + 1, points.length - 1)]
      tangent.subVectors(b, a).normalize()
      // Carry the previous ring's frame along, so the tube doesn't twist
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize()
      binormal.crossVectors(tangent, normal)
      center.copy(points[i])
      ring(radii[i], 0, from + shares[i] * length, flexes[i], phases[i])
    }

    // Close the tip with a rounded dome, shrinking rings down to a point:
    // one ring makes it a point straight away
    const end = points[points.length - 1]
    const endRadius = radii[radii.length - 1]
    for (let k = 1; k <= capRings; k++) {
      const bend = (k / capRings) * (Math.PI / 2)
      center.copy(end).addScaledVector(tangent, endRadius * Math.sin(bend))
      ring(endRadius * Math.cos(bend), bend, from + length, flexes.at(-1), phases.at(-1))
    }

    for (let i = 0; i < points.length - 1 + capRings; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * sides + j
        const b = base + i * sides + ((j + 1) % sides)
        indices.push3(a, b, a + sides)
        indices.push3(b, b + sides, a + sides)
      }
    }
  }

  // Twigs in each clump, count of them in a clump of average size, more in
  // a bigger one: thin wood from its centre, which is on the wood, out
  // towards its surface, squashed into a pad or stretched into a tress
  // with it. A twig grows with its clump and sways as it does all along, so
  // the leaves on it stay on it. How many a clump gets goes by its full
  // grown radius, fullRadius on a young tree's, so a clump growing keeps
  // its twigs, growing out with it. Each clump's twigs draw from a random
  // of its own, so a change to one clump never moves another's. Each clump
  // is given its twigs' kinks, for its leaves to hang from. Without tubes,
  // only the kinks are worked out, not the wood round them, which is most
  // of the work: for when the twigs wouldn't be seen
  function twigs(clumps, count, seed, farthest, most, tubes) {
    const full = (c) => c.fullRadius ?? c.radius
    const meanRadius = Math.sqrt(clumps.reduce((sum, c) => sum + full(c) ** 2, 0) / Math.max(clumps.length, 1))
    const sides = Math.min(params.sides, TWIG_SIDES)
    const turn = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const out = new THREE.Vector3()
    clumps.forEach((clump, c) => {
      const { position, radius, flatten = 1, hangFrom, birth, swing } = clump
      const rand = mulberry32(seed + c * 7919)
      const wood = nearestWood(position, CELL)
      const thickness = Math.min(radius * TWIG_THICKNESS, wood ? wood.radius * TWIG_THINNER : Infinity)
      // Spread evenly round the clump, the pattern turned randomly, so no
      // two clumps line up
      const twigCount = count > 0 ? Math.max(1, Math.round((count * full(clump)) / meanRadius)) : 0
      turn.setFromEuler(euler.set(rand() * 6.28, rand() * 6.28, rand() * 6.28))
      clump.twigs = []
      for (let i = 0; i < twigCount; i++) {
        const y = 1 - (2 * (i + 0.5)) / twigCount
        const ring = Math.sqrt(1 - y * y)
        const angle = i * GOLDEN_ANGLE
        out.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring).applyQuaternion(turn)
        if (wood) out.addScaledVector(wood.dir, TWIG_AHEAD).normalize()
        out.y *= flatten
        const length = out.length() * radius * TWIG_REACH * (0.8 + rand() * 0.4)
        const d = out.normalize()
        const points = [position.clone()]
        const radii = [thickness]
        // Its kinks' turns are measured from the spiral's own way round at
        // its point, turned with the pattern, and carried along it, rather
        // than each from the sky's: twigs head every way, and the sky's
        // turns round from squaring to it to SIDE near upright, so a twig
        // heading through there would swing as the tree ages
        const square = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).applyQuaternion(turn)
        for (let k = 1; k <= TWIG_SEGMENTS; k++) {
          square.addScaledVector(d, -square.dot(d)).normalize()
          kink(d, params.crookedness * TWIG_CROOKED, rand, square)
          d.addScaledVector(UP, hangFrom === undefined ? TWIG_LIFT : -TWIG_LIFT).normalize()
          points.push(points[k - 1].clone().addScaledVector(d, length / TWIG_SEGMENTS))
          radii.push(thickness * (1 - (1 - TWIG_TAPER) * (k / TWIG_SEGMENTS)))
        }
        // One on a clump not grown yet is too short to draw
        if (length < MIN_LENGTH) continue
        for (const point of points) top = Math.max(top, point.y)
        if (tubes) {
          const flexes = points.map(() => swing.flex * most)
          const phases = points.map(() => swing.phase)
          tube(points, radii, birth * farthest, length, hangFrom, sides, 1, 1, 0, 0, flexes, phases)
        }
        clump.twigs.push(points)
      }
    })
  }

  // The wood as one geometry, its births and flexes on the scale of the
  // wood's own farthest tip and most flexible tip, however far a twig goes
  function geometryOf(farthest, most) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.copy(), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals.copy(), 3))
    geometry.setIndex(new THREE.BufferAttribute(indices.copy(), 1))
    // For growing: distances along the wood, 0 at the ground to 1 at the
    // farthest tip
    geometry.setAttribute('growCenter', new THREE.BufferAttribute(centers.copy(), 3))
    geometry.setAttribute('growRoot', new THREE.BufferAttribute(roots.copy(), 3))
    const grownBy = births.copy()
    for (let i = 0; i < grownBy.length; i++) grownBy[i] = Math.min(grownBy[i] / farthest, 1)
    geometry.setAttribute('birth', new THREE.BufferAttribute(grownBy, 1))
    // For the wind: the lift, and the branches' own sway, its flex from 0
    // at the ground to 1 at the most flexible tip
    geometry.setAttribute('swayLift', new THREE.BufferAttribute(lifts.copy(), 1))
    const detail = sways.copy()
    for (let i = 0; i < detail.length; i += 2) detail[i] = Math.min(detail[i] / most, 1)
    geometry.setAttribute('swayDetail', new THREE.BufferAttribute(detail, 2))
    return geometry
  }

  // The wood as one geometry, and how far along it the farthest tip is, so
  // a species can place its leaves' births on the same scale. A leaf clump
  // takes the flex and beat of the wood nearest it, so it moves with its
  // twig. With no wood at all, as on a bush, each clump bobs on a beat of
  // its own, drawn for its index, so it keeps it as it grows. Once the
  // clumps have their swing, withTwigs(clumps, count, tubes) gives the wood
  // again with twigs grown into them, drawn from a random of their own, so
  // they never move the branches or the leaves. With tubes false, the
  // clumps get their twigs' kinks, and the wood comes back as it was
  function build() {
    if (params.measuring) {
      const geometry = new THREE.BufferGeometry()
      geometry.userData.farthest = Math.max(farthestEnd, 1e-6)
      return { geometry, farthest: geometry.userData.farthest }
    }
    const farthest = farthestBirth
    // The most flexible tip, from the branches rather than their tubes, so
    // a lighter level, leaving out the thinnest, sways as the full tree does
    let most = 1e-6
    for (const { flexB } of stretches) most = Math.max(most, flexB)
    const geometry = geometryOf(farthest, most)
    const swayAt = (point, index) => {
      if (stretches.length === 0) return { flex: 1, phase: mulberry32(params.seed + 2903 + index)() * Math.PI * 2 }
      // Out a ring of cells at a time, most clumps being on their wood
      for (let rings = 1; rings <= SEARCH_RINGS; rings++) {
        const found = nearestWood(point, rings * CELL)
        if (found) return { flex: found.flex / most, phase: found.phase }
      }
      return { flex: 0, phase: 0 }
    }
    geometry.userData.swayAt = swayAt
    geometry.userData.farthest = farthest
    geometry.userData.top = top
    geometry.userData.withTwigs = (clumps, count, tubes = true) => {
      twigs(clumps, count, params.seed + 6151, farthest, most, tubes)
      geometry.userData.top = top
      if (!tubes) return geometry
      const twigged = geometryOf(farthest, most)
      twigged.userData.swayAt = swayAt
      twigged.userData.top = top
      return twigged
    }
    return { geometry, farthest }
  }

  return { branch, build }
}

// Where a branch is, which way it goes and how thick it is, a share of the
// way along its kinks, from 0 at its start to 1 at its end
export function alongBranch({ points, radii }, at) {
  const segments = points.length - 1
  const k = Math.min(Math.floor(at * segments), segments - 1)
  const f = at * segments - k
  const a = points[k]
  const b = points[k + 1]
  return {
    point: a.clone().lerp(b, f),
    dir: b.clone().sub(a).normalize(),
    radius: THREE.MathUtils.lerp(radii[k], radii[k + 1], f),
  }
}

// A direction from its compass bearing, around, and how far it rises off
// level, both in radians
export function heading(around, rise) {
  return new THREE.Vector3(Math.cos(around) * Math.cos(rise), Math.sin(rise), Math.sin(around) * Math.cos(rise))
}

// A list of numbers in a typed array that doubles in size as it fills:
// quicker to fill than a plain array, and copied to a geometry in one go
function numbers(Type) {
  let array = new Type(4096)
  let length = 0
  const room = (more) => {
    if (length + more <= array.length) return
    const bigger = new Type(Math.max(array.length * 2, length + more))
    bigger.set(array)
    array = bigger
  }
  return {
    get length() {
      return length
    },
    push(a) {
      room(1)
      array[length++] = a
    },
    push2(a, b) {
      room(2)
      array[length++] = a
      array[length++] = b
    },
    push3(a, b, c) {
      room(3)
      array[length++] = a
      array[length++] = b
      array[length++] = c
    },
    view: () => array.subarray(0, length), // the numbers so far, not copied
    copy: () => array.slice(0, length), // a copy of them, for a geometry of its own
  }
}

// A grid cell's key: a number, quicker to make than a string, for cells
// within 1024 of the origin each way, 512 metres
function cellKey(x, y, z) {
  return ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024)
}

// Every step-th of a list, its last always kept
function everyNth(list, step) {
  return step <= 1 ? list : list.filter((_, i) => i % step === 0 || i === list.length - 1)
}

// Lean a direction away from itself by angle, on the side given by around
export function splay(dir, around, angle) {
  const axis = perpendicular(dir).applyAxisAngle(dir, around)
  return dir.clone().applyAxisAngle(axis, angle)
}

// A direction square to v, for the random turns round it to start from:
// square to the sky, or for v nearly upright, to SIDE. Between the two it
// turns from one to the other, so as a tree ages and a branch's way tips
// past upright its kinks swing round smoothly rather than all jumping at once
const UPRIGHT_FROM = 0.87 // how upright v starts turning from squaring to the sky
const UPRIGHT_TO = 0.93 // how upright it's turned to squaring to SIDE
const toSide = new THREE.Vector3()
function perpendicular(v) {
  const turn = THREE.MathUtils.smoothstep(Math.abs(v.y), UPRIGHT_FROM, UPRIGHT_TO)
  if (turn === 1) return new THREE.Vector3().crossVectors(v, SIDE).normalize()
  const square = new THREE.Vector3().crossVectors(v, UP).normalize()
  if (turn === 0) return square
  toSide.crossVectors(v, SIDE).normalize()
  return square.lerp(toSide, turn).normalize()
}

// A tree's own character: how far its seed takes it from its species'
// average, drawn from a random of its own, so it never moves the branches'
// draws. vary(value, by) is value give or take by, as far as the variety
// takes it: always value at 0, anywhere in the range at 1. bearing() is a
// compass bearing, for a lean or the side a crown is heavier on
export function character(params) {
  const random = mulberry32(params.seed + 3571)
  return {
    vary: (value, by) => value + (random() * 2 - 1) * by * params.variety,
    bearing: () => random() * Math.PI * 2,
  }
}

// How much longer a branch heading around is on a crown heavier by heavy
// towards side: 1 + heavy facing it, 1 - heavy facing away
export function lopsided(around, side, heavy) {
  return 1 + heavy * Math.cos(around - side)
}

// Small seeded random, so a seed always gives the same tree
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

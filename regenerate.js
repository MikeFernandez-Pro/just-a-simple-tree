import {
  attribute,
  cos,
  float,
  Fn,
  mix,
  positionGeometry,
  uniform,
} from "three/tsl";

// A new tree, with a burst: the old leaves blow away on the wind while the
// tree scales down into its foot. The moment the tree is gone, the new one
// springs up out of the ground, taller
// and thinner as it shoots up, shorter and wider as it overshoots, bouncing
// to rest, while its branches shoot out and its leaves pop on in a quick
// soft wave from the trunk to the tips. A new seed or a new species both
// go this way. Falling leaves stop leaving the old tree, and start again from
// the new one once it has grown. The first tree, as the page opens, comes up
// the same way from bare ground, with no old one to blow away

// 0 bare ground, 1 fully grown: the branches unfolding and the leaves popping
export const growth = uniform(1);
// 0 leaves on the tree, 1 blown away
export const burst = uniform(0);
// The whole tree's size from its foot, across and up, which shake.js puts on
// it with its own squash. The leaves blowing away keep their own size as the
// wood shrinks under them, or they'd be pulled in after it
export const treeSize = { width: 1, height: 1, leaves: true };

const UNFOLD = 0.25; // how much of the growth each ring takes to unfold
const LEAF_SPREAD = 0.4; // of the growth, from the first leaf popping to the last starting
const LEAF_POP = 1; // of the growth, each leaf's pop

const BLOW_SECONDS = 1.6; // the old leaves blowing away, cut short when the new tree comes up
const SHRINK_DELAY = 0; // seconds into the blow before the tree starts scaling down
const SHRINK_SECONDS = 0.8;
const ACROSS_SHARE = 0.4; // of the shrink's time, the width's: it goes in faster, as if the tree were sucked into its trunk
const GROW_SECONDS = 0.9; // the branches unfolding and the leaves popping
// The spring the new tree comes up on: its height a little stiffer than its
// width, so it shoots up thin, then overshoots short and wide
const UP_BOUNCE = 1.4; // bounces a second, its height
const ACROSS_BOUNCE = 1.1; // bounces a second, its width
const DAMPING = 0.4; // 0 bounces for ever, 1 settles with no bounce; 0.4 overshoots by a quarter

// How far along its own growth a point of the wood is, eased
function grownBy(birth) {
  return growth
    .mul(1 + UNFOLD)
    .sub(birth)
    .div(UNFOLD)
    .smoothstep(0, 1);
}

// The wood: each ring slides out from its branch's root to its place, and
// widens as it goes
export const grownWood = Fn(() => {
  const center = attribute("growCenter", "vec3");
  const root = attribute("growRoot", "vec3");
  const k = grownBy(attribute("birth", "float"));
  return mix(root, center, k).add(positionGeometry.sub(center).mul(k));
});

// A leaf card's size: none until the wave reaches it, then a soft pop,
// swelling a quarter past its size halfway through and settling back, each
// card on its own beat. It rises gently and lands on its size exactly
export function grownLeaf(birth, jitter) {
  const t = growth
    .sub(birth.mul(LEAF_SPREAD).add(jitter.mul(0.1)))
    .div(LEAF_POP)
    .clamp(0, 1);
  const left = t.oneMinus();
  return float(1).sub(left.mul(left).mul(cos(t.mul(Math.PI * 2))));
}

const easeOut = (t) => 1 - (1 - t) ** 3;

// hold(true) keeps the tree as it is, whatever changes, until hold(false)
// rebuilds it with the latest. A change that wants a new tree is made, then
// regrow called: the tree held shows until it has shrunk away
// onSpringUp is called as each new tree starts springing up, but not the
// first, which comes up as the page opens
export function createRegenerate({ hold, falling, onSpringUp }) {
  let wanted = false;
  let running = null;
  let waiting = 0; // new trees asked for that haven't broken the old one yet

  function tween(seconds, onUpdate, stop = () => false) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        if (stop()) return resolve();
        const t = Math.min((now - start) / 1000 / seconds, 1);
        onUpdate(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // The new tree coming up from nothing on its springs, until it rests or
  // another change comes. A frame's step is at most a thirtieth of a second,
  // in small steps, so a hidden tab doesn't come back to a spring flung off
  function springUp() {
    return new Promise((resolve) => {
      const up = { at: 0, speed: 0, omega: UP_BOUNCE * Math.PI * 2 };
      const across = { at: 0, speed: 0, omega: ACROSS_BOUNCE * Math.PI * 2 };
      let last = performance.now();
      const frame = (now) => {
        let left = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        while (left > 0) {
          const dt = Math.min(left, 1 / 240);
          for (const s of [up, across]) {
            s.speed +=
              (-s.omega * s.omega * (s.at - 1) -
                2 * DAMPING * s.omega * s.speed) *
              dt;
            s.at += s.speed * dt;
          }
          left -= dt;
        }
        treeSize.height = Math.max(up.at, 0);
        treeSize.width = Math.max(across.at, 0);
        const resting = [up, across].every(
          (s) => Math.abs(s.at - 1) < 1e-3 && Math.abs(s.speed) < 1e-2,
        );
        if (wanted || resting) {
          if (resting) treeSize.width = treeSize.height = 1;
          return resolve();
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // Another change while the old tree goes lands with the swap. One while the
  // new tree comes up sends it away from wherever it got to, and brings up
  // the latest
  async function run() {
    falling.uniforms.spawning.value = 0;
    while (wanted) {
      const from = growth.value;
      const pace = Math.max(from, 0.25); // of the whole shrink's time, for a tree part grown

      // The leaves blow away; a moment in, the tree scales down into its
      // foot from wherever it was, fast at first and slowing as it goes, its
      // width pulled in to the trunk quicker than its height comes down. The
      // leaves keep their own size, and stop blowing when the new tree comes
      treeSize.leaves = false;
      let swapped = false;
      tween(
        BLOW_SECONDS * pace,
        (t) => (burst.value = easeOut(t)),
        () => swapped,
      );
      await tween(SHRINK_DELAY * pace, () => {});
      const { width, height } = treeSize;
      await tween(SHRINK_SECONDS * pace, (t) => {
        treeSize.width = width * (1 - easeOut(Math.min(t / ACROSS_SHARE, 1)));
        treeSize.height = height * (1 - easeOut(t));
      });

      // The old tree has shrunk away: swap in the new one, and bring it up,
      // once no other new tree is still on its way to break it, so the one
      // that comes up is the latest
      while (waiting > 0) await tween(0, () => {});
      swapped = true;
      wanted = false;
      hold(false);
      burst.value = 0;
      onSpringUp();
      await comeUp();
    }
    done();
  }

  // The tree springing up out of the ground, its branches shooting out and
  // its leaves popping on, until it has grown or another change comes
  async function comeUp() {
    growth.value = 0;
    treeSize.leaves = true;
    const grow = tween(
      GROW_SECONDS,
      (t) => (growth.value = 1 - (1 - t) ** 2),
      () => wanted,
    );
    await springUp();
    await grow;
  }

  function done() {
    growth.value = 1;
    treeSize.leaves = true;
    falling.uniforms.spawning.value = 1;
    running = null;
  }

  // The first tree kept down in the ground, and no leaf falling, until
  // appear brings it up
  function waitToAppear() {
    growth.value = 0;
    treeSize.width = treeSize.height = 0;
    falling.uniforms.spawning.value = 0;
  }

  // The first tree coming up. A new tree asked for meanwhile takes over
  // from wherever it got to, as it does from a growing one
  function appear() {
    running ??= (async () => {
      await comeUp();
      if (wanted) await run();
      else done();
    })();
    return running;
  }

  // Resolves once the newest tree has grown. With a delay, in seconds, the
  // old tree is held as it is until then, and only then breaks
  async function regrow(delay = 0) {
    hold(true);
    if (delay > 0) {
      waiting++;
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      waiting--;
    }
    wanted = true;
    running ??= run();
    return running;
  }

  return { regrow, waitToAppear, appear };
}

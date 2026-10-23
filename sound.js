import { LINE, PHONE } from "./stickers.js";
import { wind } from "./wind.js";

// The wind and the leaves rustling, two recorded loops playing over each
// other, each as loud as the panel's wind makes it: the wind in step with
// its strength, the leaves with their flutter and with how much of the tree
// is in leaf, falling quiet as the leaves drop. Both swell as a theme's gust
// blows and die away as the wind's speed comes down to nothing, the tree
// standing still. Under them, three lofi tracks play one after the other,
// round and round, at a steady volume. A whoosh sweeps in each new theme,
// peaking about two thirds of the way through the sweep. Each new tree, a
// new species or seed, snaps the old one like wood as it breaks down, and
// pops as it springs up. It all starts as you enter the
// page, easing in: a browser only lets a page make sound once you've done
// something on it, and entering is that. A round sticker beside the GitHub
// one turns it all off and on, as M does. Hovering it brings out a bar
// above it setting the volume of everything, which a touch screen has
// buttons of its own for. Every visit starts with it on, at the volume
// last set. It goes quiet while the page is hidden, and the music pauses

const FILES = { wind: "sounds/wind.ogg", leaves: "sounds/leaves.ogg" };
const LOUDEST = { wind: 0.37, leaves: 0.315 }; // each loop's gain, at its loudest
const FULL_WIND = 0.6; // the strength, gust included, the wind is loudest at, rising in step with it until then
const FULL_FLUTTER = 0.6; // the flutter, gust included, the leaves are loudest at
const STILL = 0.4; // the wind's speed below which the sound dies away towards none
// The music, from Pixabay (see public/music/CREDITS.md), each track as Opus
// and as an MP3 for a browser without Opus, an old Safari
const TRACKS = ["chill-vlog-beats", "sunny-cafe", "beautiful-lofi"];
const MUSIC = 0.3; // the music's gain
// The short sounds, from Pixabay too, as Opus and as an MP3 like the music,
// each with its gain and the speed it plays at, a slower one lower: a
// theme's whoosh, and the wood breaking and the pop of a new tree
const EFFECTS = {
  whoosh: { gain: 0.3, rate: 1 },
  break: { gain: 0.05, rate: 2 }, // loud enough to crack through the music's beat
  pop: { gain: 0.12, rate: 0.6 },
};
const OVERALL = 0.8; // the gain of everything, at the bar's top
const EASE = 0.25; // seconds a change of loudness takes, about
const START = 1.5; // seconds the sound takes to ease in; turned off, it stops at once
const SIZE = 44; // the sticker's width, in pixels
const STORED_VOLUME = "just-a-simple-tree:volume"; // where the page remembers the volume, 0 to 1
const BAR = 110; // the volume bar's length, in pixels

// A speaker, with its sound coming out of it or crossed out, in a 24 × 24 box
const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>';
const ICONS = {
  on: `${SPEAKER}<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>`,
  off: `${SPEAKER}<path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>`,
};

// leafiness gives how much of the tree is in leaf, 0 to 1
export function createSound({ leafiness }) {
  const style = document.createElement("style");
  style.textContent = `
    .sound { position: fixed; right: ${26 + SIZE + 18}px; bottom: 30px; display: flex; align-items: center }
    .sound-toggle { width: ${SIZE}px; height: ${SIZE}px;
      box-sizing: border-box; padding: 0; display: grid; place-items: center; border: 3px solid ${LINE};
      border-radius: 50%; background: #fff; box-shadow: 4px 4px 0 var(--button-shadow); color: ${LINE};
      cursor: pointer; rotate: -5deg; transition: box-shadow .08s, translate .08s, scale .25s cubic-bezier(.34, 1.8, .64, 1) }
    .sound-toggle svg { width: 58%; height: 58% }
    .sound-toggle:hover { box-shadow: 6px 6px 0 var(--button-shadow); scale: 1.08 }
    .sound-toggle:active { box-shadow: 1px 1px 0 var(--button-shadow); translate: 3px 3px }
    /* The volume bar, a white pill standing on top of the sticker, its
       track filled in charcoal from the bottom up to the knob: a level
       slider turned upright, which every browser can draw and drag, its
       knob's shadow turned back so it falls down and right like the rest. A
       strip under it reaches the sticker, so the pointer can cross the gap
       without it going */
    .sound .volume { position: absolute; bottom: calc(100% + 12px); left: 50%; box-sizing: border-box;
      width: 46px; height: ${BAR + 32}px; border: 3px solid ${LINE}; border-radius: 999px; background: #fff;
      box-shadow: 4px 4px 0 var(--button-shadow); rotate: 2deg; opacity: 0; translate: -50% 8px; pointer-events: none;
      transition: opacity .12s, translate .15s cubic-bezier(.34, 1.8, .64, 1) }
    .sound .volume::after { content: ''; position: absolute; top: 100%; left: -6px; right: -6px; height: 20px }
    .sound:hover .volume, .sound:focus-within .volume { opacity: 1; translate: -50% 0; pointer-events: auto }
    .sound input { --fill: 100%; appearance: none; position: absolute; left: 50%; top: 50%; width: ${BAR}px;
      height: 20px; margin: 0; translate: -50% -50%; rotate: -90deg; background: none; cursor: pointer }
    .sound input:focus-visible { outline: 2px solid ${LINE}; outline-offset: 4px; border-radius: 4px }
    .sound input::-webkit-slider-runnable-track { box-sizing: border-box; height: 10px; border: 2.5px solid ${LINE};
      border-radius: 5px; background: linear-gradient(to right, ${LINE} var(--fill), #fff var(--fill)) }
    .sound input::-webkit-slider-thumb { appearance: none; box-sizing: border-box; width: 18px; height: 18px;
      margin-top: -6.5px; border: 2.5px solid ${LINE}; border-radius: 50%; background: #fff;
      box-shadow: -2px 2px 0 var(--button-shadow) }
    .sound input::-moz-range-track { box-sizing: border-box; height: 10px; border: 2.5px solid ${LINE};
      border-radius: 5px; background: #fff }
    .sound input::-moz-range-progress { height: 10px; border-radius: 5px; background: ${LINE} }
    .sound input::-moz-range-thumb { box-sizing: border-box; width: 18px; height: 18px; border: 2.5px solid ${LINE};
      border-radius: 50%; background: #fff; box-shadow: -2px 2px 0 var(--button-shadow) }
    @media (hover: none) { .sound .volume { display: none } }
    @media (max-width: 900px) { .sound { bottom: 100px } }
    @media (max-width: 480px), (max-height: 500px) {
      .sound { right: ${16 + SIZE * 0.8 + 12}px; bottom: 104px }
      .sound-toggle { width: ${SIZE * 0.8}px; height: ${SIZE * 0.8}px;
        border-width: 2.5px; box-shadow: 3px 3px 0 var(--button-shadow) }
    }
    @media ${PHONE} { .sound { bottom: 24px } }
  `;
  document.head.appendChild(style);

  const holder = document.createElement("div");
  holder.className = "sound";
  const bar = document.createElement("div");
  bar.className = "volume";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 1;
  slider.step = 0.01;
  slider.setAttribute("aria-label", "volume");
  bar.append(slider);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sound-toggle";
  holder.append(bar, button);
  document.body.appendChild(holder);

  let on = true;
  // The volume last set, unless that was none, as on would then be silent
  const kept = Number(localStorage.getItem(STORED_VOLUME) ?? 1);
  let volume = Number.isFinite(kept) && kept > 0 ? Math.min(kept, 1) : 1;
  slider.value = volume;
  const fill = () => slider.style.setProperty("--fill", `${volume * 100}%`);
  fill();
  function show() {
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[on ? "on" : "off"]}</svg>`;
    button.title = on ? "sound off  M" : "sound on  M";
    button.setAttribute(
      "aria-label",
      on ? "turn the sound off" : "turn the sound on",
    );
    button.setAttribute("aria-pressed", on);
  }
  show();

  // Made as you enter, or turn it on, as a browser wants: the context, a gain
  // for everything that eases it in and out, and one per loop for how loud
  // the wind makes it. Each loop is fetched and decoded, then plays round
  // and round from a random point, so the two don't line up the same way
  // every visit. One that can't be decoded, an old Safari with no Ogg,
  // stays silent
  let context = null;
  let master = null;
  const gains = {};
  // The music streams from an audio element rather than being decoded whole,
  // a few minutes of it being a lot of memory decoded, and goes through the
  // same easing as the loops. Each track that ends starts the next
  const music = new Audio();
  music.preload = "none";
  const type = music.canPlayType('audio/webm; codecs="opus"') ? "webm" : "mp3";
  let track = 0;
  const load = () =>
    (music.src = `${import.meta.env.BASE_URL}music/${TRACKS[track]}.${type}`);
  music.addEventListener("ended", () => {
    track = (track + 1) % TRACKS.length;
    load();
    music.play().catch(() => {});
  });
  function start() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    // A limiter last, so a crack landing on a loud beat is held under full
    // scale rather than clipping; quieter than that, it does nothing
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master.connect(limiter).connect(context.destination);
    const musicGain = context.createGain();
    musicGain.gain.value = MUSIC;
    context.createMediaElementSource(music).connect(musicGain).connect(master);
    load();
    for (const [name, file] of Object.entries(FILES)) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      gains[name] = gain;
      fetch(`${import.meta.env.BASE_URL}${file}`)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(gain);
          source.start(0, Math.random() * buffer.duration);
        })
        .catch((error) =>
          console.warn(`The ${name} sound didn't load:`, error),
        );
    }
    for (const name of Object.keys(EFFECTS)) {
      fetch(`${import.meta.env.BASE_URL}sounds/${name}.${type}`)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => (effects[name] = buffer))
        .catch((error) => console.warn(`The ${name} didn't load:`, error));
    }
    fade();
  }

  // A short sound, played afresh each time, so quick ones in succession
  // each get their own. Not before you've entered, nor with the sound off
  const effects = {};
  function play(name) {
    if (!context || !on || !effects[name]) return;
    const source = context.createBufferSource();
    source.buffer = effects[name];
    source.playbackRate.value = EFFECTS[name].rate;
    const gain = context.createGain();
    gain.gain.value = EFFECTS[name].gain;
    source.connect(gain).connect(master);
    source.start();
  }

  // The whole sound easing in when it's turned on, and stopping at once,
  // the music pausing, when it's turned off or the page is hidden
  function fade() {
    if (!context) return;
    const gain = master.gain;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    if (on && !document.hidden) {
      context.resume();
      music
        .play()
        .catch((error) => console.warn(`The music didn't play:`, error));
      gain.setValueAtTime(gain.value, now);
      gain.setTargetAtTime(loud(), now, START / 3);
    } else {
      music.pause();
      gain.setValueAtTime(0, now);
    }
  }
  // The volume as a gain, squared, so the bar's middle sounds about half as
  // loud rather than nearly as loud as its end
  const loud = () => OVERALL * volume ** 2;

  function toggle() {
    on = !on;
    show();
    if (entered) start();
    fade();
  }
  button.addEventListener("click", () => {
    button.blur();
    toggle();
  });
  // Moving the bar sets the volume at once, and turns the sound on if it
  // was off, once you've entered
  slider.addEventListener("input", () => {
    volume = Number(slider.value);
    localStorage.setItem(STORED_VOLUME, volume);
    fill();
    if (!entered) return;
    if (!on) return toggle();
    master?.gain.setTargetAtTime(loud(), context.currentTime, 0.02);
  });
  // Let go of focus once dragged, so the bar goes when the pointer does,
  // staying for the keys only when they brought it
  slider.addEventListener("pointerup", () => slider.blur());
  addEventListener("visibilitychange", fade);

  // Entering the page: the sound starts, if it's on, the enter button's
  // click or key letting it
  let entered = false;
  function begin() {
    entered = true;
    if (on) start();
  }

  // Once a frame: each loop's loudness from the wind as it blows now. The
  // wind's in step with its strength, so a stronger wind is plainly louder;
  // the leaves' rising quickly from a little flutter and levelling off, then
  // as full as the tree is of leaves
  const loudness = (amount, full) => Math.min(amount / full, 1) ** 0.6;
  const levels = { wind: -1, leaves: -1 };
  function update() {
    if (!context) return;
    const gust = 1 + wind.gust.value;
    const moving = Math.min(wind.speed.value / STILL, 1);
    const now = {
      wind:
        Math.min((wind.strength.value * gust) / FULL_WIND, 1) *
        moving *
        LOUDEST.wind,
      leaves:
        loudness(wind.flutter.value * gust, FULL_FLUTTER) *
        leafiness() *
        moving *
        LOUDEST.leaves,
    };
    // Only when it changes, so the gains' timelines don't fill up
    for (const [name, gain] of Object.entries(gains)) {
      if (Math.abs(now[name] - levels[name]) < 1e-3) continue;
      levels[name] = now[name];
      gain.gain.setTargetAtTime(now[name], context.currentTime, EASE / 3);
    }
  }

  return { begin, toggle, update, play };
}

import { createStickers } from './stickers.js'

// Colour themes, each a whole scene: three leaf bands from shadow to light,
// the three they turn to as they age, three wood bands, the grass from root
// to tip, the background, and the shadows' colour and darkness. Blossom is
// the one the page opens on. And the buttons
// picking them, a row of round stickers along the top, centred, white like
// the bar at the bottom so they read on any background, each with its
// season's emoji

export const THEMES = {
  blossom: {
    emoji: '🌸',
    leaves: ['#d9789b', '#ff94b6', '#ffadce'],
    turned: ['#c4564f', '#f0805f', '#ffb08a'],
    wood: ['#959cb1', '#bfb8d1', '#c1c8ec'],
    grass: ['#1cab47', '#a8e1c6'],
    background: '#ffe5f4',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  spring: {
    emoji: '🌱',
    leaves: ['#4ea276', '#a8ff75', '#d7f08c'],
    turned: ['#d0632e', '#f2a23a', '#f7d66a'],
    wood: ['#837282', '#8a796a', '#b4a088'],
    grass: ['#11a63e', '#77dfca'],
    background: '#c4f3fd',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  autumn: {
    emoji: '🍂',
    leaves: ['#ff7e38', '#ffae00', '#f5e26b'],
    turned: ['#a3302c', '#d4473a', '#f07a4f'],
    wood: ['#7a5343', '#805f4d', '#867365'],
    grass: ['#9c1c1c', '#eb6847'],
    background: '#fffae0',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  frost: {
    emoji: '❄️',
    leaves: ['#7f9fb5', '#b9d3e2', '#f2f8fb'],
    turned: ['#8a7f95', '#b7a9bf', '#e6dcea'],
    wood: ['#5c5f66', '#66686c', '#89909a'],
    grass: ['#407da5', '#e3f0f7'],
    background: '#4194c8',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  night: {
    emoji: '🌙',
    leaves: ['#245370', '#2d707c', '#3b878c'],
    turned: ['#5b3f5e', '#7d4d63', '#a0606a'],
    wood: ['#252a32', '#3b414f', '#4d5666'],
    grass: ['#092534', '#0e575d'],
    background: '#1f2947',
    shadow: { color: '#000000', darkness: 0.51 },
  },
}

export const START_THEME = 'blossom'

// The buttons along the top, centred: under the Inspector's bar when the
// screen is too narrow to share the top with it
export function createThemeButtons({ onPick }) {
  const style = document.createElement('style')
  style.textContent = `
    .themes { position: fixed; left: 50%; top: 16px; transform: translateX(-50%) }
    @media (max-width: 480px), (max-height: 500px) {
      .themes { top: 12px }
    }
    @media (max-width: 480px) {
      .themes { top: 64px }
    }
  `
  document.head.appendChild(style)

  const choices = Object.fromEntries(Object.entries(THEMES).map(([name, { emoji }]) => [name, emoji]))
  const { show } = createStickers({ className: 'themes', choices, label: (name) => `${name} theme`, hint: '← →', onPick })
  return { show }
}

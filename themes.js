import { createStickers } from './stickers.js'

// Colour themes, each a whole scene: four leaf bands from core to light, three
// trunk bands, the grass from root to tip, the background, and the shadows'
// colour and darkness. Blossom is the one the page opens on. And the buttons
// picking them, a row of round stickers along the top, centred, white like
// the bar at the bottom so they read on any background, each with its
// season's emoji

export const THEMES = {
  blossom: {
    emoji: '🌸',
    leaves: ['#a0577a', '#d47f9e', '#f2abc2', '#ffe0ea'],
    trunk: ['#a9a4a6', '#d3cfd0', '#f4f2f2'],
    grass: ['#7d3654', '#d68a8a'],
    background: '#ffe5f4',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  spring: {
    emoji: '🌱',
    leaves: ['#3f7f63', '#5fae4e', '#8fd16a', '#d7f08c'],
    trunk: ['#4a423c', '#6e6258', '#948676'],
    grass: ['#2c6a3f', '#a6dc62'],
    background: '#a8c2ff',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  autumn: {
    emoji: '🍂',
    leaves: ['#6b2f2a', '#a8432b', '#e0782f', '#f6c35a'],
    trunk: ['#3d3430', '#5a4c44', '#7a6a5e'],
    grass: ['#9d552f', '#ffaf7a'],
    background: '#ffd1bd',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  frost: {
    emoji: '❄️',
    leaves: ['#4f6f86', '#7f9fb5', '#b9d3e2', '#f2f8fb'],
    trunk: ['#45474b', '#66686c', '#8b8d90'],
    grass: ['#5f7f94', '#e3f0f7'],
    background: '#f0f2ff',
    shadow: { color: '#2e3b5c', darkness: 0.75 },
  },
  night: {
    emoji: '🌙',
    leaves: ['#14273a', '#182d3a', '#2e5a62', '#5f8f86'],
    trunk: ['#1c2127', '#31343a', '#434851'],
    grass: ['#0d1f29', '#2b5458'],
    background: '#0f1524',
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
  const { show } = createStickers({ className: 'themes', choices, label: (name) => `${name} theme`, onPick })
  return { show }
}

import { createStickers } from './stickers.js'

// The buttons picking the species, a column of stickers down the left side,
// centred, each with a small flat silhouette of its tree in the outline's
// ink: the oak's round crown, the pine's tiers and the cypress's flame

const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths}</svg>`

const ICONS = {
  oak: icon(
    '<rect x="10.8" y="13" width="2.4" height="9" rx="0.8"/>' +
      '<circle cx="12" cy="8" r="6"/><circle cx="7" cy="11.5" r="4"/><circle cx="17" cy="11.5" r="4"/>',
  ),
  pine: icon(
    '<rect x="10.8" y="17" width="2.4" height="5" rx="0.8"/>' +
      '<path d="M12 1.5 L16.5 7.5 H14.2 L18.5 12.5 H15.8 L20.5 18 H3.5 L8.2 12.5 H5.5 L9.8 7.5 H7.5 Z"/>',
  ),
  cypress: icon(
    '<rect x="10.9" y="18" width="2.2" height="4.5" rx="0.8"/>' +
      '<path d="M12 1 C14.8 5 16 10 15.2 14.5 C14.7 17.5 13.5 19 12 19 C10.5 19 9.3 17.5 8.8 14.5 C8 10 9.2 5 12 1 Z"/>',
  ),
}

export function createSpeciesButtons({ species, onPick }) {
  const style = document.createElement('style')
  style.textContent = `
    .species { position: fixed; left: 16px; top: 50%; transform: translateY(-50%); flex-direction: column }
    @media (max-width: 480px), (max-height: 500px) {
      .species { left: 12px }
    }
  `
  document.head.appendChild(style)

  const choices = Object.fromEntries(species.map((name) => [name, ICONS[name]]))
  const { show } = createStickers({ className: 'species', choices, label: (name) => `${name} tree`, onPick })
  return { show }
}

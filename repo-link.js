import { LINE, PHONE } from './stickers.js'

// A round white sticker in the bottom right corner with GitHub's mark,
// opening the repo in a new tab: outlined and shadowed like the other
// stickers, so it reads on any background and theme. Where the bar at the
// bottom would reach it, it sits higher up instead, except on a phone, whose
// bar is only the new tree button

const REPO = 'https://github.com/MikeFernandez-Pro/just-a-simple-tree'
const SIZE = 44 // its width, in pixels
// GitHub's mark, in a 16 × 16 box
const MARK =
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>'

export function createRepoLink() {
  const style = document.createElement('style')
  style.textContent = `
    .repo-link { position: fixed; right: 26px; bottom: 30px; width: ${SIZE}px; height: ${SIZE}px; box-sizing: border-box;
      display: grid; place-items: center; border: 3px solid ${LINE}; border-radius: 50%; background: #fff;
      box-shadow: 4px 4px 0 var(--button-shadow); color: ${LINE}; rotate: 6deg;
      transition: box-shadow .08s, translate .08s, scale .25s cubic-bezier(.34, 1.8, .64, 1) }
    .repo-link svg { width: 58%; height: 58% }
    .repo-link:hover { box-shadow: 6px 6px 0 var(--button-shadow); scale: 1.08 }
    .repo-link:active { box-shadow: 1px 1px 0 var(--button-shadow); translate: 3px 3px }
    @media (max-width: 900px) { .repo-link { bottom: 100px } }
    @media (max-width: 480px), (max-height: 500px) {
      .repo-link { right: 16px; bottom: 104px; width: ${SIZE * 0.8}px; height: ${SIZE * 0.8}px; border-width: 2.5px;
        box-shadow: 3px 3px 0 var(--button-shadow) }
    }
    @media ${PHONE} { .repo-link { bottom: 24px } }
  `
  document.head.appendChild(style)

  const link = document.createElement('a')
  link.className = 'repo-link'
  link.href = REPO
  link.target = '_blank'
  link.rel = 'noopener'
  link.title = 'the code on GitHub'
  link.setAttribute('aria-label', 'Just a simple tree on GitHub')
  link.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${MARK}</svg>`
  document.body.appendChild(link)
}

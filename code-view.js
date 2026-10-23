import readme from './README.md?raw'
import { INK, LINE } from './stickers.js'

// The material code that gives the tree's GLB its look back in three.js,
// celShade, in a little editor window over the page: a tab for
// WebGPURenderer's, shown to start with, and one for WebGLRenderer's, the
// one shown picked out in its colour. The code scrolls beside its line
// numbers, with a copy button, and without its comments, just the code,
// with how to use it underneath.
// White with a charcoal outline like the rest of the page's buttons, and
// coloured inside like a light editor theme, the same whatever the page's
// theme. It's read out of the README, so the two never differ: each
// renderer's code from the <details> whose summary names it

const MUTED = '#8a8692' // the tab not picked
const RULE = '#ecebef' // the line between the gutter and the code
// The editor's theme, a light one: each kind of token's colour, the
// gutter's and the three dots'
const SYNTAX = {
  comment: '#a0a1a7',
  string: '#50a14f',
  keyword: '#a626a4',
  number: '#d47a1f',
  call: '#4078f2',
  type: '#c18401',
}
const GUTTER = '#f8f7fa'
const DOTS = ['#ff7a7a', '#ffcd4d', '#5fd07a']
const COPIED = '#d9f5df' // a copy button just pressed
const OPENER_TOP = 68 // the opening button's top, in pixels, just under the Inspector's
const NAME = 'celShade'
const EXAMPLE = `// apply the material
mesh.material = ${NAME}(mesh.material)`
const RENDERERS = [
  { name: 'WebGPURenderer', label: 'WebGPU', colour: '#e6dcff' },
  { name: 'WebGLRenderer', label: 'WebGL', colour: '#d9ecff' },
]

const text = readme.replace(/\r\n/g, '\n')
const jsBlocks = (from) => [...from.matchAll(/```js\n([\s\S]*?)\n```/g)].map((match) => match[1])
function snippet(renderer) {
  const at = text.indexOf(`<summary><code>${NAME}</code> for <code>${renderer}</code></summary>`)
  return at >= 0 ? withoutComments(jsBlocks(text.slice(at))[0] ?? '') : `// ${NAME} for ${renderer} isn't in the README`
}

// Comments, strings (the templates' GLSL included), keywords, numbers,
// calls and capitalised names, each kind in its own colour
const TOKENS = /(\/\/[^\n]*)|('(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(import|from|export|function|const|let|return|if|for|of|new|true|false|null|await)\b|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|(\b[a-zA-Z_]\w*(?=\())|(\b[A-Z]\w*\b)/g
const KINDS = ['comment', 'string', 'keyword', 'number', 'call', 'type']
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
function highlight(code) {
  let html = ''
  let last = 0
  for (const match of code.matchAll(TOKENS)) {
    const kind = KINDS[match.slice(1).findIndex((group) => group !== undefined)]
    html += `${escape(code.slice(last, match.index))}<span class="${kind}">${escape(match[0])}</span>`
    last = match.index + match[0].length
  }
  return html + escape(code.slice(last))
}
// The code with its comments taken out, the lines that were only a comment
// with them, and no more than one blank line in a row. The strings are left
// as they are, a // in one included
function withoutComments(code) {
  const cut = '\u0000'
  return code
    .replace(TOKENS, (token, comment) => (comment ? cut : token))
    .split('\n')
    .filter((line) => line.trim() !== cut)
    .map((line) => line.replace(cut, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function createCodeView() {
  const style = document.createElement('style')
  style.textContent = `
    .code-view { position: fixed; inset: 0; z-index: 10000; display: none; place-items: start center;
      padding: max(24px, 10vh) 24px 24px; box-sizing: border-box }
    .code-view.open { display: grid }
    .code-view .window { display: flex; flex-direction: column; width: min(980px, 100%);
      max-height: min(720px, 100%); box-sizing: border-box; border: 3px solid ${LINE}; border-radius: 10px; background: #fff;
      box-shadow: 6px 6px 0 var(--button-shadow); color: ${INK}; font: 13px/1.5 monospace; overflow: hidden }
    .code-view button { font: inherit; color: inherit; cursor: pointer }
    .code-view .top { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px;
      border-bottom: 3px solid ${LINE}; user-select: none }
    .code-view .dots { display: flex; gap: 6px; margin-right: 2px }
    .code-view .dots span { width: 10px; height: 10px; border: 2.5px solid ${LINE}; border-radius: 50% }
    ${DOTS.map((colour, i) => `.code-view .dots span:nth-child(${i + 1}) { background: ${colour} }`).join(' ')}
    .code-view .tabs { display: flex; gap: 6px; flex: 1; min-width: 0 }
    .code-view .tabs button { padding: 4px 14px; border: 2.5px solid transparent; border-radius: 999px;
      background: none; color: ${MUTED}; font-weight: 700; white-space: nowrap }
    .code-view .tabs button:hover { background: #efedf2; color: ${INK} }
    .code-view .tabs button[aria-pressed="true"] { border-color: ${LINE}; color: ${INK}; cursor: default;
      box-shadow: 2px 2px 0 var(--button-shadow) }
    ${RENDERERS.map(({ colour }, i) => `.code-view .tabs button:nth-child(${i + 1})[aria-pressed="true"] { background: ${colour} }`).join(' ')}
    .code-view .close { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0;
      border-radius: 7px; background: none }
    .code-view .close:hover { background: #efedf2 }
    .code-view .close svg { width: 18px; height: 18px }
    .code-view .copy { display: grid; padding: 3px 10px; border: 2.5px solid ${LINE}; border-radius: 7px;
      background: #fff; box-shadow: 2px 2px 0 var(--button-shadow); font-size: 12px; font-weight: 700;
      transition: box-shadow .08s, translate .08s }
    .code-view .copy > span { grid-area: 1 / 1; text-align: center }
    .code-view .copy:hover { box-shadow: 3px 3px 0 var(--button-shadow) }
    .code-view .copy:active, .code-view .copy.done { box-shadow: 0 0 0 var(--button-shadow); translate: 2px 2px }
    .code-view .copy.done { background: ${COPIED} }
    .code-view .scroll { flex: 0 1 auto; min-height: 0; display: flex; align-items: flex-start; overflow: auto; outline: none;
      scrollbar-width: thin; scrollbar-color: #c9c6cf transparent }
    .code-view .scroll:focus-visible { box-shadow: inset 0 0 0 2px ${LINE} }
    .code-view pre { margin: 0; padding: 10px 16px 14px; font: inherit }
    .code-view .lines { position: sticky; left: 0; flex: none; padding-right: 12px; text-align: right;
      background: ${GUTTER}; border-right: 2px solid ${RULE}; color: #b4b1bb; user-select: none }
    .code-view .code { flex: 1 0 auto }
    .code-view .example { flex: none; padding: 9px 16px 11px; border-top: 3px solid ${LINE}; background: ${GUTTER};
      overflow-x: auto; scrollbar-width: thin }
    ${Object.entries(SYNTAX).map(([kind, colour]) => `.code-view .${kind} { color: ${colour} }`).join(' ')}
    .code-view .comment { font-style: italic }
    .code-view .keyword { font-weight: 700 }
    @media (max-width: 760px), (max-height: 500px) {
      .code-view { padding: 10px }
      .code-view .window { font-size: 12px; box-shadow: 4px 4px 0 var(--button-shadow) }
    }
    .code-view-opener { position: fixed; top: ${OPENER_TOP}px; right: 15px; display: flex; align-items: center; gap: 9px;
      padding: 7px 14px 7px 11px; border: 3px solid ${LINE}; border-radius: 10px; background: #fff;
      box-shadow: 4px 4px 0 var(--button-shadow); font: 700 14px/1.2 monospace; letter-spacing: .02em; color: ${INK};
      cursor: pointer; user-select: none; transform: rotate(1.5deg); transition: box-shadow .08s, translate .08s }
    .code-view-opener svg { flex: none; width: 20px; height: 20px }
    .code-view-opener:hover { box-shadow: 6px 6px 0 var(--button-shadow) }
    .code-view-opener:active { box-shadow: 1px 1px 0 var(--button-shadow); translate: 3px 3px }
    @media (max-width: 480px) {
      .code-view-opener { padding: 6px 9px; border-width: 2.5px; box-shadow: 3px 3px 0 var(--button-shadow) }
      .code-view-opener span { display: none }
      .code-view .dots { display: none }
    }
  `
  document.head.appendChild(style)

  const view = document.createElement('div')
  view.className = 'code-view'
  const win = document.createElement('div')
  win.className = 'window'
  win.setAttribute('role', 'dialog')
  win.setAttribute('aria-label', 'material code')
  view.append(win)

  // A copy button for what text() gives: copied for a moment, or if the
  // clipboard won't have it, the code selected for the keys to copy
  function copyButton(text, selectable) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    const words = ['copy', 'copied', 'selected'].map((word) => {
      const span = document.createElement('span')
      span.textContent = word
      button.append(span)
      return span
    })
    const show = (word) => words.forEach((span) => (span.style.visibility = span.textContent === word ? '' : 'hidden'))
    show('copy')
    let timer
    button.addEventListener('click', async () => {
      let word = 'copied'
      try {
        await navigator.clipboard.writeText(`${text()}\n`)
      } catch {
        getSelection().selectAllChildren(selectable())
        word = 'selected'
      }
      show(word)
      button.classList.add('done')
      clearTimeout(timer)
      timer = setTimeout(() => {
        show('copy')
        button.classList.remove('done')
      }, 1200)
    })
    return button
  }

  // The code beside its line numbers, which stay put as it scrolls sideways
  const scroll = document.createElement('div')
  scroll.className = 'scroll'
  scroll.tabIndex = 0
  const lines = document.createElement('pre')
  lines.className = 'lines'
  const code = document.createElement('pre')
  code.className = 'code'
  scroll.append(lines, code)
  const current = { renderer: RENDERERS[0], code: '' }

  // The top: the editor's three dots, a tab per renderer, the code's copy
  // button and a close button
  const top = document.createElement('div')
  top.className = 'top'
  const dots = document.createElement('div')
  dots.className = 'dots'
  dots.innerHTML = '<span></span><span></span><span></span>'
  const tabs = document.createElement('div')
  tabs.className = 'tabs'
  const tabButtons = RENDERERS.map((renderer) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = renderer.label
    button.title = `${NAME} for ${renderer.name}`
    button.addEventListener('click', () => show(renderer))
    tabs.append(button)
    return button
  })
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.setAttribute('aria-label', 'close')
  close.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  close.addEventListener('click', () => open(false))
  top.append(dots, tabs, copyButton(() => current.code, () => code), close)

  // Underneath, how to use it, the same for both renderers
  const example = document.createElement('pre')
  example.className = 'example'
  example.innerHTML = highlight(EXAMPLE)
  win.append(top, scroll, example)

  // A renderer's code, its tab picked out
  function show(renderer) {
    current.renderer = renderer
    RENDERERS.forEach((other, i) => tabButtons[i].setAttribute('aria-pressed', other === renderer))
    current.code = snippet(renderer.name)
    lines.textContent = current.code.split('\n').map((_, i) => i + 1).join('\n')
    code.innerHTML = highlight(current.code)
    scroll.scrollTo(0, 0)
  }
  show(RENDERERS[0])

  // The button opening it, a sticker under the Inspector's in the top right
  const opener = document.createElement('button')
  opener.type = 'button'
  opener.className = 'code-view-opener'
  opener.title = 'the material code that gives the GLB its look back in three.js, to copy'
  opener.setAttribute('aria-label', 'material code for your GLB')
  opener.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/></svg><span>material</span>`
  // Let go of focus, so space makes a new tree instead of pressing this again
  opener.addEventListener('click', () => {
    opener.blur()
    open()
  })
  document.body.appendChild(opener)

  const isOpen = () => view.classList.contains('open')
  function open(on = true) {
    view.classList.toggle('open', on)
    if (on) scroll.focus({ preventScroll: true })
  }
  // A click round the window or Escape closes it
  view.addEventListener('pointerdown', (e) => {
    if (e.target === view) open(false)
  })
  addEventListener('keydown', (e) => {
    if (isOpen() && e.key === 'Escape') open(false)
  })
  document.body.appendChild(view)

  return { open, isOpen }
}

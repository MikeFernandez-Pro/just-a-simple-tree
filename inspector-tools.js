// Reset buttons, a shareable link and a copy-config button for the WebGPU
// Inspector's Parameters tab. Each section remembers the values its controls
// start with; reset puts them back through the controls themselves, so every
// onChange runs as if picked by hand. A control can instead be given where
// it resets to at the moment, like a colour the theme picked. The page's
// address always holds every value changed from those, so it can be shared;
// opening it sets them again, reloading it doesn't.
// Copy config writes every current value as JSON, by section and folder,
// under the names shown in the panel

// The Inspector keeps a section's own controls but not its folders: make
// addFolder remember them. It's patched on the class every section shares, so
// one call, with any section, covers them all; make it before the first
// folder is added
export function trackFolders(section) {
  const proto = Object.getPrototypeOf(section)
  if (proto.tracksFolders) return
  const addFolder = proto.addFolder
  proto.addFolder = function (name) {
    const folder = addFolder.call(this, name)
    ;(this.folders ??= []).push(folder)
    return folder
  }
  proto.tracksFolders = true
}

// The Inspector runs a control's onChange a tick after it changes, so that
// several changes at once land together. This runs fn at once instead, for a
// control whose change sets off others that should follow it straight away
export function onChangeNow(control, fn) {
  control.addEventListener('change', ({ value }) => fn(value))
  return control
}

const nameOf = (section) => String(section.paramList.data[0]).trim()
const labelOf = (subItem) => subItem.data[0].textContent.trim()
const isButton = ({ object, key }) => typeof object[key] === 'function'
// A section's or folder's own controls, leaving out its buttons
const own = (group) => group.objects.filter((entry) => !isButton(entry))

// A control's value as plain data: colours as hex
function valueOf(editor) {
  const value = editor.getValue()
  return value?.isColor ? `#${value.getHexString()}` : value
}

// Every control of a section and its folders
function controls(section) {
  return [...own(section), ...(section.folders ?? []).flatMap(controls)]
}

// Folds a section and every folder inside it
export function closeAll(section) {
  section.close()
  ;(section.folders ?? []).forEach(closeAll)
}

// A button at the bottom of a section or folder putting back the values its
// controls have now, or for those in resetTo, the value it gives when
// pressed. Only the controls that differ are set, so nothing runs for those
// already there
function resetButton(group, label, resetTo) {
  const starting = controls(group).map(({ editor }) => [editor, valueOf(editor)])
  const reset = () => {
    for (const [control, value] of starting) {
      const target = resetTo.has(control) ? resetTo.get(control)() : value
      if (valueOf(control) !== target) control.setValue(target)
    }
  }
  group.add({ [label]: reset }, label)
}

// Resets for a section: one under each of its folders, at any depth, putting
// back just that folder, and one under the whole section, "reset all" when it
// has folders, putting back everything in it. resetTo maps a control to a
// function giving where it resets to now
export function addReset(section, resetTo = new Map()) {
  const folders = (group) => (group.folders ?? []).flatMap((folder) => [...folders(folder), folder])
  for (const folder of folders(section)) resetButton(folder, 'reset', resetTo)
  resetButton(section, section.folders?.length ? 'reset all' : 'reset', resetTo)
}

// The section's values, its folders nested inside
function config(section) {
  const values = {}
  for (const { subItem, editor } of own(section)) values[labelOf(subItem)] = valueOf(editor)
  for (const folder of section.folders ?? []) values[nameOf(folder)] = config(folder)
  return values
}

// Two small icons: two overlapping sheets, and a tick once copied
const svg = (path) =>
  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const COPY_ICON = svg('<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>')
const DONE_ICON = svg('<path d="M3 8.5l3.2 3.2L13 5"/>')
const LINK_ICON = svg(
  '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2L8 3.8"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.8-.8"/>',
)

// Every control of a section and its folders, by its path of names in the
// panel: "Tree/shape/seed"
function paths(section, prefix = nameOf(section)) {
  const mine = own(section).map(({ editor, subItem }) => [`${prefix}/${labelOf(subItem)}`, editor])
  return [...mine, ...(section.folders ?? []).flatMap((folder) => paths(folder, `${prefix}/${nameOf(folder)}`))]
}

// Numbers rounded, so the address stays short
const plain = (value) => (typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value)

// Keeps every value changed from where it started in the page's address,
// and sets the ones an address arrives with, leaving out the controls in
// skip. A control in following, set by another one like a theme, counts as
// changed when it's away from where that puts it now, the value following
// gives, rather than from where it started. Call once every control exists
export function addShareLink(sections, skip = [], following = new Map()) {
  const controls = new Map(sections.flatMap((section) => paths(section)).filter(([, editor]) => !skip.includes(editor)))
  const starting = new Map([...controls].map(([path, editor]) => [path, plain(valueOf(editor))]))
  const unchanged = (path, editor) =>
    following.has(editor) ? plain(following.get(editor)()) : starting.get(path)

  function write() {
    const changed = {}
    for (const [path, editor] of controls) {
      const value = plain(valueOf(editor))
      if (value !== unchanged(path, editor)) changed[path] = value
    }
    const hash = Object.keys(changed).length ? `#${encodeURIComponent(JSON.stringify(changed))}` : ''
    history.replaceState(null, '', location.pathname + location.search + hash)
  }
  // Once a slider rests: browsers limit how often the address may change
  let pending
  const later = () => {
    clearTimeout(pending)
    pending = setTimeout(write, 250)
  }
  for (const editor of controls.values()) editor.addEventListener('change', later)

  // An address's values, when it's opened: a reload, by hand or by the dev
  // server's hot refresh, starts again from the starting values. The page
  // writes a theme and species before what they set, so one pass is enough
  // for its own links; a second puts back anything a link written in another
  // order had overwritten
  let wanted = {}
  const reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload'
  try {
    if (!reloaded) wanted = JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}')
  } catch {
    // not one of ours
  }
  const apply = () => {
    for (const [path, value] of Object.entries(wanted)) {
      const editor = controls.get(path)
      if (editor && plain(valueOf(editor)) !== value) editor.setValue(value)
    }
  }
  // Then the address is written again, so whatever it held that isn't kept,
  // like a debug view, an old name or a value back at its start, goes
  apply()
  apply()
  later()
}

// A button that copies some text, and ticks once copied
function copyButton(icon, label, text) {
  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText =
    'flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 8px;' +
    'font:inherit;color:var(--text-primary);background:rgba(255,255,255,0.06);' +
    'border:1px solid rgba(255,255,255,0.12);border-radius:4px;cursor:pointer'
  const show = (icon, label) => (button.innerHTML = `${icon}<span>${label}</span>`)
  show(icon, label)
  button.addEventListener('mouseenter', () => (button.style.borderColor = 'var(--color-accent)'))
  button.addEventListener('mouseleave', () => (button.style.borderColor = 'rgba(255,255,255,0.12)'))
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text())
    show(DONE_ICON, 'copied')
    setTimeout(() => show(icon, label), 1200)
  })
  return button
}

// Copy-link and copy-config buttons pinned under the Parameters list, outside
// every section, so they're always in view: the list scrolls above them
export function addCopyConfig(inspector, sections) {
  const bar = document.createElement('div')
  bar.style.cssText = 'display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--profiler-border)'
  bar.appendChild(copyButton(LINK_ICON, 'copy link', () => location.href))
  bar.appendChild(
    copyButton(COPY_ICON, 'copy config', () =>
      JSON.stringify(Object.fromEntries(sections.map((section) => [nameOf(section), config(section)])), null, 2),
    ),
  )
  // Right under the list, wherever it lives: the tab moves its content
  // between its full view and its small floating panel, siblings included
  const list = inspector.parameters.paramList.domElement.parentElement
  list.parentElement.insertBefore(bar, list.nextSibling)
  // The list may only be as tall as the window leaves once the panel's own
  // header, the filter above it and this bar below it are counted, so the
  // bar never drops out of view
  list.style.maxHeight = 'calc(100vh - 200px)'
}

// Opens the Parameters tab in its floating panel, unfolds a section and every
// folder inside it, and scrolls the list to it, for a button elsewhere on the
// page that leads to its settings. A filter typed in the panel's box is
// cleared first, so it can't hide the section
export function openSection(inspector, section) {
  inspector.profiler.show(inspector.parameters)
  const list = inspector.parameters.paramList.domElement.parentElement
  const filter = list.parentElement.querySelector('input[type="search"]')
  if (filter?.value) {
    filter.value = ''
    filter.dispatchEvent(new Event('input'))
  }
  const unfold = (group) => {
    if (!group.paramList.isOpen) group.paramList.toggle()
    ;(group.folders ?? []).forEach(unfold)
  }
  unfold(section)
  // Only the list scrolls: scrollIntoView would scroll the Inspector's
  // hidden bottom panel into view too
  const top = section.paramList.domElement.getBoundingClientRect().top - list.getBoundingClientRect().top
  list.scrollTo({ top: list.scrollTop + top, behavior: 'smooth' })
}

// Reset buttons and a copy-config button for the WebGPU Inspector's
// Parameters tab. Each section remembers the values its controls start
// with; reset puts them back through the controls themselves, so every
// onChange runs as if picked by hand. Copy config writes every current value
// as JSON, by section and folder, under the names shown in the panel

// The Inspector keeps a section's own controls but not its folders: make
// addFolder remember them. Call before the first folder is added
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

const nameOf = (section) => String(section.paramList.data[0]).trim()
const labelOf = (subItem) => subItem.data[0].textContent.trim()
const isButton = ({ object, key }) => typeof object[key] === 'function'

// A control's value as plain data: colours as hex
function valueOf(editor) {
  const value = editor.getValue()
  return value?.isColor ? `#${value.getHexString()}` : value
}

// Every control of a section and its folders
function controls(section) {
  const own = section.objects.filter((entry) => !isButton(entry))
  return [...own, ...(section.folders ?? []).flatMap(controls)]
}

// Folds a section and every folder inside it
export function closeAll(section) {
  section.close()
  ;(section.folders ?? []).forEach(closeAll)
}

// A button at the bottom of a section or folder putting back the values its
// controls have now
function resetButton(group, label) {
  const starting = controls(group).map(({ editor }) => [editor, valueOf(editor)])
  group.add({ [label]: () => starting.forEach(([control, value]) => control.setValue(value)) }, label)
}

// Resets for a section: one under each of its folders, at any depth, putting
// back just that folder, and one under the whole section, "reset all" when it
// has folders, putting back everything in it
export function addReset(section) {
  const folders = (group) => (group.folders ?? []).flatMap((folder) => [...folders(folder), folder])
  for (const folder of folders(section)) resetButton(folder, 'reset')
  resetButton(section, section.folders?.length ? 'reset all' : 'reset')
}

// The section's values, its folders nested inside
function config(section) {
  const values = {}
  for (const entry of section.objects) if (!isButton(entry)) values[labelOf(entry.subItem)] = valueOf(entry.editor)
  for (const folder of section.folders ?? []) values[nameOf(folder)] = config(folder)
  return values
}

// Two small icons: two overlapping sheets, and a tick once copied
const svg = (path) =>
  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const COPY_ICON = svg('<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>')
const DONE_ICON = svg('<path d="M3 8.5l3.2 3.2L13 5"/>')

// A copy-config button pinned under the Parameters list, outside every
// section, so it's always in view: the list scrolls above it
export function addCopyConfig(inspector, sections) {
  const bar = document.createElement('div')
  bar.style.cssText = 'padding:6px 8px;border-top:1px solid var(--profiler-border)'
  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText =
    'width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 8px;' +
    'font:inherit;color:var(--text-primary);background:rgba(255,255,255,0.06);' +
    'border:1px solid rgba(255,255,255,0.12);border-radius:4px;cursor:pointer'
  const show = (icon, label) => (button.innerHTML = `${icon}<span>${label}</span>`)
  show(COPY_ICON, 'copy config')
  button.addEventListener('mouseenter', () => (button.style.borderColor = 'var(--color-accent)'))
  button.addEventListener('mouseleave', () => (button.style.borderColor = 'rgba(255,255,255,0.12)'))
  button.addEventListener('click', async () => {
    const all = Object.fromEntries(sections.map((section) => [nameOf(section), config(section)]))
    await navigator.clipboard.writeText(JSON.stringify(all, null, 2))
    show(DONE_ICON, 'copied')
    setTimeout(() => show(COPY_ICON, 'copy config'), 1200)
  })
  bar.appendChild(button)
  // Right under the list, wherever it lives: the tab moves its content
  // between its full view and its small floating panel, siblings included
  const list = inspector.parameters.paramList.domElement.parentElement
  list.parentElement.insertBefore(bar, list.nextSibling)
  // The list may only be as tall as the window leaves once the panel's own
  // header, the filter above it and this bar below it are counted, so the
  // bar never drops out of view
  list.style.maxHeight = 'calc(100vh - 200px)'
  return button
}

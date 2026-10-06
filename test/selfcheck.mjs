/**
 * Offline self-check for dsh-plugin-skillhub-finder.
 *
 *   node test/selfcheck.mjs
 *
 * Two things are worth proving without a live DSH instance:
 *   1. `lib/index.js` is valid Node ESM and its keyword extractor ranks the
 *      terms a real draft would need.
 *   2. `lib/client.js` is a valid *classic* script (no `import`/`export`) that
 *      registers exactly the bundle id the client module table looks up, and
 *      whose `apply` registers the three expected contributions against a fake
 *      Cordis context.
 *
 * The client half is loaded by executing the file, not importing it, because
 * that is exactly how the shell loads it: a plain `<script src>`.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_PATH = join(ROOT, 'lib', 'client.js')
const HOST_PATH = join(ROOT, 'lib', 'index.js')

const PKG_NAME = 'dsh-plugin-skillhub-finder'

test('package.json declares the bundle and client contract', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.name, PKG_NAME)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  // React/Cordis/ui-primitives are baseline externals and must not be requested.
  assert.deepEqual(pkg.dsh.client.external, undefined)
  for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    assert.ok(pkg.files.includes('lib') || pkg.files.includes(file), `${file} is not published`)
  }
})

test('cordis.patch.yml inserts one row naming this package', async () => {
  const yaml = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(yaml, /^-\s*insert:/m)
  assert.match(yaml, new RegExp(`name:\\s*'?${PKG_NAME}'?`))
})

test('host half is importable and extracts intent keywords', async () => {
  const mod = await import(`file://${HOST_PATH.replace(/\\/g, '/')}`)
  assert.equal(mod.name, PKG_NAME)
  assert.deepEqual(mod.inject, ['webServer'])
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.Config['~standard'].version, 1)

  const { issues, value } = mod.Config['~standard'].validate({})
  assert.equal(issues, undefined)
  assert.match(value.installDir, /skills$/)
  assert.equal(value.apiBase, 'https://api.skillhub.cn')

  const bad = mod.Config['~standard'].validate({ nope: 1 })
  assert.ok(bad.issues.some((entry) => /unknown config field/.test(entry.message)))
})

test('the plugin row loads through a real profile bundle patch', async () => {
  // The patch must name a resolvable specifier; a bare relative path or a
  // missing ./exports entry is the classic "loaded but empty" mistake.
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (key === './package.json') continue
    const resolved = join(ROOT, target)
    await assert.doesNotReject(readFile(resolved), `${key} points at a missing file`)
  }
})

/** Shared minimal React stand-in: enough for module bodies, nothing rendered. */
const FakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'Fragment',
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/**
 * Load `lib/client.js` the way the shell does: as a classic script with a
 * `window.__ModuleLoader__` facade, then materialize the factory.
 * @returns {Promise<{ id: string, exports: Record<string, unknown>, required: string[] }>}
 */
async function loadClientBundle() {
  const source = await readFile(CLIENT_PATH, 'utf8')
  // A classic script cannot contain ESM syntax; catching it here is the whole
  // point, since the shell's own failure is an opaque "did not activate".
  assert.doesNotMatch(source, /^\s*(import|export)\s/m, 'client.js must be a classic script')

  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { sandbox.__registration = value } } },
    document: {
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      head: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    fetch: () => Promise.reject(new Error('offline')),
    console,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  const registration = sandbox.__registration
  assert.ok(registration, 'client.js never called window.__ModuleLoader__.load')
  assert.equal(registration.id, PKG_NAME, 'bundle id must equal the package name')
  assert.equal(typeof registration.factory, 'function')

  const required = []
  const exports = registration.factory((spec) => {
    required.push(spec)
    if (spec === 'react') return FakeReact
    throw new Error(`client.js must only require baseline modules, saw require(${spec})`)
  })
  return { id: registration.id, exports, required }
}

test('client bundle registers under the exact package id and requires only react', async () => {
  const bundle = await loadClientBundle()
  assert.equal(bundle.id, PKG_NAME)
  assert.deepEqual(bundle.required, ['react'])
  // The bundle runs in a vm realm, so compare content rather than realm identity.
  assert.equal(bundle.exports.inject.join(','), 'slots,sidebarRight,sidebarRightTabs')
  assert.equal(typeof bundle.exports.apply, 'function')
})

test('apply() registers the composer button, the tab type, and both tab seats', async () => {
  const bundle = await loadClientBundle()

  const tabTypes = []
  const slots = []
  const injectKeys = []
  const effects = []
  const ctx = {
    sidebarRight: { openTab() {}, openResource() {}, close() {} },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {} } },
    slots: {
      inject: (key, callback) => { injectKeys.push(key); callback(); return () => {} },
      register: (options, component) => {
        slots.push({ options, component })
        return () => {}
      },
    },
    effect: (callback, label) => {
      effects.push({ label, disposer: callback() })
      return () => {}
    },
  }

  bundle.exports.apply(ctx)

  assert.deepEqual(tabTypes.map((entry) => entry.kind), ['skillhub-finder'])
  assert.equal(tabTypes[0].id, PKG_NAME)
  assert.equal(typeof tabTypes[0].title, 'function')
  assert.ok(Array.isArray(tabTypes[0].guide), 'the tab type guide must be an array')
  assert.equal(typeof tabTypes[0].guide[0].title, 'function')

  assert.deepEqual(injectKeys, [
    'sidebar.right.pane.tab',
    'sidebar.right.pane.tab.title',
    'conversation.input.right',
  ])

  const byName = Object.fromEntries(slots.map((entry) => [entry.options.name, entry]))
  // The two keyed tab seats must share the tab type's id; the list seat needs a list id.
  assert.equal(byName['sidebar.right.pane.tab'].options.key, PKG_NAME)
  assert.equal(byName['sidebar.right.pane.tab.title'].options.key, PKG_NAME)
  assert.equal(byName['conversation.input.right'].options.id, PKG_NAME)
  assert.equal(byName['conversation.input.right'].options.order, 10)
  for (const entry of slots) assert.equal(typeof entry.component, 'function')

  // Both tab seats contribute a business face carrying the shared store; the
  // composer seat contributes the sidebar navigation handle it needs to open.
  const tabFace = byName['sidebar.right.pane.tab'].options.inject()
  const titleFace = byName['sidebar.right.pane.tab.title'].options.inject()
  const composerFace = byName['conversation.input.right'].options.inject()
  for (const face of [tabFace, titleFace]) {
    assert.equal(typeof face.store.setResult, 'function')
    assert.equal(typeof face.store.useStore, 'function')
  }
  assert.equal(typeof composerFace.sidebarRight.openTab, 'function')

  // The store is shared: a write from the button must reach the tab faces.
  let notified = 0
  tabFace.store.subscribe(() => { notified += 1 })
  tabFace.store.setResult({ id: 'x', keywords: ['周报'], skills: [{ slug: 'a' }] })
  assert.equal(notified, 1, 'the tab face did not observe the write')
  assert.equal(titleFace.store.getSnapshot().result.keywords.join(','), '周报')
  assert.equal(tabFace.store.getSnapshot().result.skills.length, 1)

  // The tab title reflects the live result count.
  const titleEntry = byName['sidebar.right.pane.tab.title']
  assert.equal(titleEntry.component({ store: tabFace.store }), 'SkillHub 技能 (1)')

  // Every effect must expose a disposer: styles, store, tab type, three seats.
  assert.equal(effects.length, 6)
  for (const effect of effects) {
    assert.equal(typeof effect.disposer, 'function', `${effect.label} has no disposer`)
  }
})

/**
 * Mirror of the sidebar tab registry's own `register()` guards, transcribed
 * from the shipped bundle. Keeping this here is the whole point: `guide` must
 * be an ARRAY (the registry runs `(definition.guide ?? []).map(...)`), and
 * getting that wrong fails the entire plugin fiber at boot with nothing shown
 * but `dsh-plugin-skillhub-finder: failed`.
 * @param {Record<string, any>} definition - a tab type definition.
 * @param {Set<string>} ids - ids already registered.
 * @param {Map<string, string>} kinds - kind to occupying band.
 */
function assertTabDefinition(definition, ids, kinds) {
  const { id, kind } = definition
  assert.equal(typeof id, 'string', 'tab type needs a string id')
  assert.equal(typeof kind, 'string', 'tab type needs a string kind')
  assert.equal(typeof definition.title, 'function', 'tab type needs a title()')

  const entries = definition.guide ?? []
  assert.ok(Array.isArray(entries), `tab type "${id}" has a non-array guide (got ${typeof entries})`)
  const entryIds = entries.map((entry) => entry?.id)
  assert.equal(new Set(entryIds).size, entryIds.length, `tab type "${id}" has a duplicate guide entry id`)
  for (const entry of entries) {
    assert.equal(typeof entry.id, 'string', 'guide entry needs a string id')
    assert.equal(typeof entry.title, 'function', 'guide entry needs a title()')
    if (entry.description !== undefined) {
      assert.equal(typeof entry.description, 'function', 'guide entry description must be a function')
    }
    if (entry.order !== undefined) assert.equal(typeof entry.order, 'number', 'guide entry order must be a number')
  }

  assert.ok(!ids.has(id), `tab type id "${id}" is already registered`)
  assert.ok(!kinds.has(kind), `tab kind "${kind}" is already registered`)
}

test('the tab type definition satisfies the registry contract', async () => {
  const bundle = await loadClientBundle()

  let definition
  const ctx = {
    sidebarRight: { openTab() {} },
    sidebarRightTabs: { register: (value) => { definition = value; return () => {} } },
    slots: { inject: (_key, callback) => { callback(); return () => {} }, register: () => () => {} },
    effect: (callback) => { callback(); return () => {} },
  }
  bundle.exports.apply(ctx)

  assert.ok(definition, 'apply() never registered a tab type')
  // The regression guard for the boot failure.
  assertTabDefinition(definition, new Set(), new Map())
  assert.equal(definition.title(), 'SkillHub 技能')
  assert.equal(definition.guide[0].title(), 'SkillHub 技能')
})

test('both READMEs exist and cross-link', async () => {
  const en = await readFile(join(ROOT, 'README.md'), 'utf8')
  const zh = await readFile(join(ROOT, 'README.zh.md'), 'utf8')

  // Each must point at the other, and neither may point at itself.
  assert.match(en, /\[中文\]\(README\.zh\.md\)/, 'README.md does not link to README.zh.md')
  assert.match(zh, /\[English\]\(README\.md\)/, 'README.zh.md does not link back to README.md')
  assert.doesNotMatch(en, /\[English\]\(README\.md\)/, 'README.md links to itself')

  // The switcher belongs above the first section, not buried in the body.
  assert.ok(
    en.indexOf('[中文](README.zh.md)') < en.indexOf('## '),
    'the English README switcher must sit above the first section',
  )
  assert.ok(
    zh.indexOf('[English](README.md)') < zh.indexOf('## '),
    'the Chinese README switcher must sit above the first section',
  )

  // Both must document the same load-bearing things, so a translation cannot rot.
  for (const [label, text] of [['en', en], ['zh', zh]]) {
    for (const required of [
      'dsh-plugin-skillhub-finder',
      'conversation.input.right',
      'sidebar.right.pane.tab',
      'skillhub.cn',
      'npm test',
      'did not activate',
    ]) {
      assert.ok(text.includes(required), `README.${label} is missing "${required}"`)
    }
  }
})

test('package.json publishes both READMEs', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  for (const file of ['README.md', 'README.zh.md']) {
    assert.ok(pkg.files.includes(file), `${file} is listed in package.json but not in files`)
    await assert.doesNotReject(readFile(join(ROOT, file)), `${file} is published but does not exist`)
  }
})

/** The plugin's own stylesheet, as shipped inside the bundle. */
async function readStylesheet() {
  const source = await readFile(CLIENT_PATH, 'utf8')
  const start = source.indexOf('const CSS = `')
  assert.ok(start >= 0, 'the bundle no longer declares a CSS template literal')
  const body = source.slice(start + 'const CSS = `'.length)
  const end = body.indexOf('`', body.indexOf('.skhf-skeleton-row'))
  assert.ok(end > 0, 'could not find the end of the CSS template literal')
  return body.slice(0, end)
}

test('the stylesheet avoids literal colours so both themes stay legible', async () => {
  const css = await readStylesheet()

  // Strip complete comments FIRST, multi-line ones included: a comment that
  // explains a past literal is not a declaration.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

  // Drop every well-formed `var(--token, fallback)` call — nested var() included —
  // then anything left is a colour written into the sheet rather than a token.
  const outsideVars = (text) => {
    let out = ''
    for (let i = 0; i < text.length; i += 1) {
      if (!text.startsWith('var(', i)) {
        out += text[i]
        continue
      }
      let depth = 0
      let j = i
      for (; j < text.length; j += 1) {
        if (text[j] === '(') depth += 1
        else if (text[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      out += ' '.repeat(j - i + 1)
      i = j
    }
    return out
  }

  const literals = [...outsideVars(declarations).matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)].map((m) => m[0])
  assert.deepEqual(
    literals,
    [],
    `literal colours break the dark theme; use a --dsw-* token instead: ${literals.join(', ')}`,
  )

  // The primary button is what regressed. Its fill must NOT be a token that
  // inverts with the theme: `--dsw-alias-brand-primary` resolves to
  // `var(--dsw-alias-label-primary)` (near-black in light, near-white in dark),
  // which painted white text onto a near-white fill under the dark theme.
  const primary = declarations.slice(declarations.indexOf('.skhf-btn-primary {'))
  const primaryBlock = primary.slice(0, primary.indexOf('}'))
  const fill = /background:\s*var\((--dsw-[a-z0-9-]+)/.exec(primaryBlock)
  assert.ok(fill, 'the primary button must take its fill from a token')
  assert.notEqual(
    fill[1],
    '--dsw-alias-brand-primary',
    'the primary fill must not be --dsw-alias-brand-primary: it inverts with the theme and swallows white text in dark mode',
  )
  assert.equal(
    fill[1],
    '--dsw-alias-button-info-fill',
    'the primary fill should be the composer send button\'s own --dsw-alias-button-info-fill',
  )
  assert.match(
    primaryBlock,
    /color:\s*var\(--dsw-alias-label-primary-foreground/,
    'the primary button text colour must come from --dsw-alias-label-primary-foreground',
  )
  assert.doesNotMatch(primaryBlock, /^\s*color:\s*#/m, 'the primary button text colour must not be a literal')
})

test('every token the stylesheet uses is a real --dsw-* name', async () => {
  const css = await readStylesheet()
  const used = [...new Set([...css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]))]
  assert.ok(used.length > 10, 'the stylesheet should be token-driven')
  for (const token of used) {
    assert.match(token, /^--dsw-(alias|specific|focus-ring|radius|font|elevation|corner)[a-z0-9-]*$/, `${token} is not a --dsw-* token name`)
  }
  // The tokens the dark-mode regression depended on must be present.
  assert.ok(
    used.includes('--dsw-alias-button-info-fill'),
    'the primary fill must use the composer send button\'s own --dsw-alias-button-info-fill',
  )
  assert.ok(used.includes('--dsw-alias-label-primary-foreground'))
  // And the one that CAUSED it must never be used as a background: it resolves
  // to --dsw-alias-label-primary, i.e. near-black in light and near-white in dark.
  assert.doesNotMatch(
    css,
    /background(?:-color)?:\s*var\(--dsw-alias-brand-primary/,
    'no rule may paint a background with --dsw-alias-brand-primary: it inverts with the theme',
  )
})

test('the composer button disables itself on an empty draft', async () => {
  const bundle = await loadClientBundle()

  let button
  const ctx = {
    sidebarRight: { openTab() {} },
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_key, callback) => { callback(); return () => {} },
      register: (options, component) => {
        if (options.name === 'conversation.input.right') button = component
        return () => {}
      },
    },
    effect: (callback) => { callback(); return () => {} },
  }
  bundle.exports.apply(ctx)

  // The slot spreads the registration's inject() result onto the props, so the
  // controller arrives as `props.sidebarRight` — never nested under `injected`.
  const empty = button({ useInput: (selector) => selector({ draft: '   ' }), sidebarRight: ctx.sidebarRight })
  assert.equal(empty.props.disabled, true)
  assert.equal(empty.props['data-busy'], 'false')

  const filled = button({ useInput: (selector) => selector({ draft: '帮我写一个周报' }), sidebarRight: ctx.sidebarRight })
  assert.equal(filled.props.disabled, false)
  assert.match(filled.props['aria-label'], /搜索 SkillHub 技能/)
})

/**
 * Build a React stand-in whose `useState` really re-renders, so a click handler
 * and its awaited continuation actually run.
 * @returns the React stub plus render bookkeeping.
 */
function createReactStub() {
  const states = []
  let cursor = 0
  let render = () => {}
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++
      if (states.length <= index) states[index] = initial
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
        render()
      }]
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  return { React, begin: () => { cursor = 0 }, setRender: (fn) => { render = fn } }
}

/**
 * Load the bundle with a fetch that answers the Host routes, register the
 * composer button, and return everything a click test needs.
 * @param options - `withService`: whether the fake ctx exposes `sidebarRight`.
 * @returns the button component, recorded calls, and a render helper.
 */
async function mountButton({ withService }) {
  const stub = createReactStub()
  const calls = []
  const opened = []
  const fetchStub = async (url) => {
    calls.push(url)
    const body = url.endsWith('/search')
      ? { ok: true, id: 's1', keywords: ['周报'], skills: [{ slug: 'a', name: 'A' }] }
      : { ok: true }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }

  const source = await readFile(CLIENT_PATH, 'utf8')
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { sandbox.__registration = value } } },
    document: {
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      head: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    fetch: fetchStub,
    console,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  const exports = sandbox.__registration.factory((spec) => {
    if (spec === 'react') return stub.React
    throw new Error(`unexpected require(${spec})`)
  })

  // The controller the props share carries, and separately the one on ctx.
  const propsSidebarRight = { openTab: (kind) => { opened.push(kind) }, openResource() {}, close() {} }
  let button
  const ctx = {
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_key, callback) => { callback(); return () => {} },
      register: (options, component) => {
        if (options.name === 'conversation.input.right') button = component
        return () => {}
      },
    },
    effect: (callback) => { callback(); return () => {} },
  }
  if (withService) ctx.sidebarRight = propsSidebarRight
  exports.apply(ctx)

  const render = () => {
    stub.begin()
    const tree = button({
      useInput: (selector) => selector({ draft: '帮我写一个周报' }),
      sidebarRight: propsSidebarRight,
    })
    return tree
  }
  stub.setRender(render)
  return { render, calls, opened }
}

/** Walk down the returned tree to the element carrying onClick. */
function clickTarget(tree) {
  let current = tree
  for (let depth = 0; depth < 6; depth += 1) {
    if (current && current.props && typeof current.props.onClick === 'function') return current
    current = current && Array.isArray(current.children) ? current.children[0] : undefined
  }
  return undefined
}

test('clicking the button searches and then opens the Sidebar tab', async () => {
  // `withService: true` exercises the props share with the ctx fallback present;
  // `withService: false` removes the fallback so ONLY the props share can work.
  // Both must open the tab, which pins down both delivery paths independently.
  for (const withService of [true, false]) {
    const mounted = await mountButton({ withService })
    const target = clickTarget(mounted.render())
    assert.ok(target, `the button node carries no onClick (withService: ${withService})`)

    target.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.ok(
      mounted.calls.some((url) => url.endsWith('/search')),
      `no search request was made (withService: ${withService})`,
    )
    assert.equal(mounted.opened.length, 1, `the Sidebar tab was not opened (withService: ${withService})`)
    assert.equal(mounted.opened[0], 'skillhub-finder')
  }
})

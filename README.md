# dsh-plugin-skillhub-finder

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugin that puts a
**round SkillHub button inside the composer**, between the model selector and the send button.
Click it and it reads what you have typed, extracts the keywords that carry search intent,
searches [skillhub.cn](https://skillhub.cn) for skills that could help with that work, opens the
ranked results in the **right Sidebar**, and installs the one you pick.

> This is a **skill** finder, not a Cordis plugin store. SkillHub ships agent skills — `SKILL.md`
> bundles — so "download" here means *install the skill into your DSH skills root*, where the
> official filesystem skill provider picks it up without a restart.

## What it looks like

- **In the composer** — a 28px round button (`border-radius: 999px` + `corner-shape: round`, the
  shipped `.add` geometry), coloured from the same `--dsw-*` tokens as its neighbours. It is
  disabled until the draft has content, and spins while the search is in flight.
- **In the right Sidebar** — a `SkillHub 技能` tab. The tab title carries the live result
  count. `SkillHub 技能` also appears as a card on the Sidebar's guide page.

### A note on the seat

The composer tool row renders `conversation.input.right` **before** the model selector —
`InputBar.tsx` mounts it inside `.standardControls`, ahead of `conversation.input.model`, with the
Stop/Send buttons after that group. The requested position is the region to the *right* of the model
selector and to the *left* of send, so the button claims a later flex slot than the model seat:

```css
.skhf-btn { order: 2; }
```

That places it in the requested region without touching another plugin's entry. The only other seat
that sits after the model selector is `conversation.input.activity`, which is the wrong tool here:
an occupant of that seat expands across the toolbar and hides the ordinary accessory controls.

If a future DSH release mounts the seat in the order the name suggests, the `order` declaration
becomes a no-op and the button stays adjacent to the model selector, between it and send.

## Install

From a checkout of this directory, using the path form of `dsh plugin`:

```sh
dsh plugin --profile web add ./dsh-plugin-skillhub-finder
```

Or from a packed tarball:

```sh
npm pack
dsh plugin --profile web add ./dsh-plugin-skillhub-finder-0.1.0.tgz
```

Then restart the profile. The profile patch inserts one Loader row:

```yaml
- insert:
    - id: dsh-plugin-skillhub-finder
      name: dsh-plugin-skillhub-finder
```

Remove it the same way, with `dsh plugin --profile web remove dsh-plugin-skillhub-finder`.

## Use

1. Type what you are about to do — `帮我分析这份 Excel 并画图`, `帮我写周报`, `把这个 PDF 转成 Markdown`.
2. Click the round SkillHub button to the left of send.
3. The right Sidebar opens with the extracted keywords as chips and the ranked matches below.
4. **下载安装** installs a skill; **卸载** removes it; **查看主页** opens its skillhub.cn page.
5. **把首个技能插入输入框** hands the top recommendation's name back to the composer, so you can
   mention it in your next message.

## How the search works

Keyword extraction runs on the **Host**, not in the browser:

- Chinese candidates are gated on a **function-character deny list**: a 2- to 4-gram
  survives only when it contains no pronoun, particle or modal. That is what rejects the
  filler every request is full of. A stop-phrase list alone cannot do it — the n-grams that
  straddle two content words (`我想要`, `想要做`, `做一个`) score higher than the single real
  term beside them, and they were once the top keywords for a SpringBoot request.
- Terms are weighted, not counted. Curated **subject** terms (technologies, products, file
  formats: `springboot`, `excel`, `pdf`, `mysql`) outrank generic **intent** terms
  (`分析`, `周报`, `框架`), which outrank statistical n-grams. `我想要做一个springboot的后端框架`
  therefore yields `springboot` and `后端` — and drops `框架`, whose matches are
  "思维框架" and "记忆系统框架".
- English words are gated the same way, minus a filler list.

Each surviving keyword is searched against
`GET https://api.skillhub.cn/api/skills?keyword=…&sortBy=score`, then results are merged by
slug and ranked by **weight**, not by how many branches matched. Two evidence rules apply:

- A card only counts as a hit for a keyword when that keyword **actually appears** in the
  card's name, slug or summary. `sortBy=score` is a fuzzy tokenized recall, so the branch
  for `框架` returns stock analysers and social-media reports that do not contain the term
  at all.
- Name hits outweigh summary hits.

A skill whose search branch fails does not fail the whole search. When a draft carries no
subject term (`你好`), the search still runs on the line itself, the snapshot is flagged
`weak`, and the tab says the matches are a guess rather than pretending they are hits.

## Choosing where skills are installed

The install root is editable at runtime, from the tab itself — no profile edit, no restart:

1. Open the **SkillHub 技能** tab.
2. **更改** next to the current path opens the client's own folder picker.
3. Pick a directory. The Host validates it, creates it when missing, proves it is writable, and
   only then adopts it. **恢复默认** returns to `$DSH_HOME/skills`.

The chosen path is persisted through the settings document when this composition has one, and the
Host reads its Config live, so a new root applies to the very next install. Without a settings
service the path still takes effect for the session, and the tab says it was not saved rather than
pretending otherwise.

## Configuration

The same value can be set up front in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-plugin-skillhub-finder
      name: dsh-plugin-skillhub-finder
      config:
        apiBase: https://api.skillhub.cn
        installDir: D:/skills
```

`apiBase` must be an absolute `http(s)` URL without credentials. `installDir` is validated both when
the plugin loads and whenever it changes: a relative path (it would resolve against whatever the
process cwd happens to be) and a filesystem root are refused, and `~` is expanded. The default is
`$DSH_HOME/skills`, i.e. `~/.dsh/skills`.

## Architecture

Two halves, one package.

**Host half** (`lib/index.js`) registers a same-origin route prefix
`/dsh-plugin-skillhub-finder/api` on `ctx.webServer` and owns every filesystem write:

| Route | Purpose |
|---|---|
| `POST /search` | extract keywords from the draft (or accept explicit ones), search, merge, mark installed |
| `GET /latest` | the last snapshot, so a reloaded page restores its results |
| `GET /meta` | API base, install directory, its default, writability, category labels |
| `GET /detail?slug=` | one skill's detail projection |
| `POST /install-dir` | validate, create and adopt a new skills root |
| `POST /install` | download the zip, unpack it into the skills root |
| `POST /uninstall` | remove an installed skill |

The browser never talks to `api.skillhub.cn` directly, so there is no cross-origin surface and the
zip is unpacked where the filesystem lives.

**Client half** (`lib/client.js`) is a hand-written lazy-CJS bundle — no bundler, no build step:

- `conversation.input.right` (list, session scope) — the round button. It reads the draft through
  the standard `useInput` prop, so no editor wiring is involved.
- `sidebar.right.pane.tab` + `sidebar.right.pane.tab.title` (keyed by the tab type's `id`) — the
  results page and its live chip title.
- `ctx.sidebarRightTabs.register({ id, kind: 'skillhub-finder', title, guide })` declares the tab
  type; `ctx.sidebarRight.openTab('skillhub-finder')` opens and expands it.
- One shared store per client run connects the button to every mounted tab, exposed to both through
  the registration's `inject` face.
- The stylesheet is a plain `<style data-plugin="dsh-plugin-skillhub-finder">` tag owned by the
  fiber, over `--dsw-alias-*` / `--dsw-focus-ring-*` tokens. The install button fills with
  `--dsw-alias-button-info-fill` — the composer send button's own token — rather than
  `--dsw-alias-button-primary-fill`, which resolves through `--dsw-alias-brand-primary` to
  `var(--dsw-alias-label-primary)`: near-black in the light theme and near-white in the dark one,
  where a white label vanishes into the fill.

### Installing safely

`POST /install` is the only mutating route and guards itself: same-origin `Origin` check, an 8 KB
body cap, a strict slug pattern, a download size cap, a ZIP member cap, and a resolved-path check
that refuses to write outside the destination. Members are read for stored and deflated entries
only, `..` segments and `__MACOSX` noise are dropped, and the tree is staged in a temp directory
before an atomic rename publishes it. One install per slug may be in flight; a second click gets
`409` instead of racing the same directory.

## Development

```sh
npm test        # node --test test/selfcheck.mjs
```

`test/selfcheck.mjs` loads `lib/client.js` the way the shell does — as a *classic* script through a
`window.__ModuleLoader__` facade — and asserts it registers under the exact package id, requires
nothing but the baseline `react` seed, registers the three seats with the right ids and orders,
shares one store across the button and the tab, and disposes every effect. It also checks the Host
half's config schema and that every `exports` entry resolves.

There is no build step: edit `lib/client.js` and `lib/index.js` directly. A client bundle is a
classic script, so ESM `import`/`export` syntax in it is a `SyntaxError` — the test above catches
that before the shell reports an opaque `did not activate`.

### Failure mode worth knowing

A throw anywhere in `apply()` fails the plugin's **whole fiber**, and the boot audit reports it as
exactly one opaque line — the entry's client state is literally `failed`:

```
web boot: 1 entry did not activate
dsh-plugin-skillhub-finder: failed
```

It names neither the throwing call nor the error. This plugin hit it once:
`sidebarRightTabs.register()` runs `(definition.guide ?? []).map(...)`, so a `guide` written as an
**object** throws `TypeError: entries.map is not a function` and takes the entire plugin down —
including the parts that had nothing to do with the guide.

`test/selfcheck.mjs` therefore mirrors the registry's own guards (guide must be an array, entry ids
unique, `title` a function, no id/kind collision) as `assertTabDefinition`, asserted by
`the tab type definition satisfies the registry contract`. If you extend the tab definition, extend
that mirror too.

Debugging tip: both halves use the package name as their entry id, so a client-side failure also
makes the Host routes 404 — the Host half is fine, its entry simply never mounted. And a Host-side
change always needs a restart; only client bundles hot-reload.

## Limits

- Results are ranked by SkillHub's own search score over up to six keyword branches; there is no
  semantic re-ranking and no per-result "why this matches" explanation beyond the `命中` chips.
- The result snapshot lives in memory plus one Host-side slot, so only the most recent search is
  restored after a reload.
- Installation targets `SKILL.md` bundles only. A SkillHub entry that is not a skill bundle is
  rejected with `this bundle has no SKILL.md`.
- The Sidebar tab renders results one page at a time; there is no infinite scroll or category
  browsing yet — the keyword chips and the `在 skillhub.cn 打开` link are the way out.

## License

MIT

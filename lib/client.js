/**
 * dsh-plugin-skillhub-finder — Client half.
 *
 * Two contributions:
 *   1. `conversation.input.right` — a round button between the model selector
 *      and the submit action. It reads the composer draft, asks the Host half to
 *      extract keywords and search skillhub.cn, then opens the result tab.
 *   2. `sidebar.right.pane.tab` — the right-Sidebar tab that renders the ranked
 *      skills and installs the one the user picks.
 *
 * Bundle format: `window.__ModuleLoader__.load({ id, factory(require) })`. The
 * shell supplies the CJS shim and the frozen seed module table (react,
 * react-dom, react/jsx-runtime, @deepseek-ai/cordis, dsh-client-store,
 * ui-slots, ui-primitives, ui-dockkit), so this file needs no bundler and no
 * build step.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-skillhub-finder',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Bundle id; must equal `package.json.name`. Doubles as the tab type's id. */
    const PLUGIN_ID = 'dsh-plugin-skillhub-finder'
    /** Host routes that proxy SkillHub and own the filesystem writes. */
    const API = '/dsh-plugin-skillhub-finder/api'
    /** Page kind used by `ctx.sidebarRight.openTab`. */
    const TAB_KIND = 'skillhub-finder'

    // ---------------------------------------------------------------------
    // Icons — official DSH product geometry, inlined so the bundle carries no
    // value import beyond the platform seed table.
    // ---------------------------------------------------------------------

    const svgBase = {
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    }

    /** `IconSkillOutlineRegular` — a document plus a spark: "find a skill". */
    const SkillIcon = ({ size = 16, strokeWidth = 1 }) => h(
      'svg',
      { ...svgBase, width: size, height: size, viewBox: '0 0 17 17', strokeWidth },
      h('path', { d: 'M4.57788 5.77124H10.7029', stroke: 'currentColor' }),
      h('path', { d: 'M4.57788 8.89819H7.91879', stroke: 'currentColor' }),
      h('path', {
        d: 'M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z',
        fill: 'currentColor',
      }),
      h('path', {
        d: 'M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z',
        stroke: 'currentColor',
      }),
    )

    /** `IconRefreshOutlineRegular`. */
    const RefreshIcon = ({ size = 14, strokeWidth = 1 }) => h(
      'svg',
      { ...svgBase, width: size, height: size, viewBox: '0 0 16 16', strokeWidth },
      h('path', {
        d: 'M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1',
        stroke: 'currentColor',
      }),
      h('path', { d: 'M14.4999 1.5V5.1H10.8999', stroke: 'currentColor' }),
    )

    /** `IconCheckOutlineRegular`. */
    const CheckIcon = ({ size = 13, strokeWidth = 1 }) => h(
      'svg',
      { ...svgBase, width: size, height: size, viewBox: '0 0 16 16', strokeWidth },
      h('path', {
        d: 'M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4',
        stroke: 'currentColor',
      }),
    )

    /** Download-into-the-project glyph, on the shared 1px product stroke. */
    const InstallIcon = ({ size = 13, strokeWidth = 1 }) => h(
      'svg',
      { ...svgBase, width: size, height: size, viewBox: '0 0 16 16', strokeWidth },
      h('path', { d: 'M8 1.75V10.25', stroke: 'currentColor' }),
      h('path', { d: 'M4.25 7L8 10.75L11.75 7', stroke: 'currentColor' }),
      h('path', { d: 'M2.75 13.75H13.25', stroke: 'currentColor' }),
    )

    /** Insert-into-draft glyph, matching the shared arrow geometry. */
    const InsertIcon = ({ size = 13, strokeWidth = 1 }) => h(
      'svg',
      { ...svgBase, width: size, height: size, viewBox: '0 0 16 16', strokeWidth },
      h('path', { d: 'M8 13.25V2.75', stroke: 'currentColor' }),
      h('path', { d: 'M3.75 7L8 2.75L12.25 7', stroke: 'currentColor' }),
    )

    // ---------------------------------------------------------------------
    // Styles — plain CSS over the `--dsw-*` design tokens, owned by this fiber.
    // ---------------------------------------------------------------------

    const CSS = `
.skhf-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  cursor: pointer;
  flex: none;
  /* The shipped tool row renders the conversation.input.right seat BEFORE the
     model selector. The request is the region to its right, immediately left of
     send, so claim a later flex slot than the model seat and the send button. */
  order: 2;
  transition: background-color .15s ease, color .15s ease;
}
.skhf-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-secondary);
}
.skhf-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.skhf-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.skhf-btn:disabled { opacity: .5; cursor: default; }
.skhf-btn[data-busy="true"] { cursor: progress; color: var(--dsw-alias-brand-primary); opacity: 1; }
.skhf-ico { display: inline-flex; }
.skhf-spin { animation: skhf-spin .9s linear infinite; transform-origin: 50% 50%; }
@keyframes skhf-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .skhf-spin { animation-duration: 2.4s; } }

.skhf-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
.skhf-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.skhf-head-top { display: flex; align-items: center; gap: 8px; }
.skhf-title { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skhf-count { flex: none; font-size: 11px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary)); }
.skhf-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  flex: none;
  transition: background-color .15s ease, color .15s ease;
}
.skhf-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-primary);
}
.skhf-icon-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.skhf-icon-btn:disabled { opacity: .5; cursor: default; }

.skhf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.skhf-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skhf-chip[data-kind="manual"] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }

.skhf-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px 20px; }
.skhf-list { display: flex; flex-direction: column; gap: 8px; list-style: none; margin: 0; padding: 0; }

.skhf-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  transition: border-color .15s ease;
}
.skhf-card:hover { border-color: var(--dsw-alias-border-l2); }
.skhf-card-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.skhf-name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skhf-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary));
}
.skhf-desc {
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.skhf-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.skhf-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  /* The same token the composer's own send button uses. It is a REAL blue in
     both themes (deepseek-500 light, deepseek-400 dark), so white text reads on
     it. Do NOT use --dsw-alias-button-primary-fill here: it falls back to
     --dsw-alias-brand-primary, which is var(--dsw-alias-label-primary) — near
     BLACK in the light theme and near WHITE in the dark one — which painted
     this button white-on-white under the dark theme. */
  background: var(--dsw-alias-button-info-fill, var(--dsw-alias-brand-primary));
  color: var(--dsw-alias-label-primary-foreground, #fff);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .15s ease, opacity .15s ease;
}
.skhf-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover, var(--dsw-alias-button-info-fill, var(--dsw-alias-brand-primary)));
}
.skhf-btn-primary:disabled { opacity: .5; cursor: default; }
.skhf-btn-primary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
.skhf-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  transition: background-color .15s ease, color .15s ease;
}
.skhf-btn-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-primary);
}
.skhf-btn-ghost:disabled { opacity: .5; cursor: default; }
.skhf-btn-ghost:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
.skhf-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-state-success-primary); font-size: 12px; }

.skhf-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.skhf-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.skhf-path { font-size: 11px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; }
.skhf-draft {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary));
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skhf-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 20px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.skhf-state-title { color: var(--dsw-alias-label-primary); font-weight: 600; }
.skhf-state-icon { color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); display: inline-flex; }

.skhf-skeleton { display: flex; flex-direction: column; gap: 8px; }
.skhf-skeleton-row {
  height: 78px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  animation: skhf-pulse 1.4s ease-in-out infinite;
}
@keyframes skhf-pulse { 0%, 100% { opacity: .5; } 50% { opacity: .95; } }
@media (prefers-reduced-motion: reduce) { .skhf-skeleton-row { animation: none; opacity: .7; } }
`

    // ---------------------------------------------------------------------
    // Host transport
    // ---------------------------------------------------------------------

    const jsonRequest = async (path, init) => {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        headers: init && init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        ...init,
      })
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`SkillHub 代理返回了非 JSON 响应（HTTP ${response.status}）`)
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `请求失败（HTTP ${response.status}）`)
      }
      return payload
    }

    // ---------------------------------------------------------------------
    // Shared result store — one per client run. The composer button writes it,
    // every mounted tab body and title reads it, so a search lands everywhere.
    // ---------------------------------------------------------------------

    const listeners = new Set()
    let state = { result: null, failure: null }

    const store = {
      getSnapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      /** Selector hook over the shared result. */
      useStore: (selector) => React.useSyncExternalStore(
        store.subscribe,
        () => selector(store.getSnapshot()),
        () => selector(store.getSnapshot()),
      ),
      setResult: (result) => {
        state = { result, failure: null }
        for (const listener of [...listeners]) listener()
      },
      setFailure: (failure) => {
        state = { result: state.result, failure }
        for (const listener of [...listeners]) listener()
      },
      dispose: () => {
        listeners.clear()
        state = { result: null, failure: null }
      },
    }

    // ---------------------------------------------------------------------
    // Right-Sidebar navigation handle
    // ---------------------------------------------------------------------

    /**
     * The controller, captured in `apply` from the injected service. A slot
     * component also receives the registration's `inject()` result on its props,
     * which is the primary source; this capture is the fallback for the case
     * where that share does not reach a given render site.
     */
    let sidebarRightService = null

    /**
     * Resolve the right-Sidebar controller from whichever source has it.
     * @param fromProps - `props.sidebarRight`, when the slot supplied it.
     * @returns the controller, or undefined when the sidebar is not composed.
     */
    const resolveSidebarRight = (fromProps) => {
      if (fromProps && typeof fromProps.openTab === 'function') return fromProps
      if (sidebarRightService && typeof sidebarRightService.openTab === 'function') return sidebarRightService
      return undefined
    }

    // ---------------------------------------------------------------------
    // Presentation helpers
    // ---------------------------------------------------------------------

    const SOURCE_LABELS = {
      community: '社区',
      enterprise: '企业',
      official: '官方',
      clawhub: 'ClawHub',
    }

    const compactNumber = (value) => {
      const n = Number(value) || 0
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
      return String(n)
    }

    /** One search hit, with its per-card install lifecycle. */
    const SkillCard = ({ skill, categoryLabel, cardState, onInstall, onUninstall }) => {
      const installed = cardState?.status === 'done' || (skill.installed && cardState?.status !== 'error')
      const busy = cardState?.status === 'busy'
      return h(
        'li',
        { className: 'skhf-card', 'data-installed': installed ? 'true' : 'false' },
        h(
          'div',
          { className: 'skhf-card-top' },
          h('span', { className: 'skhf-name', title: skill.name }, skill.name),
          skill.verified ? h('span', { className: 'skhf-chip' }, '认证') : null,
        ),
        h(
          'div',
          { className: 'skhf-meta' },
          skill.source ? h('span', { className: 'skhf-chip' }, SOURCE_LABELS[skill.source] || skill.source) : null,
          skill.category
            ? h('span', { className: 'skhf-chip' }, (categoryLabel && categoryLabel[skill.category]) || skill.category)
            : null,
          h('span', null, `↓ ${compactNumber(skill.downloads)}`),
          skill.version ? h('span', null, `v${skill.version}`) : null,
          skill.requiresApiKey ? h('span', { className: 'skhf-chip' }, '需 API Key') : null,
        ),
        skill.description ? h('div', { className: 'skhf-desc' }, skill.description) : null,
        Array.isArray(skill.matched) && skill.matched.length > 1
          ? h(
            'div',
            { className: 'skhf-meta' },
            skill.matched.slice(0, 4).map((word) => h('span', { key: word, className: 'skhf-chip' }, `命中 ${word}`)),
          )
          : null,
        h(
          'div',
          { className: 'skhf-actions' },
          installed
            ? h(
              'span',
              { className: 'skhf-ok' },
              h(CheckIcon, null),
              cardState?.dirName ? `已安装 · ${cardState.dirName}` : '已安装',
            )
            : h(
              'button',
              {
                type: 'button',
                className: 'skhf-btn-primary',
                disabled: busy,
                onClick: () => onInstall(skill),
              },
              busy ? null : h(InstallIcon, null),
              busy ? '安装中…' : '下载安装',
            ),
          installed
            ? h(
              'button',
              { type: 'button', className: 'skhf-btn-ghost', disabled: busy, onClick: () => onUninstall(skill) },
              '卸载',
            )
            : null,
          h(
            'a',
            {
              className: 'skhf-btn-ghost',
              href: skill.page || `https://skillhub.cn/skills/${skill.slug}`,
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            '查看主页',
          ),
        ),
        cardState?.status === 'error'
          ? h('div', { className: 'skhf-note', 'data-tone': 'error' }, cardState.message)
          : null,
        cardState?.status === 'done' && cardState.dirPath
          ? h('div', { className: 'skhf-path' }, `安装位置：${cardState.dirPath}`)
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // Composer button — conversation.input.right
    // ---------------------------------------------------------------------

    /**
     * Round action between the model selector and the submit button. It reads
     * the live composer draft through the standard `useInput` session prop, so
     * nothing extra is needed to reach the editor.
     */
    const SkillHubButton = (props) => {
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const input = props.useInput ? props.useInput((value) => value) : undefined
      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      const ready = draft.trim().length > 0
      // The slot spreads this registration's `inject()` result onto the props,
      // so it arrives as `props.sidebarRight` — not nested under `injected`.
      const injectedSidebarRight = props.sidebarRight

      const onClick = React.useCallback(() => {
        if (busy || !ready) return
        setBusy(true)
        setFailure(null)
        void (async () => {
          try {
            const payload = await jsonRequest('/search', {
              method: 'POST',
              body: JSON.stringify({ draft, pageSize: 12 }),
            })
            store.setResult(payload)
            const sidebarRight = resolveSidebarRight(injectedSidebarRight)
            if (sidebarRight !== undefined) {
              sidebarRight.openTab(TAB_KIND)
            } else {
              store.setFailure('右侧栏服务不可用：请确认 dsh-client-ui-sidebar-right 已启用。')
            }
          } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error))
          } finally {
            setBusy(false)
          }
        })()
      }, [busy, ready, draft, injectedSidebarRight])

      const label = !ready
        ? '先在输入框写下你的需求，再搜索 SkillHub 技能'
        : (busy ? '正在搜索 SkillHub…' : '按当前输入搜索 SkillHub 技能')

      return h(
        'button',
        {
          type: 'button',
          className: 'skhf-btn',
          'data-busy': busy ? 'true' : 'false',
          disabled: !ready,
          title: failure ? `${label}（${failure}）` : label,
          'aria-label': label,
          onClick,
        },
        h('span', { className: busy ? 'skhf-ico skhf-spin' : 'skhf-ico' }, h(SkillIcon, { size: 16 })),
      )
    }

    // ---------------------------------------------------------------------
    // Right-Sidebar tab body — sidebar.right.pane.tab
    // ---------------------------------------------------------------------

    /**
     * The result page. It reads the shared store the button writes, so a search
     * started anywhere in the composer updates every mounted tab at once.
     */
    const SkillHubResults = (props) => {
      const bound = props.store || store
      const snapshot = bound.useStore((value) => value.result)
      const sharedFailure = bound.useStore((value) => value.failure)
      const [busy, setBusy] = React.useState(false)
      const [meta, setMeta] = React.useState(null)
      const [cards, setCards] = React.useState({})
      const live = React.useRef(true)

      React.useEffect(() => () => { live.current = false }, [])

      const skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills : []
      const keywords = snapshot && Array.isArray(snapshot.keywords) ? snapshot.keywords : []

      const setCard = React.useCallback((slug, next) => {
        setCards((current) => ({ ...current, [slug]: next }))
      }, [])

      React.useEffect(() => {
        void (async () => {
          try {
            const payload = await jsonRequest('/meta')
            if (live.current) setMeta(payload)
          } catch {
            // The install-dir hint is decoration; its absence is not an error.
          }
        })()
      }, [])

      // A page reload drops the in-memory store; the Host still holds the last
      // snapshot, so the restored tab shows results instead of the empty state.
      const restored = React.useRef(false)
      React.useEffect(() => {
        if (snapshot || restored.current) return
        restored.current = true
        void (async () => {
          try {
            const payload = await jsonRequest('/latest')
            if (live.current && payload && payload.search) bound.setResult(payload.search)
          } catch {
            // Nothing to restore is a normal first run.
          }
        })()
      }, [snapshot, bound])

      const install = React.useCallback((skill) => {
        setCard(skill.slug, { status: 'busy' })
        void (async () => {
          try {
            const payload = await jsonRequest('/install', {
              method: 'POST',
              body: JSON.stringify({ slug: skill.slug }),
            })
            if (!live.current) return
            setCard(skill.slug, { status: 'done', dirName: payload.dirName, dirPath: payload.dirPath })
          } catch (error) {
            if (!live.current) return
            setCard(skill.slug, {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        })()
      }, [setCard])

      const uninstall = React.useCallback((skill) => {
        setCard(skill.slug, { status: 'busy' })
        void (async () => {
          try {
            await jsonRequest('/uninstall', { method: 'POST', body: JSON.stringify({ slug: skill.slug }) })
            if (live.current) setCard(skill.slug, { status: 'idle' })
          } catch (error) {
            if (!live.current) return
            setCard(skill.slug, {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        })()
      }, [setCard])

      /** Re-run the same keywords: the same draft may gain new skills upstream. */
      const rerun = React.useCallback(() => {
        if (busy || !snapshot) return
        setBusy(true)
        void (async () => {
          try {
            const payload = await jsonRequest('/search', {
              method: 'POST',
              body: JSON.stringify({
                draft: snapshot.draft || '',
                keywords,
                pageSize: Math.max(12, skills.length),
              }),
            })
            bound.setResult(payload)
            setCards({})
          } catch (error) {
            bound.setFailure(error instanceof Error ? error.message : String(error))
          } finally {
            if (live.current) setBusy(false)
          }
        })()
      }, [busy, snapshot, keywords, skills.length, bound])

      /** Hand the leading recommendation back to the composer as plain text. */
      const insertFirst = React.useCallback(() => {
        const target = skills[0]
        const actions = props.inputActions
        if (!target || !actions || typeof actions.captureInsertion !== 'function') return
        let span
        try {
          span = actions.captureInsertion()
        } catch {
          span = undefined
        }
        if (span && typeof actions.insertText === 'function' && actions.insertText(`${target.name} `, span)) return
        if (typeof actions.setDraft === 'function') actions.setDraft(`${target.name} `)
      }, [skills, props.inputActions])

      const head = h(
        'div',
        { className: 'skhf-head' },
        h(
          'div',
          { className: 'skhf-head-top' },
          h('span', { className: 'skhf-title' }, snapshot ? 'SkillHub 推荐' : 'SkillHub 技能'),
          snapshot ? h('span', { className: 'skhf-count' }, `${skills.length} 个结果`) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'skhf-icon-btn',
              title: '用同样的关键词重新搜索',
              'aria-label': '重新搜索',
              disabled: busy || !snapshot,
              onClick: rerun,
            },
            h('span', { className: busy ? 'skhf-ico skhf-spin' : 'skhf-ico' }, h(RefreshIcon, { size: 14 })),
          ),
        ),
        keywords.length
          ? h(
            'div',
            { className: 'skhf-chips' },
            keywords.map((word) => h(
              'span',
              {
                key: word,
                className: 'skhf-chip',
                'data-kind': snapshot.keywordSource === 'provided' ? 'manual' : 'auto',
              },
              word,
            )),
          )
          : null,
        snapshot && snapshot.draft ? h('div', { className: 'skhf-draft' }, `来自输入：${snapshot.draft}`) : null,
        meta && meta.installDir ? h('div', { className: 'skhf-path' }, `安装到：${meta.installDir}`) : null,
      )

      let body
      if (!snapshot) {
        body = h(
          'div',
          { className: 'skhf-state' },
          h('span', { className: 'skhf-state-icon' }, h(SkillIcon, { size: 28 })),
          h('span', { className: 'skhf-state-title' }, '还没有搜索'),
          h('span', null, '在输入框写下这次要做的事，然后点击发送键左边的圆形按钮。'),
        )
      } else if (busy && skills.length === 0) {
        body = h(
          'div',
          { className: 'skhf-skeleton', 'aria-busy': 'true' },
          [0, 1, 2, 3].map((index) => h('div', { key: index, className: 'skhf-skeleton-row' })),
        )
      } else if (skills.length === 0) {
        body = h(
          'div',
          { className: 'skhf-state' },
          h('span', { className: 'skhf-state-icon' }, h(SkillIcon, { size: 28 })),
          h('span', { className: 'skhf-state-title' }, '没有找到相关技能'),
          h(
            'span',
            null,
            keywords.length
              ? `已尝试关键词：${keywords.join('、')}，换个说法再试一次。`
              : '输入框内容太短，写得更具体一些再搜索。',
          ),
        )
      } else {
        body = h(
          'ul',
          { className: 'skhf-list' },
          skills.map((skill) => h(SkillCard, {
            key: skill.slug,
            skill,
            categoryLabel: meta && meta.categories,
            cardState: cards[skill.slug],
            onInstall: install,
            onUninstall: uninstall,
          })),
        )
      }

      return h(
        'div',
        { className: 'skhf-root' },
        head,
        h(
          'div',
          { className: 'skhf-scroll' },
          sharedFailure
            ? h('div', { className: 'skhf-note', 'data-tone': 'error', style: { marginBottom: '8px' } }, sharedFailure)
            : null,
          body,
          snapshot && skills.length
            ? h(
              'div',
              { className: 'skhf-actions', style: { marginTop: '12px' } },
              h(
                'button',
                { type: 'button', className: 'skhf-btn-ghost', onClick: insertFirst },
                h(InsertIcon, null),
                '把首个技能插入输入框',
              ),
              h(
                'a',
                {
                  className: 'skhf-btn-ghost',
                  href: keywords.length
                    ? `https://skillhub.cn/search?keyword=${encodeURIComponent(keywords[0])}`
                    : 'https://skillhub.cn/',
                  target: '_blank',
                  rel: 'noreferrer noopener',
                },
                '在 skillhub.cn 打开',
              ),
            )
            : null,
        ),
      )
    }

    /** Live chip title: the result count while a search is loaded. */
    const SkillHubTitle = (props) => {
      const bound = props.store || store
      const snapshot = bound.useStore((value) => value.result)
      const count = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills.length : 0
      return count ? `SkillHub 技能 (${count})` : 'SkillHub 技能'
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    /** Cordis service dependencies. */
    exports.inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

    /**
     * Mount the composer button, the Sidebar tab type, and their shared store.
     * @param ctx - the browser client context.
     */
    exports.apply = function apply(ctx) {
      sidebarRightService = ctx.sidebarRight

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = PLUGIN_ID
        tag.dataset.pluginCss = `${PLUGIN_ID}/styles`
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, `${PLUGIN_ID}: styles`)

      ctx.effect(() => () => store.dispose(), `${PLUGIN_ID}: result store`)

      // The tab type and the three seats are load-bearing: a mistake here must
      // fail loudly rather than leave a half-mounted plugin.
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PLUGIN_ID,
        kind: TAB_KIND,
        title: () => 'SkillHub 技能',
        // `guide` is an ARRAY of entry boxes: the registry runs
        // `(definition.guide ?? []).map(...)` over it, so an object here throws
        // a TypeError and fails this plugin's entire fiber.
        guide: [{
          id: 'finder',
          order: 40,
          title: () => 'SkillHub 技能',
          description: () => '按输入框内容推荐 skillhub.cn 上的技能，并可一键安装',
        }],
      }), `${PLUGIN_ID}: tab type`)

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PLUGIN_ID,
        inject: () => ({ store }),
      }, SkillHubResults)), `${PLUGIN_ID}: tab body`)

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: PLUGIN_ID,
        inject: () => ({ store }),
      }, SkillHubTitle)), `${PLUGIN_ID}: tab title`)

      ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: PLUGIN_ID,
        order: 10,
        inject: () => ({ sidebarRight: ctx.sidebarRight }),
      }, SkillHubButton)), `${PLUGIN_ID}: composer button`)
    }

    return module.exports
  },
})

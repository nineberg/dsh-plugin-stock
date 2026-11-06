/**
 * Client half of the symbol-trends bundle (panel + floating widget).
 *
 * One plugin, two presentations of the same tracked list:
 *
 *   1. Sidebar panel — `sidebar.panellist` (id `astock-quotes`) plus the
 *      central panel it opens (`main`, key `astock-quotes`).
 *   2. Floating widget — `shell.overlay` (id `astock-widget`): a Dynamic-
 *      Island-style card that morphs between a dot and the full card and
 *      is freely draggable.
 *
 * Tear-off / dock: dragging the sidebar icon out of the sidebar spawns the
 * floating widget at the drop point; dragging the widget (card header or
 * dot) back over the sidebar docks it again. The dot also speaks the
 * Plugin Island drag-and-drop protocol (MIME
 * `application/x-dsh-plugin-island`), so dropping it on the island docks
 * a launcher chip there that reopens this panel.
 *
 * Data: one same-origin Host route pair powers both halves:
 *
 *   GET /astock/quotes?symbols=...  live quotes + intraday/5-day trends
 *   GET /astock/search?q=...        symbol suggestions for the add box
 *
 * The sidebar panel is the editing surface (search/add/remove); the
 * widget is a read-only viewer of the same localStorage-backed list and
 * follows every change instantly via the `astock-quotes:changed` event.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-astock-quotes',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const PANEL_ID = 'astock-quotes'
    const WIDGET_ID = 'astock-widget'
    const ENDPOINT = '/astock/quotes'
    const SEARCH_ENDPOINT = '/astock/search'
    const NS = 'astock'
    const REFRESH_MS = 8000
    const MAX_SYMBOLS = 30

    // Shared state keys (the panel owns writes; the widget follows).
    const SYMBOLS_STORAGE = 'astock-quotes:symbols:v1'
    const RANGE_STORAGE = 'astock-quotes:range:v1'
    const SHELL_STORAGE = 'astock-quotes:shell:v1' // 'sidebar' | 'floating'
    const WIDGET_MODE_STORAGE = 'astock-quotes:widget-mode:v1' // 'expanded' | 'hidden'
    const WIDGET_POS_STORAGE = 'astock-quotes:widget-pos:v1'
    const SYNC_EVENT = 'astock-quotes:changed'
    // Plugin Island drag-and-drop protocol.
    const ISLAND_MIME = 'application/x-dsh-plugin-island'
    // Legacy keys from the retired standalone widget bundle.
    const LEGACY_WIDGET_KEYS = {
      mode: 'astock-widget:mode:v1',
      pos: 'astock-widget:pos:v1',
    }

    // Shell geometry for the floating widget states.
    const BOX_DOT = { w: 46, h: 46, r: 23 }
    const BOX_CARD_W = 316
    const BOX_CARD_R = 16

    const ZH = {
      'nav.label': '投资标的',
      'panel.title': '投资标的',
      'panel.subtitle': '实时价格、涨跌幅与分时/5日走势',
      'panel.updated': '更新于',
      'panel.refresh': '刷新',
      'panel.loading': '正在获取行情…',
      'panel.error': '行情获取失败',
      'panel.retry': '重试',
      'panel.market.open': '交易中',
      'panel.market.closed': '休市',
      'panel.footer': '数据来源：东方财富，每 8 秒刷新。行情可能延迟，不构成投资建议。',
      'panel.empty': '列表为空，搜索代码 / 名称 / 拼音首字母添加标的（A股、指数、港股、美股）。',
      'panel.noTrend': '暂无分时数据',
      'panel.stale': '上次数据',
      'panel.limit': `最多跟踪 ${MAX_SYMBOLS} 个标的`,
      'panel.dup': '该标的已在列表中',
      'panel.badSymbol': '无法识别该代码，请从搜索结果中选择',
      'range.intraday': '分时',
      'range.five': '5日',
      'search.placeholder': '搜索 A股 / 港股 / 美股：代码、名称或拼音，回车添加…',
      'search.searching': '搜索中…',
      'search.none': '未找到匹配的股票或指数',
      'search.failed': '搜索失败',
      'search.kind.index': '指数',
      'search.kind.stock': 'A股',
      'search.kind.hk': '港股',
      'search.kind.us': '美股',
      'row.remove': '移除',
      'widget.label': '投资标的悬浮窗',
      'widget.loading': '获取中…',
      'widget.error': '行情获取失败',
      'widget.retry': '重试',
      'widget.empty': '暂无标的，请在左侧「投资标的」面板中添加',
      'widget.noTrend': '暂无分时',
      'widget.updated': '更新',
      'widget.refresh': '刷新',
      'widget.collapse': '点击收起',
      'widget.tapToExpand': '点按展开',
      'widget.dockHint': '拖回左侧导航栏可停靠',
      'icon.tearoff': '拖出成悬浮窗 / 点击打开面板',
    }

    const EN = {
      'nav.label': 'Symbol Trends',
      'panel.title': 'Symbol Trends',
      'panel.subtitle': 'Live price, change, intraday and 5-day trend',
      'panel.updated': 'updated',
      'panel.refresh': 'Refresh',
      'panel.loading': 'Loading quotes…',
      'panel.error': 'Failed to load quotes',
      'panel.retry': 'Retry',
      'panel.market.open': 'Open',
      'panel.market.closed': 'Closed',
      'panel.footer': 'Source: Eastmoney, refreshed every 8s. Quotes may be delayed; not investment advice.',
      'panel.empty': 'List is empty — search by code / name / pinyin to add A-shares, indices, HK or US stocks.',
      'panel.noTrend': 'No trend data',
      'panel.stale': 'last data',
      'panel.limit': `At most ${MAX_SYMBOLS} symbols`,
      'panel.dup': 'Already in the list',
      'panel.badSymbol': 'Unrecognized code — pick one from the results',
      'range.intraday': 'Intraday',
      'range.five': '5D',
      'search.placeholder': 'Search A-share / HK / US: code, name or pinyin, Enter to add…',
      'search.searching': 'Searching…',
      'search.none': 'No matching stock or index',
      'search.failed': 'Search failed',
      'search.kind.index': 'Index',
      'search.kind.stock': 'A-share',
      'search.kind.hk': 'HK',
      'search.kind.us': 'US',
      'row.remove': 'Remove',
      'widget.label': 'Symbol Trends Widget',
      'widget.loading': 'Loading…',
      'widget.error': 'Failed to load quotes',
      'widget.retry': 'Retry',
      'widget.empty': 'No symbols — add them in the sidebar Trends panel',
      'widget.noTrend': 'No trend',
      'widget.updated': 'updated',
      'widget.refresh': 'Refresh',
      'widget.collapse': 'Tap to collapse',
      'widget.tapToExpand': 'Tap to expand',
      'widget.dockHint': 'Drag back to the sidebar to dock',
      'icon.tearoff': 'Drag out as floating widget / click to open panel',
    }

    function isEnglish(active) {
      return typeof active === 'string' && /^en/i.test(active)
    }

    function translate(active, key) {
      const dict = isEnglish(active) ? EN : ZH
      return dict[key] || ZH[key] || key
    }

    const TONE_UP = 'var(--dsw-alias-state-error-primary)'
    const TONE_DOWN = 'var(--dsw-alias-state-success-primary)'
    const TONE_FLAT = 'var(--dsw-alias-label-secondary)'
    const BORDER = '1px solid var(--dsw-alias-border-l1)'
    // Long, soft spring: slow take-off, gentle overshoot, long settle tail.
    const MORPH_CURVE = 'cubic-bezier(0.25, 1.05, 0.30, 1)'

    function toneOf(changePct) {
      if (typeof changePct !== 'number') return TONE_FLAT
      if (changePct > 0) return TONE_UP
      if (changePct < 0) return TONE_DOWN
      return TONE_FLAT
    }

    function formatPrice(value) {
      if (typeof value !== 'number') return '—'
      return value.toFixed(2)
    }

    function formatSigned(value, digits, suffix) {
      if (typeof value !== 'number') return '—'
      const sign = value > 0 ? '+' : ''
      return `${sign}${value.toFixed(digits)}${suffix || ''}`
    }

    function arrowOf(changePct) {
      if (typeof changePct !== 'number' || changePct === 0) return '—'
      return changePct > 0 ? '▲' : '▼'
    }

    function formatClock(iso) {
      const date = iso ? new Date(iso) : new Date()
      if (Number.isNaN(date.getTime())) return ''
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(date)
      } catch {
        return date.toLocaleTimeString()
      }
    }

    function marketPhase() {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(new Date())
        const pick = type => {
          const found = parts.find(part => part.type === type)
          return found ? found.value : ''
        }
        const weekday = pick('weekday')
        if (weekday === 'Sat' || weekday === 'Sun') return 'closed'
        const minutes = Number(pick('hour')) * 60 + Number(pick('minute'))
        const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30
        const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60
        return morning || afternoon ? 'open' : 'closed'
      } catch {
        return 'closed'
      }
    }

    /* ------------------------------------------------------------------ *
     * Drop-target helpers (sidebar / plugin island)                       *
     * ------------------------------------------------------------------ */

    function elementAtPoint(x, y) {
      try {
        return document.elementFromPoint(x, y)
      } catch {
        return null
      }
    }

    /** The Plugin Island overlay root, if the point is over it. */
    function islandRootAt(x, y) {
      const el = elementAtPoint(x, y)
      if (el && el.closest) {
        const root = el.closest('.dsw-pli-root') || el.closest('[class*="plugin-island"]')
        if (root) return root
      }
      return null
    }

    /**
     * The real left sidebar column: a tall narrow region hugging the left
     * edge. Naive `closest('aside, nav')` matches nested <nav>s inside the
     * main content, which made every drop look "over the sidebar".
     */
    function findSidebarRoot() {
      try {
        const nodes = document.querySelectorAll('aside, nav, [class*="idebar"], [class*="Sidebar"]')
        for (const node of nodes) {
          const rect = node.getBoundingClientRect()
          if (rect.width >= 30 && rect.height >= 200 && rect.left < 120 && rect.right <= window.innerWidth * 0.5) {
            return node
          }
        }
      } catch {
        /* fall through */
      }
      return null
    }

    /**
     * A drop over the shell sidebar docks the widget back. Uses the full
     * element stack so a floating card sitting on top of the sidebar still
     * counts as "over" it.
     */
    function isOverSidebar(x, y) {
      const root = findSidebarRoot()
      if (!root) return false
      try {
        if (typeof document.elementsFromPoint === 'function') {
          return document.elementsFromPoint(x, y).some(el => el === root || root.contains(el))
        }
      } catch {
        /* fall back below */
      }
      const el = elementAtPoint(x, y)
      return !!(el && (el === root || root.contains(el)))
    }

    function clampPoint(x, y, width, height) {
      const viewW = typeof window === 'undefined' ? 1200 : window.innerWidth
      const viewH = typeof window === 'undefined' ? 800 : window.innerHeight
      return {
        x: Math.min(Math.max(x, 8), Math.max(8, viewW - width - 8)),
        y: Math.min(Math.max(y, 8), Math.max(8, viewH - height - 8)),
      }
    }

    /* ------------------------------------------------------------------ *
     * Morph styles (Dynamic-Island-like)                                  *
     * ------------------------------------------------------------------ */

    const STYLE_ID = 'astock-widget-anim'

    function ensureAnimationStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
.astock-widget-shell {
  transition:
    width 700ms ${MORPH_CURVE},
    height 700ms ${MORPH_CURVE},
    border-radius 700ms ${MORPH_CURVE};
  will-change: width, height;
}
.astock-widget-layer {
  transition:
    opacity 220ms ease 110ms,
    transform 700ms ${MORPH_CURVE};
}
.astock-widget-dot-icon {
  transition: transform 700ms ${MORPH_CURVE};
}
@media (prefers-reduced-motion: reduce) {
  .astock-widget-shell,
  .astock-widget-layer,
  .astock-widget-dot-icon { transition: none; }
}`
      document.head.appendChild(style)
    }

    /* ------------------------------------------------------------------ *
     * Persisted state                                                     *
     * ------------------------------------------------------------------ */

    function readStoredJson(key) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null || raw === undefined) return undefined
        return JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    function writeStoredJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* private mode or quota: keep working without persistence */
      }
    }

    /**
     * Broadcast that the tracked list, range or shell mode changed so the
     * other half of this plugin (and any companion) syncs immediately.
     */
    function notifyAstockState() {
      try {
        window.dispatchEvent(new CustomEvent(SYNC_EVENT))
      } catch {
        /* CustomEvent unavailable: listeners fall back to polling */
      }
    }

    /** Accepted panel symbols: sh600519, sz000791, bj430047, hk00700, us105:aapl */
    const SYMBOL_PATTERN = /^(?:(?:sh|sz|bj)\d{6}|hk\d{4,6}|us\d{2,3}:[A-Za-z0-9._-]{1,12})$/

    function normalizeSymbols(input) {
      if (!Array.isArray(input)) return undefined
      const seen = new Set()
      const out = []
      for (const entry of input) {
        if (typeof entry !== 'string') continue
        const symbol = entry.trim().toLowerCase()
        if (!SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue
        seen.add(symbol)
        out.push(symbol)
        if (out.length >= MAX_SYMBOLS) break
      }
      return out
    }

    /** Turn free text like "600519" / "sh600519" into a panel symbol, or null. */
    function symbolFromText(text) {
      const match = /^(?:(sh|sz|bj))?(\d{6})$/i.exec(String(text || '').trim())
      if (!match) return null
      const code = match[2]
      const market = match[1] ? match[1].toLowerCase() : guessMarket(code)
      return market + code
    }

    function guessMarket(code) {
      if (/^[69]/.test(code)) return 'sh'
      if (/^[48]/.test(code)) return 'bj'
      return 'sz'
    }

    /** Row sub-line: A股/港股 show market+code, 美股 show the bare ticker. */
    function displaySymbol(symbol) {
      const text = String(symbol || '').toUpperCase()
      if (text.startsWith('US')) {
        const colon = text.indexOf(':')
        return colon >= 0 ? text.slice(colon + 1) : text
      }
      return text
    }

    /** shell mode with one-time migration from the retired widget bundle */
    function readShellMode() {
      const stored = readStoredJson(SHELL_STORAGE)
      if (stored === 'sidebar' || stored === 'floating') return stored
      // Users of the old standalone widget start docked-out.
      if (readStoredJson(LEGACY_WIDGET_KEYS.mode) !== undefined) return 'floating'
      return 'sidebar'
    }

    /* ------------------------------------------------------------------ *
     * Sparkline                                                           *
     * ------------------------------------------------------------------ */

    function Sparkline(props) {
      const values = Array.isArray(props.values) ? props.values : []
      const marks = Array.isArray(props.marks) ? props.marks : []
      const width = typeof props.width === 'number' ? props.width : 104
      const height = props.height || (width <= 90 ? 26 : 34)
      const base = typeof props.base === 'number' ? props.base : null
      const color = props.color

      if (values.length < 2) {
        return h('div', {
          style: {
            width,
            height,
            borderRadius: 6,
            border: BORDER,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: width <= 90 ? 9 : 10,
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, props.emptyLabel || '')
      }

      const series = base === null ? values : values.concat([base])
      let min = series[0]
      let max = series[0]
      for (const value of series) {
        if (value < min) min = value
        if (value > max) max = value
      }
      if (max - min < 1e-9) {
        max += 0.5
        min -= 0.5
      }
      const pad = width <= 90 ? 2.5 : 3
      const spanX = Math.max(values.length - 1, 1)
      const px = index => pad + (index * (width - pad * 2)) / spanX
      const py = value => pad + (1 - (value - min) / (max - min)) * (height - pad * 2)
      const points = values.map((value, index) => `${px(index).toFixed(2)},${py(value).toFixed(2)}`).join(' ')
      const lastIndex = values.length - 1
      const baselineY = base === null ? null : py(base)

      return h('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        'aria-hidden': true,
        style: { display: 'block', overflow: 'visible' },
      },
        baselineY === null ? null : h('line', {
          x1: pad,
          x2: width - pad,
          y1: baselineY,
          y2: baselineY,
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: 1,
          strokeDasharray: '3 3',
        }),
        marks.map(index => h('line', {
          key: `mark-${index}`,
          x1: px(index),
          x2: px(index),
          y1: pad,
          y2: height - pad,
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: 1,
          strokeDasharray: '2 3',
        })),
        h('polyline', {
          points,
          fill: 'none',
          stroke: color,
          strokeWidth: width <= 90 ? 1.4 : 1.5,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }),
        h('circle', {
          cx: px(lastIndex),
          cy: py(values[lastIndex]),
          r: width <= 90 ? 1.6 : 1.8,
          fill: color,
        }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Sidebar panel pieces                                                *
     * ------------------------------------------------------------------ */

    function TagPill(props) {
      return h('span', {
        style: {
          flexShrink: 0,
          height: 18,
          lineHeight: '18px',
          padding: '0 7px',
          borderRadius: 999,
          border: BORDER,
          fontSize: 10,
          color: 'var(--dsw-alias-label-secondary)',
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      }, props.label)
    }

    function QuoteRow(props) {
      const item = props.item
      const t = props.t
      const five = props.range === 'five'
      const values = five
        ? (Array.isArray(item.trend5) ? item.trend5 : [])
        : (Array.isArray(item.trend) ? item.trend : [])
      const base = five ? item.prevClose5 : item.prevClose
      const marks = five ? (Array.isArray(item.marks5) ? item.marks5 : []) : []

      // Numbers and colors follow the visible window: today's change for
      // 分时; last price vs. the pre-window baseline for 5日.
      let change = item.change
      let changePct = item.changePct
      if (five && values.length > 0 && typeof item.prevClose5 === 'number' && item.prevClose5 !== 0) {
        const last = values[values.length - 1]
        change = last - item.prevClose5
        changePct = (last / item.prevClose5 - 1) * 100
      }
      const tone = toneOf(changePct)

      return h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 132px 104px 26px',
          alignItems: 'center',
          gap: 12,
          padding: '13px 16px',
          border: BORDER,
          borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
        h('div', { style: { minWidth: 0 } },
          h('div', {
            style: {
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          }, item.name || item.code),
          h('div', {
            style: {
              marginTop: 3,
              fontSize: 11,
              letterSpacing: 0.3,
              color: 'var(--dsw-alias-label-secondary)',
              fontVariantNumeric: 'tabular-nums',
            },
          }, displaySymbol(item.symbol)),
        ),
        h('div', { style: { textAlign: 'right' } },
          h('div', {
            style: {
              fontSize: 18,
              fontWeight: 650,
              color: tone,
              fontVariantNumeric: 'tabular-nums',
            },
          }, formatPrice(item.price)),
          h('div', {
            style: {
              marginTop: 2,
              fontSize: 12,
              color: tone,
              fontVariantNumeric: 'tabular-nums',
            },
          }, `${arrowOf(changePct)} ${formatSigned(change, 2)}  ${formatSigned(changePct, 2, '%')}`),
        ),
        h(Sparkline, {
          values,
          base,
          marks,
          color: tone,
          emptyLabel: t('panel.noTrend'),
        }),
        h('button', {
          type: 'button',
          title: t('row.remove'),
          'aria-label': t('row.remove'),
          onClick: () => props.onRemove(item.symbol),
          onMouseEnter: event => {
            event.currentTarget.style.color = 'var(--dsw-alias-state-error-primary)'
            event.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2)'
          },
          onMouseLeave: event => {
            event.currentTarget.style.color = 'var(--dsw-alias-label-tertiary)'
            event.currentTarget.style.background = 'transparent'
          },
          style: {
            width: 24,
            height: 24,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--dsw-alias-label-tertiary)',
            fontSize: 13,
            lineHeight: '24px',
            textAlign: 'center',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'inherit',
          },
        }, '✕'),
      )
    }

    function SymbolSearch(props) {
      const t = props.t
      const [text, setText] = useState('')
      const [results, setResults] = useState(null)
      const [phase, setPhase] = useState('idle')
      const [highlight, setHighlight] = useState(0)
      const rootRef = useRef(null)

      useEffect(() => {
        const query = text.trim()
        if (query.length < 2) {
          setResults(null)
          setPhase('idle')
          return undefined
        }
        let cancelled = false
        setPhase('loading')
        const timer = setTimeout(async () => {
          try {
            const response = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (cancelled) return
            const rows = payload && Array.isArray(payload.results) ? payload.results : []
            setResults(rows)
            setHighlight(0)
            setPhase('done')
          } catch {
            if (!cancelled) {
              setResults(null)
              setPhase('error')
            }
          }
        }, 300)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [text])

      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onDown = event => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setResults(null)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [])

      const addFromSearch = useCallback(entry => {
        props.onAdd({ symbol: entry.symbol })
        setText('')
        setResults(null)
        setPhase('idle')
      }, [props])

      const onKeyDown = event => {
        const rows = Array.isArray(results) ? results : []
        if (event.key === 'Escape') {
          setResults(null)
          return
        }
        if (event.key === 'ArrowDown' && rows.length > 0) {
          event.preventDefault()
          setHighlight(index => (index + 1) % rows.length)
          return
        }
        if (event.key === 'ArrowUp' && rows.length > 0) {
          event.preventDefault()
          setHighlight(index => (index - 1 + rows.length) % rows.length)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (rows.length > 0) {
            addFromSearch(rows[Math.min(highlight, rows.length - 1)])
            return
          }
          const symbol = symbolFromText(text)
          if (symbol) {
            props.onAdd({ symbol })
            setText('')
            setResults(null)
            setPhase('idle')
          } else {
            props.onAdd({ invalid: text })
          }
        }
      }

      const rows = Array.isArray(results) ? results : []
      const showDropdown = phase === 'loading' || phase === 'error' || (phase === 'done' && text.trim().length >= 2)

      return h('div', { ref: rootRef, style: { position: 'relative', flexGrow: 1, minWidth: 220 } },
        h('input', {
          type: 'text',
          value: text,
          placeholder: t('search.placeholder'),
          onChange: event => setText(event.target.value),
          onKeyDown,
          style: {
            width: '100%',
            height: 30,
            padding: '0 12px',
            borderRadius: 8,
            border: BORDER,
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 12.5,
            fontFamily: 'inherit',
            outline: 'none',
          },
        }),
        showDropdown
          ? h('div', {
            style: {
              position: 'absolute',
              top: 34,
              left: 0,
              right: 0,
              zIndex: 40,
              borderRadius: 10,
              border: BORDER,
              background: 'var(--dsw-alias-bg-layer-2)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              maxHeight: 264,
              overflowY: 'auto',
              padding: 4,
            },
          },
            phase === 'loading' ? h('div', {
              style: { padding: '10px 12px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, t('search.searching')) : null,
            phase === 'error' ? h('div', {
              style: { padding: '10px 12px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
            }, t('search.failed')) : null,
            phase === 'done' && rows.length === 0 ? h('div', {
              style: { padding: '10px 12px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, t('search.none')) : null,
            rows.map((entry, index) => h('div', {
              key: entry.symbol,
              role: 'option',
              'aria-selected': index === highlight,
              onMouseEnter: () => setHighlight(index),
              onClick: () => addFromSearch(entry),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 7,
                cursor: 'pointer',
                fontSize: 12.5,
                background: index === highlight ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
              },
            },
              h('span', {
                style: {
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: 'var(--dsw-alias-label-primary)',
                  fontWeight: 500,
                },
              }, entry.name || entry.symbol),
              h('span', {
                style: {
                  marginLeft: 'auto',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 11.5,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, displaySymbol(entry.symbol)),
              h(TagPill, {
                label: t(`search.kind.${entry.kind === 'index' || entry.kind === 'hk' || entry.kind === 'us' ? entry.kind : 'stock'}`),
              }),
            )),
          )
          : null,
      )
    }

    function PanelButton(props) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        onClick: props.onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          height: 28,
          padding: '0 12px',
          borderRadius: 8,
          border: BORDER,
          background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
        },
      }, props.label)
    }

    function RangeToggle(props) {
      const options = [
        { key: 'intraday', labelKey: 'range.intraday' },
        { key: 'five', labelKey: 'range.five' },
      ]
      return h('div', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          height: 28,
          padding: 3,
          gap: 2,
          borderRadius: 9,
          border: BORDER,
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
        options.map(option => {
          const active = props.value === option.key
          return h('button', {
            key: option.key,
            type: 'button',
            onClick: () => props.onChange(option.key),
            style: {
              height: 22,
              padding: '0 10px',
              borderRadius: 6,
              border: 'none',
              background: active ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
              color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              fontSize: 11.5,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            },
          }, props.t(option.labelKey))
        }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Sidebar icon (with tear-off drag)                                   *
     * ------------------------------------------------------------------ */

    function TrendGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', { d: 'M3 20h18' }),
        h('path', { d: 'M6 16v-4' }),
        h('path', { d: 'M10 16V8' }),
        h('path', { d: 'M14 16v-6' }),
        h('path', { d: 'M18 16V5' }),
        h('path', { d: 'M4.5 8.5 9 5l3.5 2.5L20 3' }),
      )
    }

    /** Tear the panel off into the floating widget at a screen point. */
    function tearOffWidgetAt(x, y) {
      const point = clampPoint(x - BOX_CARD_W / 2, y - 24, BOX_CARD_W, 240)
      writeStoredJson(WIDGET_POS_STORAGE, point)
      writeStoredJson(WIDGET_MODE_STORAGE, 'expanded')
      writeStoredJson(SHELL_STORAGE, 'floating')
      notifyAstockState()
    }

    /**
     * Sidebar entry glyph. Click opens the panel (shell behavior); a
     * pointer drag out of the sidebar tears the panel off into the
     * floating widget, and a native drag onto the Plugin Island docks a
     * launcher chip there. Both drag paths work: whichever starts first
     * wins (a native drag cancels the pointer gesture).
     */
    function makeTearoffIcon(t) {
      return function SidebarIcon(props) {
        const size = typeof props.size === 'number' ? props.size : 20
        const payload = JSON.stringify({ from: 'palette', id: PANEL_ID })

        /** Pointer-based tear-off: the reliable path (same as the card). */
        const beginTearoff = event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          const handle = event.currentTarget
          const startX = event.clientX
          const startY = event.clientY
          let moved = false
          let last = null
          try {
            handle.setPointerCapture(event.pointerId)
          } catch {
            /* capture is best-effort */
          }
          const move = moveEvent => {
            if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 8) moved = true
            last = { x: moveEvent.clientX, y: moveEvent.clientY }
          }
          const finish = finishEvent => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', finish)
            handle.removeEventListener('pointercancel', finish)
            try {
              if (finishEvent && finishEvent.pointerId !== undefined) handle.releasePointerCapture(finishEvent.pointerId)
            } catch {
              /* already released */
            }
            if (!moved || !last) return
            if (islandRootAt(last.x, last.y)) return // native path / island owns it
            if (isOverSidebar(last.x, last.y)) return
            tearOffWidgetAt(last.x, last.y)
          }
          handle.addEventListener('pointermove', move)
          handle.addEventListener('pointerup', finish)
          handle.addEventListener('pointercancel', finish)
        }

        return h('div', {
          draggable: true,
          title: t('icon.tearoff'),
          style: { display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' },
          onPointerDown: beginTearoff,
          onDragStart(event) {
            event.dataTransfer.setData(ISLAND_MIME, payload)
            event.dataTransfer.setData('text/plain', payload)
            event.dataTransfer.effectAllowed = 'copyMove'
          },
          onDragEnd(event) {
            // Native drags fire pointercancel, so the pointer path above
            // stood down; handle this drop here instead.
            if (event.clientX === 0 && event.clientY === 0) return
            if (islandRootAt(event.clientX, event.clientY)) return // island docks a chip
            if (isOverSidebar(event.clientX, event.clientY)) return
            tearOffWidgetAt(event.clientX, event.clientY)
          },
        }, TrendGlyph({ size }))
      }
    }

    /* ------------------------------------------------------------------ *
     * Floating widget pieces                                              *
     * ------------------------------------------------------------------ */

    function TinyButton(props) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title: props.title || '',
        'aria-label': props.title || '',
        onClick: props.onClick,
        onPointerDown: event => event.stopPropagation(),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          minWidth: 28,
          width: 'auto',
          padding: '0 9px',
          height: 28,
          borderRadius: 9,
          border: 'none',
          background: hover ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
          color: hover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
          fontSize: props.fontSize || 15,
          fontWeight: props.bold ? 700 : 400,
          lineHeight: '28px',
          textAlign: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        },
      }, props.children || '')
    }

    function MiniRangeToggle(props) {
      return h('div', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          height: 28,
          padding: 2,
          gap: 2,
          borderRadius: 10,
          border: BORDER,
          background: 'var(--dsw-alias-bg-layer-1)',
          flexShrink: 0,
        },
        onPointerDown: event => event.stopPropagation(),
      },
        ['intraday', 'five'].map(key => {
          const active = props.value === key
          return h('button', {
            key,
            type: 'button',
            onClick: () => props.onChange(key),
            style: {
              height: 24,
              padding: '0 10px',
              borderRadius: 8,
              border: 'none',
              background: active ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
              color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            },
          }, props.t(key === 'intraday' ? 'range.intraday' : 'range.five'))
        }),
      )
    }

    function CollapseIconButton(props) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title: props.title,
        'aria-label': props.title,
        onPointerDown: event => {
          // Keep the header's drag handler from stealing the pointer;
          // this button owns the gesture: tap collapses, drag moves.
          event.stopPropagation()
          props.beginDrag(event, props.onToggle)
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          width: 40,
          height: 34,
          borderRadius: 10,
          border: hover ? '1px solid var(--dsw-alias-border-l2)' : '1px solid transparent',
          background: hover ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-1)',
          color: hover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          fontFamily: 'inherit',
          touchAction: 'none',
          transition: 'background 140ms ease, color 140ms ease',
        },
      }, TrendGlyph({ size: 20 }))
    }

    function WidgetRow(props) {
      const item = props.item
      const t = props.t
      const five = props.range === 'five'
      const values = five
        ? (Array.isArray(item.trend5) ? item.trend5 : [])
        : (Array.isArray(item.trend) ? item.trend : [])
      const base = five ? item.prevClose5 : item.prevClose
      const marks = five ? (Array.isArray(item.marks5) ? item.marks5 : []) : []

      let changePct = item.changePct
      if (five && values.length > 0 && typeof item.prevClose5 === 'number' && item.prevClose5 !== 0) {
        changePct = (values[values.length - 1] / item.prevClose5 - 1) * 100
      }
      const tone = toneOf(changePct)

      return h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 64px 84px',
          alignItems: 'center',
          gap: 8,
          height: 42,
          boxSizing: 'border-box',
          padding: '0 10px',
          borderTop: BORDER,
        },
      },
        h('div', { style: { minWidth: 0 } },
          h('div', {
            title: item.name || '',
            style: {
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          }, item.name || item.code),
          h('div', {
            style: {
              marginTop: 1,
              fontSize: 9.5,
              color: 'var(--dsw-alias-label-tertiary)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          }, displaySymbol(item.symbol)),
        ),
        h('div', { style: { textAlign: 'right', minWidth: 0 } },
          h('div', {
            style: { fontSize: 12.5, fontWeight: 650, color: tone, fontVariantNumeric: 'tabular-nums' },
          }, formatPrice(item.price)),
          h('div', {
            style: {
              marginTop: 1,
              fontSize: 10,
              color: tone,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            },
          }, `${arrowOf(changePct)} ${formatSigned(changePct, 2, '%')}`),
        ),
        h(Sparkline, {
          values,
          base,
          marks,
          color: tone,
          width: 84,
          emptyLabel: t('widget.noTrend'),
        }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Hooks                                                               *
     * ------------------------------------------------------------------ */

    function useLocale(ctx) {
      const locale = ctx.get('locale')
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setRevision(value => value + 1))
      }, [locale])
      let active = 'zh'
      try {
        if (locale && typeof locale.getSnapshot === 'function') active = locale.getSnapshot().active
      } catch {
        active = 'zh'
      }
      return key => translate(active, key)
    }

    function useQuotes(symbolsKey) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: null })
      const [nonce, setNonce] = useState(0)
      const delayRef = useRef(REFRESH_MS)

      useEffect(() => {
        if (symbolsKey === '') {
          setState({ phase: 'ready', data: { items: [], symbols: [] }, error: null })
          return undefined
        }

        let alive = true
        let timer = undefined
        let controller = null

        const load = async () => {
          if (controller) {
            try { controller.abort() } catch { /* ignore */ }
          }
          const next = typeof AbortController === 'function' ? new AbortController() : null
          controller = next
          try {
            const url = symbolsKey === null
              ? ENDPOINT
              : `${ENDPOINT}?symbols=${encodeURIComponent(symbolsKey)}`
            const response = await fetch(url, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
              signal: next ? next.signal : undefined,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (!alive) return
            const configured = payload && Number(payload.refreshMs)
            if (Number.isFinite(configured) && configured >= 2000) {
              delayRef.current = Math.min(Math.round(configured), 60000)
            }
            setState({ phase: 'ready', data: payload, error: null })
          } catch (error) {
            if (!alive) return
            if (error && error.name === 'AbortError') return
            const message = error && error.message ? error.message : String(error)
            setState(previous => ({
              phase: previous.data ? 'stale' : 'error',
              data: previous.data,
              error: message,
            }))
          }
        }

        const schedule = delay => {
          if (!alive) return
          timer = setTimeout(tick, delay)
        }

        const tick = () => {
          if (typeof document !== 'undefined' && document.hidden) {
            schedule(delayRef.current)
            return
          }
          load().then(() => schedule(delayRef.current))
        }

        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
          if (controller) {
            try { controller.abort() } catch { /* ignore */ }
          }
        }
      }, [symbolsKey, nonce])

      return { state, reload: () => setNonce(value => value + 1) }
    }

    /**
     * Live view over the shared localStorage keys (symbols, range, shell
     * mode) for read-only consumers like the floating widget: reacts to
     * the same-page sync event, cross-window storage events, focus, and
     * a slow poll as a safety net.
     */
    function useSharedState() {
      const [, setTick] = useState(0)
      const rawRef = useRef(undefined)

      const readRaw = () => {
        try {
          return [
            window.localStorage.getItem(SYMBOLS_STORAGE),
            window.localStorage.getItem(RANGE_STORAGE),
            window.localStorage.getItem(SHELL_STORAGE),
          ].join('|')
        } catch {
          return '||'
        }
      }

      useEffect(() => {
        const check = () => {
          const raw = readRaw()
          if (raw !== rawRef.current) {
            rawRef.current = raw
            setTick(value => value + 1)
          }
        }
        rawRef.current = readRaw()
        window.addEventListener(SYNC_EVENT, check)
        window.addEventListener('storage', check)
        window.addEventListener('focus', check)
        const timer = setInterval(check, 1000)
        return () => {
          window.removeEventListener(SYNC_EVENT, check)
          window.removeEventListener('storage', check)
          window.removeEventListener('focus', check)
          clearInterval(timer)
        }
      }, [])

      return {
        symbols: normalizeSymbols(readStoredJson(SYMBOLS_STORAGE)) ?? null,
        range: readStoredJson(RANGE_STORAGE) === 'five' ? 'five' : 'intraday',
        shell: readShellMode(),
      }
    }

    /* ------------------------------------------------------------------ *
     * Floating widget (morphing shell)                                    *
     * ------------------------------------------------------------------ */

    function widgetInitialMode() {
      const stored = readStoredJson(WIDGET_MODE_STORAGE)
      if (stored === 'hidden' || stored === 'expanded') return stored
      const legacy = readStoredJson(LEGACY_WIDGET_KEYS.mode)
      if (legacy === 'hidden' || legacy === 'collapsed') return 'hidden'
      if (legacy === 'expanded') return 'expanded'
      return 'expanded'
    }

    function widgetInitialPos() {
      const stored = readStoredJson(WIDGET_POS_STORAGE)
      if (stored && typeof stored.x === 'number' && typeof stored.y === 'number') return stored
      const legacy = readStoredJson(LEGACY_WIDGET_KEYS.pos)
      if (legacy && typeof legacy.x === 'number' && typeof legacy.y === 'number') return legacy
      return {
        x: Math.max(8, (typeof window === 'undefined' ? 1200 : window.innerWidth) - 340),
        y: Math.max(8, (typeof window === 'undefined' ? 800 : window.innerHeight) - 280),
      }
    }

    function makeWidget(ctx) {
      return function Widget() {
        const translateNow = useLocale(ctx)
        const shared = useSharedState()
        const [mode, setMode] = useState(widgetInitialMode)
        const [notice, setNotice] = useState('')
        const shellRef = useRef(null)
        const sizerRef = useRef(null)
        const [contentHeight, setContentHeight] = useState(320)
        const [pos, setPos] = useState(widgetInitialPos)

        useEffect(() => {
          ensureAnimationStyles()
        }, [])

        // Dragging our chip out of the Plugin Island re-floats the widget
        // at the drop point (the island broadcasts the eject with coords).
        useEffect(() => {
          const onIslandEject = event => {
            const detail = event && event.detail
            if (!detail || detail.id !== PANEL_ID) return
            tearOffWidgetAt(detail.x, detail.y)
          }
          window.addEventListener('plugin-island:eject', onIslandEject)
          return () => window.removeEventListener('plugin-island:eject', onIslandEject)
        }, [])

        // A fresh spawn (sidebar → floating) adopts the persisted spawn
        // point and mode, so tear-off places the card exactly where the
        // icon was dropped.
        const prevShellRef = useRef(shared.shell)
        useEffect(() => {
          if (prevShellRef.current !== 'floating' && shared.shell === 'floating') {
            const storedPos = readStoredJson(WIDGET_POS_STORAGE)
            if (storedPos && typeof storedPos.x === 'number' && typeof storedPos.y === 'number') {
              setPos(storedPos)
            }
            const storedMode = readStoredJson(WIDGET_MODE_STORAGE)
            if (storedMode === 'hidden' || storedMode === 'expanded') setMode(storedMode)
          }
          prevShellRef.current = shared.shell
        }, [shared.shell])

        const dockToSidebar = useCallback(() => {
          writeStoredJson(SHELL_STORAGE, 'sidebar')
          notifyAstockState()
        }, [])

        // Hidden presentation: render nothing at all.
        if (shared.shell !== 'floating') return null

        return h(WidgetBody, {
          translateNow,
          shared,
          mode,
          setMode,
          shellRef,
          sizerRef,
          contentHeight,
          setContentHeight,
          pos,
          setPos,
          notice,
          setNotice,
          dockToSidebar,
          selectPanel(id) {
            try {
              if (ctx.layout && typeof ctx.layout.selectPanel === 'function') ctx.layout.selectPanel(id)
            } catch { /* unknown panel id */ }
          },
        })
      }
    }

    function WidgetBody(props) {
      const {
        translateNow: t,
        shared,
        mode,
        setMode,
        shellRef,
        sizerRef,
        contentHeight,
        setContentHeight,
        pos,
        setPos,
        dockToSidebar,
        selectPanel,
      } = props

      // Track the natural card height so the shell can morph its height.
      // offsetHeight is layout-based: unlike getBoundingClientRect it is
      // NOT affected by the layer's scale() while collapsed.
      useEffect(() => {
        const el = sizerRef.current
        if (!el) return undefined
        const measure = () => setContentHeight(previous => {
          const next = el.offsetHeight
          return Number.isFinite(next) && Math.abs(next - previous) >= 1 ? next : previous
        })
        measure()
        if (typeof ResizeObserver === 'undefined') {
          const timer = setInterval(measure, 500)
          return () => clearInterval(timer)
        }
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
      }, [])

      // Belt and braces: re-measure after the expand morph settles.
      useEffect(() => {
        if (mode !== 'expanded') return undefined
        const timer = setTimeout(() => {
          const el = sizerRef.current
          if (el) setContentHeight(previous => {
            const next = el.offsetHeight
            return Number.isFinite(next) && Math.abs(next - previous) >= 1 ? next : previous
          })
        }, 760)
        return () => clearTimeout(timer)
      }, [mode])

      const symbolsKey = shared.symbols === null ? null : shared.symbols.join(',')
      const { state, reload } = useQuotes(symbolsKey)
      const data = state.data
      const items = data && Array.isArray(data.items) ? data.items : []
      const updated = data ? formatClock(data.updatedAt) : ''

      // Keep the shell inside the viewport when the window shrinks.
      useEffect(() => {
        const clamp = () => {
          setPos(current => {
            const shell = shellRef.current
            const width = shell ? shell.offsetWidth : BOX_CARD_W
            const height = shell ? shell.offsetHeight : 120
            const next = clampPoint(current.x, current.y, width, height)
            if (next.x === current.x && next.y === current.y) return current
            return next
          })
        }
        window.addEventListener('resize', clamp)
        return () => window.removeEventListener('resize', clamp)
      }, [])

      const setWidgetMode = next => {
        setMode(next)
        writeStoredJson(WIDGET_MODE_STORAGE, next)
      }

      /**
       * Pointer drag on the card header: moves the shell; releasing over
       * the sidebar docks it back; a barely-moved pointer is a tap.
       */
      const beginDrag = (event, onTap) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const shell = shellRef.current
        if (!shell) return
        const handle = event.currentTarget
        const rect = shell.getBoundingClientRect()
        const offsetX = event.clientX - rect.left
        const offsetY = event.clientY - rect.top
        const startX = event.clientX
        const startY = event.clientY
        let moved = false
        let last = { x: rect.left, y: rect.top }
        try {
          handle.setPointerCapture(event.pointerId)
        } catch {
          /* capture is best-effort */
        }
        document.body.style.userSelect = 'none'
        const move = moveEvent => {
          if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 4) moved = true
          const point = clampPoint(
            moveEvent.clientX - offsetX,
            moveEvent.clientY - offsetY,
            shell.offsetWidth,
            shell.offsetHeight,
          )
          last = point
          setPos(point)
        }
        const finish = finishEvent => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', finish)
          handle.removeEventListener('pointercancel', finish)
          try {
            if (finishEvent && finishEvent.pointerId !== undefined) handle.releasePointerCapture(finishEvent.pointerId)
          } catch {
            /* already released */
          }
          document.body.style.userSelect = ''
          writeStoredJson(WIDGET_POS_STORAGE, last)
          if (moved && isOverSidebar(finishEvent.clientX, finishEvent.clientY)) {
            dockToSidebar()
            return
          }
          if (!moved && onTap) onTap()
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', finish)
        handle.addEventListener('pointercancel', finish)
      }

      const changeRange = next => {
        writeStoredJson(RANGE_STORAGE, next)
        notifyAstockState()
      }

      const box = mode === 'hidden'
        ? BOX_DOT
        : { w: BOX_CARD_W, h: Math.max(contentHeight, 64), r: BOX_CARD_R }

      const layerStyle = active => ({
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: active ? 1 : 0,
        transform: active ? 'scale(1)' : 'scale(0.85)',
        transformOrigin: 'top left',
        pointerEvents: active ? 'auto' : 'none',
      })

      const islandPayload = JSON.stringify({ from: 'palette', id: PANEL_ID })

      /** Dot: native drag so the Plugin Island (HTML5 DnD) can receive it. */
      const dotDragStart = event => {
        event.dataTransfer.setData(ISLAND_MIME, islandPayload)
        event.dataTransfer.setData('text/plain', islandPayload)
        event.dataTransfer.effectAllowed = 'copyMove'
      }
      const dotDragEnd = event => {
        if (event.clientX === 0 && event.clientY === 0) return
        const x = event.clientX
        const y = event.clientY
        if (islandRootAt(x, y)) {
          // Dropped onto the Plugin Island: the island docks its launcher
          // chip, so the standalone ball folds away (the sidebar entry and
          // the island chip both reopen the panel).
          dockToSidebar()
          return
        }
        if (isOverSidebar(x, y)) {
          dockToSidebar()
          return
        }
        const point = clampPoint(x - BOX_DOT.w / 2, y - BOX_DOT.h / 2, BOX_DOT.w, BOX_DOT.h)
        setPos(point)
        writeStoredJson(WIDGET_POS_STORAGE, point)
      }

      const headerChildren = [
        h(CollapseIconButton, {
          title: t('widget.collapse'),
          onToggle: () => setWidgetMode('hidden'),
          beginDrag,
        }),
      ]
      if (mode === 'expanded') {
        headerChildren.push(
          h('span', { style: { flex: 1 } }),
          h(MiniRangeToggle, { value: shared.range, onChange: changeRange, t }),
        )
      }

      return h('div', {
        ref: shellRef,
        className: 'astock-widget-shell',
        style: {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: box.w,
          height: box.h,
          borderRadius: box.r,
          border: BORDER,
          background: 'var(--dsw-alias-bg-layer-2)',
          boxShadow: '0 10px 32px rgba(0,0,0,0.24)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          zIndex: 5,
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 12,
        },
      },
        // --- card layer -------------------------------------------------
        h('div', {
          className: 'astock-widget-layer',
          style: layerStyle(mode === 'expanded'),
        },
          h('div', {
            ref: sizerRef,
            style: {
              width: BOX_CARD_W,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 64,
            },
          },
            h('div', {
              onPointerDown: event => beginDrag(event),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                background: 'var(--dsw-alias-bg-layer-3)',
                cursor: 'grab',
                touchAction: 'none',
                userSelect: 'none',
              },
            }, headerChildren),

            state.phase === 'loading'
              ? h('div', {
                style: {
                  padding: '12px 14px',
                  fontSize: 11,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, t('widget.loading'))
              : null,

            state.phase === 'error'
              ? h('div', {
                style: { padding: '10px 14px', borderTop: BORDER },
              },
                h('div', {
                  style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' },
                }, t('widget.error')),
                h(TinyButton, {
                  title: t('widget.retry'),
                  fontSize: 11,
                  onClick: reload,
                }, t('widget.retry')),
              )
              : null,

            items.length === 0 && state.phase !== 'loading' && state.phase !== 'error'
              ? h('div', {
                style: {
                  padding: '12px 14px',
                  fontSize: 11,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, t('widget.empty'))
              : null,

            h('div', {
              style: {
                // Exactly 6 rows (row height 42); longer lists scroll.
                maxHeight: 252,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              },
            },
              items.map(item => h(WidgetRow, {
                key: item.symbol || item.code,
                item,
                t,
                range: shared.range,
              })),
            ),

            state.phase === 'stale'
              ? h('div', {
                style: {
                  padding: '3px 14px',
                  fontSize: 9.5,
                  color: 'var(--dsw-alias-state-warn-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              }, `${t('widget.updated')} ${updated} · ${state.error || ''}`)
              : null,

            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '5px 12px 6px',
                borderTop: BORDER,
                fontSize: 10.5,
                color: 'var(--dsw-alias-label-secondary)',
                fontVariantNumeric: 'tabular-nums',
              },
            },
              h('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                },
              },
                h('span', {
                  style: {
                    flexShrink: 0,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--dsw-alias-state-idle-primary)',
                  },
                }),
                h('span', {
                  style: {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 600,
                    color: 'var(--dsw-alias-label-primary)',
                  },
                }, updated ? `${t('widget.updated')} ${updated}` : '—'),
                h('span', { style: { flexShrink: 0 } }, '· 8s'),
              ),
              h(TinyButton, {
                title: t('widget.refresh'),
                fontSize: 11,
                onClick: reload,
              }, t('widget.refresh')),
            ),
          ),
        ),

        // --- dot layer (native drag → move / dock / Plugin Island) --------
        h('div', {
          className: 'astock-widget-layer',
          style: {
            ...layerStyle(mode === 'hidden'),
            width: BOX_DOT.w,
            height: BOX_DOT.h,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'grab',
            touchAction: 'none',
            userSelect: 'none',
          },
          title: t('widget.tapToExpand'),
          draggable: mode === 'hidden',
          onDragStart: dotDragStart,
          onDragEnd: dotDragEnd,
          onClick: () => setWidgetMode('expanded'),
        },
          h('span', {
            className: 'astock-widget-dot-icon',
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: mode === 'hidden' ? 'scale(1)' : 'scale(0.45)',
            },
          }, TrendGlyph({ size: 22 })),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Sidebar panel                                                       *
     * ------------------------------------------------------------------ */

    function makePanel(ctx) {
      return function Panel() {
        const translateNow = useLocale(ctx)
        const [symbols, setSymbols] = useState(() => normalizeSymbols(readStoredJson(SYMBOLS_STORAGE)) ?? null)
        const [range, setRange] = useState(() => (readStoredJson(RANGE_STORAGE) === 'five' ? 'five' : 'intraday'))
        const [notice, setNotice] = useState('')
        const symbolsKey = symbols === null ? null : symbols.join(',')
        const { state, reload } = useQuotes(symbolsKey)
        const data = state.data
        const items = data && Array.isArray(data.items) ? data.items : []
        const phase = marketPhase()
        const updated = data ? formatClock(data.updatedAt) : ''

        // First load without stored list: adopt the configured list.
        useEffect(() => {
          if (symbols === null && data && Array.isArray(data.symbols) && data.symbols.length > 0) {
            const adopted = normalizeSymbols(data.symbols)
            if (adopted && adopted.length > 0) {
              setSymbols(adopted)
              writeStoredJson(SYMBOLS_STORAGE, adopted)
              notifyAstockState()
            }
          }
        }, [symbols, data])

        useEffect(() => {
          if (notice === '') return undefined
          const timer = setTimeout(() => setNotice(''), 2600)
          return () => clearTimeout(timer)
        }, [notice])

        const changeRange = next => {
          setRange(next)
          writeStoredJson(RANGE_STORAGE, next)
          notifyAstockState()
        }

        const addSymbol = entry => {
          if (entry && entry.invalid !== undefined) {
            setNotice(translateNow('panel.badSymbol'))
            return
          }
          const symbol = entry && typeof entry.symbol === 'string' ? entry.symbol.toLowerCase() : ''
          if (!SYMBOL_PATTERN.test(symbol)) {
            setNotice(translateNow('panel.badSymbol'))
            return
          }
          const list = symbols === null ? [] : symbols.slice()
          if (list.indexOf(symbol) >= 0) {
            setNotice(translateNow('panel.dup'))
            return
          }
          if (list.length >= MAX_SYMBOLS) {
            setNotice(translateNow('panel.limit'))
            return
          }
          list.push(symbol)
          writeStoredJson(SYMBOLS_STORAGE, list)
          setSymbols(list)
          notifyAstockState()
        }

        const removeSymbol = symbol => {
          if (symbols === null) return
          const target = String(symbol || '').toLowerCase()
          const list = symbols.filter(entry => entry !== target)
          writeStoredJson(SYMBOLS_STORAGE, list)
          setSymbols(list)
          notifyAstockState()
        }

        const subtitle = updated
          ? `${translateNow('panel.subtitle')} · ${translateNow('panel.updated')} ${updated}`
          : translateNow('panel.subtitle')

        return h('div', {
          style: {
            height: '100%',
            overflowY: 'auto',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          },
        },
          h('div', { style: { maxWidth: 880, margin: '0 auto', padding: '28px 28px 48px' } },
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 14,
              },
            },
              h('div', { style: { minWidth: 0 } },
                h('div', { style: { fontSize: 20, fontWeight: 650, letterSpacing: 0.2 } },
                  translateNow('panel.title')),
                h('div', {
                  style: {
                    marginTop: 6,
                    fontSize: 12,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                }, subtitle),
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
                h(RangeToggle, { value: range, onChange: changeRange, t: translateNow }),
                h('span', {
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: BORDER,
                    fontSize: 11,
                    color: phase === 'open'
                      ? 'var(--dsw-alias-brand-primary)'
                      : 'var(--dsw-alias-label-secondary)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                  },
                },
                  h('span', {
                    style: {
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: phase === 'open'
                        ? 'var(--dsw-alias-brand-primary)'
                        : 'var(--dsw-alias-state-idle-primary)',
                    },
                  }),
                  phase === 'open'
                    ? translateNow('panel.market.open')
                    : translateNow('panel.market.closed'),
                ),
                h(PanelButton, { label: translateNow('panel.refresh'), onClick: reload }),
              ),
            ),

            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14,
              },
            },
              h(SymbolSearch, { t: translateNow, onAdd: addSymbol }),
              notice ? h('span', {
                style: {
                  flexShrink: 1,
                  minWidth: 0,
                  fontSize: 11,
                  color: 'var(--dsw-alias-state-warn-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              }, notice) : null,
            ),

            state.phase === 'loading'
              ? h('div', {
                style: {
                  padding: '18px 16px',
                  borderRadius: 12,
                  border: BORDER,
                  background: 'var(--dsw-alias-bg-layer-1)',
                  fontSize: 13,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, translateNow('panel.loading'))
              : null,

            state.phase === 'error'
              ? h('div', {
                style: {
                  padding: '18px 16px',
                  borderRadius: 12,
                  border: BORDER,
                  background: 'var(--dsw-alias-bg-layer-1)',
                },
              },
                h('div', {
                  style: {
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--dsw-alias-state-error-primary)',
                  },
                }, translateNow('panel.error')),
                h('div', {
                  style: {
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--dsw-alias-label-secondary)',
                    wordBreak: 'break-all',
                  },
                }, state.error || ''),
                h('div', { style: { marginTop: 10 } },
                  h(PanelButton, { label: translateNow('panel.retry'), onClick: reload })),
              )
              : null,

            items.length === 0 && state.phase !== 'loading' && state.phase !== 'error'
              ? h('div', {
                style: {
                  padding: '18px 16px',
                  borderRadius: 12,
                  border: BORDER,
                  background: 'var(--dsw-alias-bg-layer-1)',
                  fontSize: 13,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              }, translateNow('panel.empty'))
              : null,

            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              items.map(item => h(QuoteRow, {
                key: item.symbol || item.code,
                item,
                t: translateNow,
                range,
                onRemove: removeSymbol,
              })),
            ),

            state.phase === 'stale'
              ? h('div', {
                style: {
                  marginTop: 12,
                  fontSize: 11,
                  color: 'var(--dsw-alias-state-warn-primary)',
                },
              }, `${translateNow('panel.stale')} ${updated} · ${state.error || ''}`)
              : null,

            h('div', {
              style: {
                marginTop: 18,
                fontSize: 11,
                color: 'var(--dsw-alias-label-secondary)',
              },
            }, translateNow('panel.footer')),
          ),
        )
      }
    }

    function isEnglishCurrent(locale) {
      try {
        if (locale && typeof locale.getSnapshot === 'function') return isEnglish(locale.getSnapshot().active)
      } catch {
        return false
      }
      return false
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const navLabel = () => translate(isEnglishCurrent(locale) ? 'en' : 'zh', 'nav.label')
        if (locale && typeof locale.register === 'function') {
          for (const id of ['zh', 'zh-CN']) {
            ctx.effect(() => locale.register(NS, id, ZH), `astock-quotes: ${id} dictionary`)
          }
          for (const id of ['en', 'en-US']) {
            ctx.effect(() => locale.register(NS, id, EN), `astock-quotes: ${id} dictionary`)
          }
        }

        const Panel = makePanel(ctx)
        const Widget = makeWidget(ctx)
        const SidebarIcon = makeTearoffIcon(key => translate(isEnglishCurrent(locale) ? 'en' : 'zh', key))

        ctx.slots.inject('sidebar.panellist', () => {
          // `islandStandalone` tells the Plugin Island this panel supports
          // tear-off (drag out of the island into a floating widget); the
          // extra key is optional, so fall back to a plain registration.
          try {
            return ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: navLabel,
              islandStandalone: true,
            }, SidebarIcon)
          } catch {
            return ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: navLabel,
            }, SidebarIcon)
          }
        })

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: WIDGET_ID,
          order: 20,
          label: () => translate(isEnglishCurrent(locale) ? 'en' : 'zh', 'widget.label'),
        }, Widget))
      },
    }
  },
})

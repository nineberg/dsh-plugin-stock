/**
 * Host half of the symbol-trends bundle.
 *
 * Registers two same-origin JSON endpoints that the Client panel polls:
 *
 *   GET /astock/quotes?symbols=sh600522,sz000791
 *   -> { updatedAt, refreshMs, symbols: [...], items: [{ code, symbol, name,
 *        secid, price, prevClose, open, high, low, change, changePct,
 *        volume, amount, quoteTime, trend, prevClose5, trend5, marks5 }] }
 *
 *     `symbols` (optional) overrides the configured list for this request;
 *     the panel persists its own list in localStorage and sends it here.
 *     `trend` is today's intraday minute series, `trend5` the last five
 *     sessions concatenated (marks5 = indices where a new session starts,
 *     prevClose5 = close before that window).
 *
 *   GET /astock/search?q=600522
 *   -> { updatedAt, results: [{ code, name, market, symbol, secid, kind }] }
 *
 * Upstream data: Eastmoney public quote endpoints (no key required).
 * The browser never talks to Eastmoney directly, so no CORS handling and
 * no third-party origin is needed.
 */

const DEFAULT_SYMBOLS = ['sh600522', 'sh688825', 'sh600206', 'sz000791', 'sh000001']
const DEFAULT_REFRESH_MS = 8000
const MAX_PANEL_SYMBOLS = 30

const QUOTE_FIELDS = 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f124'
const QUOTE_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const TREND_ENDPOINT = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get'
const SUGGEST_ENDPOINT = 'https://searchapi.eastmoney.com/api/suggest/get'

const UPSTREAM_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  referer: 'https://quote.eastmoney.com/',
  accept: 'application/json,text/plain,*/*',
}

/** Quote cache holds each upstream answer for a few seconds across panel polls. */
const QUOTE_TTL_MS = 3000
/** Intraday minute bars change once a minute, so they are refreshed lazily. */
const TREND_TTL_MS = 60000
/** Five-session series move slowly outside the last session; refresh less often. */
const TREND5_TTL_MS = 180000
/** Search suggestions are static reference data; a short TTL is plenty. */
const SEARCH_TTL_MS = 60000

function guessMarket(code) {
  if (/^[69]/.test(code)) return 'sh'
  if (/^[48]/.test(code)) return 'bj'
  return 'sz'
}

/**
 * Panel symbol formats (also the localStorage / query-param alphabet):
 *   A股  sh600519 / sz000791 / bj430047      -> secid 1.600519 / 0.000791 / 0.430047
 *   港股 hk00700                             -> secid 116.00700
 *   美股 us105:AAPL                          -> secid 105.AAPL (number = Eastmoney US board)
 */
function parseSymbol(input) {
  if (typeof input === 'string') {
    const text = input.trim()
    const cn = /^(?:(sh|sz|bj))?(\d{6})$/i.exec(text)
    if (cn) {
      const code = cn[2]
      const market = cn[1] ? cn[1].toLowerCase() : guessMarket(code)
      return { code, market, symbol: market + code, secid: `${market === 'sh' ? '1' : '0'}.${code}` }
    }
    const hk = /^hk(\d{4,6})$/i.exec(text)
    if (hk) {
      const code = hk[1].padStart(5, '0')
      return { code, market: 'hk', symbol: 'hk' + code, secid: `116.${code}` }
    }
    const us = /^us(\d{2,3}):([A-Za-z0-9._-]+)$/i.exec(text)
    if (us) {
      const board = us[1]
      const ticker = us[2].toUpperCase()
      // The panel symbol is lowercase everywhere (localStorage, query
      // params, item payloads) so add/remove comparisons always match;
      // the secid keeps the ticker case the upstream API expects.
      return { code: ticker, market: 'us', symbol: `us${board}:${ticker.toLowerCase()}`, secid: `${board}.${ticker}` }
    }
    return undefined
  }
  if (input && typeof input === 'object') {
    return parseSymbol(
      typeof input.symbol === 'string' ? input.symbol : String(input.code ?? input.secid ?? ''),
    )
  }
  return undefined
}

function resolveSymbols(config) {
  const configured = config && Array.isArray(config.symbols) ? config.symbols : DEFAULT_SYMBOLS
  const seen = new Set()
  const out = []
  for (const entry of configured) {
    const parsed = parseSymbol(entry)
    if (!parsed || seen.has(parsed.symbol)) continue
    seen.add(parsed.symbol)
    out.push(parsed)
  }
  return out.length > 0 ? out : DEFAULT_SYMBOLS.map(parseSymbol)
}

/** Parse a `?symbols=` query value into a validated, de-duplicated spec list. */
function resolveQuerySymbols(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const seen = new Set()
  const out = []
  for (const part of raw.split(',')) {
    if (out.length >= MAX_PANEL_SYMBOLS) break
    const parsed = parseSymbol(part)
    if (!parsed || seen.has(parsed.symbol)) continue
    seen.add(parsed.symbol)
    out.push(parsed)
  }
  return out.length > 0 ? out : undefined
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '' && value !== '-') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchJson(url, timeoutMs) {
  if (typeof globalThis.fetch !== 'function') throw new Error('global fetch is unavailable on this Host')
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  try {
    const response = await globalThis.fetch(url, {
      headers: UPSTREAM_HEADERS,
      signal: controller && controller.signal,
    })
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`)
    return await response.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Parse a trends2 row array into the minute-price series plus the indices
 * where a new trading session starts (used to draw day separators).
 *
 * Sessions are detected by a >3h gap between consecutive rows, not by the
 * calendar date: US sessions span Beijing midnight (21:30 -> 04:00), so a
 * date change alone would split one session in half. A-share and HK lunch
 * breaks (<=91 min) stay inside one session.
 */
const SESSION_GAP_MS = 3 * 60 * 60 * 1000

function parseTrendSeries(trends) {
  if (!Array.isArray(trends)) return { values: [], marks: [] }
  const values = []
  const marks = []
  let lastTime = NaN
  for (const row of trends) {
    if (typeof row !== 'string') continue
    const comma = row.lastIndexOf(',')
    if (comma < 0) continue
    const value = toNumber(row.slice(comma + 1))
    if (value === null) continue
    const stamp = Date.parse(`${row.slice(0, 16).replace(' ', 'T')}:00Z`)
    if (Number.isFinite(stamp) && Number.isFinite(lastTime) && stamp - lastTime > SESSION_GAP_MS) {
      marks.push(values.length)
    }
    if (Number.isFinite(stamp)) lastTime = stamp
    values.push(value)
  }
  return { values, marks }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function apply(ctx, config) {
  const configuredSymbols = resolveSymbols(config)
  const configuredRefresh = config && Number(config.refreshMs)
  const refreshMs = Number.isFinite(configuredRefresh) && configuredRefresh >= 2000
    ? Math.round(configuredRefresh)
    : DEFAULT_REFRESH_MS

  /** One cache entry per secid list, because the panel list is user-editable. */
  const quoteCaches = new Map()
  const trendCaches = new Map()
  const searchCache = { at: 0, key: null, rows: [] }

  async function loadQuotes(symbols) {
    const now = Date.now()
    const key = symbols.map(s => s.secid).join(',')
    const cached = quoteCaches.get(key)
    if (cached && now - cached.at < QUOTE_TTL_MS) return cached.value
    const url =
      `${QUOTE_ENDPOINT}?fltt=2&invt=2&secids=${encodeURIComponent(key)}` +
      `&fields=${QUOTE_FIELDS}&_=${now}`
    const body = await fetchJson(url, 8000)
    const rows = body && body.data && Array.isArray(body.data.diff) ? body.data.diff : []
    const byCode = new Map(rows.map(row => [String(row.f12), row]))
    const value = symbols.map(spec => {
      const row = byCode.get(spec.code)
      if (!row) return { spec, row: null }
      return {
        spec,
        row: {
          name: typeof row.f14 === 'string' ? row.f14 : '',
          price: toNumber(row.f2),
          changePct: toNumber(row.f3),
          change: toNumber(row.f4),
          volume: toNumber(row.f5),
          amount: toNumber(row.f6),
          high: toNumber(row.f15),
          low: toNumber(row.f16),
          open: toNumber(row.f17),
          prevClose: toNumber(row.f18),
          quoteTime: toNumber(row.f124),
        },
      }
    })
    if (quoteCaches.size > 16) quoteCaches.clear()
    quoteCaches.set(key, { at: now, value })
    return value
  }

  async function loadTrend(spec, ndays) {
    const cacheKey = `${ndays}|${spec.secid}`
    const ttl = ndays >= 5 ? TREND5_TTL_MS : TREND_TTL_MS
    const cached = trendCaches.get(cacheKey)
    const now = Date.now()
    if (cached && now - cached.at < ttl) return cached
    const url =
      `${TREND_ENDPOINT}?fltt=2&invt=2&secid=${encodeURIComponent(spec.secid)}` +
      `&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53&iscr=0&ndays=${ndays}&_=${now}`
    try {
      const body = await fetchJson(url, 8000)
      const data = body && body.data
      const series = parseTrendSeries(data && data.trends)
      const entry = {
        at: now,
        trend: series.values,
        marks: series.marks,
        prevClose: data ? toNumber(data.preClose) : null,
      }
      if (trendCaches.size > 128) trendCaches.clear()
      trendCaches.set(cacheKey, entry)
      return entry
    } catch {
      return cached || { at: now, trend: [], marks: [], prevClose: null }
    }
  }

  async function snapshot(symbols) {
    const quotes = await loadQuotes(symbols)
    const trends = await Promise.all(
      quotes.flatMap(entry => [loadTrend(entry.spec, 1), loadTrend(entry.spec, 5)]),
    )
    const items = quotes.map((entry, index) => {
      const today = trends[index * 2] || { trend: [], marks: [], prevClose: null }
      const five = trends[index * 2 + 1] || { trend: [], marks: [], prevClose: null }
      const row = entry.row
      // trends2 preClose is the latest session's previous close; for the
      // 5-day window the baseline is the first price of the window itself.
      const prevClose5 = five.trend.length > 0 ? five.trend[0] : five.prevClose
      return {
        code: entry.spec.code,
        symbol: entry.spec.symbol,
        secid: entry.spec.secid,
        name: (row && row.name) || entry.spec.symbol.toUpperCase(),
        price: row ? row.price : null,
        prevClose: row && row.prevClose !== null ? row.prevClose : today.prevClose,
        open: row ? row.open : null,
        high: row ? row.high : null,
        low: row ? row.low : null,
        change: row ? row.change : null,
        changePct: row ? row.changePct : null,
        volume: row ? row.volume : null,
        amount: row ? row.amount : null,
        quoteTime: row ? row.quoteTime : null,
        trend: today.trend,
        prevClose5,
        trend5: five.trend,
        marks5: five.marks,
      }
    })
    return {
      updatedAt: new Date().toISOString(),
      refreshMs,
      source: 'eastmoney',
      symbols: symbols.map(s => s.symbol),
      items,
    }
  }

  async function handleQuotes(req, res) {
    try {
      let override
      try {
        override = resolveQuerySymbols(new URL(req.url, 'http://localhost').searchParams.get('symbols'))
      } catch {
        override = undefined
      }
      const payload = await snapshot(override || configuredSymbols)
      sendJson(res, 200, payload)
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      sendJson(res, 502, { error: message, updatedAt: new Date().toISOString() })
    }
  }

  /**
   * Keep plain stocks and indices the panel can chart. The suggest feed
   * mixes in ETFs, bonds, OTC paper and futures, and its SecurityType
   * labeling is inconsistent across markets (Apple=20 but Tesla/NVIDIA=7,
   * the same value as ETFs). TypeUS is the reliable per-market marker:
   * 1 = US common stock, 3 = HK share; A-shares keep SecurityType 1 and
   * indices SecurityType 5.
   */
  function mapSuggestRows(rows) {
    const seen = new Set()
    const out = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const kind = String(row.Classify || '')
      const securityType = String(row.SecurityType || '')
      const typeUS = String(row.TypeUS || '')
      const quoteId = String(row.QuoteID || '')

      let market
      let code
      let symbol
      let label
      if (kind === 'AStock' && securityType === '1') {
        const match = /^([01])\.(\d{6})$/.exec(quoteId)
        if (!match) continue
        market = match[1] === '1' ? 'sh' : 'sz'
        code = match[2]
        symbol = market + code
        label = 'stock'
      } else if (kind === 'Index' && securityType === '5') {
        const match = /^([01])\.(\d{6})$/.exec(quoteId)
        if (!match) continue
        market = match[1] === '1' ? 'sh' : 'sz'
        code = match[2]
        symbol = market + code
        label = 'index'
      } else if (kind === 'HK' && (typeUS === '3' || securityType === '19')) {
        const match = /^116\.(\d{4,6})$/.exec(quoteId)
        if (!match) continue
        market = 'hk'
        code = match[1].padStart(5, '0')
        symbol = 'hk' + code
        label = 'hk'
      } else if (kind === 'UsStock' && (typeUS === '1' || securityType === '20')) {
        const match = /^(\d{2,3})\.([A-Za-z0-9._-]+)$/.exec(quoteId)
        if (!match) continue
        market = 'us'
        code = match[2].toUpperCase()
        symbol = `us${match[1]}:${code.toLowerCase()}`
        label = 'us'
      } else {
        continue
      }
      // MktNum (when present) must agree with the QuoteID market prefix.
      const mktNum = String(row.MktNum || '')
      if (mktNum !== '' && mktNum !== quoteId.split('.')[0]) continue
      if (seen.has(symbol)) continue
      seen.add(symbol)
      out.push({
        code,
        name: String(row.Name || ''),
        market,
        symbol,
        secid: quoteId,
        kind: label,
      })
      if (out.length >= 10) break
    }
    return out
  }

  /**
   * Letter-only queries look like a US ticker: also probe the three US
   * boards directly through the quote API, so an exact ticker works even
   * when the suggest feed ranks it below unrelated rows or misses it.
   */
  async function probeUsTicker(query) {
    const ticker = query.toUpperCase()
    const secids = [105, 106, 107].map(board => `${board}.${ticker}`).join(',')
    const url =
      `${QUOTE_ENDPOINT}?fltt=2&invt=2&secids=${encodeURIComponent(secids)}` +
      `&fields=f12,f13,f14&_=${Date.now()}`
    try {
      const body = await fetchJson(url, 6000)
      const rows = body && body.data && Array.isArray(body.data.diff) ? body.data.diff : []
      const hits = []
      for (const row of rows) {
        const name = typeof row.f14 === 'string' ? row.f14 : ''
        const code = String(row.f12 || '').toUpperCase()
        const board = toNumber(row.f13)
        if (!name || code !== ticker || !board) continue
        hits.push({
          code: ticker,
          name,
          market: 'us',
          symbol: `us${board}:${ticker.toLowerCase()}`,
          secid: `${board}.${ticker}`,
          kind: 'us',
        })
      }
      return hits
    } catch {
      return []
    }
  }

  async function handleSearch(req, res) {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams
      const query = (params.get('q') || '').trim()
      if (query === '') {
        sendJson(res, 200, { updatedAt: new Date().toISOString(), results: [] })
        return
      }
      // The suggest API matches pinyin initials; upper-casing helps typed input.
      const key = query.toUpperCase()
      const now = Date.now()
      if (searchCache.key === key && now - searchCache.at < SEARCH_TTL_MS) {
        sendJson(res, 200, { updatedAt: new Date().toISOString(), results: searchCache.rows })
        return
      }
      const url =
        `${SUGGEST_ENDPOINT}?input=${encodeURIComponent(key)}&type=14&count=20&_=${now}`
      const body = await fetchJson(url, 8000)
      const table = body && body.QuotationCodeTable
      let rows = mapSuggestRows(table && Array.isArray(table.Data) ? table.Data : [])
      // Ticker-shaped queries also get a direct board probe; merge its hits
      // in front so an exact code always surfaces first.
      if (/^[A-Za-z][A-Za-z0-9._-]{0,11}$/.test(key)) {
        const probe = await probeUsTicker(key)
        if (probe.length > 0) {
          const have = new Set(rows.map(row => row.symbol))
          rows = probe.filter(row => !have.has(row.symbol)).concat(rows)
        }
      }
      searchCache.at = now
      searchCache.key = key
      searchCache.rows = rows
      sendJson(res, 200, { updatedAt: new Date().toISOString(), results: rows })
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      sendJson(res, 502, { error: message, updatedAt: new Date().toISOString() })
    }
  }

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () => scoped.webServer.register({ kind: 'exact', path: '/astock/quotes', handler: handleQuotes }),
      'astock-quotes: quote route',
    )
    scoped.effect(
      () => scoped.webServer.register({ kind: 'exact', path: '/astock/search', handler: handleSearch }),
      'astock-quotes: search route',
    )
  })
}

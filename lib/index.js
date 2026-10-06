/**
 * dsh-plugin-skillhub-finder — Host half.
 *
 * Proxies the public skillhub.cn API, extracts search keywords from a composer
 * draft, and installs a chosen skill bundle into the DSH skills root. The
 * browser half never talks to api.skillhub.cn directly: it calls the same-origin
 * routes declared here, so there is no cross-origin surface and the zip is
 * unpacked on the Host where the filesystem lives.
 *
 * Function plugin: named exports `name` / `inject` / `apply`, no default export.
 * @module dsh-plugin-skillhub-finder
 */

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** Loader entry name; must match `package.json.name`. */
export const name = 'dsh-plugin-skillhub-finder'

/** The proxy needs an HTTP carrier to serve its routes. */
export const inject = ['webServer']

const PREFIX = '/dsh-plugin-skillhub-finder'
const API_BASE = 'https://api.skillhub.cn'
const SITE = 'https://skillhub.cn'
const SIDECAR = '.skillhub.json'

const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SORTS = new Set(['updated_at', 'downloads', 'stars', 'installs', 'score'])
const SOURCES = new Set(['community', 'enterprise', 'official', 'clawhub'])

const MAX_ZIP_BYTES = 25 * 1024 * 1024
const MAX_UNCOMPRESSED = 40 * 1024 * 1024
const MAX_ZIP_FILES = 400
const FETCH_MS = 25_000
const MAX_BODY_BYTES = 8192
const MAX_KEYWORDS = 6
const PER_KEYWORD = 6

/**
 * @typedef {object} Config
 * @property {string} apiBase SkillHub API origin, without a trailing slash.
 * @property {string} installDir Directory that receives installed skill bundles.
 */

/** DSH home, mirroring the harness' own `$DSH_HOME` convention. */
function dshHome() {
  const configured = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  return configured ? configured.trim() : join(homedir(), '.dsh')
}

/** Default destination for installed skills: the root `ctx.skills` discovers. */
function defaultSkillsRoot() {
  return join(dshHome(), 'skills')
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function issue(path, message) {
  return { message, path }
}

/** A rejected request: the caller's mistake, answered as 400 rather than 500. */
class InputError extends Error {}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function resolveApiBase(raw) {
  const text = asTrimmedString(raw) || API_BASE
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: `apiBase "${text}" is not an absolute URL` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `apiBase must be an http(s) URL, got ${url.protocol}` }
  }
  if (url.username || url.password) return { error: 'apiBase must not include credentials' }
  return { value: text.replace(/\/+$/, '') }
}

/**
 * Standard Schema config: an invalid profile row fails plugin load instead of
 * surfacing as a runtime error on the first request.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-skillhub-finder',
    validate(value) {
      if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        return { issues: [issue([], 'config must be an object')] }
      }
      const raw = value && typeof value === 'object' ? value : {}
      const issues = []
      if ('apiBase' in raw && raw.apiBase !== undefined && typeof raw.apiBase !== 'string') {
        issues.push(issue(['apiBase'], 'apiBase must be a string'))
      }
      if ('installDir' in raw && raw.installDir !== undefined && typeof raw.installDir !== 'string') {
        issues.push(issue(['installDir'], 'installDir must be a string'))
      }
      for (const key of Object.keys(raw)) {
        if (key !== 'apiBase' && key !== 'installDir') {
          issues.push(issue([key], `unknown config field "${key}"`))
        }
      }
      const api = resolveApiBase(raw.apiBase)
      if (api.error) issues.push(issue(['apiBase'], api.error))
      const installDir = asTrimmedString(raw.installDir) || defaultSkillsRoot()
      if (issues.length) return { issues }
      return { value: { apiBase: api.value, installDir } }
    },
  },
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/** Fillers that carry no search intent in either language. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from', 'get',
  'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'need',
  'not', 'of', 'on', 'or', 'our', 'out', 'please', 'should', 'so', 'some', 'that', 'the', 'their',
  'then', 'there', 'these', 'this', 'to', 'up', 'use', 'using', 'want', 'was', 'we', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
])

/** Chinese function words and filler phrases, removed before n-gram scoring. */
const ZH_STOP_PHRASES = [
  '帮我', '帮忙', '请你', '请帮', '我想', '我要', '需要', '可以', '能不能', '能否', '一下',
  '一个', '这个', '那个', '这些', '那些', '如何', '怎么', '怎样', '什么', '为什么', '是否',
  '并且', '然后', '以及', '还有', '就是', '进行', '用于', '用来', '通过', '根据', '按照',
  '我们', '你们', '他们', '自己', '现在', '已经', '非常', '比较', '一些', '时候', '问题',
  '的话', '东西', '方面', '相关', '以及', '因为', '所以', '但是', '如果', '或者', '而且',
]

/** Weighted intent terms: what the draft is asking for, mapped to search words. */
const INTENT_TERMS = [
  ['插件', 5], ['技能', 4], ['工具', 3], ['助手', 3], ['脚本', 3],
  ['搜索', 3], ['查找', 3], ['检索', 3], ['推荐', 3], ['安装', 2], ['下载', 2],
  ['总结', 4], ['归纳', 3], ['摘要', 4], ['翻译', 4], ['改写', 3], ['润色', 3],
  ['写作', 3], ['撰写', 3], ['文案', 3], ['报告', 4], ['周报', 4], ['日报', 3], ['汇报', 3],
  ['表格', 3], ['文档', 3], ['幻灯片', 4], ['演示', 3], ['图片', 3], ['图像', 3], ['视频', 3],
  ['音频', 3], ['爬虫', 4], ['抓取', 4], ['解析', 3], ['提取', 3], ['转换', 3], ['格式', 2],
  ['数据', 3], ['分析', 4], ['统计', 3], ['可视化', 4], ['图表', 3], ['清洗', 3],
  ['代码', 3], ['编程', 3], ['开发', 3], ['调试', 4], ['重构', 3], ['测试', 3], ['部署', 3],
  ['接口', 3], ['数据库', 3], ['前端', 3], ['后端', 3], ['算法', 3], ['正则', 4],
  ['安全', 3], ['扫描', 3], ['审计', 4], ['监控', 3], ['运维', 3], ['日志', 3],
  ['邮件', 3], ['日历', 3], ['日程', 3], ['清单', 3], ['待办', 3], ['笔记', 3],
  ['学习', 3], ['考试', 3], ['翻译成', 3], ['简历', 4], ['面试', 3], ['合同', 3], ['发票', 3],
]

/** Domain words that sharpen a search, kept as their own recall branch. */
const DOMAIN_TERMS = [
  '办公效率', '内容创作', '开发编程', '数据分析', '设计多媒体', '人工智能',
  '知识管理', '商业运营', '教育学习', '行业专业', '运维安全', '生活服务',
  'pdf', 'excel', 'word', 'ppt', 'markdown', 'json', 'yaml', 'csv', 'sql', 'regex',
  'api', 'cli', 'git', 'docker', 'typescript', 'javascript', 'python', 'node',
]

/**
 * Strip filler, then keep the terms most likely to match a skill description.
 * @param {string} raw - composer draft text.
 * @returns {string[]} up to {@link MAX_KEYWORDS} ordered keywords, best first.
 */
function extractKeywords(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const lower = text.toLowerCase()
  /** @type {Map<string, { score: number, at: number }>} */
  const hits = new Map()
  /** @param {string} term @param {number} weight @param {number} at */
  const add = (term, weight, at) => {
    const key = term.trim()
    if (!key) return
    const existing = hits.get(key)
    if (existing) existing.score += weight
    else hits.set(key, { score: weight, at })
  }

  // Latin/Cyrillic words: length and frequency are the only signals available.
  const latin = lower.match(/[a-z][a-z0-9+#.-]{1,23}/g) ?? []
  for (const word of latin) {
    const bare = word.replace(/[.-]+$/, '')
    if (bare.length < 2 || STOPWORDS.has(bare)) continue
    add(bare, 2 + Math.min(bare.length, 10) * 0.4, lower.indexOf(bare))
  }

  // CJK: score 2- and 3-grams, which is where technical terms survive.
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g) ?? []
  let order = 0
  for (const run of cjk) {
    for (const stop of ZH_STOP_PHRASES) {
      if (run.includes(stop)) add(stop, -4, order++)
    }
    for (let size = 2; size <= 3; size += 1) {
      for (let i = 0; i + size <= run.length; i += 1) {
        add(run.slice(i, i + size), size === 3 ? 2.6 : 1.4, order++)
      }
    }
  }

  // Explicit intent and domain vocabulary outranks n-gram statistics.
  for (const [term, weight] of INTENT_TERMS) {
    const at = lower.indexOf(term.toLowerCase())
    if (at >= 0) add(term, weight + 3, at)
  }
  const domains = []
  for (const term of DOMAIN_TERMS) {
    const at = lower.indexOf(term.toLowerCase())
    if (at < 0) continue
    add(term, 3, at)
    domains.push(term)
  }

  const ranked = [...hits.entries()]
    .filter(([, hit]) => hit.score > 0)
    .sort((a, b) => b[1].score - a[1].score || a[1].at - b[1].at)

  const kept = []
  for (const [term] of ranked) {
    // Drop a shorter candidate already covered by a longer one ("数据" vs "数据分析").
    if (kept.some((other) => other.includes(term))) continue
    kept.push(term)
    if (kept.length >= MAX_KEYWORDS) break
  }
  return [...new Set([...kept, ...domains])].slice(0, MAX_KEYWORDS)
}

// ---------------------------------------------------------------------------
// SkillHub access
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_MS) })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`SkillHub returned non-JSON (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const message = parsed && typeof parsed === 'object' && 'message' in parsed
      ? String(parsed.message)
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return parsed
}

async function fetchBuffer(url, maxBytes) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('download is too large')
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('download is too large')
    return bytes
  }
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      reader.cancel().catch(() => undefined)
      throw new Error('download is too large')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * Project one SkillHub list row onto the card shape the Sidebar tab renders.
 * @param {unknown} item - raw list row.
 * @returns {Record<string, unknown> | null} the card, or null without a slug.
 */
function cardFromListItem(item) {
  if (!item || typeof item !== 'object') return null
  const row = /** @type {Record<string, any>} */ (item)
  const slug = typeof row.slug === 'string' ? row.slug : ''
  if (!slug) return null
  const zh = typeof row.description_zh === 'string' ? row.description_zh : ''
  const en = typeof row.description === 'string' ? row.description : ''
  return {
    slug,
    name: typeof row.name === 'string' && row.name ? row.name : slug,
    description: (zh || en).replace(/\s+/g, ' ').trim(),
    category: typeof row.category === 'string' ? row.category : '',
    source: typeof row.source === 'string' ? row.source : '',
    version: typeof row.version === 'string' ? row.version : '',
    downloads: Number(row.downloads) || 0,
    installs: Number(row.installs) || 0,
    stars: Number(row.stars) || 0,
    ownerName: typeof row.ownerName === 'string' ? row.ownerName : '',
    iconUrl: typeof row.iconUrl === 'string' ? row.iconUrl : '',
    requiresApiKey: row.labels?.requires_api_key === 'true',
    verified: row.publisher?.verified === true || row.verified === true,
    score: Number(row.score) || 0,
    page: `${SITE}/skills/${slug}`,
  }
}

/** Chinese labels for the twelve first-level SkillHub categories. */
const CATEGORY_LABELS = {
  'office-efficiency': '办公效率',
  'content-creation': '内容创作',
  'dev-programming': '开发编程',
  'data-analysis': '数据分析',
  'design-media': '设计多媒体',
  'ai-agent': 'AI Agent',
  'knowledge-management': '知识管理',
  'business-ops': '商业运营',
  'education': '教育学习',
  'professional': '行业专业',
  'it-ops-security': 'IT 运维与安全',
  'life-service': '生活服务',
}

/**
 * Run one keyword search and project its rows.
 * @param {string} apiBase - SkillHub origin.
 * @param {string} keyword - search term.
 * @returns {Promise<Record<string, unknown>[]>} cards, empty on failure.
 */
async function searchKeyword(apiBase, keyword) {
  const params = new URLSearchParams({
    keyword,
    sortBy: 'score',
    order: 'desc',
    page: '1',
    pageSize: String(PER_KEYWORD),
  })
  try {
    const payload = await fetchJson(`${apiBase}/api/skills?${params}`)
    const data = payload?.data ?? payload
    const rows = Array.isArray(data?.skills) ? data.skills : []
    return rows.map(cardFromListItem).filter(Boolean)
  } catch {
    return []
  }
}

/** Merge keyword branches by slug, keeping the best score and a hit list. */
function mergeResults(branches) {
  /** @type {Map<string, Record<string, any>>} */
  const merged = new Map()
  for (const { keyword, cards } of branches) {
    for (const card of cards) {
      const slug = /** @type {string} */ (card.slug)
      const existing = merged.get(slug)
      if (!existing) {
        merged.set(slug, { ...card, matched: [keyword] })
        continue
      }
      existing.matched.push(keyword)
      existing.score = Math.max(existing.score ?? 0, card.score ?? 0)
      existing.downloads = Math.max(existing.downloads ?? 0, card.downloads ?? 0)
    }
  }
  return [...merged.values()]
    .map((card) => ({ ...card, matched: [...new Set(card.matched)] }))
    .sort((a, b) => (b.matched.length - a.matched.length)
      || ((b.score ?? 0) - (a.score ?? 0))
      || ((b.downloads ?? 0) - (a.downloads ?? 0)))
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/** @param {string} slug @returns {string} the validated slug. */
function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new InputError('invalid skill slug')
  return slug
}

/** Normalize a skill name into the kebab-case directory DSH expects. */
function kebabName(slug) {
  const lowered = slug.toLowerCase().replace(/[._\s]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (KEBAB_RE.test(lowered)) return lowered
  const fallback = lowered.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (KEBAB_RE.test(fallback)) return fallback
  throw new InputError(`skill name "${slug}" cannot be normalized to a valid directory name`)
}

/**
 * Read a `name:` value out of YAML frontmatter.
 * @param {string} text - SKILL.md body.
 * @returns {string | null} the declared name, or null.
 */
function frontmatterName(text) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text)
  if (!match) return null
  const line = match[1].split(/\r?\n/).find((row) => /^\s*name\s*:/.test(row))
  if (!line) return null
  const value = line.replace(/^\s*name\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '')
  return value || null
}

/**
 * Minimal ZIP reader: stored and deflated members only, every path guard
 * applied before a byte reaches the filesystem.
 * @param {Buffer} buffer - the archive.
 * @returns {{ name: string, data: Buffer }[]} accepted members.
 */
function unzip(buffer) {
  if (buffer.length < 22) throw new Error('invalid zip')
  let eocd = -1
  const floor = Math.max(0, buffer.length - 22 - 65535)
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('invalid zip: missing central directory')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (count > MAX_ZIP_FILES) throw new Error('zip has too many files')
  const files = []
  let total = 0
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid zip directory entry')
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const uncompSize = buffer.readUInt32LE(offset + 24)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOff = buffer.readUInt32LE(offset + 42)
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    offset += 46 + nameLen + extraLen + commentLen
    const memberName = rawName.replace(/\\/g, '/')
    if (memberName.endsWith('/') || memberName.startsWith('/')) continue
    if (memberName.split('/').includes('..')) continue
    if (memberName.startsWith('__MACOSX/') || memberName.endsWith('.DS_Store')) continue
    if (buffer.readUInt32LE(localOff) !== 0x04034b50) throw new Error('invalid zip local header')
    const localNameLen = buffer.readUInt16LE(localOff + 26)
    const localExtraLen = buffer.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtraLen
    const compressed = buffer.subarray(dataStart, dataStart + compSize)
    let data
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = inflateRawSync(compressed)
    else throw new Error(`unsupported zip compression ${method}`)
    if (uncompSize !== 0 && data.length !== uncompSize) throw new Error('zip size mismatch')
    total += data.length
    if (total > MAX_UNCOMPRESSED) throw new Error('uncompressed skill is too large')
    files.push({ name: memberName, data })
  }
  return files
}

/** Directory prefix the archive wraps its skill in, if any. */
function skillRootPrefix(files) {
  const skillFiles = files.filter((file) => /(^|\/)SKILL\.md$/i.test(file.name))
  if (skillFiles.length === 0) throw new Error('this bundle has no SKILL.md')
  if (skillFiles.some((file) => file.name.toLowerCase() === 'skill.md')) return ''
  const first = skillFiles[0].name
  const slash = first.lastIndexOf('/')
  return slash === -1 ? '' : first.slice(0, slash + 1)
}

/** Write accepted members under `dest`, refusing anything that escapes it. */
async function writeTree(dest, files, prefix) {
  await mkdir(dest, { recursive: true })
  const root = resolve(dest) + sep
  for (const file of files) {
    if (prefix && !file.name.startsWith(prefix)) continue
    const relative = prefix ? file.name.slice(prefix.length) : file.name
    if (!relative || relative.endsWith('/')) continue
    const target = resolve(dest, ...relative.split('/'))
    if (!target.startsWith(root)) throw new Error('refusing to write outside the skill directory')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.data)
  }
}

/**
 * Download one skill bundle and publish it under the skills root.
 * @param {string} apiBase - SkillHub origin.
 * @param {string} installDir - destination root.
 * @param {string} rawSlug - the skill slug.
 * @returns {Promise<{ slug: string, dirName: string, dirPath: string, name: string, version: string }>} receipt.
 */
async function installSkill(apiBase, installDir, rawSlug) {
  const slug = assertSlug(rawSlug)
  const zip = await fetchBuffer(
    `${apiBase}/api/v1/download?slug=${encodeURIComponent(slug)}`,
    MAX_ZIP_BYTES,
  )
  const files = unzip(zip)
  const prefix = skillRootPrefix(files)
  const entry = files.find((file) => file.name.toLowerCase() === `${prefix}skill.md`.toLowerCase())
  if (!entry) throw new Error('this bundle has no SKILL.md')
  const body = entry.data.toString('utf8')
  const fmName = frontmatterName(body)
  const dirName = kebabName(fmName && KEBAB_RE.test(fmName) ? fmName : slug)

  let detail = null
  try {
    detail = await fetchJson(`${apiBase}/api/v1/skills/${encodeURIComponent(slug)}`)
  } catch {
    detail = null
  }

  const dest = join(installDir, dirName)
  const staging = await mkdtemp(join(tmpdir(), 'dsh-skillhub-finder-'))
  try {
    const staged = join(staging, dirName)
    await writeTree(staged, files, prefix)
    await writeFile(join(staged, SIDECAR), `${JSON.stringify({
      slug,
      name: detail?.skill?.displayName ?? fmName ?? slug,
      version: detail?.latestVersion?.version ?? '',
      source: detail?.skill?.source ?? '',
      installedAt: new Date().toISOString(),
      via: 'dsh-plugin-skillhub-finder',
      page: `${SITE}/skills/${slug}`,
    }, null, 2)}\n`)
    await mkdir(installDir, { recursive: true })
    await rm(dest, { recursive: true, force: true })
    try {
      await rename(staged, dest)
    } catch {
      // A cross-device rename cannot publish: copy the staged tree instead.
      await writeTree(dest, files, prefix)
      await writeFile(join(dest, SIDECAR), await readFile(join(staged, SIDECAR)))
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  return {
    slug,
    dirName,
    dirPath: dest,
    name: typeof detail?.skill?.displayName === 'string' ? detail.skill.displayName : (fmName ?? slug),
    version: typeof detail?.latestVersion?.version === 'string' ? detail.latestVersion.version : '',
  }
}

/**
 * List installed skills across the alternate roots consumers also read.
 * @param {string} installDir - primary root.
 * @returns {Promise<Set<string>>} slugs and directory names present on disk.
 */
async function listInstalledKeys(installDir) {
  const roots = [installDir, join(dshHome(), 'skills'), join(homedir(), '.agents', 'skills')]
  const keys = new Set()
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      keys.add(entry.name)
      try {
        const meta = JSON.parse(await readFile(join(root, entry.name, SIDECAR), 'utf8'))
        if (typeof meta?.slug === 'string') keys.add(meta.slug)
      } catch {
        // A skill without our sidecar still counts by directory name.
      }
    }
  }
  return keys
}

/** Remove one installed skill by slug or directory name. */
async function uninstallSkill(installDir, rawSlug) {
  const slug = assertSlug(rawSlug)
  for (const root of [installDir, join(dshHome(), 'skills')]) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let meta = null
      try {
        meta = JSON.parse(await readFile(join(root, entry.name, SIDECAR), 'utf8'))
      } catch {
        meta = null
      }
      if (entry.name !== slug && meta?.slug !== slug) continue
      await rm(join(root, entry.name), { recursive: true, force: true })
      return { slug, dirName: entry.name }
    }
  }
  throw new Error('this skill is not installed here')
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Same-origin guard for the mutating route. */
function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new RangeError('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new InputError('request body is not valid JSON')
  }
}

function requestUrl(request) {
  return new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {Config} config - resolved plugin config.
 */
export function apply(ctx, config) {
  /** Slugs with an install in flight, so two clicks cannot race the same directory. */
  const installing = new Set()
  /** Search snapshots, so a reloaded page can restore the last result set. */
  const searches = new Map()
  let latestSearchId = null

  async function handle(request, response) {
    const url = requestUrl(request)
    const path = url.pathname
    const method = request.method ?? 'GET'

    if (path === `${PREFIX}/api/meta` && method === 'GET') {
      const installed = await listInstalledKeys(config.installDir)
      return sendJson(response, 200, {
        ok: true,
        apiBase: config.apiBase,
        installDir: config.installDir,
        site: SITE,
        installedCount: installed.size,
        categories: CATEGORY_LABELS,
      })
    }

    if (path === `${PREFIX}/api/search` && method === 'POST') {
      const body = await readJsonBody(request)
      const draft = typeof body?.draft === 'string' ? body.draft.slice(0, 8000) : ''
      const provided = Array.isArray(body?.keywords)
        ? body.keywords.filter((word) => typeof word === 'string' && word.trim()).slice(0, MAX_KEYWORDS)
        : []
      const keywords = [...new Set(provided.map((word) => word.trim()))].length
        ? [...new Set(provided.map((word) => word.trim()))].slice(0, MAX_KEYWORDS)
        : extractKeywords(draft)
      const pagesize = Math.min(30, Math.max(4, Number(body?.pageSize) || 12))

      const branches = await Promise.all(keywords.map(async (keyword) => ({
        keyword,
        cards: await searchKeyword(config.apiBase, keyword),
      })))
      const skills = mergeResults(branches).slice(0, pagesize)
      const installed = await listInstalledKeys(config.installDir)
      for (const skill of skills) skill.installed = installed.has(skill.slug)

      const searchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const snapshot = {
        id: searchId,
        at: new Date().toISOString(),
        keywordSource: provided.length ? 'provided' : 'extracted',
        keywords,
        draft: draft.length > 400 ? `${draft.slice(0, 400)}…` : draft,
        skills,
        totalFound: skills.length,
      }
      searches.set(searchId, snapshot)
      latestSearchId = searchId
      if (searches.size > 20) {
        const oldest = searches.keys().next().value
        if (oldest !== undefined && oldest !== latestSearchId) searches.delete(oldest)
      }
      return sendJson(response, 200, { ok: true, ...snapshot })
    }

    if (path === `${PREFIX}/api/latest` && method === 'GET') {
      const snapshot = latestSearchId ? searches.get(latestSearchId) : undefined
      if (!snapshot) return sendJson(response, 200, { ok: true, search: null })
      const installed = await listInstalledKeys(config.installDir)
      for (const skill of snapshot.skills) skill.installed = installed.has(skill.slug)
      return sendJson(response, 200, { ok: true, search: snapshot })
    }

    if (path === `${PREFIX}/api/detail` && method === 'GET') {
      const slug = assertSlug(url.searchParams.get('slug') ?? '')
      let detail = null
      try {
        detail = await fetchJson(`${config.apiBase}/api/v1/skills/${encodeURIComponent(slug)}`)
      } catch {
        detail = null
      }
      const skill = detail?.skill ?? null
      const installed = await listInstalledKeys(config.installDir)
      return sendJson(response, 200, {
        ok: true,
        slug,
        installed: installed.has(slug),
        name: skill?.displayName ?? slug,
        summary: skill?.summary_zh || skill?.summary || '',
        category: skill?.category ?? '',
        source: skill?.source ?? '',
        version: detail?.latestVersion?.version ?? '',
        owner: skill?.owner?.displayName ?? skill?.ownerName ?? '',
        stats: skill?.stats ?? {},
        page: `${SITE}/skills/${slug}`,
      })
    }

    if (path === `${PREFIX}/api/install` && method === 'POST') {
      if (!sameOrigin(request)) return sendJson(response, 403, { ok: false, error: 'untrusted origin' })
      const body = await readJsonBody(request)
      const slug = assertSlug(typeof body?.slug === 'string' ? body.slug : '')
      if (installing.has(slug)) return sendJson(response, 409, { ok: false, error: 'this skill is already installing' })
      installing.add(slug)
      try {
        const receipt = await installSkill(config.apiBase, config.installDir, slug)
        ctx.emit('skills/change')
        return sendJson(response, 200, { ok: true, ...receipt })
      } finally {
        installing.delete(slug)
      }
    }

    if (path === `${PREFIX}/api/uninstall` && method === 'POST') {
      if (!sameOrigin(request)) return sendJson(response, 403, { ok: false, error: 'untrusted origin' })
      const body = await readJsonBody(request)
      const slug = assertSlug(typeof body?.slug === 'string' ? body.slug : '')
      const receipt = await uninstallSkill(config.installDir, slug)
      ctx.emit('skills/change')
      return sendJson(response, 200, { ok: true, ...receipt })
    }

    return sendJson(response, 404, { ok: false, error: 'not found' })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (request, response) => {
      void handle(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (response.headersSent) {
          response.destroy()
          return
        }
        // A rejected slug or body is the caller's mistake, not a server fault;
        // an oversized body is a refusal. Everything else is a 500.
        const status = error instanceof InputError ? 400
          : error instanceof RangeError ? 413
            : 500
        sendJson(response, status, { ok: false, error: message })
      })
    },
  }), 'dsh-plugin-skillhub-finder: routes')
}

/* ============================================================
   db.js —— 移动端只读版 · 浏览器直连 Turso/libSQL
   配置存于 localStorage(pmc:dbcfg)；支持 #cfg= 分享链接
   ============================================================ */

import { createClient } from './vendor/libsql-web.js';
import { DB_URL, buildToken } from './config.js';

const CFG_KEY = 'pmc:dbcfg';
const GUEST_KEY = 'pmc:guest';

let client = null;
let currentSuffix = null;

/* ---------------- 连接配置存取 ---------------- */

export function hasConfig() {
  return !!getSuffix();
}

export function getSuffix() {
  if (currentSuffix !== null) return currentSuffix;
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg && cfg.suffix) return cfg.suffix;
  } catch (e) { /* ignore */ }
  return null;
}

export function saveSuffix(suffix) {
  const s = String(suffix || '').trim();
  if (!s) throw new Error('请填写哈希值码');
  localStorage.setItem(CFG_KEY, JSON.stringify({ suffix: s }));
  currentSuffix = s;
  client = null;
}

export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
  currentSuffix = null;
  client = null;
}

/* ---------------- 游客会话存取 ---------------- */

export function getGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function saveGuest(g) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(g));
}

export function clearGuest() {
  localStorage.removeItem(GUEST_KEY);
}

/* ---------------- 分享链接（#cfg=后缀） ---------------- */

export function configFromHash() {
  const m = location.hash.match(/[#&]cfg=([^&]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return null; }
}

export function applyHashConfig() {
  const suffix = configFromHash();
  if (!suffix) return false;
  saveSuffix(suffix);
  try {
    const cleaned = location.hash.replace(/[#&]cfg=[^&]*/, '');
    history.replaceState(null, '', location.href.split('#')[0] + cleaned);
  } catch (e) { /* ignore */ }
  return true;
}

/* ---------------- 连接与查询 ---------------- */

export function getClient() {
  if (client) return client;
  const suffix = getSuffix();
  if (!suffix) throw new Error('尚未输入哈希值码，请先输入');
  client = createClient({ url: DB_URL, authToken: buildToken(suffix) });
  return client;
}

export async function ping() {
  await getClient().execute('SELECT 1');
  return true;
}

export async function all(sql, args = []) {
  const r = await getClient().execute({ sql, args });
  return (r.rows || []).map((row) => ({ ...row }));
}

export async function one(sql, args = []) {
  return (await all(sql, args))[0] || null;
}
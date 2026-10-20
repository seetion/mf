/* ============================================================
   db.js —— 浏览器直连 Turso/libSQL 连接层（纯静态版）
   配置存于 localStorage(pmc:dbcfg)；支持 #cfg= 分享链接
   ============================================================ */

import { createClient } from './vendor/libsql-web.js';
import { DB_URL, buildToken } from './config.js';

const CFG_KEY = 'pmc:dbcfg';

let client = null;
let currentSuffix = null;

/* ---------------- 配置存取（只存令牌后缀，地址与前缀写死于 config.js） ---------------- */

export function hasConfig() {
  return !!getSuffix();
}

/** 获取使用者输入的令牌后缀（签名段） */
export function getSuffix() {
  if (currentSuffix !== null) return currentSuffix;
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg && cfg.suffix) return cfg.suffix;
  } catch (e) {
    /* ignore */
  }
  return null;
}

/** 保存令牌后缀（签名段） */
export function saveSuffix(suffix) {
  const s = String(suffix || '').trim();
  if (!s) throw new Error('请填写哈希值码');
  localStorage.setItem(CFG_KEY, JSON.stringify({ suffix: s }));
  currentSuffix = s;
  client = null; // 配置变更后重建连接
}

export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
  currentSuffix = null;
  client = null;
}

/* ---------------- 分享链接（#cfg=后缀） ---------------- */

export function configFromHash() {
  const m = location.hash.match(/[#&]cfg=([^&]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
}

export function buildShareLink() {
  const suffix = getSuffix();
  if (!suffix) return '';
  const base = location.href.split('#')[0];
  return `${base}#cfg=${encodeURIComponent(suffix)}`;
}

/** 应用 URL 中携带的令牌后缀（自动保存并清理 hash） */
export function applyHashConfig() {
  const suffix = configFromHash();
  if (!suffix) return false;
  saveSuffix(suffix);
  try {
    const cleaned = location.hash.replace(/[#&]cfg=[^&]*/, '');
    history.replaceState(null, '', location.href.split('#')[0] + cleaned);
  } catch (e) {
    /* ignore */
  }
  return true;
}

/* ---------------- 连接 ---------------- */

export function getClient() {
  if (client) return client;
  const suffix = getSuffix();
  if (!suffix) throw new Error('尚未输入哈希值码，请先输入');
  client = createClient({ url: DB_URL, authToken: buildToken(suffix) });
  return client;
}

/** 测试连接：执行简单查询，成功返回 true，失败抛错 */
export async function ping() {
  const c = getClient();
  await c.execute('SELECT 1');
  return true;
}

/* ---------------- 查询封装（与 server.js 的 all/one/run 一致） ---------------- */

export async function all(sql, args = []) {
  const r = await getClient().execute({ sql, args });
  return (r.rows || []).map((row) => ({ ...row }));
}

export async function one(sql, args = []) {
  return (await all(sql, args))[0] || null;
}

export async function run(sql, args = []) {
  return await getClient().execute({ sql, args });
}
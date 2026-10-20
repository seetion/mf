/* ============================================================
   api.js —— 浏览器直连 Turso 数据接口（纯静态版）
   与 public/js/api.js 导出签名完全一致，页面代码无需修改
   ============================================================ */

import { all, one, run } from './db.js';
import { DB_URL } from './config.js';
import { loadLocal, saveLocal } from './util.js';

/* ---------------- 工具 ---------------- */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v === null || v === undefined ? '' : String(v));
const nowISO = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function normalizeDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return t;
}
function deriveStatus(done, qty) {
  if (done <= 0) return '下达';
  if (qty > 0 && done >= qty) return '完工';
  return '开工';
}
function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}
function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- PBKDF2-SHA256（Web Crypto，与 server.js 完全一致） ---------------- */
const PBKDF2_ITER = 120000;
const PBKDF2_LEN = 32;

async function pbkdf2Hex(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(String(salt)), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_LEN * 8
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, salt) {
  return `pbkdf2$${PBKDF2_ITER}$${await pbkdf2Hex(password, salt)}`;
}
async function makeHash(password) {
  const salt = randomHex(16);
  return { salt, hash: await hashPassword(password, salt) };
}
/** 验证密码：仅支持 pbkdf2 格式（v1.6 及以后创建的账号均为该格式） */
async function verifyPassword(password, salt, hash) {
  const stored = String(hash || '');
  if (!stored || !salt) return false;
  if (!stored.startsWith('pbkdf2$')) return false; // 旧 scrypt 格式不支持，请用桌面版登录一次自动升级
  const calc = await hashPassword(password, salt);
  if (calc.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 会话（本地管理） ---------------- */
const TOKEN_KEY = 'pmc:token';
const USER_KEY = 'pmc:user';

export const session = {
  token: loadLocal(TOKEN_KEY, '') || '',
  user: loadLocal(USER_KEY, null),
  get logged() {
    return !!this.token && !!this.user;
  },
  set(token, user) {
    this.token = token || '';
    this.user = user || null;
    saveLocal(TOKEN_KEY, this.token);
    saveLocal(USER_KEY, this.user);
  },
  clear() {
    this.token = '';
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

/** 二级密码（本次会话内复用，避免频繁输入；仅在浏览器内存中） */
export const deleteGuard = { password: '' };

/* ---------------- 权限 ---------------- */
function requireWriter() {
  if (!session.logged) fail('请先登录后再操作', 401);
  if (session.user.role === 'guest') fail('游客码为只读权限，无法录入或修改数据', 403);
  return session.user;
}
async function checkDeletePassword() {
  const pwd = str(deleteGuard.password);
  if (!pwd) return false;
  const expected = await getSetting('delete_password', '888888');
  if (pwd === expected) return true;
  // 兼容：超级管理员 / 历史 admin 的登录密码也可作为二级密码
  for (const name of ['Asheng', 'admin']) {
    const u = await one(`SELECT * FROM users WHERE username = ?`, [name]);
    if (u && (await verifyPassword(pwd, u.salt, u.password_hash))) return true;
  }
  return false;
}
async function guard() {
  if (!(await checkDeletePassword())) fail('二级密码错误，删除已取消', 403);
}

/* ---------------- 业务辅助（与 server.js 一致） ---------------- */
async function getSetting(key, fallback = '') {
  const row = await one(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await run(`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
    key,
    str(value),
  ]);
}
async function registerProduct(code, name, spec, unit) {
  const c = str(code).trim();
  if (!c) return;
  const exist = await one(`SELECT id FROM products WHERE code = ?`, [c]);
  if (exist) return;
  const stamp = nowISO();
  await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
    c,
    str(name).trim(),
    str(spec).trim(),
    str(unit).trim(),
    stamp,
    stamp,
  ]);
}
async function syncOrders() {
  const rows = await all(
    `SELECT ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit,
            ri.order_qty, ri.today_qty, r.report_date
       FROM report_items ri
       JOIN reports r ON r.id = ri.report_id
      WHERE TRIM(ri.order_no) <> ''
      ORDER BY r.report_date ASC, ri.id ASC`
  );
  const map = new Map();
  for (const r of rows) {
    const key = `${r.order_no}||${r.product_code}`;
    let g = map.get(key);
    if (!g) {
      g = {
        order_no: r.order_no,
        product_code: r.product_code,
        product_name: r.product_name,
        spec: r.spec,
        unit: r.unit,
        order_qty: num(r.order_qty),
        done_qty: 0,
        first_date: r.report_date,
        last_date: r.report_date,
      };
      map.set(key, g);
    }
    g.done_qty += num(r.today_qty);
    g.order_qty = num(r.order_qty);
    if (r.product_name) g.product_name = r.product_name;
    if (r.spec) g.spec = r.spec;
    if (r.unit) g.unit = r.unit;
    g.last_date = r.report_date;
  }
  const existing = await all(`SELECT * FROM orders`);
  const existMap = new Map(existing.map((o) => [`${o.order_no}||${o.product_code}`, o]));
  const stamp = nowISO();
  for (const g of map.values()) {
    const old = existMap.get(`${g.order_no}||${g.product_code}`);
    if (!old) continue;
    let status = old.status;
    let orderQty = num(g.order_qty);
    if (Number(old.manual) === 1) {
      orderQty = num(old.order_qty) > 0 ? num(old.order_qty) : num(g.order_qty);
      status = old.status === '结单' ? '结单' : deriveStatus(g.done_qty, orderQty);
    } else if (num(g.order_qty) > num(old.order_qty) && num(old.order_qty) > 0) {
      status = '追加';
    } else {
      status = deriveStatus(g.done_qty, orderQty);
    }
    await run(
      `UPDATE orders SET product_name=?, spec=?, unit=?, order_qty=?, done_qty=?, status=?, first_date=?, last_date=?, updated_at=? WHERE id=?`,
      [g.product_name, g.spec, g.unit, orderQty, g.done_qty, status, g.first_date, g.last_date, stamp, old.id]
    );
  }
}
async function getHistoryRows({ from, to, q, line } = {}) {
  const where = [];
  const args = [];
  if (from) {
    where.push(`r.report_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`r.report_date <= ?`);
    args.push(to);
  }
  if (line) {
    where.push(`r.line = ?`);
    args.push(line);
  }
  if (q) {
    where.push(`(ri.order_no LIKE ? OR ri.product_code LIKE ? OR ri.product_name LIKE ? OR ri.spec LIKE ?)`);
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  const sql = `SELECT ri.id AS item_id, ri.report_id, r.report_date, r.line, r.attendance, r.work_hours, r.remark AS report_remark,
                      ri.seq, ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit,
                      ri.order_qty, ri.today_qty, ri.remark
                 FROM report_items ri
                 JOIN reports r ON r.id = ri.report_id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY r.report_date DESC, r.line ASC, ri.seq ASC, ri.id ASC`;
  return all(sql, args);
}
async function _getStock() {
  const items = await all(
    `SELECT product_code, product_name, spec, unit, today_qty FROM report_items
      WHERE TRIM(product_code) <> '' OR TRIM(product_name) <> ''`
  );
  const inb = await all(`SELECT product_code, product_name, qty FROM inbound`);
  const outb = await all(`SELECT product_code, product_name, qty FROM outbound`);
  const products = await all(`SELECT code, name, spec, unit FROM products`);
  const pMap = new Map(products.map((p) => [String(p.code).trim(), p]));
  const map = new Map();
  const norm = (s) => String(s ?? '').trim();
  const keyOf = (code, name) => {
    const c = norm(code);
    return c || `@${norm(name)}`;
  };
  const ensure = (code, name) => {
    const key = keyOf(code, name);
    let g = map.get(key);
    if (!g) {
      const p = pMap.get(norm(code)) || {};
      g = {
        product_code: norm(code),
        product_name: norm(name) || p.name || '',
        spec: p.spec || '',
        unit: p.unit || '',
        produced: 0,
        inbound: 0,
        outbound: 0,
      };
      map.set(key, g);
    }
    return g;
  };
  for (const it of items) {
    const g = ensure(it.product_code, it.product_name);
    g.produced += num(it.today_qty);
    if (norm(it.product_name)) g.product_name = norm(it.product_name);
    if (norm(it.spec)) g.spec = norm(it.spec);
    if (norm(it.unit)) g.unit = norm(it.unit);
  }
  for (const r of inb) {
    const g = ensure(r.product_code, r.product_name);
    g.inbound += num(r.qty);
  }
  for (const r of outb) {
    const g = ensure(r.product_code, r.product_name);
    g.outbound += num(r.qty);
  }
  const list = [...map.values()].map((r) => ({ ...r, stock: r.produced + r.inbound - r.outbound }));
  list.sort((a, b) => String(a.product_code).localeCompare(String(b.product_code), 'zh-CN'));
  return list;
}

/* ============================================================
   以下为对外接口（与 public/js/api.js 签名一致）
   ============================================================ */

/* ---------------- 认证 ---------------- */
export async function login(username, password) {
  username = str(username).trim();
  password = str(password);
  if (!username || !password) fail('请输入账号与密码');
  const user = await one(`SELECT * FROM users WHERE username = ?`, [username]);
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) fail('账号或密码错误', 401);
  const token = randomHex(24);
  return { token, user: { id: Number(user.id), username: user.username, role: user.role } };
}
export async function loginGuest(code) {
  code = str(code).trim();
  if (!code) fail('请输入游客码');
  const row = await one(`SELECT * FROM guest_codes WHERE code = ?`, [code]);
  if (!row) fail('游客码无效或已被删除', 401);
  const token = randomHex(24);
  const label = str(row.remark).trim() || code;
  const username = `游客·${label}`;
  return { token, user: { id: 0, username, role: 'guest', code } };
}
export async function logout() {
  return {};
}
export async function me() {
  return { user: session.logged ? session.user : null };
}
export async function changePassword(oldPassword, newPassword) {
  requireWriter();
  const user = await one(`SELECT * FROM users WHERE id = ?`, [session.user.id]);
  if (!user || !(await verifyPassword(str(oldPassword), user.salt, user.password_hash))) fail('原密码错误');
  const { salt, hash } = await makeHash(str(newPassword));
  await run(`UPDATE users SET password_hash=?, salt=? WHERE id=?`, [hash, salt, Number(user.id)]);
  return {};
}

/* ---------------- 游客码管理 ---------------- */
export async function listGuestCodes() {
  requireWriter();
  return all(`SELECT * FROM guest_codes ORDER BY created_at DESC, id DESC`);
}
export async function createGuestCode(data) {
  requireWriter();
  const code = str(data.code).trim();
  if (!code) fail('请填写游客码');
  if (await one(`SELECT id FROM guest_codes WHERE code = ?`, [code])) fail('该游客码已存在');
  const stamp = nowISO();
  const r = await run(`INSERT INTO guest_codes(code, remark, created_at, updated_at) VALUES(?,?,?,?)`, [
    code,
    str(data.remark).trim(),
    stamp,
    stamp,
  ]);
  return { id: Number(r.lastInsertRowid) };
}
export async function updateGuestCode(id, data) {
  requireWriter();
  const code = str(data.code).trim();
  if (!code) fail('请填写游客码');
  if (await one(`SELECT id FROM guest_codes WHERE code = ? AND id <> ?`, [code, Number(id)])) fail('该游客码已存在');
  await run(`UPDATE guest_codes SET code=?, remark=?, updated_at=? WHERE id=?`, [
    code,
    str(data.remark).trim(),
    nowISO(),
    Number(id),
  ]);
  return {};
}
export async function deleteGuestCode(id) {
  requireWriter();
  await guard();
  await run(`DELETE FROM guest_codes WHERE id = ?`, [Number(id)]);
  return {};
}

/* ---------------- 基础物品信息 ---------------- */
export async function listProducts(q = '') {
  q = str(q).trim();
  return q
    ? all(`SELECT * FROM products WHERE code LIKE ? OR name LIKE ? OR spec LIKE ? ORDER BY code ASC LIMIT 500`, [
        `%${q}%`,
        `%${q}%`,
        `%${q}%`,
      ])
    : all(`SELECT * FROM products ORDER BY code ASC LIMIT 5000`);
}
export async function saveProducts(items) {
  requireWriter();
  const list = Array.isArray(items) ? items : [items];
  const stamp = nowISO();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const it of list) {
    const code = str(it.code ?? it.product_code).trim();
    if (!code) {
      skipped++;
      continue;
    }
    const name = str(it.name ?? it.product_name).trim();
    const spec = str(it.spec).trim();
    const unit = str(it.unit).trim();
    const exist = await one(`SELECT id FROM products WHERE code = ?`, [code]);
    if (exist) {
      await run(`UPDATE products SET name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [name, spec, unit, stamp, exist.id]);
      updated++;
    } else {
      await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
        code,
        name,
        spec,
        unit,
        stamp,
        stamp,
      ]);
      created++;
    }
  }
  return { created, updated, skipped, total: list.length };
}
export async function updateProduct(id, data) {
  requireWriter();
  await run(`UPDATE products SET code=?, name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [
    str(data.code).trim(),
    str(data.name).trim(),
    str(data.spec).trim(),
    str(data.unit).trim(),
    nowISO(),
    Number(id),
  ]);
  return {};
}
export async function deleteProduct(id) {
  requireWriter();
  await guard();
  await run(`DELETE FROM products WHERE id = ?`, [Number(id)]);
  return {};
}

/* ---------------- 报表 / 历史 ---------------- */
export async function getReportByDate(date, line = '') {
  date = str(date);
  line = str(line);
  if (date) {
    const rep = line
      ? await one(`SELECT * FROM reports WHERE report_date=? AND line=?`, [date, line])
      : await one(`SELECT * FROM reports WHERE report_date=? ORDER BY id DESC LIMIT 1`, [date]);
    if (!rep) return null;
    const items = await all(`SELECT * FROM report_items WHERE report_id=? ORDER BY seq ASC, id ASC`, [rep.id]);
    return { ...rep, items };
  }
  return all(`SELECT * FROM reports ORDER BY report_date DESC LIMIT 200`);
}
export async function listReports() {
  return all(`SELECT * FROM reports ORDER BY report_date DESC LIMIT 200`);
}
export async function saveReport(body) {
  const u = requireWriter();
  const date = str(body.report_date).trim() || today();
  const line = str(body.line).trim() || '一线';
  const attendance = num(body.attendance);
  const hours = num(body.work_hours);
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (it) => str(it.order_no).trim() || str(it.product_code).trim() || str(it.product_name).trim()
  );
  if (!items.length) fail('请至少录入一条生产明细');
  const stamp = nowISO();
  const exist = await one(`SELECT id FROM reports WHERE report_date=? AND line=?`, [date, line]);
  let reportId;
  if (exist) {
    reportId = Number(exist.id);
    await run(`UPDATE reports SET attendance=?, work_hours=?, remark=?, created_by=?, updated_at=? WHERE id=?`, [
      attendance,
      hours,
      str(body.remark),
      u.username,
      stamp,
      reportId,
    ]);
    await run(`DELETE FROM report_items WHERE report_id=?`, [reportId]);
  } else {
    const r = await run(
      `INSERT INTO reports(report_date, line, attendance, work_hours, remark, created_by, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [date, line, attendance, hours, str(body.remark), u.username, stamp, stamp]
    );
    reportId = Number(r.lastInsertRowid);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const code = str(it.product_code).trim();
    const name = str(it.product_name).trim();
    if (code && (name || it.unit)) {
      const p = await one(`SELECT id FROM products WHERE code=?`, [code]);
      if (!p) {
        await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
          code,
          name,
          str(it.spec || it.spec_model).trim(),
          str(it.unit).trim(),
          stamp,
          stamp,
        ]);
      }
    }
    await run(
      `INSERT INTO report_items(report_id, seq, order_no, product_code, product_name, spec, unit, order_qty, today_qty, remark)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        reportId,
        i + 1,
        str(it.order_no).trim(),
        code,
        name,
        str(it.spec).trim(),
        str(it.unit).trim(),
        num(it.order_qty),
        num(it.today_qty),
        str(it.remark),
      ]
    );
  }
  await syncOrders();
  return { report_id: reportId, count: items.length };
}
export async function deleteReport(id) {
  requireWriter();
  await guard();
  const rid = Number(id);
  await run(`DELETE FROM report_items WHERE report_id=?`, [rid]);
  await run(`DELETE FROM reports WHERE id=?`, [rid]);
  await syncOrders();
  return {};
}
export async function listHistory({ from, to, q, line } = {}) {
  return getHistoryRows({ from, to, q: str(q).trim(), line });
}
export async function deleteHistoryItem(id) {
  requireWriter();
  await guard();
  await run(`DELETE FROM report_items WHERE id=?`, [Number(id)]);
  await syncOrders();
  return {};
}
export async function batchHistory(items) {
  const u = requireWriter();
  const raw = Array.isArray(items) ? items : [];
  const valid = raw.filter(
    (it) =>
      str(it.report_date).trim() &&
      (str(it.order_no).trim() || str(it.product_code).trim() || str(it.product_name).trim())
  );
  if (!valid.length) fail('没有可导入的记录：每条至少需要「日期」和「订单号/产品编号/产品名称」之一');
  const defaultLine = await getSetting('default_line', '一线');
  const stamp = nowISO();
  const groups = new Map();
  for (const it of valid) {
    const date = normalizeDate(str(it.report_date));
    const line = str(it.line).trim() || defaultLine || '一线';
    const key = `${date}||${line}`;
    if (!groups.has(key)) groups.set(key, { date, line, attendance: 0, items: [] });
    const g = groups.get(key);
    const att = num(it.attendance);
    if (att > 0 && g.attendance <= 0) g.attendance = att;
    g.items.push({
      order_no: str(it.order_no).trim(),
      product_code: str(it.product_code).trim(),
      product_name: str(it.product_name).trim(),
      spec: str(it.spec).trim(),
      unit: str(it.unit).trim(),
      order_qty: num(it.order_qty),
      today_qty: num(it.today_qty),
      remark: str(it.remark).trim(),
    });
  }
  let reportsCreated = 0;
  let reportsUpdated = 0;
  let itemsImported = 0;
  for (const g of groups.values()) {
    const exist = await one(`SELECT id, attendance FROM reports WHERE report_date=? AND line=?`, [g.date, g.line]);
    let reportId;
    if (exist) {
      reportId = Number(exist.id);
      if (num(exist.attendance) <= 0 && g.attendance > 0) {
        await run(`UPDATE reports SET attendance=?, updated_at=? WHERE id=?`, [g.attendance, stamp, reportId]);
      }
      reportsUpdated++;
    } else {
      const r = await run(
        `INSERT INTO reports(report_date, line, attendance, work_hours, remark, created_by, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [g.date, g.line, g.attendance, 0, '', u.username, stamp, stamp]
      );
      reportId = Number(r.lastInsertRowid);
      reportsCreated++;
    }
    const maxSeq = await one(`SELECT MAX(seq) AS v FROM report_items WHERE report_id=?`, [reportId]);
    let seq = num(maxSeq && maxSeq.v) || 0;
    for (const it of g.items) {
      seq++;
      if (it.product_code && (it.product_name || it.unit)) {
        const p = await one(`SELECT id FROM products WHERE code=?`, [it.product_code]);
        if (!p) {
          await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
            it.product_code,
            it.product_name,
            it.spec,
            it.unit,
            stamp,
            stamp,
          ]);
        }
      }
      await run(
        `INSERT INTO report_items(report_id, seq, order_no, product_code, product_name, spec, unit, order_qty, today_qty, remark)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [reportId, seq, it.order_no, it.product_code, it.product_name, it.spec, it.unit, it.order_qty, it.today_qty, it.remark]
      );
      itemsImported++;
    }
  }
  await syncOrders();
  return {
    reports_created: reportsCreated,
    reports_updated: reportsUpdated,
    items_imported: itemsImported,
    items_skipped: raw.length - valid.length,
    groups: groups.size,
  };
}

/* ---------------- 生产进度 ---------------- */
export async function listOrders({ q, status } = {}) {
  q = str(q).trim();
  status = str(status);
  const where = [];
  const args = [];
  if (q) {
    where.push(`(order_no LIKE ? OR product_code LIKE ? OR product_name LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`status = ?`);
    args.push(status);
  }
  return all(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC`, args);
}
export async function createOrder(data) {
  requireWriter();
  const order_no = str(data.order_no).trim();
  const product_code = str(data.product_code).trim();
  const product_name = str(data.product_name).trim();
  const spec = str(data.spec).trim();
  const unit = str(data.unit).trim();
  const order_qty = num(data.order_qty);
  if (!order_no) fail('请填写工单号');
  if (!product_code) fail('请填写产品编号');
  if (order_qty <= 0) fail('订单数量必须大于 0');
  if (await one(`SELECT id FROM orders WHERE order_no=? AND product_code=?`, [order_no, product_code]))
    fail(`工单 ${order_no} / 产品 ${product_code} 已存在，不可重复建单`);
  await registerProduct(product_code, product_name, spec, unit);
  const t = today();
  const stamp = nowISO();
  await run(
    `INSERT INTO orders(order_no, product_code, product_name, spec, unit, order_qty, done_qty, status, manual, first_date, last_date, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,'1',?,?,?,?)`,
    [order_no, product_code, product_name, spec, unit, order_qty, 0, deriveStatus(0, order_qty), t, t, stamp, stamp]
  );
  return {};
}
export async function batchOrders(rows) {
  requireWriter();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) fail('没有可导入的数据');
  const t = today();
  const stamp = nowISO();
  let imported = 0;
  let skipped = 0;
  const errors = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i] || {};
    const order_no = str(r.order_no).trim();
    const product_code = str(r.product_code).trim();
    const product_name = str(r.product_name).trim();
    const spec = str(r.spec).trim();
    const unit = str(r.unit).trim();
    const order_qty = num(r.order_qty);
    if (!order_no || !product_code || order_qty <= 0) {
      skipped++;
      errors.push(`第 ${i + 1} 行：工单号/产品编号缺失或数量无效`);
      continue;
    }
    if (await one(`SELECT id FROM orders WHERE order_no=? AND product_code=?`, [order_no, product_code])) {
      skipped++;
      errors.push(`第 ${i + 1} 行：工单 ${order_no} / 产品 ${product_code} 已存在`);
      continue;
    }
    await registerProduct(product_code, product_name, spec, unit);
    await run(
      `INSERT INTO orders(order_no, product_code, product_name, spec, unit, order_qty, done_qty, status, manual, first_date, last_date, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,'1',?,?,?,?)`,
      [order_no, product_code, product_name, spec, unit, order_qty, 0, deriveStatus(0, order_qty), t, t, stamp, stamp]
    );
    imported++;
  }
  return { imported, skipped, errors };
}
export async function updateOrder(id, body) {
  requireWriter();
  const oid = Number(id);
  const fields = [];
  const args = [];
  if (body.status !== undefined) {
    fields.push('status=?', 'manual=?');
    args.push(str(body.status), 1);
  }
  if (body.order_qty !== undefined) {
    const newQty = num(body.order_qty);
    fields.push('order_qty=?', 'manual=?');
    args.push(newQty, 1);
    if (body.status === undefined) {
      const cur = await one(`SELECT done_qty FROM orders WHERE id=?`, [oid]);
      if (cur) {
        fields.push('status=?');
        args.push(deriveStatus(num(cur.done_qty), newQty));
      }
    }
  }
  if (!fields.length) return {};
  args.push(nowISO(), oid);
  await run(`UPDATE orders SET ${fields.join(', ')}, updated_at=? WHERE id=?`, args);
  return {};
}
export async function deleteOrder(id) {
  requireWriter();
  await guard();
  const oid = Number(id);
  /* 删除保护：工单已有生产记录时不可直接删除 */
  const order = await one(`SELECT order_no, product_code, product_name FROM orders WHERE id=?`, [oid]);
  if (order) {
    const cnt = await one(`SELECT COUNT(*) AS c FROM report_items WHERE order_no=? AND product_code=?`, [
      order.order_no,
      order.product_code,
    ]);
    if (cnt && num(cnt.c) > 0) {
      fail(
        `工单 ${order.order_no}（${order.product_name || order.product_code}）已有 ${cnt.c} 条生产记录，请先在「历史记录」中删除对应生产记录后再删除工单`,
        409
      );
    }
  }
  await run(`DELETE FROM orders WHERE id=?`, [oid]);
  return {};
}

/* ---------------- 库存 ---------------- */
export async function getStock() {
  return _getStock();
}
export async function listInbound(opt = {}) {
  const q = str(opt.q).trim();
  const from = str(opt.from);
  const to = str(opt.to);
  const where = [];
  const args = [];
  if (q) {
    where.push(`(product_code LIKE ? OR product_name LIKE ? OR summary LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push(`in_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`in_date <= ?`);
    args.push(to);
  }
  return all(`SELECT * FROM inbound ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY in_date DESC, id DESC`, args);
}
export async function createInbound(data) {
  requireWriter();
  const stamp = nowISO();
  const r = await run(
    `INSERT INTO inbound(in_date, product_code, product_name, spec, qty, summary, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      str(data.in_date) || today(),
      str(data.product_code).trim(),
      str(data.product_name).trim(),
      str(data.spec).trim(),
      num(data.qty),
      str(data.summary),
      str(data.remark),
      stamp,
      stamp,
    ]
  );
  await registerProduct(data.product_code, data.product_name, data.spec, data.unit);
  return { id: Number(r.lastInsertRowid) };
}
export async function updateInbound(id, data) {
  requireWriter();
  await run(`UPDATE inbound SET in_date=?, product_code=?, product_name=?, spec=?, qty=?, summary=?, remark=?, updated_at=? WHERE id=?`, [
    str(data.in_date),
    str(data.product_code).trim(),
    str(data.product_name).trim(),
    str(data.spec).trim(),
    num(data.qty),
    str(data.summary),
    str(data.remark),
    nowISO(),
    Number(id),
  ]);
  return {};
}
export async function deleteInbound(id) {
  requireWriter();
  await guard();
  await run(`DELETE FROM inbound WHERE id=?`, [Number(id)]);
  return {};
}
export async function listOutbound(opt = {}) {
  const q = str(opt.q).trim();
  const from = str(opt.from);
  const to = str(opt.to);
  const where = [];
  const args = [];
  if (q) {
    where.push(`(product_code LIKE ? OR product_name LIKE ? OR summary LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push(`out_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`out_date <= ?`);
    args.push(to);
  }
  return all(`SELECT * FROM outbound ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY out_date DESC, id DESC`, args);
}
export async function createOutbound(data) {
  requireWriter();
  const stamp = nowISO();
  const r = await run(
    `INSERT INTO outbound(out_date, product_code, product_name, spec, qty, summary, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      str(data.out_date) || today(),
      str(data.product_code).trim(),
      str(data.product_name).trim(),
      str(data.spec).trim(),
      num(data.qty),
      str(data.summary),
      str(data.remark),
      stamp,
      stamp,
    ]
  );
  await registerProduct(data.product_code, data.product_name, data.spec, data.unit);
  return { id: Number(r.lastInsertRowid) };
}
export async function updateOutbound(id, data) {
  requireWriter();
  await run(`UPDATE outbound SET out_date=?, product_code=?, product_name=?, spec=?, qty=?, summary=?, remark=?, updated_at=? WHERE id=?`, [
    str(data.out_date),
    str(data.product_code).trim(),
    str(data.product_name).trim(),
    str(data.spec).trim(),
    num(data.qty),
    str(data.summary),
    str(data.remark),
    nowISO(),
    Number(id),
  ]);
  return {};
}
export async function deleteOutbound(id) {
  requireWriter();
  await guard();
  await run(`DELETE FROM outbound WHERE id=?`, [Number(id)]);
  return {};
}

/* ---------------- 系统 ---------------- */
export async function getSettings() {
  const rows = await all(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function saveSettings(data) {
  requireWriter();
  for (const [k, v] of Object.entries(data || {})) {
    if (k === 'delete_password' && !str(v)) continue;
    await setSetting(k, v);
  }
  return {};
}
export async function verifyDeletePassword(password) {
  const pwd = str(password);
  const expected = await getSetting('delete_password', '888888');
  let pass = pwd !== '' && pwd === expected;
  if (!pass && pwd) {
    for (const name of ['Asheng', 'admin']) {
      const u = await one(`SELECT * FROM users WHERE username = ?`, [name]);
      if (u && (await verifyPassword(pwd, u.salt, u.password_hash))) {
        pass = true;
        break;
      }
    }
  }
  return { valid: pass };
}
export async function getOverview() {
  const total = await one(`SELECT COALESCE(SUM(today_qty),0) AS v FROM report_items`);
  const days = await one(`SELECT COUNT(DISTINCT report_date) AS v FROM reports`);
  const orders = await all(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`);
  const stockCount = (await _getStock()).reduce((s, x) => s + num(x.stock), 0);
  return {
    total_output: num(total.v),
    days: num(days.v),
    orders: Object.fromEntries(orders.map((o) => [o.status, num(o.c)])),
    stock_total: stockCount,
    products: num((await one(`SELECT COUNT(*) AS v FROM products`)).v),
  };
}
export async function getEngine() {
  let target = '';
  try {
    target = new URL(DB_URL.replace(/^libsql:/, 'https:')).host;
  } catch (e) {
    target = 'Turso 云库';
  }
  return {
    engine: 'libSQL',
    remote: true,
    label: 'libSQL · Turso 云库（浏览器直连）',
    target,
    mode: 'static(browser→Turso)',
  };
}
export async function restoreBackup(payload) {
  requireWriter();
  await guard();
  const data = (payload && payload.data) || payload || {};
  const tables = ['report_items', 'reports', 'orders', 'inbound', 'outbound', 'products'];
  for (const t of tables) {
    if (!Array.isArray(data[t])) continue;
    await run(`DELETE FROM ${t}`);
    for (const row of data[t]) {
      const keys = Object.keys(row).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
      if (!keys.length) continue;
      await run(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map((k) => (row[k] === null || row[k] === undefined ? '' : row[k])));
    }
  }
  if (Array.isArray(data.settings)) {
    for (const s of data.settings) {
      if (s.key) await setSetting(s.key, s.value);
    }
  }
  await syncOrders();
  return {};
}

/* ---------------- 导出 / 备份（前端生成文件下载） ---------------- */
function toCSV(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 300);
}
async function buildExport(table) {
  if (table === 'products') {
    const r = await all(`SELECT code, name, spec, unit FROM products ORDER BY code`);
    return { title: '基础物品信息', headers: ['产品编号', '产品名称', '规格型号', '单位'], rows: r.map((x) => [x.code, x.name, x.spec, x.unit]) };
  }
  if (table === 'reports') {
    const list = await all(`SELECT * FROM reports ORDER BY report_date DESC`);
    const out = [];
    for (const rep of list) {
      const items = await all(`SELECT today_qty FROM report_items WHERE report_id=?`, [rep.id]);
      const total = items.reduce((s, i) => s + num(i.today_qty), 0);
      const manHours = num(rep.attendance) * num(rep.work_hours);
      out.push([
        rep.report_date, rep.line, rep.attendance, rep.work_hours, total,
        manHours ? (total / manHours).toFixed(2) : '0.00',
        num(rep.attendance) ? (total / num(rep.attendance)).toFixed(2) : '0.00',
        rep.created_by, rep.updated_at,
      ]);
    }
    return { title: '今日报表', headers: ['日期', '线别', '出勤人数', '出勤时间', '总产量', 'UPPH', 'UPPD', '录入人', '更新时间'], rows: out };
  }
  if (table === 'history') {
    const r = await getHistoryRows({});
    return {
      title: '历史记录',
      headers: ['日期', '线别', '订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '出勤人数', '备注'],
      rows: r.map((x) => [x.report_date, x.line, x.order_no, x.product_code, x.product_name, x.spec, x.unit, x.order_qty, x.today_qty, x.attendance, x.remark]),
    };
  }
  if (table === 'orders') {
    const r = await all(`SELECT * FROM orders ORDER BY id DESC`);
    return {
      title: '生产进度',
      headers: ['订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '进度', '订单状态', '开始日期', '最近日期'],
      rows: r.map((x) => [
        x.order_no, x.product_code, x.product_name, x.spec, x.unit, x.order_qty, x.done_qty,
        num(x.order_qty) ? `${Math.min(100, (num(x.done_qty) / num(x.order_qty)) * 100).toFixed(1)}%` : '0%',
        x.status, x.first_date, x.last_date,
      ]),
    };
  }
  if (table === 'stock') {
    const r = await _getStock();
    return {
      title: '成品库存',
      headers: ['产品编号', '产品名称', '规格型号', '单位', '生产数量', '其他入库', '成品出库', '成品库存'],
      rows: r.map((x) => [x.product_code, x.product_name, x.spec, x.unit, x.produced, x.inbound, x.outbound, x.stock]),
    };
  }
  if (table === 'inbound') {
    const r = await all(`SELECT * FROM inbound ORDER BY in_date DESC`);
    return { title: '其他入库', headers: ['入库日期', '产品编号', '产品名称', '规格型号', '入库数量', '入库摘要', '备注'], rows: r.map((x) => [x.in_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]) };
  }
  if (table === 'outbound') {
    const r = await all(`SELECT * FROM outbound ORDER BY out_date DESC`);
    return { title: '成品出库', headers: ['出库日期', '产品编号', '产品名称', '规格型号', '出库数量', '出库摘要', '备注'], rows: r.map((x) => [x.out_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]) };
  }
  return null;
}
const EXPORT_TABLES = ['products', 'reports', 'history', 'orders', 'stock', 'inbound', 'outbound'];

export async function exportDownload(table, format = 'csv') {
  if (table === 'all' || !table) {
    const parts = [];
    for (const key of EXPORT_TABLES) {
      const def = await buildExport(key);
      parts.push(`# ${def.title}`);
      parts.push(toCSV(def.headers, def.rows).replace(/^\uFEFF/, ''));
      parts.push('');
    }
    downloadBlob('\uFEFF' + parts.join('\r\n'), `production-all-${today()}.csv`, 'text/csv;charset=utf-8');
    return;
  }
  const def = await buildExport(table);
  if (!def) fail('未知的数据表');
  if (format === 'json') {
    downloadBlob(JSON.stringify({ headers: def.headers, rows: def.rows }, null, 2), `${table}-${today()}.json`, 'application/json;charset=utf-8');
    return;
  }
  downloadBlob(toCSV(def.headers, def.rows), `${table}-${today()}.csv`, 'text/csv;charset=utf-8');
}

/** 静态版备份标记（downloadUrl 识别后执行备份下载） */
export function backupUrl() {
  return '__pmc_backup__';
}
export async function downloadUrl(url) {
  if (url === '__pmc_backup__') {
    const tables = ['products', 'reports', 'report_items', 'orders', 'inbound', 'outbound', 'settings'];
    const data = {};
    for (const t of tables) data[t] = await all(`SELECT * FROM ${t}`);
    const payload = {
      app: '生产管理系统',
      engine: 'libSQL',
      source: 'static(browser→Turso)',
      version: 1,
      exported_at: nowISO(),
      data,
    };
    downloadBlob(JSON.stringify(payload, null, 2), `pmc-backup-${today()}.json`, 'application/json;charset=utf-8');
    return;
  }
  /* 兼容导出链接（table=xxx&format=csv） */
  try {
    const u = new URL(url, location.href);
    if (u.pathname.endsWith('/api/export')) {
      await exportDownload(u.searchParams.get('table') || 'all', u.searchParams.get('format') || 'csv');
    }
  } catch (e) {
    /* ignore */
  }
}
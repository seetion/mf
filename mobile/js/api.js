/* ============================================================
   api.js —— 移动端只读版 · 纯查询接口
   游客码验证 + 仪表盘数据（产量UPPH / 库存 / 生产进度）
   ============================================================ */

import { all, one } from './db.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- 游客码验证 ---------------- */

export async function loginGuest(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('请输入游客码');
  const row = await one(`SELECT * FROM guest_codes WHERE code = ?`, [code]);
  if (!row) throw new Error('游客码无效或已被删除');
  const label = String(row.remark || '').trim() || code;
  return { username: `游客·${label}`, code };
}

/* ---------------- 概览 KPI ---------------- */

export async function getOverview() {
  const total = await one(`SELECT COALESCE(SUM(today_qty),0) AS v FROM report_items`);
  const days = await one(`SELECT COUNT(DISTINCT report_date) AS v FROM reports`);
  const orders = await all(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`);
  const products = await one(`SELECT COUNT(*) AS v FROM products`);
  // 今日产量
  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const todayTotal = await one(
    `SELECT COALESCE(SUM(ri.today_qty),0) AS v FROM report_items ri JOIN reports r ON r.id = ri.report_id WHERE r.report_date = ?`,
    [todayStr]
  );
  return {
    total_output: num(total.v),
    days: num(days.v),
    orders: Object.fromEntries(orders.map((o) => [o.status, num(o.c)])),
    products: num(products.v),
    today_output: num(todayTotal.v),
  };
}

/* ---------------- 历史产量 + UPPH ---------------- */

/**
 * 近 N 天日报汇总（含 UPPH）
 * UPPH = 当日总产量 / (出勤人数 × 出勤时间)
 */
export async function getRecentReports(limit = 14) {
  const reps = await all(
    `SELECT id, report_date, line, attendance, work_hours, remark, created_by
       FROM reports ORDER BY report_date DESC, id DESC LIMIT ?`,
    [limit]
  );
  if (!reps.length) return [];
  // 一次性聚合各报表产量
  const ids = reps.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const sums = await all(
    `SELECT report_id, COALESCE(SUM(today_qty),0) AS total FROM report_items WHERE report_id IN (${placeholders}) GROUP BY report_id`,
    ids
  );
  const sumMap = new Map(sums.map((s) => [Number(s.report_id), num(s.total)]));
  return reps.map((r) => {
    const total = sumMap.get(Number(r.id)) || 0;
    const mh = num(r.attendance) * num(r.work_hours);
    return { ...r, total, upph: mh > 0 ? total / mh : 0 };
  });
}

/* ---------------- 库存 ---------------- */

export async function getStock() {
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
  const keyOf = (code, name) => norm(code) || `@${norm(name)}`;
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
  for (const r of inb) { ensure(r.product_code, r.product_name).inbound += num(r.qty); }
  for (const r of outb) { ensure(r.product_code, r.product_name).outbound += num(r.qty); }
  const list = [...map.values()].map((r) => ({ ...r, stock: r.produced + r.inbound - r.outbound }));
  list.sort((a, b) => String(a.product_code).localeCompare(String(b.product_code), 'zh-CN'));
  return list;
}

/* ---------------- 生产进度 ---------------- */

export async function listOrders(limit = 100) {
  const rows = await all(`SELECT * FROM orders LIMIT ?`, [limit * 2]);
  // 按最近日期降序（最新在前），无日期的排末尾
  rows.sort((a, b) => {
    const av = a.last_date || '';
    const bv = b.last_date || '';
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return bv < av ? -1 : bv > av ? 1 : 0;
  });
  return rows.slice(0, limit);
}
/* ============================================================
   app.js —— 移动端只读版主逻辑
   登录（哈希值码+游客码）→ 仪表盘渲染（概览/库存/进度）
   ============================================================ */

import * as db from './db.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function fmt(n, d = 0) {
  return num(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function esc(s) {
  const map = { '&': String.fromCharCode(38) + 'amp;', '<': String.fromCharCode(38) + 'lt;', '>': String.fromCharCode(38) + 'gt;', '"': String.fromCharCode(38) + 'quot;', "'": String.fromCharCode(38) + '#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => map[c]);
}

/* ---------------- 启动 ---------------- */

db.applyHashConfig();

const guest = db.getGuest();
const configured = db.hasConfig();

if (configured && guest) {
  enterApp(guest);
} else {
  showLogin();
}

/* ---------------- 登录页 ---------------- */

function showLogin(cfgError) {
  $('loginPage').style.display = 'flex';
  $('app').style.display = 'none';
  if (db.hasConfig()) {
    $('cfgField').style.display = 'none';
  } else {
    $('cfgField').style.display = '';
  }
  if (cfgError) showError(cfgError);
}

function showError(msg) {
  const box = $('loginError');
  box.textContent = msg;
  box.classList.add('show');
}

function clearError() {
  $('loginError').classList.remove('show');
}

$('btnLogin').addEventListener('click', doLogin);
$('guestInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('cfgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('guestInput').focus(); });

async function doLogin() {
  clearError();
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = '连接中…';
  try {
    // 第一步：如未配置，先保存哈希值码并测试连接
    if (!db.hasConfig()) {
      const suffix = $('cfgInput').value.trim();
      if (!suffix) { showError('请输入哈希值码'); return; }
      db.saveSuffix(suffix);
      try {
        await db.ping();
      } catch (e) {
        db.clearConfig();
        showError('哈希值码不正确，无法连接服务器');
        return;
      }
    } else {
      try { await db.ping(); } catch (e) {
        db.clearConfig();
        showError('连接已失效，请重新输入哈希值码');
        $('cfgField').style.display = '';
        return;
      }
    }
    // 第二步：验证游客码
    const code = $('guestInput').value.trim();
    if (!code) { showError('请输入游客码'); return; }
    const g = await api.loginGuest(code);
    db.saveGuest(g);
    enterApp(g);
  } catch (e) {
    showError(e.message || '登录失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '连接并进入';
  }
}

/* ---------------- 进入应用 ---------------- */

function enterApp(guest) {
  $('loginPage').style.display = 'none';
  $('app').style.display = '';
  $('userName').textContent = guest.username || '游客';
  loadAll();
}

$('btnLogout').addEventListener('click', () => {
  db.clearGuest();
  location.reload();
});

/* ---------------- Tab 切换 ---------------- */

const PAGE_TITLES = { pageHome: '概览', pageStock: '库存', pageProgress: '进度' };
let loadedPages = new Set();

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const pageId = tab.dataset.page;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === pageId));
    $('topTitle').textContent = PAGE_TITLES[pageId] || '';
    // 懒加载：首次切换时加载数据
    if (!loadedPages.has(pageId)) {
      loadedPages.add(pageId);
      if (pageId === 'pageStock') loadStock();
      if (pageId === 'pageProgress') loadOrders();
    }
  });
});

/* ---------------- 数据加载 ---------------- */

async function loadAll() {
  loadedPages.add('pageHome');
  await Promise.all([loadOverview(), loadRecent()]);
}

async function loadOverview() {
  try {
    const ov = await api.getOverview();
    $('kToday').textContent = fmt(ov.today_output);
    $('kTotal').textContent = fmt(ov.total_output);
    const doing = num(ov.orders['开工']) + num(ov.orders['追加']);
    $('kOrders').textContent = fmt(doing);
    // 库存合计需单独查询，异步填入
    api.getStock().then((list) => {
      const total = list.reduce((s, x) => s + num(x.stock), 0);
      $('kStock').textContent = fmt(total);
    }).catch(() => { $('kStock').textContent = '-'; });
  } catch (e) {
    console.error('loadOverview:', e);
  }
}

async function loadRecent() {
  const host = $('recentList');
  host.innerHTML = '<div class="loading-box">加载中…</div>';
  try {
    const reps = await api.getRecentReports(14);
    if (!reps.length) {
      host.innerHTML = '<div class="empty-box">暂无报表记录</div>';
      return;
    }
    host.innerHTML = reps.map((r) => {
      const [y, m, d] = String(r.report_date || '').split('-');
      const mh = num(r.attendance) * num(r.work_hours);
      const upph = mh > 0 ? r.upph : 0;
      return `
        <div class="rep-item">
          <div class="rep-date">
            <div class="d-day">${d || '-'}</div>
            <div class="d-month">${m || ''}月</div>
          </div>
          <div class="rep-info">
            <div class="r-line"><span class="tag tag-line">${esc(r.line || '-')}</span> ${fmt(r.total)} 件</div>
            <div class="r-meta">出勤 ${fmt(r.attendance)} 人 × ${fmt(r.work_hours, 1)} 时${r.remark ? ' · ' + esc(r.remark) : ''}</div>
          </div>
          <div class="rep-nums">
            <div class="r-total">${fmt(r.total)}</div>
            <div class="r-upph">UPPH ${fmt(upph, 2)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    host.innerHTML = `<div class="empty-box">加载失败：${esc(e.message || '未知错误')}</div>`;
  }
}

async function loadStock() {
  const host = $('stockList');
  host.innerHTML = '<div class="loading-box">加载中…</div>';
  try {
    const list = await api.getStock();
    $('stockCount').textContent = `${list.length} 项`;
    if (!list.length) {
      host.innerHTML = '<div class="empty-box">暂无库存数据</div>';
      return;
    }
    host.innerHTML = list.map((r) => {
      const s = num(r.stock);
      const cls = s > 0 ? 'pos' : s < 0 ? 'neg' : 'zero';
      return `
        <div class="stock-item">
          <div class="stock-row">
            <div class="stock-name">${esc(r.product_name || r.product_code || '-')}</div>
            <div class="stock-qty ${cls}">${fmt(s)}</div>
          </div>
          <div class="stock-code">${esc(r.product_code)}${r.spec ? ' · ' + esc(r.spec) : ''}</div>
          <div class="stock-meta">
            <span>产量 ${fmt(r.produced)}</span>
            <span>入库 ${fmt(r.inbound)}</span>
            <span>出库 ${fmt(r.outbound)}</span>
            <span>${esc(r.unit || '')}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    host.innerHTML = `<div class="empty-box">加载失败：${esc(e.message || '未知错误')}</div>`;
  }
}

async function loadOrders() {
  const host = $('orderList');
  host.innerHTML = '<div class="loading-box">加载中…</div>';
  try {
    const orders = await api.listOrders(100);
    $('orderCount').textContent = `${orders.length} 单`;
    if (!orders.length) {
      host.innerHTML = '<div class="empty-box">暂无生产订单</div>';
      return;
    }
    host.innerHTML = orders.map((r) => {
      const done = num(r.done_qty);
      const total = num(r.order_qty);
      const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
      const over = done > total && total > 0;
      return `
        <div class="order-item">
          <div class="order-top">
            <div class="order-no">${esc(r.order_no)}</div>
            <span class="st-badge st-${esc(r.status)}">${esc(r.status)}</span>
          </div>
          <div class="order-prod">${esc(r.product_name || r.product_code || '-')}${r.spec ? ' · ' + esc(r.spec) : ''}</div>
          <div class="progress-bar">
            <div class="progress-fill${over ? ' over' : ''}" style="width:${pct}%"></div>
          </div>
          <div class="order-nums">
            <span>完成 <b>${fmt(done)}</b> / ${fmt(total)} ${esc(r.unit || '')}</span>
            <span>${r.first_date ? esc(r.first_date) : ''}${r.last_date ? ' → ' + esc(r.last_date) : ''}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    host.innerHTML = `<div class="empty-box">加载失败：${esc(e.message || '未知错误')}</div>`;
  }
}
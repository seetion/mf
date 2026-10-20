/* ============================================================
   app.js —— 应用入口：路由 / 导航 / 登录
   ============================================================ */

import * as api from './api.js';
import { deleteGuard } from './api.js';
import { $, $$, el, toast, status, loadLocal } from './util.js';
import { applyAppearance, loadProducts, loadSettings, refreshUserUI } from './store.js';
import { ensureConfig } from './config-ui.js';
import { applyHashConfig } from './db.js';

import * as home from './pages/home.js';
import * as today from './pages/today.js';
import * as history from './pages/history.js';
import * as progress from './pages/progress.js';
import * as stock from './pages/stock.js';
import * as inbound from './pages/inbound.js';
import * as outbound from './pages/outbound.js';
import * as settings from './pages/settings.js';

const ROUTES = { home, today, history, progress, stock, inbound, outbound, settings };
const STOCK_ROUTES = ['stock', 'inbound', 'outbound'];

let cleanupFn = null;

/* ---------------- 路由 ---------------- */
function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[raw] ? raw : 'home';
}

function setActiveNav(key) {
  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  $$(`.nav-item[data-route="${key}"]`).forEach((n) => n.classList.add('active'));
  const group = document.querySelector('.nav-group[data-group="stock"]');
  if (group) group.classList.toggle('open', STOCK_ROUTES.includes(key));
}

async function navigate() {
  const key = currentRoute();
  const mod = ROUTES[key];
  const view = $('#view');

  if (typeof cleanupFn === 'function') {
    try {
      cleanupFn();
    } catch (e) {
      /* ignore */
    }
    cleanupFn = null;
  }

  setActiveNav(key);
  $('#crumb').textContent = mod.meta.title;
  document.title = `${mod.meta.title} - 生产管理系统`;
  view.scrollTop = 0;
  view.innerHTML = '<div class="loading">正在加载…</div>';

  try {
    cleanupFn = await mod.render(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = '';
    view.appendChild(
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'empty', html: `<span class="big">✖</span>页面加载失败：${e.message || e}` }),
        ]),
      ])
    );
  }
}

/* ---------------- 登录 ---------------- */
let loginMode = 'admin';

function setLoginMode(mode) {
  loginMode = mode === 'guest' ? 'guest' : 'admin';
  $$('.login-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === loginMode));
  $('#paneAdmin').classList.toggle('hidden', loginMode !== 'admin');
  $('#paneGuest').classList.toggle('hidden', loginMode !== 'guest');
  const tip = $('#loginTip');
  tip.className = 'login-tip';
  tip.textContent =
    loginMode === 'admin'
      ? '请输入超级管理员账号与密码'
      : '请输入超级管理员创建的游客码（只读，不能录入或修改数据）';
  setTimeout(() => (loginMode === 'admin' ? $('#loginUser') : $('#guestCode')).focus(), 40);
}

/** 打开登录门：打开网页 / 退出登录后，必须登录才能进入系统 */
function openLogin() {
  $('#loginMask').classList.remove('hidden');
  setLoginMode(loginMode);
}
function closeLogin() {
  $('#loginMask').classList.add('hidden');
  $('#loginPass').value = '';
  $('#guestCode').value = '';
  $('#loginTip').className = 'login-tip';
}
window.pmcOpenLogin = openLogin;

async function doLogin() {
  const tip = $('#loginTip');
  const btn = $('#loginSubmit');
  btn.disabled = true;
  try {
    let r;
    if (loginMode === 'admin') {
      const username = $('#loginUser').value.trim();
      const password = $('#loginPass').value;
      if (!username || !password) {
        tip.className = 'login-tip warn';
        tip.textContent = '请输入账号与密码';
        return;
      }
      r = await api.login(username, password);
    } else {
      const code = $('#guestCode').value.trim();
      if (!code) {
        tip.className = 'login-tip warn';
        tip.textContent = '请输入游客码';
        return;
      }
      r = await api.loginGuest(code);
    }
    api.session.set(r.token, r.user);
    deleteGuard.password = '';
    refreshUserUI();
    closeLogin();
    toast(`欢迎，${r.user.username}`, 'success');
    await loadSettings();
    await loadProducts(true);
    await navigate();
  } catch (e) {
    tip.className = 'login-tip warn';
    tip.textContent = e.message || '登录失败';
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  try {
    await api.logout();
  } catch (e) {
    /* ignore */
  }
  api.session.clear();
  deleteGuard.password = '';
  refreshUserUI();
  toast('已退出登录', 'info');
  await navigate();
  openLogin(); // 退出后必须重新登录
}

/* ---------------- 启动 ---------------- */
async function boot() {
  // 先应用本地外观设置，避免闪烁
  applyAppearance();

  // 纯静态版：先处理 URL 携带的数据库配置（#cfg=…），再确保已完成配置
  applyHashConfig();
  status('正在连接 Turso 云库…');
  try {
    await ensureConfig();
  } catch (e) {
    toast('数据库配置未完成，无法进入系统', 'error', 5000);
    status('未配置数据库');
    return;
  }

  // 导航交互
  $('#btnToggleSide').addEventListener('click', () => document.querySelector('.app').classList.toggle('collapsed'));
  $('.nav-group[data-group="stock"] .nav-parent').addEventListener('click', () => {
    document.querySelector('.nav-group[data-group="stock"]').classList.add('open');
  });
  window.addEventListener('hashchange', navigate);

  // 直接按 Ctrl+P 时若没有生成报表单据，则打印页面本身，避免空白页
  window.addEventListener('beforeprint', () => {
    const area = document.getElementById('printArea');
    document.body.classList.toggle('print-empty', !area || !area.childElementCount);
  });

  // 登录相关（登录门不可关闭：未登录不能进入系统）
  $('#btnSwitch').addEventListener('click', openLogin);
  $('#btnLogout').addEventListener('click', doLogout);
  $('#loginSubmit').addEventListener('click', doLogin);
  $$('.login-tab').forEach((t) => t.addEventListener('click', () => setLoginMode(t.dataset.mode)));
  $('#loginPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  $('#loginUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginPass').focus();
  });
  $('#guestCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  // 打开网页立即弹出登录页
  if (!api.session.logged) openLogin();

  // 校验数据库连接与本地会话
  status('正在验证数据库连接…');
  try {
    await loadSettings();
    if (api.session.token) {
      const r = await api.me();
      if (r && r.user) {
        api.session.set(api.session.token, r.user);
        closeLogin();
      } else {
        api.session.clear();
        openLogin();
      }
    }
    await loadProducts(true);
    const eng = await api.getEngine();
    const badge = $('#dbBadge');
    badge.textContent = 'libSQL · 云库直连';
    badge.title = `当前数据源：${eng.label}\n${eng.target}`;
    badge.style.background = 'rgba(22,163,74,.28)';
    badge.style.color = '#9fe6bb';
    console.log('[数据引擎]', eng.label, eng.target);
  } catch (e) {
    console.error(e);
    toast(`无法连接 Turso 云库：${e.message || e}`, 'error', 6000);
    status('云库连接失败');
  }
  refreshUserUI();

  if (!location.hash) location.hash = '#/home';
  await navigate();
  status('就绪');
}

boot();

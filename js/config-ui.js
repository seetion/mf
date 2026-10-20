/* ============================================================
   config-ui.js —— 首次配置界面（仅需输入令牌后半段）
   地址与前缀写死于 config.js，使用者只需输入签名段
   ============================================================ */

import { hasConfig, saveSuffix, ping, buildShareLink, getSuffix } from './db.js';
import { el, toast } from './util.js';

/** 确保已完成数据库配置；未配置则弹出配置门，返回 Promise（配置成功后 resolve） */
export function ensureConfig() {
  if (hasConfig()) return Promise.resolve(true);
  return new Promise((resolve) => {
    openConfigGate(resolve);
  });
}

function openConfigGate(onDone) {
  const mask = document.getElementById('configMask') || createMask();
  mask.classList.remove('hidden');

  const suffixInput = document.getElementById('cfgSuffix');
  const tip = document.getElementById('cfgTip');
  const btnTest = document.getElementById('cfgTest');
  const btnSave = document.getElementById('cfgSave');

  // 预填已有后缀（修改配置场景）
  const existing = getSuffix();
  if (existing) suffixInput.value = existing;

  const setTip = (msg, type = '') => {
    tip.className = 'login-tip' + (type ? ' ' + type : '');
    tip.textContent = msg;
  };

  const readSuffix = () => {
    const s = suffixInput.value.trim();
    if (!s) {
      setTip('请填写哈希值码', 'warn');
      suffixInput.focus();
      return null;
    }
    return s;
  };

  btnTest.onclick = async () => {
    const s = readSuffix();
    if (!s) return;
    btnTest.disabled = true;
    setTip('正在测试连接…');
    try {
      saveSuffix(s);
      await ping();
      setTip('连接成功！数据库可正常访问', 'ok');
    } catch (e) {
      setTip(`连接失败：${e.message || e}，请检查哈希值码是否正确`, 'warn');
    } finally {
      btnTest.disabled = false;
    }
  };

  btnSave.onclick = async () => {
    const s = readSuffix();
    if (!s) return;
    btnSave.disabled = true;
    setTip('正在验证并保存…');
    try {
      saveSuffix(s);
      await ping();
      mask.classList.add('hidden');
      toast('数据库配置成功', 'success');
      onDone(true);
    } catch (e) {
      setTip(`保存失败：${e.message || e}，请检查哈希值码`, 'warn');
    } finally {
      btnSave.disabled = false;
    }
  };

  suffixInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSave.click();
  });

  setTimeout(() => suffixInput.focus(), 60);
}

function createMask() {
  const mask = el('div', { class: 'mask', id: 'configMask' });
  mask.appendChild(
    el('div', { class: 'dialog dialog-sm login-gate' }, [
      el('div', { class: 'dialog-head' }, [el('span', { text: '首次使用 · 输入哈希值码' })]),
      el('div', { class: 'dialog-body' }, [
        el('div', { class: 'danger-box', style: 'margin-bottom:12px' }, [
          el('div', { class: 'danger-title', text: '数据库地址已内置，请输入哈希值' }),
          el('div', {
            class: 'danger-detail',
            text: '请输入哈希值码，连接服务器',
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '哈希值码（由管理员提供）' }),
          el('input', {
            type: 'password',
            id: 'cfgSuffix',
            placeholder: '输入管理员提供的哈希值码…',
            autocomplete: 'off',
          }),
        ]),
        el('div', { class: 'login-tip', id: 'cfgTip', text: '填写后建议先「测试连接」，确认无误再保存' }),
      ]),
      el('div', { class: 'dialog-foot' }, [
        el('button', { class: 'btn', id: 'cfgTest', text: '测试连接' }),
        el('button', { class: 'btn btn-primary', id: 'cfgSave', text: '保存并进入' }),
      ]),
    ])
  );
  document.body.appendChild(mask);
  return mask;
}

/** 生成分享链接（设置页可调用） */
export function shareLink() {
  return buildShareLink();
}
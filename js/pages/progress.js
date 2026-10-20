/* ============================================================
   pages/progress.js —— 生产进度
   ============================================================ */

import * as api from '../api.js';
import { progressBar, renderTable } from '../table.js';
import { findProduct, guestBar, isGuest, loadProducts, requireLogin, withDeleteGuard } from '../store.js';
import { dialog, el, num, fmtQty, toast, status, debounce, escapeHtml } from '../util.js';

const STATUSES = ['下达', '开工', '完工', '结单', '追加'];
const STATUS_DESC = {
  下达: '订单已下达，尚未开工',
  开工: '已开工，正在生产',
  完工: '完成数量已达订单数量',
  结单: '订单已结案',
  追加: '订单数量已追加',
};

export async function render(view) {
  await loadProducts();
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar('游客模式：可查看生产进度，无法修改订单状态。'));

  let rows = [];
  let filter = { q: '', status: '' };

  const searchInput = el('input', { type: 'search', placeholder: '订单号 / 产品编号 / 名称' });
  const stat = el('span', { class: 'hint' });
  const btnNew = el('button', { class: 'btn btn-sm btn-primary', text: '＋ 手工建单' });
  const btnBatch = el('button', { class: 'btn btn-sm', text: '≡ 批量录入' });
  const btnExport = el('button', { class: 'btn btn-sm', text: '⤓ 导出 CSV' });
  const btnRefresh = el('button', { class: 'btn btn-sm', text: '↻ 刷新' });

  const tabs = el('div', { class: 'toolbar' });
  ['全部', ...STATUSES].forEach((s) => {
    const b = el('button', { class: `btn btn-sm ${s === '全部' ? 'active' : ''}`, text: s });
    b.addEventListener('click', () => {
      filter.status = s === '全部' ? '' : s;
      Array.from(tabs.querySelectorAll('.btn')).forEach((x) => x.classList.toggle('active', x === b));
      load();
    });
    tabs.appendChild(b);
  });
  tabs.appendChild(el('span', { class: 'grow' }));
  tabs.appendChild(el('span', { class: 'hint', text: '状态说明：' + STATUSES.map((s) => `${s}（${STATUS_DESC[s]}）`).join('；') }));

  const tableHost = el('div');

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '生产进度' }),
      el('div', { class: 'sub', text: '手工建单维护订单，完成数量随今日报表录入自动累计' }),
      el('div', { class: 'tools' }, [stat, btnRefresh, btnExport, btnBatch, btnNew]),
    ]),
    tabs,
    el('div', { class: 'toolbar' }, [el('div', { class: 'search' }, [searchInput]), el('span', { class: 'hint', text: '可手动调整订单状态（结单 / 追加 为人工状态，不会被自动覆盖）' })]),
    tableHost,
  ]);
  view.appendChild(panel);

  /* ---------------- 手工建单 ---------------- */
  function fieldWrap(label, input) {
    return el('div', { class: 'field' }, [el('label', { text: label }), input]);
  }

  function openCreate() {
    if (!requireLogin('手工建单')) return;
    const orderInput = el('input', { placeholder: '如：DD20261019-01' });
    const codeInput = el('input', { placeholder: '输入编号自动带出' });
    const nameInput = el('input', {});
    const specInput = el('input', {});
    const unitInput = el('input', {});
    const qtyInput = el('input', { type: 'number', step: 'any', min: '0', placeholder: '订单总数量' });

    codeInput.setAttribute('list', 'ioProductList');
    codeInput.addEventListener('change', () => {
      const p = findProduct(codeInput.value);
      if (p) {
        nameInput.value = p.name || nameInput.value;
        specInput.value = p.spec || specInput.value;
        unitInput.value = p.unit || unitInput.value;
      }
    });

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        fieldWrap('工单号', orderInput),
        fieldWrap('产品编号', codeInput),
        fieldWrap('产品名称', nameInput),
        fieldWrap('规格型号', specInput),
        fieldWrap('单位', unitInput),
        fieldWrap('订单数量', qtyInput),
      ]),
      el('div', { class: 'hint', style: 'margin-top:8px', text: '建单后状态为「下达」；在今日报表录入对应工单号产量时，完成数量自动累计。' }),
    ]);

    return dialog({
      title: '手工建单',
      body,
      okText: '建单',
      onOk: async () => {
        const payload = {
          order_no: orderInput.value.trim(),
          product_code: codeInput.value.trim(),
          product_name: nameInput.value.trim(),
          spec: specInput.value.trim(),
          unit: unitInput.value.trim(),
          order_qty: num(qtyInput.value),
        };
        if (!payload.order_no) { toast('请填写工单号', 'warn'); return false; }
        if (!payload.product_code) { toast('请填写产品编号', 'warn'); return false; }
        if (payload.order_qty <= 0) { toast('订单数量必须大于 0', 'warn'); return false; }
        await api.createOrder(payload);
        await loadProducts(true);
        toast(`工单 ${payload.order_no} 建单成功`, 'success');
        load();
      },
    });
  }

  /* ---------------- 批量录入 ---------------- */
  function openBatch() {
    if (!requireLogin('批量建单')) return;
    const ta = el('textarea', {
      rows: 10,
      style: 'width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px',
      placeholder: '每行一条，字段用制表符(Tab)或逗号分隔：\n工单号\t产品编号\t产品名称\t规格\t单位\t订单数量\n\n示例：\nDD20261019-01\tP001\t轴承\t6204\t套\t1000\nDD20261019-02,P002,法兰,DN50,个,500',
    });
    const body = el('div', {}, [
      el('div', { class: 'hint', style: 'margin-bottom:8px', text: '第一列为工单号、第二列为产品编号……最后一列为订单数量；可从 Excel 直接粘贴（Tab 分隔）。' }),
      ta,
      el('div', { id: 'batchOrderResult', style: 'margin-top:8px' }),
    ]);
    return dialog({
      title: '批量建单',
      body,
      width: 'dialog-lg',
      okText: '导入',
      onOk: async () => {
        const text = ta.value.trim();
        if (!text) { toast('请先粘贴数据', 'warn'); return false; }
        const rows = [];
        for (const line of text.split(/\r?\n/)) {
          const s = line.trim();
          if (!s) continue;
          const parts = s.includes('\t') ? s.split('\t') : s.split(',');
          if (parts.length < 2) continue;
          rows.push({
            order_no: parts[0],
            product_code: parts[1],
            product_name: parts[2] || '',
            spec: parts[3] || '',
            unit: parts[4] || '',
            order_qty: num(parts[5]),
          });
        }
        if (!rows.length) { toast('未解析到有效数据，请检查格式', 'warn'); return false; }
        const r = await api.batchOrders(rows);
        await loadProducts(true);
        const box = document.getElementById('batchOrderResult');
        if (box) {
          box.innerHTML = `<div class="hint">导入成功 ${r.imported} 条，跳过 ${r.skipped} 条${r.errors && r.errors.length ? '<br>' + r.errors.slice(0, 5).map((e) => escapeHtml(e)).join('<br>') : ''}</div>`;
        }
        toast(`导入成功 ${r.imported} 条，跳过 ${r.skipped} 条`, r.skipped ? 'warn' : 'success');
        load();
        return false; // 保留对话框显示结果，用户手动关闭
      },
    });
  }

  /* ---------------- 追加产能 ---------------- */
  function openAppend(r) {
    if (!requireLogin('追加产能')) return;
    const oldQty = num(r.order_qty);
    const doneQty = num(r.done_qty);
    const addInput = el('input', { type: 'number', step: 'any', min: '0', placeholder: '输入追加数量（正数）' });
    const preview = el('div', { class: 'hint', style: 'margin-top:6px;min-height:18px' });
    addInput.addEventListener('input', () => {
      const add = num(addInput.value);
      preview.innerHTML = add > 0
        ? `追加后订单数量：<b>${fmtQty(oldQty + add)}</b>　完成数量 <b>${fmtQty(doneQty)}</b>　状态将自动重算`
        : '';
    });
    const body = el('div', {}, [
      el('div', { class: 'hint', style: 'margin-bottom:8px', html: `工单 <b>${escapeHtml(r.order_no)}</b>　${escapeHtml(r.product_name || r.product_code)}<br/>当前订单数量 <b>${fmtQty(oldQty)}</b>　完成数量 <b>${fmtQty(doneQty)}</b>　状态 <b>${escapeHtml(r.status)}</b>` }),
      fieldWrap('追加数量', addInput),
      preview,
    ]);
    return dialog({
      title: '追加产能',
      body,
      okText: '确认追加',
      onOk: async () => {
        const add = num(addInput.value);
        if (add <= 0) { toast('追加数量必须大于 0', 'warn'); return false; }
        const newQty = oldQty + add;
        await api.updateOrder(r.id, { order_qty: newQty });
        toast(`已追加 ${fmtQty(add)}，订单数量更新为 ${fmtQty(newQty)}`, 'success');
        load();
      },
    });
  }

  function statusSelect(row) {
    const sel = el('select', { class: 'input-sm', style: `width:auto;color:${statusColor(row.status)};font-weight:700` });
    STATUSES.forEach((s) => sel.appendChild(el('option', { value: s, text: s })));
    sel.value = row.status;
    sel.addEventListener('change', async () => {
      if (!requireLogin('修改订单状态')) {
        sel.value = row.status;
        return;
      }
      try {
        await api.updateOrder(row.id, { status: sel.value });
        row.status = sel.value;
        sel.style.color = statusColor(sel.value);
        toast(`订单 ${row.order_no} 状态已更新为「${sel.value}」`, 'success');
        load();
      } catch (e) {
        toast(e.message || '更新失败', 'error');
        sel.value = row.status;
      }
    });
    return sel;
  }

  function statusColor(s) {
    return { 下达: '#d9a400', 开工: '#1f6feb', 完工: '#16a34a', 结单: '#135c2b', 追加: '#7c3aed' }[s] || '#1f2937';
  }

  function renderRows() {
    renderTable(tableHost, {
      key: 'progress',
      pageSize: 20,
      empty: '暂无生产订单，点击右上角「手工建单」添加',
      rows,
      columns: [
        { key: 'seq', title: '序号', width: 48, align: 'center', render: (_, idx) => idx + 1 },
        { key: 'order_no', title: '订单号', width: 125 },
        { key: 'product_code', title: '产品编号', width: 120 },
        { key: 'product_name', title: '产品名称', width: 190 },
        { key: 'spec', title: '规格型号', width: 140 },
        { key: 'unit', title: '单位', width: 60, align: 'center' },
        { key: 'order_qty', title: '订单数量', width: 95, align: 'right', render: (r) => fmtQty(r.order_qty) },
        { key: 'done_qty', title: '完成数量', width: 95, align: 'right', render: (r) => `<b>${fmtQty(r.done_qty)}</b>` },
        { key: 'progress', title: '进度', width: 130, render: (r) => progressBar(r.done_qty, r.order_qty) },
        {
          key: 'status',
          title: '订单状态',
          width: 120,
          align: 'center',
          render: (r) =>
            isGuest()
              ? `<span class="st-${r.status}">${r.status}</span>`
              : statusSelect(r),
        },
        { key: 'first_date', title: '开始日期', width: 105 },
        { key: 'last_date', title: '最近日期', width: 105 },
        {
          key: 'ops',
          title: '操作',
          width: 116,
          align: 'center',
          render: (r) => {
            const wrap = el('span', {});
            const bAdd = el('button', { class: 'btn-link', text: '追加', title: '追加产能：在原订单数量基础上增加' });
            bAdd.addEventListener('click', () => openAppend(r));
            const bDel = el('button', { class: 'btn-link danger', text: '删除' });
            bDel.addEventListener('click', async () => {
              const detail = `订单 ${r.order_no}　${r.product_code}　${r.product_name}\n完成数量 ${r.done_qty} / 订单数量 ${r.order_qty}　状态 ${r.status}`;
              const done = await withDeleteGuard(detail, async () => api.deleteOrder(r.id));
              if (done) {
                toast(`已删除订单进度：${r.order_no}`, 'success');
                load();
              }
            });
            wrap.appendChild(bAdd);
            wrap.appendChild(bDel);
            return wrap;
          },
        },
      ],
      footer: (rs) => [
        '',
        '合计',
        '',
        '',
        '',
        '',
        fmtQty(rs.reduce((s, x) => s + num(x.order_qty), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.done_qty), 0)),
        '',
        '',
        '',
        '',
        `${rs.length} 单`,
      ],
    });
  }

  async function load() {
    status('加载生产进度…');
    tableHost.innerHTML = '<div class="loading">正在加载…</div>';
    try {
      rows = await api.listOrders(filter);
    } catch (e) {
      rows = [];
      toast(e.message || '加载失败', 'error');
    }
    const doing = rows.filter((r) => r.status === '开工').length;
    const done = rows.filter((r) => r.status === '完工' || r.status === '结单').length;
    stat.textContent = `共 ${rows.length} 单｜开工 ${doing}｜完工/结单 ${done}`;
    renderRows();
    status('就绪');
  }

  searchInput.addEventListener('input', debounce(() => {
    filter.q = searchInput.value.trim();
    load();
  }, 320));
  btnRefresh.addEventListener('click', load);
  btnNew.addEventListener('click', openCreate);
  btnBatch.addEventListener('click', openBatch);
  btnExport.addEventListener('click', () => api.exportDownload('orders'));

  await load();
}

export const meta = { title: '生产进度', key: 'progress' };

/* ============================================================
   table.js —— 表格渲染 + 列宽拖拽 + 分页
   ============================================================ */

import { $, el, loadLocal, saveLocal, escapeHtml, num } from './util.js';

/* ---------------- 列宽拖拽 ---------------- */
export function makeResizable(table, storageKey) {
  const ths = Array.from(table.querySelectorAll('thead th'));
  const cols = Array.from(table.querySelectorAll('colgroup col'));
  if (!ths.length || !cols.length) return;

  const saved = loadLocal(`pmc:cols:${storageKey}`, {}) || {};

  const syncWidth = () => {
    let total = 0;
    cols.forEach((c, i) => {
      const w = parseFloat(c.style.width) || ths[i].offsetWidth || 100;
      total += w;
    });
    table.style.width = `${Math.round(total)}px`;
    table.style.minWidth = '100%';
  };

  ths.forEach((th, index) => {
    const colKey = th.dataset.col || `c${index}`;
    if (saved[colKey]) {
      cols[index].style.width = `${saved[colKey]}px`;
      th.style.width = `${saved[colKey]}px`;
    } else if (th.dataset.width) {
      cols[index].style.width = `${th.dataset.width}px`;
      th.style.width = `${th.dataset.width}px`;
    }

    const grip = el('span', { class: 'col-resizer', title: '拖动调整列宽，双击恢复默认' });
    th.appendChild(grip);

    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = cols[index].offsetWidth || th.offsetWidth || 100;
      const minW = Number(th.dataset.min || 44);
      document.body.classList.add('col-resizing');

      const onMove = (ev) => {
        const w = Math.max(minW, Math.round(startW + (ev.clientX - startX)));
        cols[index].style.width = `${w}px`;
        th.style.width = `${w}px`;
      };
      const onUp = () => {
        document.body.classList.remove('col-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saved[colKey] = parseFloat(cols[index].style.width) || startW;
        saveLocal(`pmc:cols:${storageKey}`, saved);
        syncWidth();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    grip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      delete saved[colKey];
      saveLocal(`pmc:cols:${storageKey}`, saved);
      const def = th.dataset.width || '';
      cols[index].style.width = def ? `${def}px` : 'auto';
      th.style.width = def ? `${def}px` : 'auto';
      syncWidth();
    });
  });

  syncWidth();
  return { syncWidth };
}

/* ---------------- 分页 ---------------- */
export function renderPager(container, { page, pageSize, total, onChange, pageSizes, onPageSizeChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const wrap = el('div', { class: 'pager' });
  const mk = (label, p, disabled, active) => {
    const b = el('button', { text: label, disabled: disabled || false });
    if (active) b.classList.add('active');
    b.addEventListener('click', () => !disabled && onChange(p));
    return b;
  };
  wrap.appendChild(el('span', { text: `共 ${total} 条 / ${pages} 页` }));
  wrap.appendChild(mk('«', 1, page <= 1));
  wrap.appendChild(mk('‹', page - 1, page <= 1));

  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  for (let p = start; p <= end; p++) wrap.appendChild(mk(String(p), p, false, p === page));

  wrap.appendChild(mk('›', page + 1, page >= pages));
  wrap.appendChild(mk('»', pages, page >= pages));

  if (pageSizes && pageSizes.length) {
    const sel = el('select', { class: 'input-sm pager-size', title: '每页显示条数' });
    pageSizes.forEach((s) => sel.appendChild(el('option', { value: s, text: `${s} 条/页` })));
    sel.value = pageSize;
    sel.addEventListener('change', () => onPageSizeChange && onPageSizeChange(Number(sel.value)));
    wrap.appendChild(sel);
  }
  container.appendChild(wrap);
}

/* ---------------- 通用表格 ---------------- */
/**
 * @param {HTMLElement} container 容器
 * @param {object} opts
 *   key         列宽持久化标识
 *   columns     [{ key, title, width, min, align, className, render(row,index), headerClass }]
 *   rows        数据数组
 *   footer      合计行：数组（与 columns 等长）或 (rows) => 数组
 *   pageSize    分页大小（0 或省略表示不分页）；用户可通过选择器调整并持久化
 *   pageSizes   可选页大小列表（默认 [20, 30]），传 [] 则不显示选择器
 *   empty       空数据文案
 *   rowClass    (row) => string
 *   onRowClick  (row) => void
 */
export function renderTable(container, opts) {
  const {
    key = 'default',
    columns = [],
    rows = [],
    footer = null,
    pageSize = 0,
    pageSizes = [20, 30],
    empty = '暂无数据',
    rowClass = null,
    onRowClick = null,
  } = opts;

  /* 页大小持久化：用户调整后记住该模块的选择 */
  let effSize = pageSize;
  if (pageSize > 0 && pageSizes && pageSizes.length) {
    const saved = loadLocal(`pmc:pagesize:${key}`, 0) || 0;
    effSize = pageSizes.includes(saved) ? saved : pageSize;
  }

  container.innerHTML = '';
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', { class: 'grid' });
  const colgroup = el('colgroup');
  columns.forEach((c) => colgroup.appendChild(el('col', { style: `width:${c.width || 100}px` })));
  table.appendChild(colgroup);

  const thead = el('thead');
  const trh = el('tr');
  columns.forEach((c) => {
    const th = el('th', {
      class: [c.align === 'right' ? 'num' : '', c.align === 'center' ? 'center' : '', c.headerClass || ''].join(' ').trim(),
      dataset: { col: c.key || '', width: c.width || 100, min: c.min || 44 },
      text: c.title || '',
    });
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const total = rows.length;
  const usePager = effSize > 0 && total > effSize;
  const page = usePager ? Math.min(Math.max(1, opts.__page || 1), Math.ceil(total / effSize)) : 1;
  const view = usePager ? rows.slice((page - 1) * effSize, page * effSize) : rows;

  const tbody = el('tbody');
  if (!view.length) {
    tbody.appendChild(
      el('tr', {}, [
        el('td', {
          colspan: columns.length,
          html: `<div class="empty"><span class="big">∅</span>${escapeHtml(empty)}</div>`,
        }),
      ])
    );
  }
  view.forEach((row, i) => {
    const tr = el('tr', { class: rowClass ? rowClass(row, i) : '' });
    columns.forEach((c) => {
      const td = el('td', {
        class: [c.align === 'right' ? 'num' : '', c.align === 'center' ? 'center' : '', c.className || ''].join(' ').trim(),
      });
      const content = c.render ? c.render(row, (page - 1) * effSize + i) : row[c.key];
      if (content instanceof Node) td.appendChild(content);
      else td.innerHTML = content === null || content === undefined ? '' : String(content);
      tr.appendChild(td);
    });
    if (onRowClick) {
      tr.classList.add('row-click');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input, select, button, a')) return;
        onRowClick(row);
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  if (footer) {
    const cells = typeof footer === 'function' ? footer(rows) : footer;
    const tfoot = el('tfoot');
    const tr = el('tr');
    columns.forEach((c, i) => {
      const td = el('td', {
        class: [c.align === 'right' ? 'num' : '', c.align === 'center' ? 'center' : ''].join(' ').trim(),
      });
      const v = cells[i];
      if (v instanceof Node) td.appendChild(v);
      else td.innerHTML = v === null || v === undefined ? '' : String(v);
      tr.appendChild(td);
    });
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }

  wrap.appendChild(table);
  container.appendChild(wrap);
  makeResizable(table, key);

  if (usePager) {
    renderPager(container, {
      page,
      pageSize: effSize,
      total,
      pageSizes: pageSizes && pageSizes.length ? pageSizes : null,
      onChange: (p) => renderTable(container, { ...opts, __page: p }),
      onPageSizeChange: (s) => {
        saveLocal(`pmc:pagesize:${key}`, s);
        renderTable(container, { ...opts, __page: 1 });
      },
    });
  } else if (effSize > 0 && pageSizes && pageSizes.length && total > 0) {
    /* 数据未超一页时也显示条数与选择器，方便用户提前调整 */
    renderPager(container, {
      page: 1,
      pageSize: effSize,
      total,
      pageSizes,
      onChange: () => {},
      onPageSizeChange: (s) => {
        saveLocal(`pmc:pagesize:${key}`, s);
        renderTable(container, { ...opts, __page: 1 });
      },
    });
  }
  return table;
}

/* ---------------- 常用单元格渲染 ---------------- */
export const cellText = (v) => escapeHtml(v === null || v === undefined || v === '' ? '-' : v);
export const cellNum = (v, digits = 0) =>
  v === null || v === undefined || v === '' ? '<span style="color:#b6bfcc">-</span>' : num(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: 2 });

export function progressBar(done, qty) {
  const d = num(done);
  const q = num(qty);
  const pct = q > 0 ? (d / q) * 100 : 0;
  const cls = pct >= 100 ? 'progress done' : 'progress';
  return `<div class="${cls}" title="完成 ${d} / 订单 ${q}"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span><b>${pct.toFixed(1)}%</b></div>`;
}

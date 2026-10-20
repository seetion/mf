/* ============================================================
   pages/settings.js —— 系统配置
   ============================================================ */

import * as api from '../api.js';
import { renderTable } from '../table.js';
import { deleteGuard } from '../api.js';
import {
  guestBar,
  isGuest,
  loadProducts,
  loadSettings,
  refreshUserUI,
  requireLogin,
  state,
  setRowPadding,
  setting,
  withDeleteGuard,
} from '../store.js';
import {
  dialog,
  downloadText,
  el,
  escapeHtml,
  loadLocal,
  num,
  parseCSV,
  pickFile,
  saveLocal,
  toast,
  status,
} from '../util.js';
import { buildShareLink, getSuffix } from '../db.js';
import { DB_URL } from '../config.js';

const TABLES = [
  ['history', '历史记录'],
  ['reports', '今日报表'],
  ['orders', '生产进度'],
  ['stock', '成品库存'],
  ['inbound', '其他入库'],
  ['outbound', '成品出库'],
  ['products', '基础物品信息'],
];

export async function render(view) {
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar('游客模式：可查看配置，但无法修改或录入基础数据。'));

  const tabsBar = el('div', { class: 'tabs' });
  const body = el('div');
  const sections = {};
  const tabDefs = [
    ['items', '基础物品信息'],
    ['historyImport', '历史记录录入'],
    ['data', '数据导出与备份'],
  ];
  // 「账号与安全」「游客码管理」仅登录用户可见，游客登录时隐藏
  if (!isGuest()) {
    tabDefs.push(['auth', '账号与安全']);
    tabDefs.push(['guest', '游客码管理']);
  }
  tabDefs.push(['ui', '外观与显示']);
  tabDefs.push(['about', '关于本系统']);
  tabDefs.forEach(([k, label], i) => {
    const t = el('div', { class: `tab ${i === 0 ? 'active' : ''}`, text: label });
    t.addEventListener('click', () => {
      Array.from(tabsBar.children).forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      Object.entries(sections).forEach(([kk, node]) => node.classList.toggle('hidden', kk !== k));
    });
    tabsBar.appendChild(t);
  });
  view.appendChild(tabsBar);
  view.appendChild(body);

  /* =======================================================
     ① 基础物品信息
     ======================================================= */
  const itemsSection = el('div');
  sections.items = itemsSection;
  body.appendChild(itemsSection);

  await loadProducts(true);
  let productRows = [...state.products];

  const pSearch = el('input', { type: 'search', placeholder: '搜索编号 / 名称 / 规格' });
  const pHost = el('div');
  const pStat = el('span', { class: 'hint' });

  const newCode = el('input', { placeholder: '产品编号', style: 'width:130px' });
  const newName = el('input', { placeholder: '产品名称', style: 'width:180px' });
  const newSpec = el('input', { placeholder: '规格型号', style: 'width:150px' });
  const newUnit = el('input', { placeholder: '单位', style: 'width:70px' });
  const btnAddOne = el('button', { class: 'btn btn-sm btn-primary', text: '＋ 新增' });

  function renderProducts() {
    const kw = pSearch.value.trim().toLowerCase();
    const rows = kw ? productRows.filter((r) => `${r.code} ${r.name} ${r.spec}`.toLowerCase().includes(kw)) : productRows;
    renderTable(pHost, {
      key: 'settings-products',
      pageSize: 20,
      empty: '暂无基础物品信息，可通过下方文本批量录入或 CSV 导入',
      rows,
      columns: [
        { key: 'seq', title: '序号', width: 48, align: 'center', render: (_, idx) => idx + 1 },
        { key: 'code', title: '产品编号', width: 140 },
        { key: 'name', title: '产品名称', width: 230 },
        { key: 'spec', title: '规格型号', width: 180 },
        { key: 'unit', title: '单位', width: 80, align: 'center' },
        { key: 'created_at', title: '创建时间', width: 150 },
        {
          key: 'ops',
          title: '操作',
          width: 110,
          align: 'center',
          render: (r) => {
            const wrap = el('span');
            const bEdit = el('button', { class: 'btn-link', text: '修改' });
            bEdit.addEventListener('click', () => openProductEdit(r));
            const bDel = el('button', { class: 'btn-link danger', text: '删除' });
            bDel.addEventListener('click', async () => {
              const detail = `基础物品：${r.code}　${r.name || ''}　${r.spec || ''}　${r.unit || ''}`;
              const done = await withDeleteGuard(detail, async () => api.deleteProduct(r.id));
              if (done) {
                toast(`已删除基础物品：${r.code}`, 'success');
                await reloadProducts();
              }
            });
            wrap.appendChild(bEdit);
            wrap.appendChild(bDel);
            return wrap;
          },
        },
      ],
      footer: (rs) => ['', '合计', '', '', '', '', `${rs.length} 项`],
    });
    pStat.textContent = `共 ${productRows.length} 项基础物品`;
  }

  function openProductEdit(row) {
    if (!requireLogin('修改基础物品信息')) return;
    const codeI = el('input', { value: row.code });
    const nameI = el('input', { value: row.name });
    const specI = el('input', { value: row.spec });
    const unitI = el('input', { value: row.unit });
    dialog({
      title: '修改基础物品信息',
      body: el('div', { class: 'form-grid' }, [
        el('div', { class: 'field' }, [el('label', { text: '产品编号' }), codeI]),
        el('div', { class: 'field' }, [el('label', { text: '产品名称' }), nameI]),
        el('div', { class: 'field' }, [el('label', { text: '规格型号' }), specI]),
        el('div', { class: 'field' }, [el('label', { text: '单位' }), unitI]),
      ]),
      okText: '保存',
      onOk: async () => {
        if (!codeI.value.trim()) {
          toast('产品编号不能为空', 'warn');
          return false;
        }
        await api.updateProduct(row.id, {
          code: codeI.value.trim(),
          name: nameI.value.trim(),
          spec: specI.value.trim(),
          unit: unitI.value.trim(),
        });
        toast('已保存', 'success');
        await reloadProducts();
      },
    });
  }

  async function reloadProducts() {
    await loadProducts(true);
    productRows = [...state.products];
    renderProducts();
  }

  btnAddOne.addEventListener('click', async () => {
    if (!requireLogin('录入基础物品信息')) return;
    if (!newCode.value.trim()) return toast('请填写产品编号', 'warn');
    try {
      const r = await api.saveProducts([
        { code: newCode.value.trim(), name: newName.value.trim(), spec: newSpec.value.trim(), unit: newUnit.value.trim() },
      ]);
      toast(`新增 ${r.created} 项，更新 ${r.updated} 项`, 'success');
      newCode.value = newName.value = newSpec.value = newUnit.value = '';
      await reloadProducts();
    } catch (e) {
      toast(e.message || '录入失败', 'error');
    }
  });

  /* ---------- 文本批量录入 ---------- */
  const batchText = el('textarea', {
    rows: '8',
    placeholder: '每行一条，字段顺序：产品编号,产品名称,规格型号,单位\n支持英文逗号、中文逗号、Tab 或空格分隔，例如：\nP-1001,散热片,120×80×5mm,件\nP-1002 支架 300mm 个',
  });
  const btnBatchImport = el('button', { class: 'btn btn-sm btn-primary', text: '解析并导入' });
  const btnDemo = el('button', { class: 'btn btn-sm', text: '填充示例' });

  function parseLines(text) {
    const items = [];
    String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split(/[,，\t]+|\s{2,}|\s(?=\S+$)/).map((s) => s.trim()).filter((s) => s !== '');
        if (parts.length < 1) return;
        items.push({ code: parts[0] || '', name: parts[1] || '', spec: parts[2] || '', unit: parts[3] || '' });
      });
    return items.filter((i) => i.code);
  }

  btnDemo.addEventListener('click', () => {
    batchText.value = [
      'P-1001,散热片,120×80×5mm,件',
      'P-1002,主板支架,300mm,个',
      'P-1003,铝合金外壳,A型/银色,套',
      'P-1004,电源模块,24V 5A,只',
    ].join('\n');
  });

  btnBatchImport.addEventListener('click', async () => {
    if (!requireLogin('批量录入')) return;
    const items = parseLines(batchText.value);
    if (!items.length) return toast('没有解析到有效数据', 'warn');
    try {
      const r = await api.saveProducts(items);
      toast(`导入完成：新增 ${r.created} 项，更新 ${r.updated} 项，忽略 ${r.skipped} 项`, 'success');
      batchText.value = '';
      await reloadProducts();
    } catch (e) {
      toast(e.message || '导入失败', 'error');
    }
  });

  /* ---------- CSV 导入 ---------- */
  const csvName = el('span', { class: 'hint', text: '未选择文件' });
  const csvPreview = el('div', { class: 'preview-table hidden' });
  let csvItems = [];
  const btnCsvPick = el('button', { class: 'btn btn-sm', text: '📄 选择 CSV 文件' });
  const btnCsvImport = el('button', { class: 'btn btn-sm btn-primary', text: '确认导入', disabled: true });
  const btnCsvTemplate = el('button', { class: 'btn btn-sm', text: '⤓ 下载 CSV 模板' });

  btnCsvTemplate.addEventListener('click', () => {
    downloadText('物品信息导入模板.csv', '\uFEFF产品编号,产品名称,规格型号,单位\r\nP-1001,散热片,120×80×5mm,件\r\n', 'text/csv;charset=utf-8');
  });

  btnCsvPick.addEventListener('click', async () => {
    if (!requireLogin('CSV 导入')) return;
    const f = await pickFile('.csv,.txt');
    if (!f) return;
    csvName.textContent = f.name;
    const rows = parseCSV(f.text);
    if (!rows.length) {
      csvItems = [];
      csvPreview.classList.add('hidden');
      btnCsvImport.disabled = true;
      return toast('CSV 内容为空', 'warn');
    }
    let data = rows;
    const head = rows[0].join(',');
    if (/编号|code|名称|name/i.test(head)) data = rows.slice(1);
    csvItems = data
      .filter((r) => r[0] && r[0].trim())
      .map((r) => ({ code: (r[0] || '').trim(), name: (r[1] || '').trim(), spec: (r[2] || '').trim(), unit: (r[3] || '').trim() }));

    csvPreview.classList.remove('hidden');
    csvPreview.innerHTML = '';
    const t = el('table');
    t.innerHTML =
      '<thead><tr><th>产品编号</th><th>产品名称</th><th>规格型号</th><th>单位</th></tr></thead><tbody>' +
      csvItems.slice(0, 50).map((r) => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.spec)}</td><td>${escapeHtml(r.unit)}</td></tr>`).join('') +
      '</tbody>';
    csvPreview.appendChild(t);
    if (csvItems.length > 50) csvPreview.appendChild(el('div', { class: 'hint', style: 'padding:6px', text: `仅预览前 50 行，共 ${csvItems.length} 行` }));
    btnCsvImport.disabled = !csvItems.length;
    toast(`已解析 ${csvItems.length} 行，请确认后导入`, 'info');
  });

  btnCsvImport.addEventListener('click', async () => {
    if (!csvItems.length) return;
    try {
      const r = await api.saveProducts(csvItems);
      toast(`导入完成：新增 ${r.created} 项，更新 ${r.updated} 项`, 'success');
      csvItems = [];
      csvPreview.classList.add('hidden');
      csvName.textContent = '未选择文件';
      btnCsvImport.disabled = true;
      await reloadProducts();
    } catch (e) {
      toast(e.message || '导入失败', 'error');
    }
  });

  itemsSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'title', text: '基础物品信息' }),
        el('div', { class: 'sub', text: '用于今日报表快速录入（产品编号 / 产品名称 / 规格型号 / 单位）' }),
        el('div', { class: 'tools' }, [pStat]),
      ]),
      el('div', { class: 'toolbar' }, [
        el('div', { class: 'search' }, [pSearch]),
        el('span', { class: 'sep' }),
        newCode,
        newName,
        newSpec,
        newUnit,
        btnAddOne,
        el('span', { class: 'grow' }),
        el('span', { class: 'hint', text: '编号已存在时将更新名称/规格/单位' }),
      ]),
      pHost,
    ])
  );

  itemsSection.appendChild(
    el('div', { class: 'cfg-grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: '文本批量录入' }),
          el('div', { class: 'tools' }, [btnDemo, btnBatchImport]),
        ]),
        el('div', { class: 'panel-body' }, [
          batchText,
          el('div', { class: 'cfg-note', html: '格式：<code>产品编号,产品名称,规格型号,单位</code>，每行一条；支持中英文逗号、Tab 分隔。' }),
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: 'CSV 表格录入' }),
          el('div', { class: 'tools' }, [csvName, btnCsvTemplate, btnCsvPick, btnCsvImport]),
        ]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'file-drop', html: '点击「选择 CSV 文件」上传表格<br/><span style="font-size:11.5px">首行可为表头（产品编号,产品名称,规格型号,单位），列顺序需一致</span>' }),
          csvPreview,
        ]),
      ]),
    ])
  );

  /* =======================================================
     ①-b 历史记录批量录入
     ======================================================= */
  const histSection = el('div', { class: 'hidden' });
  sections.historyImport = histSection;
  body.appendChild(histSection);

  const HIST_FIELDS = ['日期', '线别', '订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '出勤人数', '备注'];

  function normDate(s) {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return t;
  }

  function parseHistoryRows(rows) {
    const defaultLine = setting('default_line', '一线');
    const items = [];
    let skipped = 0;
    for (const r of rows) {
      const date = normDate(r[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      const it = {
        report_date: date,
        line: String(r[1] || '').trim() || defaultLine,
        order_no: String(r[2] || '').trim(),
        product_code: String(r[3] || '').trim(),
        product_name: String(r[4] || '').trim(),
        spec: String(r[5] || '').trim(),
        unit: String(r[6] || '').trim(),
        order_qty: String(r[7] || '').trim(),
        today_qty: String(r[8] || '').trim(),
        attendance: String(r[9] || '').trim(),
        remark: String(r[10] || '').trim(),
      };
      if (!it.order_no && !it.product_code && !it.product_name) { skipped++; continue; }
      items.push(it);
    }
    return { items, skipped };
  }

  function parseHistoryLines(text) {
    const rows = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => l.split(/[,，\t]+/).map((s) => s.trim()));
    return parseHistoryRows(rows);
  }

  function renderHistoryPreview(host, items, skipped) {
    host.innerHTML = '';
    if (!items.length) {
      host.appendChild(el('div', { class: 'hint', style: 'padding:8px', text: '没有解析到有效数据' }));
      return;
    }
    const vals = (r) => [r.report_date, r.line, r.order_no, r.product_code, r.product_name, r.spec, r.unit, r.order_qty, r.today_qty, r.attendance, r.remark];
    const t = el('table');
    t.innerHTML = '<thead><tr>' + HIST_FIELDS.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
      items.slice(0, 50).map((r) => `<tr>${vals(r).map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('') +
      '</tbody>';
    host.appendChild(t);
    let statLine = `共解析 ${items.length} 条有效记录`;
    if (skipped) statLine += `，跳过 ${skipped} 条（日期无效或缺少产品/订单信息）`;
    if (items.length > 50) statLine += `；仅预览前 50 条`;
    host.appendChild(el('div', { class: 'hint', style: 'padding:6px', text: statLine }));
  }

  async function importHistoryItems(items) {
    if (!requireLogin('批量录入历史记录')) return false;
    try {
      status('正在导入历史记录…');
      const r = await api.batchHistory(items);
      let msg = `导入完成：新增报表 ${r.reports_created} 个，追加报表 ${r.reports_updated} 个，明细 ${r.items_imported} 条`;
      if (r.items_skipped) msg += `，忽略 ${r.items_skipped} 条`;
      toast(msg, 'success');
      status('就绪');
      return true;
    } catch (e) {
      status('就绪');
      toast(e.message || '导入失败', 'error');
      return false;
    }
  }

  /* ---------- 文本批量录入 ---------- */
  const histText = el('textarea', {
    rows: '9',
    placeholder: '每行一条，字段顺序：日期,线别,订单号,产品编号,产品名称,规格型号,单位,订单数量,完成数量,出勤人数,备注\n支持英文逗号、中文逗号或 Tab 分隔，例如：\n2026-10-15,一线,DD-2501,P-1001,散热片,120×80×5mm,件,5000,1200,8,\n2026-10-16,二线,DD-2502,P-1002,主板支架,300mm,个,3000,800,,夜班补录',
  });
  const btnHistDemo = el('button', { class: 'btn btn-sm', text: '填充示例' });
  const btnHistParse = el('button', { class: 'btn btn-sm btn-primary', text: '解析并预览' });
  const btnHistImport = el('button', { class: 'btn btn-sm btn-success', text: '确认导入', disabled: true });
  const histTextPreview = el('div', { class: 'preview-table hidden' });
  let histTextItems = [];

  btnHistDemo.addEventListener('click', () => {
    histText.value = [
      '2026-10-15,一线,DD-2501,P-1001,散热片,120×80×5mm,件,5000,1200,8,',
      '2026-10-15,一线,DD-2502,P-1002,主板支架,300mm,个,3000,800,,夜班补录',
      '2026-10-16,二线,DD-2503,P-1003,风幕机,A型/银色,套,2000,650,6,',
      '2026-10-16,二线,,P-1004,电源模块,24V 5A,只,,400,,加班生产',
    ].join('\n');
  });

  btnHistParse.addEventListener('click', () => {
    const { items, skipped } = parseHistoryLines(histText.value);
    histTextItems = items;
    renderHistoryPreview(histTextPreview, items, skipped);
    histTextPreview.classList.toggle('hidden', !items.length);
    btnHistImport.disabled = !items.length;
    if (!items.length) toast('没有解析到有效数据，请检查格式', 'warn');
    else toast(`已解析 ${items.length} 条，确认无误后点击「确认导入」`, 'info');
  });

  btnHistImport.addEventListener('click', async () => {
    if (!histTextItems.length) return;
    const done = await importHistoryItems(histTextItems);
    if (done) {
      histText.value = '';
      histTextItems = [];
      histTextPreview.classList.add('hidden');
      btnHistImport.disabled = true;
    }
  });

  /* ---------- CSV 导入 ---------- */
  const histCsvName = el('span', { class: 'hint', text: '未选择文件' });
  const histCsvPreview = el('div', { class: 'preview-table hidden' });
  let histCsvItems = [];
  const btnHistCsvPick = el('button', { class: 'btn btn-sm', text: '📄 选择 CSV 文件' });
  const btnHistCsvImport = el('button', { class: 'btn btn-sm btn-success', text: '确认导入', disabled: true });
  const btnHistCsvTemplate = el('button', { class: 'btn btn-sm', text: '⤓ 下载 CSV 模板' });

  btnHistCsvTemplate.addEventListener('click', () => {
    downloadText('历史记录导入模板.csv', '\uFEFF日期,线别,订单号,产品编号,产品名称,规格型号,单位,订单数量,完成数量,出勤人数,备注\r\n2026-10-15,一线,DD-2501,P-1001,散热片,120×80×5mm,件,5000,1200,8,\r\n', 'text/csv;charset=utf-8');
  });

  btnHistCsvPick.addEventListener('click', async () => {
    if (!requireLogin('CSV 导入历史记录')) return;
    const f = await pickFile('.csv,.txt');
    if (!f) return;
    histCsvName.textContent = f.name;
    const rows = parseCSV(f.text);
    if (!rows.length) {
      histCsvItems = [];
      histCsvPreview.classList.add('hidden');
      btnHistCsvImport.disabled = true;
      return toast('CSV 内容为空', 'warn');
    }
    let data = rows;
    const head = rows[0].join(',');
    if (/日期|date/i.test(head)) data = rows.slice(1);
    const { items, skipped } = parseHistoryRows(data);
    histCsvItems = items;
    renderHistoryPreview(histCsvPreview, items, skipped);
    histCsvPreview.classList.toggle('hidden', !items.length);
    btnHistCsvImport.disabled = !items.length;
    if (!items.length) toast('没有解析到有效数据，请检查列顺序与格式', 'warn');
    else toast(`已解析 ${items.length} 条，确认无误后点击「确认导入」`, 'info');
  });

  btnHistCsvImport.addEventListener('click', async () => {
    if (!histCsvItems.length) return;
    const done = await importHistoryItems(histCsvItems);
    if (done) {
      histCsvItems = [];
      histCsvPreview.classList.add('hidden');
      histCsvName.textContent = '未选择文件';
      btnHistCsvImport.disabled = true;
    }
  });

  histSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'title', text: '历史记录批量录入' }),
        el('div', { class: 'sub', text: '用于补录以往日期的生产记录：同一「日期+线别」自动归入同一张报表，已存在的报表追加明细（不覆盖原有数据）' }),
        el('div', { class: 'tools' }, [el('span', { class: 'hint', text: '导入后自动同步生产进度与基础物品信息' })]),
      ]),
      el('div', { class: 'cfg-note', style: 'margin:8px 12px', html: '字段顺序：<code>日期,线别,订单号,产品编号,产品名称,规格型号,单位,订单数量,完成数量,出勤人数,备注</code>。日期必填（支持 2026-10-15 / 2026/10/15 / 20261015）；线别留空取默认线别；订单号 / 产品编号 / 产品名称至少填一项。' }),
    ])
  );

  histSection.appendChild(
    el('div', { class: 'cfg-grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: '文本批量录入' }),
          el('div', { class: 'tools' }, [btnHistDemo, btnHistParse, btnHistImport]),
        ]),
        el('div', { class: 'panel-body' }, [histText, histTextPreview]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: 'CSV 表格录入' }),
          el('div', { class: 'tools' }, [histCsvName, btnHistCsvTemplate, btnHistCsvPick, btnHistCsvImport]),
        ]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'file-drop', html: '点击「选择 CSV 文件」上传表格<br/><span style="font-size:11.5px">首行可为表头（日期,线别,订单号,…），列顺序需一致</span>' }),
          histCsvPreview,
        ]),
      ]),
    ])
  );

  /* =======================================================
     ② 数据导出与备份
     ======================================================= */
  const dataSection = el('div', { class: 'hidden' });
  sections.data = dataSection;
  body.appendChild(dataSection);

  const exportBtns = el('div', { class: 'cfg-actions' });
  TABLES.forEach(([key, label]) => {
    const b = el('button', { class: 'btn btn-sm', text: `⤓ ${label}` });
    b.addEventListener('click', () => api.exportDownload(key));
    exportBtns.appendChild(b);
  });
  const btnExportAll = el('button', { class: 'btn btn-sm btn-primary', text: '⤓ 导出全部表格（合并 CSV）' });
  btnExportAll.addEventListener('click', () => api.exportDownload('all'));
  exportBtns.appendChild(btnExportAll);

  const btnBackup = el('button', { class: 'btn btn-sm btn-success', text: '🔒 下载完整备份文件（JSON）' });
  btnBackup.addEventListener('click', () => api.downloadUrl(api.backupUrl()));

  const btnRestore = el('button', { class: 'btn btn-sm btn-danger', text: '⇧ 从备份文件还原' });
  btnRestore.addEventListener('click', async () => {
    if (!requireLogin('数据还原')) return;
    const f = await pickFile('.json');
    if (!f) return;
    let payload;
    try {
      payload = JSON.parse(f.text);
    } catch (e) {
      return toast('备份文件格式错误（JSON 解析失败）', 'error');
    }
    const okDel = await withDeleteGuard(
      `数据还原：将用备份文件覆盖当前全部数据\n备份文件：${f.name}　　导入时间：${new Date().toLocaleString('zh-CN')}`,
      async () => {
        await api.restoreBackup(payload);
        toast('数据还原成功，正在刷新…', 'success');
        await loadProducts(true);
        await reloadProducts();
        setTimeout(() => location.reload(), 900);
      }
    );
    if (!okDel) return;
  });

  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '导出表格数据' })]),
      el('div', { class: 'panel-body' }, [
        exportBtns,
        el('div', { class: 'cfg-note', style: 'margin-top:8px', html: '导出为 CSV（含 UTF-8 BOM，可直接用 Excel 打开）：历史记录、今日报表、生产进度、成品库存、其他入库、成品出库、基础物品信息。' }),
      ]),
    ])
  );

  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '备份与还原' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'cfg-actions' }, [btnBackup, btnRestore]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', html: '备份文件包含 libSQL 数据库全部业务表（JSON 格式）；还原操作需要登录 + 二级密码，且会覆盖现有数据。' }),
      ]),
    ])
  );

  /* 数据库连接配置（纯静态版专属） */
  const cfgInfo = el('div', { class: 'cfg-note', text: '正在读取连接配置…' });
  const btnCopySuffix = el('button', { class: 'btn btn-sm', text: '📋 复制哈希值码' });
  btnCopySuffix.addEventListener('click', async () => {
    const suffix = getSuffix();
    if (!suffix) return toast('尚未配置哈希值码', 'warn');
    try {
      await navigator.clipboard.writeText(suffix);
      toast('哈希值码已复制，直接发给同事即可', 'success', 4000);
    } catch (e) {
      dialog({ title: '哈希值码', body: el('textarea', { style: 'width:100%;height:100px', value: suffix, readonly: true }), okText: '关闭' });
    }
  });
  const btnShare = el('button', { class: 'btn btn-sm', text: '🔗 生成分享链接' });
  btnShare.addEventListener('click', async () => {
    const link = buildShareLink();
    if (!link) return toast('尚未配置哈希值码', 'warn');
    try {
      await navigator.clipboard.writeText(link);
      toast('分享链接已复制，同事打开即可自动配置', 'success', 4000);
    } catch (e) {
      dialog({ title: '分享链接', body: el('textarea', { style: 'width:100%;height:100px', value: link, readonly: true }), okText: '关闭' });
    }
  });
  const btnReconfig = el('button', { class: 'btn btn-sm btn-primary', text: '⚙ 重新输入哈希值码' });
  btnReconfig.addEventListener('click', () => {
    localStorage.removeItem('pmc:dbcfg');
    location.reload();
  });
  try {
    let host = DB_URL;
    try {
      host = new URL(DB_URL.replace(/^libsql:/, 'https:')).host;
    } catch (e) {
      /* ignore */
    }
    const suffix = getSuffix();
    cfgInfo.innerHTML = suffix
      ? `当前连接：<b>${escapeHtml(host)}</b>（浏览器直连 Turso 云库）<br/>哈希值码已保存在本浏览器，更换电脑时把哈希值码发给同事输入即可。`
      : '尚未配置哈希值码。';
  } catch (e) {
    cfgInfo.textContent = '连接配置读取失败';
  }
  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '数据库连接（静态版）' })]),
      el('div', { class: 'panel-body' }, [
        cfgInfo,
        el('div', { class: 'cfg-actions', style: 'margin-top:8px' }, [btnCopySuffix, btnShare, btnReconfig]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', html: '数据库地址已内置在系统中。<b>「复制哈希值码」</b>——发给同事，对方首次打开输入即可；<b>「分享链接」</b>——同事打开链接自动填入，无需手动输入。哈希值码等同于数据库钥匙，请仅发给可信人员。' }),
      ]),
    ])
  );

  const engineNote = el('div', { class: 'cfg-note', text: '正在读取数据引擎信息…' });
  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '数据引擎信息' })]),
      el('div', { class: 'panel-body' }, [engineNote]),
    ])
  );

  try {
    const eng = await api.getEngine();
    engineNote.innerHTML =
      `当前主数据存储：<b>${escapeHtml(eng.label)}</b><br/>` +
      `数据目标：<code>${escapeHtml(eng.target)}</code><br/>` +
      '当前运行的是 <b>纯静态版</b>（浏览器直连 Turso 云库，无需后端服务，可部署到 GitHub Pages 等静态托管）。';
  } catch (e) {
    engineNote.textContent = '数据引擎信息读取失败（无法连接 Turso 云库，请检查数据库配置）';
  }

  /* =======================================================
     ③ 账号与安全（游客登录时隐藏整个模块）
     ======================================================= */
  if (!isGuest()) {
  const authSection = el('div', { class: 'hidden' });
  sections.auth = authSection;
  body.appendChild(authSection);

  const oldPass = el('input', { type: 'password', placeholder: '原密码' });
  const newPass = el('input', { type: 'password', placeholder: '新密码（至少 6 位）' });
  const newPass2 = el('input', { type: 'password', placeholder: '确认新密码' });
  const btnChangePwd = el('button', { class: 'btn btn-sm btn-primary', text: '修改登录密码' });
  btnChangePwd.addEventListener('click', async () => {
    if (!requireLogin('修改密码')) return;
    if (!newPass.value || newPass.value.length < 6) return toast('新密码至少 6 位', 'warn');
    if (newPass.value !== newPass2.value) return toast('两次输入的新密码不一致', 'warn');
    try {
      await api.changePassword(oldPass.value, newPass.value);
      toast('登录密码已更新', 'success');
      oldPass.value = newPass.value = newPass2.value = '';
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    }
  });

  const dpInput = el('input', { type: 'text', value: await safeSetting('delete_password', '888888') });
  const btnSaveDp = el('button', { class: 'btn btn-sm btn-primary', text: '保存二级密码' });
  btnSaveDp.addEventListener('click', async () => {
    if (!requireLogin('修改二级密码')) return;
    const current = window.prompt('请输入当前二级密码以确认：');
    if (current === null) return;
    try {
      const arr = await api.verifyDeletePassword(current);
      if (!arr.valid) return toast('当前二级密码错误', 'error');
      await api.saveSettings({ delete_password: dpInput.value.trim() || '888888' });
      deleteGuard.password = '';
      toast('二级密码已更新（删除/还原等敏感操作需使用）', 'success');
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    }
  });

  authSection.appendChild(
    el('div', { class: 'cfg-grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '登录账号' })]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'cfg-note', html: '打开网页会先弹出登录页：<b>超级管理员</b>（账号 <code>Asheng</code>）可录入、修改、删除数据；<b>游客码</b>登录为只读，只能查看。下方「修改登录密码」修改的是当前登录账号的密码。' }),
          el('div', { class: 'form-row', style: 'margin-top:10px' }, [
            el('button', {
              class: 'btn btn-sm',
              text: '登录 / 切换账号',
              onclick: () => window.pmcOpenLogin && window.pmcOpenLogin(),
            }),
            el('button', {
              class: 'btn btn-sm',
              text: '退出登录',
              onclick: async () => {
                await api.logout();
                api.session.clear();
                deleteGuard.password = '';
                refreshUserUI();
                toast('已退出登录', 'info');
                location.reload();
              },
            }),
          ]),
          el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', { text: '原密码' }), oldPass]),
          el('div', { class: 'field' }, [el('label', { text: '新密码' }), newPass]),
          el('div', { class: 'field' }, [el('label', { text: '确认新密码' }), newPass2]),
          btnChangePwd,
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '二级密码（删除保护）' })]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'cfg-note', html: '删除任何记录（历史记录、生产进度、入库/出库、物品信息）以及数据还原，都需要输入 <b>二级密码</b>，用于防止误操作。' }),
          el('div', { class: 'field', style: 'margin-top:10px' }, [el('label', { text: '二级密码' }), dpInput]),
          btnSaveDp,
          el('div', { class: 'cfg-note', style: 'margin-top:10px', html: '默认二级密码：<code>888888</code>。验证通过后会在当前浏览器会话内记忆，刷新页面后需重新输入。' }),
        ]),
      ]),
    ])
  );
  } /* end if(!isGuest()) —— 账号与安全 */

  /* =======================================================
     ④ 游客码管理（仅超级管理员可见）
     ======================================================= */
  if (!isGuest()) {
    const guestSection = el('div', { class: 'hidden' });
    sections.guest = guestSection;
    body.appendChild(guestSection);

    let codeRows = [];
    const gSearch = el('input', { type: 'search', placeholder: '搜索游客码 / 备注' });
    const gHost = el('div');
    const gStat = el('span', { class: 'hint' });
    const newGCode = el('input', { placeholder: '游客码，如 guest01', style: 'width:170px' });
    const newGRemark = el('input', { placeholder: '备注，如：车间A·张三', style: 'width:240px' });
    const btnAddCode = el('button', { class: 'btn btn-sm btn-primary', text: '＋ 新增游客码' });

    function renderCodes() {
      const kw = gSearch.value.trim().toLowerCase();
      const rows = kw ? codeRows.filter((r) => `${r.code} ${r.remark}`.toLowerCase().includes(kw)) : codeRows;
      renderTable(gHost, {
        key: 'settings-guest-codes',
        pageSize: 20,
        empty: '暂无游客码，可在上方输入后点「新增游客码」',
        rows,
        columns: [
          { key: 'seq', title: '序号', width: 48, align: 'center', render: (_, idx) => idx + 1 },
          { key: 'code', title: '游客码', width: 200 },
          { key: 'remark', title: '备注', width: 300 },
          { key: 'created_at', title: '创建时间', width: 170 },
          {
            key: 'ops',
            title: '操作',
            width: 110,
            align: 'center',
            render: (r) => {
              const wrap = el('span');
              const bEdit = el('button', { class: 'btn-link', text: '修改' });
              bEdit.addEventListener('click', () => openCodeEdit(r));
              const bDel = el('button', { class: 'btn-link danger', text: '删除' });
              bDel.addEventListener('click', async () => {
                const done = await withDeleteGuard(
                  `游客码：${r.code}　备注：${r.remark || '（无）'}`,
                  async () => api.deleteGuestCode(r.id)
                );
                if (done) {
                  toast(`已删除游客码：${r.code}`, 'success');
                  await reloadCodes();
                }
              });
              wrap.appendChild(bEdit);
              wrap.appendChild(bDel);
              return wrap;
            },
          },
        ],
        footer: (rs) => ['', '合计', '', '', `${rs.length} 个`],
      });
      gStat.textContent = `共 ${codeRows.length} 个游客码`;
    }

    async function reloadCodes() {
      try {
        codeRows = (await api.listGuestCodes()) || [];
      } catch (e) {
        codeRows = [];
      }
      renderCodes();
    }

    function openCodeEdit(row) {
      const codeI = el('input', { value: row.code });
      const remarkI = el('input', { value: row.remark });
      dialog({
        title: '修改游客码',
        body: el('div', {}, [
          el('div', { class: 'field' }, [el('label', { text: '游客码' }), codeI]),
          el('div', { class: 'field' }, [el('label', { text: '备注' }), remarkI]),
        ]),
        okText: '保存',
        onOk: async () => {
          if (!codeI.value.trim()) {
            toast('游客码不能为空', 'warn');
            return false;
          }
          try {
            await api.updateGuestCode(row.id, { code: codeI.value.trim(), remark: remarkI.value.trim() });
            toast('已保存', 'success');
            await reloadCodes();
          } catch (e) {
            toast(e.message || '保存失败', 'error');
            return false;
          }
        },
      });
    }

    btnAddCode.addEventListener('click', async () => {
      const code = newGCode.value.trim();
      if (!code) return toast('请填写游客码', 'warn');
      try {
        await api.createGuestCode({ code, remark: newGRemark.value.trim() });
        toast(`已新增游客码：${code}`, 'success');
        newGCode.value = newGRemark.value = '';
        await reloadCodes();
      } catch (e) {
        toast(e.message || '新增失败', 'error');
      }
    });

    guestSection.appendChild(
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: '游客码管理' }),
          el('div', { class: 'sub', text: '游客码由超级管理员创建，持码者可查看全部数据（只读），不能录入、修改或删除' }),
          el('div', { class: 'tools' }, [gStat]),
        ]),
        el('div', { class: 'toolbar' }, [
          el('div', { class: 'search' }, [gSearch]),
          el('span', { class: 'sep' }),
          newGCode,
          newGRemark,
          btnAddCode,
        ]),
        gHost,
        el('div', { class: 'cfg-note', style: 'margin:8px 12px', html: '删除游客码需要二级密码；删除后持码者将无法再登录。' }),
      ])
    );

    gSearch.addEventListener('input', () => renderCodes());
    await reloadCodes();
  }

  /* =======================================================
     ⑤ 外观与显示
     ======================================================= */
  const uiSection = el('div', { class: 'hidden' });
  sections.ui = uiSection;
  body.appendChild(uiSection);

  const padSlider = el('input', { type: 'range', min: '0', max: '14', step: '1', value: String(setting('row_padding', loadLocal('pmc:rowPad', 2))) });
  const padVal = el('span', { class: 'slider-val', text: `${padSlider.value} px` });
  padSlider.addEventListener('input', () => {
    padVal.textContent = `${padSlider.value} px`;
    setRowPadding(num(padSlider.value));
  });
  const btnSavePad = el('button', { class: 'btn btn-sm btn-primary', text: '保存到服务端默认值' });
  btnSavePad.addEventListener('click', async () => {
    if (!requireLogin('保存外观设置')) return;
    await api.saveSettings({ row_padding: padSlider.value });
    await loadSettings();
    toast('已保存默认行间距', 'success');
  });

  const lineInput = el('input', { value: setting('line_options', '一线,二线,三线,四线') });
  const defLineInput = el('input', { value: setting('default_line', '一线'), style: 'width:110px' });
  const btnSaveLines = el('button', { class: 'btn btn-sm btn-primary', text: '保存线别设置' });
  btnSaveLines.addEventListener('click', async () => {
    if (!requireLogin('保存线别设置')) return;
    await api.saveSettings({ line_options: lineInput.value.trim(), default_line: defLineInput.value.trim() });
    await loadSettings();
    toast('线别设置已保存（刷新页面后生效）', 'success');
  });

  const btnResetCols = el('button', { class: 'btn btn-sm', text: '重置所有表格列宽' });
  btnResetCols.addEventListener('click', () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pmc:cols:'))
      .forEach((k) => localStorage.removeItem(k));
    toast('列宽已重置，刷新后生效', 'success');
  });

  uiSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '表格行间距 / 显示密度' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'slider-row' }, [el('span', { class: 'hint', text: '紧凑' }), padSlider, padVal, el('span', { class: 'hint', text: '宽松' }), btnSavePad]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', text: '默认 2px（ERP 紧凑风格）。拖动即时生效并保存在本地，点击右侧按钮可写入服务端作为全局默认值。' }),
      ]),
    ])
  );

  uiSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '线别与表格' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'field' }, [el('label', { text: '线别选项（逗号分隔）' }), lineInput]),
        el('div', { class: 'form-row' }, [
          el('div', { class: 'inline-field' }, [el('label', { text: '默认线别' }), defLineInput]),
          btnSaveLines,
          el('span', { class: 'sep' }),
          btnResetCols,
        ]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', text: '所有表格表头右侧均可拖动调整列宽（双击分隔线恢复默认），列宽按表格记忆在本地浏览器。' }),
      ]),
    ])
  );

  /* =======================================================
     ⑥ 关于本系统
     ★★★ 鸣谢/署名 与 版本更新日志 修改处：均在下方 ABOUT_HTML 字符串内 ★★★
     ======================================================= */
  const aboutSection = el('div', { class: 'hidden' });
  sections.about = aboutSection;
  body.appendChild(aboutSection);

  /* ---- 署名/鸣谢 与 版本更新日志（需要修改时直接编辑此处） ---- */
  const ABOUT_HTML = `
    <div class="about-block">
      <div class="about-name">生产管理系统</div>
      <div class="about-desc">当前版本v1.6 · 纯静态版</div>
      <div class="about-desc">面向生产车间的轻量级生产管理工具，覆盖生产日报录入、历史记录补录、生产进度跟踪、成品出入库与数据备份。</div>
      <div class="about-meta">数据引擎：libSQL / Turso（浏览器直连）　·　前端：原生 ES Module　·　无需后端服务</div>
    </div>
    <div class="about-block">
      <div class="about-sub">鸣谢</div>
      <div class="about-desc">本系统由个人独立开发、设计、调试、部署。</div>
      <div class="about-sub">在开发过程中，得到了以下工具与团队的支持，特此致谢：</div>
      <ul class="about-credits">
        <li><b>JoyCode</b> — AI 编程助手，陪伴全程开发与调试</li>
        <li><b>InsCode</b> — 开发者工具与社区支持</li>
        <li><b>ConeBuddy</b> — 灵感与陪伴</li>
        <li><b>SeeTion</b> — 贵州希田</li>
        <li><b>Comata</b> — 技术支持</li>
        <li><b>Turso</b> — （美国）云库技术支持</li>
        <li><b>Github</b> — （美国）全球最大开源代码库</li>
        <li><b>Yandex</b> — （俄罗斯）信息与检索支持</li>
      </ul>
      <div class="about-meta">By：柏兴圣·baiwuqi@126.com · 建议·info@Seetion.cn</div>
      <div class="about-desc about-thanks">感谢每一位为开源社区贡献力量的人 ❤</div>
    </div>
    <div class="about-block">
      <details class="about-changelog">
        <summary>版本更新日志<span class="chg-hint">点击展开 / 收起</span></summary>
        <div class="changelog-body">
          <div class="log-item">
            <div class="log-ver">v1.6 <span class="log-date">2026-10-19</span></div>
            <ul>
              <li>修复库存计算：统一按产品编号聚合，其他入库 / 成品出库正确扣减与增加</li>
              <li>生产进度支持「手工建单」与「文本批量录入」，完成数量随今日报表录入自动累计</li>
              <li>今日报表录入支持工单号下拉选择，自动带出产品信息与订单数量</li>
              <li>列表分页增强：20 / 30 条每页可选，底部上一页 / 下一页翻页，选择自动记忆</li>
              <li>首页柱状图顶部直接显示数量数值，无需悬停查看</li>
              <li>生产进度支持「追加产能」，追加后订单状态自动重算</li>
              <li>工单删除保护：已有生产记录的工单不可直接删除，需先删除对应历史记录</li>
              <li>历史记录、生产进度、成品库存、出入库、基础物品等列表新增「序号」列</li>
              <li>新增「纯静态版」：浏览器直连 Turso 云库，无需 Node.js 后端，可部署至 GitHub Pages</li>
            </ul>
          </div>
          <div class="log-item">
            <div class="log-ver">v1.5 <span class="log-date">2026-10-19</span></div>
            <ul>
              <li>新增「历史记录批量录入」：支持文本粘贴与 CSV 导入两种方式，按日期+线别自动归入报表，已有报表追加明细不覆盖</li>
              <li>新增「关于本系统」页面，含鸣谢署名与版本更新日志</li>
              <li>优化：游客码登录时隐藏「账号与安全」模块，避免只读用户误操作</li>
            </ul>
          </div>
          <div class="log-item">
            <div class="log-ver">v1.4 <span class="log-date">2026-10-16</span></div>
            <ul>
              <li>支持 Turso 云库模式，数据可远程存储与同步</li>
              <li>新增数据导出与备份功能（JSON 全量备份）</li>
              <li>历史记录支持按日期、线别、关键词检索</li>
            </ul>
          </div>
          <div class="log-item">
            <div class="log-ver">v1.3 <span class="log-date">2026-10-10</span></div>
            <ul>
              <li>新增游客码登录（只读模式），可查看全部数据但不能录入、修改或删除</li>
              <li>删除操作增加二级密码保护，防止误删除</li>
            </ul>
          </div>
          <div class="log-item">
            <div class="log-ver">v1.0 <span class="log-date">2026-09</span></div>
            <ul>
              <li>首个版本：生产日报录入、生产进度跟踪、成品入库/出库、基础物品信息管理</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  `;

  aboutSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '关于本系统' })]),
      el('div', { class: 'panel-body about-body', html: ABOUT_HTML }),
    ])
  );

  /* ---------------- 初始化 ---------------- */
  pSearch.addEventListener('input', () => renderProducts());
  renderProducts();
}

async function safeSetting(key, fallback) {
  try {
    const s = await api.getSettings();
    return s[key] || fallback;
  } catch (e) {
    return fallback;
  }
}

export const meta = { title: '系统配置', key: 'settings' };

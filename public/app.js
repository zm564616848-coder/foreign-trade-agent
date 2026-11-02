import { carriers, categories, filterCarriers, parseTrackingNumbers, supportsTrackingLink, officialTrackingLink } from './carriers.js';

const $ = selector => document.querySelector(selector);
const key = 'logihub.v1';
let state = { favorites: [], shipments: [] };
let storageBroken = false;
try {
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved && Array.isArray(saved.favorites) && Array.isArray(saved.shipments)) {
    state.favorites = saved.favorites.filter(id => carriers.some(c => c.id === id));
    state.shipments = saved.shipments.filter(s => s && typeof s.id === 'string' && typeof s.number === 'string' && /^[A-Za-z0-9-]{4,50}$/.test(s.number) && carriers.some(c => c.id === s.carrier));
  }
} catch { storageBroken = true; }
let view = 'directory';
let category = 'all';
let toastTimer;
const liveResults = new Map();
const statusLabels = { NotFound: '暂无轨迹', InfoReceived: '已收到预报', InTransit: '运输中', Expired: '查询已过期', AvailableForPickup: '待取件', OutForDelivery: '派送中', DeliveryFailure: '派送异常', Delivered: '已签收', Exception: '运输异常', Pending: '采集轨迹中', Unknown: '状态待确认' };
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function save() {
  try { localStorage.setItem(key, JSON.stringify(state)); storageBroken = false; }
  catch { storageBroken = true; notify('浏览器存储不可用，数据仅在本次页面中保留'); }
  $('.local-badge').textContent = storageBroken ? '临时会话 · 未持久保存' : '本地数据存储';
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function logo(carrier) {
  const el = element('span', `carrier-logo logo-${carrier.id}`, carrier.mark);
  // Brand colors are defined in the stylesheet to keep a strict CSP.
  return el;
}
function openOfficial(carrier, number) {
  const destination = officialTrackingLink(carrier.id, number);
  const a = element('a', 'official-link', destination.prefilled ? '携带单号查询 ↗' : '官网查询 ↗');
  a.href = destination.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', `${carrier.name}${destination.prefilled ? '携带单号' + number + '查询' : '官方网站查询'}`);
  return a;
}
function carrierCard(carrier) {
  const card = element('article', 'carrier-card');
  const top = element('div', 'card-top');
  const favorite = element('button', 'favorite-button' + (state.favorites.includes(carrier.id) ? ' selected' : ''), state.favorites.includes(carrier.id) ? '★' : '☆');
  favorite.setAttribute('aria-label', `${state.favorites.includes(carrier.id) ? '取消收藏' : '收藏'}${carrier.name}`);
  favorite.setAttribute('aria-pressed', String(state.favorites.includes(carrier.id)));
  favorite.onclick = () => {
    state.favorites = state.favorites.includes(carrier.id) ? state.favorites.filter(id => id !== carrier.id) : [...state.favorites, carrier.id];
    save(); render();
  };
  top.append(logo(carrier), favorite);
  const name = element('h3', '', carrier.name);
  const english = element('div', 'english-name', carrier.english);
  const bottom = element('div', 'card-bottom');
  const tag = element('span', 'category-tag', categories[carrier.category]);
  if (carrier.url.startsWith('http:')) tag.append(element('span', 'http-label', ' · HTTP'));
  bottom.append(tag, openOfficial(carrier));
  const capability = element('p', 'integration-note', supportsTrackingLink(carrier.id) ? '支持携带单号打开官网' : '打开官网后粘贴单号查询');
  card.append(top, name, english, capability, bottom);
  return card;
}
async function copy(number) {
  try { await navigator.clipboard.writeText(number); notify('单号已复制，请在官网粘贴查询'); }
  catch { notify('无法自动复制，请选中单号手动复制'); }
}
function shipmentCard(shipment, removable = true) {
  const carrier = carriers.find(c => c.id === shipment.carrier);
  const card = element('article', 'shipment-card');
  const top = element('div', 'shipment-top');
  const direct = supportsTrackingLink(carrier.id);
  top.append(logo(carrier), element('strong', '', carrier.name), element('span', 'pending-tag', direct ? '可携带单号' : '需手动粘贴'));
  const number = element('div', 'shipment-number', shipment.number);
  const actions = element('div', 'shipment-actions');
  const copyButton = element('button', 'secondary-button', '复制单号');
  copyButton.onclick = () => copy(shipment.number);
  const query = element('button', 'secondary-button', '查看本页轨迹');
  query.onclick = async () => {
    query.disabled = true; query.textContent = '查询中…';
    timeline.replaceChildren(element('p', 'integration-note', '正在获取真实轨迹…'));
    try {
      const response = await fetch('./api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carrier: carrier.id, number: shipment.number }), signal: AbortSignal.timeout(50000) });
      if (response.status === 404 || response.status === 405) throw new Error('当前站点尚未连接实时查询后端，需完成服务部署后启用。');
      let data;
      try { data = await response.json(); } catch { throw new Error('查询服务返回异常，请稍后重试'); }
      if (!response.ok) throw new Error(data.error || '查询失败，请稍后重试');
      if (data.number !== shipment.number || !Array.isArray(data.events)) throw new Error('查询服务返回的轨迹格式异常');
      liveResults.set(shipment.id, data);
      paintTimeline(timeline, data);
    } catch (error) { timeline.replaceChildren(element('p', 'form-error', error.name === 'TimeoutError' ? '查询超时，请稍后重试' : error.message)); }
    finally { query.disabled = false; query.textContent = '刷新本页轨迹'; }
  };
  actions.append(query, copyButton, openOfficial(carrier, shipment.number));
  if (removable) {
    const remove = element('button', 'remove-button', '移除');
    remove.setAttribute('aria-label', `移除运单 ${shipment.number}`);
    remove.onclick = () => { state.shipments = state.shipments.filter(s => s.id !== shipment.id); save(); render(); notify('运单已移除'); };
    actions.append(remove);
  }
  const timeline = element('div', 'tracking-timeline');
  timeline.setAttribute('aria-live', 'polite');
  if (liveResults.has(shipment.id)) paintTimeline(timeline, liveResults.get(shipment.id));
  card.append(top, number, actions, timeline);
  return card;
}
function paintTimeline(container, data) {
  container.replaceChildren();
  container.append(element('strong', 'tracking-status', statusLabels[data.status] || data.status), element('p', 'integration-note', `来源：${data.source || '17TRACK'} · 自动识别服务商${data.providers?.length ? '：' + data.providers.join(' / ') : '（请核对识别结果）'}`));
  if (!data.events.length) { container.append(element('p', 'integration-note', '服务尚未返回轨迹事件，请稍后刷新。')); return; }
  const list = element('ol', 'timeline-list');
  data.events.forEach(event => {
    const item = element('li');
    item.append(element('time', '', event.time || '时间未提供'), element('p', '', event.description), element('small', '', [event.location, event.provider].filter(Boolean).join(' · ')));
    list.append(item);
  });
  container.append(list);
}
function render() {
  const grid = $('#content-grid');
  grid.replaceChildren();
  $('#shipment-count').textContent = state.shipments.length;
  $('#filters').hidden = view === 'shipments';
  $('#directory-hint').textContent = view === 'shipments' ? '运单保存在当前浏览器' : '官方网站查询入口 ↗';
  const labels = { directory: '物流查询', shipments: '我的运单', favorites: '常用物流' };
  $('#breadcrumb').textContent = labels[view];
  $('#section-title').textContent = view === 'directory' ? '物流服务商' : labels[view];
  $('#search').placeholder = view === 'shipments' ? '搜索单号或物流商…' : '搜索物流商名称…';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const query = $('#search').value;
  if (view === 'shipments') {
    const items = state.shipments.filter(s => {
      const c = carriers.find(c => c.id === s.carrier);
      return `${s.number} ${c.name} ${c.english}`.toLowerCase().includes(query.trim().toLowerCase());
    });
    $('#result-count').textContent = `${items.length} 个运单`;
    items.forEach(s => grid.append(shipmentCard(s)));
  } else {
    const items = filterCarriers({ query, category, favorites: view === 'favorites' ? state.favorites : null });
    $('#result-count').textContent = `${items.length} 个查询入口`;
    items.forEach(c => grid.append(carrierCard(c)));
  }
  if (!grid.children.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('span', '', '⌕'), element('h3', '', query ? '没有找到匹配结果' : view === 'shipments' ? '还没有添加运单' : '还没有收藏物流商'), element('p', '', query ? '试试其他关键词，或切换物流类别。' : view === 'shipments' ? '在上方输入单号，即可开始管理你的物流查询。' : '点击物流商卡片上的 ☆，建立你的常用查询目录。'));
    grid.append(empty);
  }
}
for (const [id, label] of Object.entries(categories)) {
  const group = element('optgroup'); group.label = label;
  carriers.filter(c => c.category === id).forEach(c => { const option = element('option', '', `${c.name} · ${c.english}`); option.value = c.id; group.append(option); });
  $('#carrier-select').append(group);
}
$('#tracking-form').addEventListener('submit', event => {
  event.preventDefault();
  $('#form-error').textContent = '';
  try {
    const carrier = $('#carrier-select').value;
    const numbers = parseTrackingNumbers($('#tracking-input').value);
    if (!carriers.some(c => c.id === carrier) || !numbers.length) throw new Error('请选择物流商并输入有效单号');
    const selected = numbers.map(number => {
      const existing = state.shipments.find(s => s.number === number && s.carrier === carrier);
      if (existing) return existing;
      const shipment = { id: crypto.randomUUID(), carrier, number };
      state.shipments.unshift(shipment);
      return shipment;
    });
    save();
    $('#dialog-title').textContent = `${selected.length} 个运单已添加到工作台`;
    $('#dialog-shipments').replaceChildren(...selected.map(s => shipmentCard(s, false)));
    render(); $('#tracking-dialog').showModal();
    // Query on this page; official links are now an explicit optional fallback.
    $('#dialog-shipments .secondary-button').click();
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#search').addEventListener('input', render);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; $('#search').value = ''; render(); }));
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  render();
}));
$('#close-dialog').onclick = () => $('#tracking-dialog').close();
$('#help-button').onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
render();
if (storageBroken) { $('.local-badge').textContent = '存储读取失败'; notify('本地记录无法读取，新增记录将尝试重新保存'); }

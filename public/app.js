import { carriers, categories, filterCarriers, parseTrackingNumbers, supportsTrackingLink, officialTrackingLink, queryDestination, websiteVerification } from './carriers.js';

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
  const destination = number ? queryDestination(carrier.id, number) : officialTrackingLink(carrier.id);
  const a = element('a', 'official-link', destination.fallback ? '17TRACK 查询 ↗' : destination.prefilled ? '官网直达查询 ↗' : '官网入口 ↗');
  a.href = destination.navigationUrl || destination.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', `${destination.fallback ? '17TRACK（' + carrier.name + '备用查询）' : carrier.name}${destination.prefilled ? '携带单号' + number + '查询' : '官方网站查询'}`);
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
  const choose = element('button', 'official-link choose-carrier', '选择并查询 ↗');
  choose.onclick = () => {
    $('#carrier-select').value = carrier.id;
    updateQueryHint();
    if ($('#tracking-input').value.trim()) $('#tracking-form').requestSubmit();
    else { $('#tracking-input').focus(); $('#tracking-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  };
  const actions = element('div', 'carrier-actions');
  if (carrier.category === 'customs') {
    const original = openOfficial(carrier);
    original.textContent = websiteVerification[carrier.id]?.identity ? '官网入口 ↗' : '原网址 ↗';
    original.setAttribute('aria-label', `${carrier.name}原网址，未自动提交单号`);
    actions.append(original);
  }
  actions.append(choose);
  bottom.append(tag, actions);
  const capability = element('p', 'integration-note', websiteVerification[carrier.id]?.note || (supportsTrackingLink(carrier.id) ? '官网直达 · 自动携带单号' : '单号查询使用 17TRACK · 自动携带'));
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
  top.append(logo(carrier), element('strong', '', carrier.name), element('span', 'pending-tag', supportsTrackingLink(carrier.id) ? '官网直达' : '17TRACK'));
  const number = element('div', 'shipment-number', shipment.number);
  const actions = element('div', 'shipment-actions');
  const copyButton = element('button', 'secondary-button', '复制单号');
  copyButton.onclick = () => copy(shipment.number);
  actions.append(openOfficial(carrier, shipment.number), copyButton);
  if (removable) {
    const remove = element('button', 'remove-button', '移除');
    remove.setAttribute('aria-label', `移除运单 ${shipment.number}`);
    remove.onclick = () => { state.shipments = state.shipments.filter(s => s.id !== shipment.id); save(); render(); notify('运单已移除'); };
    actions.append(remove);
  }
  card.append(top, number, actions);
  return card;
}
function openQuery(destination) {
  // Keep window creation synchronous with the click/submit gesture.
  const tab = window.open('about:blank', '_blank');
  if (tab) {
    tab.opener = null;
    tab.location.replace(destination.navigationUrl || destination.url);
    $('#query-feedback').textContent = `${destination.source}已打开，单号已自动携带。`;
  } else {
    $('#query-feedback').replaceChildren(element('span', '', '浏览器拦截了新窗口，请点击：'));
    const link = element('a', 'official-link', `打开${destination.source}查询 ↗`);
    link.href = destination.navigationUrl || destination.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    $('#query-feedback').append(link);
  }
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
function updateQueryHint() {
  const carrier = carriers.find(c => c.id === $('#carrier-select').value);
  $('#query-hint').textContent = !carrier ? 'ⓘ 输入一次，自动打开查询页并携带单号。' : supportsTrackingLink(carrier.id)
    ? `ⓘ 将打开${carrier.name}官网，自动携带单号。`
    : `ⓘ ${carrier.name}暂无已确认的官网直达链接，将使用 17TRACK 并自动携带单号。`;
}
$('#carrier-select').addEventListener('change', updateQueryHint);
$('#tracking-form').addEventListener('submit', event => {
  event.preventDefault();
  $('#form-error').textContent = '';
  $('#query-feedback').textContent = '';
  try {
    const carrier = $('#carrier-select').value;
    const numbers = parseTrackingNumbers($('#tracking-input').value);
    if (!carriers.some(c => c.id === carrier) || !numbers.length) throw new Error('请选择物流商并输入有效单号');
    if (numbers.length !== 1) throw new Error('请每次查询一个单号，以便自动打开官网结果。');
    const number = numbers[0];
    const destination = queryDestination(carrier, number);
    openQuery(destination);
    if (!state.shipments.some(s => s.number === number && s.carrier === carrier)) {
      state.shipments.unshift({ id: crypto.randomUUID(), carrier, number });
      save(); render();
    }
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#search').addEventListener('input', render);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; $('#search').value = ''; render(); }));
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  render();
}));
$('#help-button').onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
render();
updateQueryHint();
if (storageBroken) { $('.local-badge').textContent = '存储读取失败'; notify('本地记录无法读取，新增记录将尝试重新保存'); }

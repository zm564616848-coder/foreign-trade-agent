import { categories, filterCarriers, websiteVerification } from './carriers.js';

const $ = selector => document.querySelector(selector);
const key = 'logihub.v1';
let saved = {};
let favorites = [];
let storageBroken = false;
try {
  const value = JSON.parse(localStorage.getItem(key) || '{}');
  if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  if (Array.isArray(saved.favorites)) favorites = saved.favorites.filter(id => typeof id === 'string');
} catch { storageBroken = true; }
let view = 'directory';
let category = 'all';
let toastTimer;
function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function save() {
  try {
    // Preserve existing local records even though shipment UI was removed.
    localStorage.setItem(key, JSON.stringify({ ...saved, favorites }));
    storageBroken = false;
  } catch { storageBroken = true; notify('浏览器存储不可用，收藏仅在本次页面中保留'); }
  $('.local-badge').textContent = storageBroken ? '收藏未持久保存' : '收藏已保存到本机';
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function carrierCard(carrier) {
  const card = element('article', 'carrier-card');
  const top = element('div', 'card-top');
  const favorite = element('button', 'favorite-button' + (favorites.includes(carrier.id) ? ' selected' : ''), favorites.includes(carrier.id) ? '★' : '☆');
  favorite.setAttribute('aria-label', `${favorites.includes(carrier.id) ? '取消收藏' : '收藏'}${carrier.name}`);
  favorite.setAttribute('aria-pressed', String(favorites.includes(carrier.id)));
  favorite.onclick = () => {
    favorites = favorites.includes(carrier.id) ? favorites.filter(id => id !== carrier.id) : [...favorites, carrier.id];
    save(); render();
  };
  top.append(element('span', `carrier-logo logo-${carrier.id}`, carrier.mark), favorite);
  const bottom = element('div', 'card-bottom');
  const tag = element('span', 'category-tag', categories[carrier.category]);
  if (carrier.url.startsWith('http:')) tag.append(element('span', 'http-label', ' · HTTP'));
  const verified = websiteVerification[carrier.id];
  const link = element('a', 'carrier-card-link', carrier.name);
  link.href = carrier.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `访问${carrier.name}网站`);
  bottom.append(tag);
  const heading = element('h3');
  heading.append(link);
  card.append(top, heading, element('div', 'english-name', carrier.english));
  if (verified) card.append(element('p', 'integration-note', verified.note));
  card.append(bottom);
  return card;
}
function render() {
  const label = view === 'favorites' ? '常用物流' : '物流网站';
  $('#breadcrumb').textContent = label;
  $('#section-title').textContent = view === 'favorites' ? label : '物流服务商';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const items = filterCarriers({ query: $('#search').value, category, favorites: view === 'favorites' ? favorites : null });
  $('#result-count').textContent = `${items.length} 个网站`;
  const grid = $('#content-grid'); grid.replaceChildren(...items.map(carrierCard));
  if (!items.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('span', '', '⌕'), element('h3', '', $('#search').value ? '没有找到匹配的网站' : '还没有收藏网站'), element('p', '', '试试其他关键词或分类，点击星标收藏常用网站。'));
    grid.append(empty);
  }
}
$('#search').addEventListener('input', render);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; $('#search').value = ''; render(); }));
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  render();
}));
$('#help-button').onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
render();
if (storageBroken) notify('收藏读取失败，本次可继续浏览网站');

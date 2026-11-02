export const categories = { ocean: '海运', express: '国际快递', customs: '双清专线' };
export const carriers = [
  ['maersk', '马士基', 'MAERSK', 'ocean', 'https://www.maersk.com/tracking/Maersk', 'M', '#126b8c'],
  ['msc', '地中海航运', 'MSC', 'ocean', 'https://www.msc.com/zh-cn/track-a-shipment', 'msc', '#a98329'],
  ['cma', '达飞轮船', 'CMA CGM', 'ocean', 'https://www.cma-cgm.com/ebusiness/tracking', 'CMA', '#273e72'],
  ['cosco', '中远海运集运', 'COSCO SHIPPING', 'ocean', 'https://elines.coscoshipping.com/ebusiness/', '中远', '#315a95'],
  ['hpl', '赫伯罗特', 'HAPAG-LLOYD', 'ocean', 'https://www.hapag-lloyd.cn/zh/online-business/track/track-by-booking-solution.html', 'HL', '#c56b2d'],
  ['one', '海洋网联', 'ONE', 'ocean', 'https://ch.one-line.com/zh-hans/tracking', 'ONE', '#b72672'],
  ['evergreen', '长荣海运', 'EVERGREEN', 'ocean', 'https://www.evergreen-marine.com/track', '长荣', '#218052'],
  ['yangming', '阳明海运', 'YANG MING', 'ocean', 'https://www.yangming.com/e-service/track_trace/track_trace_cargo_tracking.aspx', 'YM', '#445d9a'],
  ['wanhai', '万海航运', 'WAN HAI', 'ocean', 'https://eshipping.wanhai.com/cec/', 'WH', '#288796'],
  ['oocl', '东方海外', 'OOCL', 'ocean', 'https://www.oocl.com/schi/ourservices/eservices/cargotracking/Pages/CargoTracking.aspx', 'OOCL', '#b34041'],
  ['17track', '17TRACK 全球查询', '17TRACK', 'express', 'https://www.17track.net/zh-cn', '17', '#32805e'],
  ['dhl', '敦豪快递', 'DHL', 'express', 'https://mydhlplus.dhl.com/cn/zh/tracking.html', 'DHL', '#ae7d00'],
  ['ups', '联合包裹', 'UPS', 'express', 'https://www.ups.com/track?loc=zh_CN', 'UPS', '#76502c'],
  ['fedex', '联邦快递', 'FEDEX', 'express', 'https://www.fedex.com/zh-cn/tracking.html', 'FedEx', '#674a94'],
  ['usps', '美国邮政', 'USPS', 'express', 'https://tools.usps.com/tracking/', 'USPS', '#3b608f'],
  ['jimi', '集米物流', 'JIMI LOGISTICS', 'customs', 'https://oms.gzfst.cn/index/track', '集米', '#328782'],
  ['tongzhi', '同智物流', 'TONGZHI LOGISTICS', 'customs', 'http://www.cnwwil.com', '同智', '#51739e'],
  ['shida', '世拓物流（原标世达）', 'STOCK LOGISTICS', 'customs', 'http://www.stockcargo.cn/index.php?m=content&c=index&a=cargo_tracking&catid=20', '世拓', '#7f6698'],
  ['meite', '美特联合物流', 'MEITE LOGISTICS', 'customs', 'http://jingya.track.8bami.com/?EnterpriseNo=jy', '美特', '#ae7850']
].map(([id, name, english, category, url, mark, color]) => ({ id, name, english, category, url, mark, color }));

export const websiteVerification = {
  jimi: { identity: false, note: '原查询页可访问，集米品牌归属待核验；单号查询使用 17TRACK' },
  tongzhi: { identity: true, note: '同智官网已核验；单号查询使用 HTTPS 17TRACK，免 HTTP 表单确认' },
  shida: { identity: true, note: '原站显示广州世拓；查询页被网站防护拦截，查询使用 17TRACK' },
  meite: { identity: false, note: '原网址为 8BAMI 托管查询页，美特归属待核验；查询使用 17TRACK' }
};

export function filterCarriers({ query = '', category = 'all', favorites = null } = {}) {
  const term = query.trim().toLowerCase();
  return carriers.filter(c => (category === 'all' || category === c.category)
    && (!favorites || favorites.includes(c.id))
    && `${c.name} ${c.english} ${c.id}`.toLowerCase().includes(term));
}
export function parseTrackingNumbers(text) {
  const values = [...new Set(text.split(/[\s,，;；]+/u).filter(Boolean))];
  if (values.length > 20) throw new Error('每次最多添加 20 个单号');
  if (values.some(v => !/^[A-Za-z0-9-]{4,50}$/.test(v))) throw new Error('单号需为 4–50 位字母、数字或连字符');
  return values;
}

// Public web query formats; these links do not provide a tracking-data API.
// Keep the remaining carriers on their supplied landing page until a supported
// parameter format has been established. Never guess a private API endpoint.
const trackingLinks = {
  '17track': number => `https://t.17track.net/zh-cn#nums=${encodeURIComponent(number)}`,
  ups: number => `https://www.ups.com/track?loc=zh_CN&tracknum=${encodeURIComponent(number)}`,
  fedex: number => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(number)}&cntry_code=cn`,
  usps: number => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(number)}`,
  dhl: number => `https://www.dhl.com/cn-zh/home/tracking.html?tracking-id=${encodeURIComponent(number)}`
};

export function supportsTrackingLink(carrierId) {
  return Object.hasOwn(trackingLinks, carrierId);
}

export function officialTrackingLink(carrierId, number) {
  const carrier = carriers.find(c => c.id === carrierId);
  if (!carrier) throw new Error('未知物流商');
  if (number === undefined) return { url: carrier.url, prefilled: false };
  if (typeof number !== 'string' || !/^[A-Za-z0-9-]{4,50}$/.test(number)) throw new Error('无效物流单号');
  return supportsTrackingLink(carrierId)
    ? { url: trackingLinks[carrierId](number), prefilled: true }
    : { url: carrier.url, prefilled: false };
}

export function queryDestination(carrierId, number) {
  const destination = officialTrackingLink(carrierId, number);
  const carrier = carriers.find(c => c.id === carrierId);
  if (destination.prefilled) return { ...destination, source: `${carrier.name}官网`, fallback: false,
    navigationUrl: destination.method === 'POST' ? `./submit-query.html?carrier=${encodeURIComponent(carrierId)}&number=${encodeURIComponent(number)}` : destination.url };
  const fallback = officialTrackingLink('17track', number);
  return { ...fallback, navigationUrl: fallback.url, source: '17TRACK', fallback: true };
}

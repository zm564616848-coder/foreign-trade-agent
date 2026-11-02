const endpoint = 'https://api.17track.net/track/v2.2/';
// Tongzhi coverage confirmed with a user-authorized live query (provider TZ).
const supported = new Set(['17track', 'dhl', 'ups', 'fedex', 'usps', 'tongzhi']);

export class TrackingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeTracking(item) {
  const info = item.track_info;
  if (!info || typeof info !== 'object') throw new TrackingError(502, '轨迹服务返回的数据格式异常');
  const providers = Array.isArray(info.tracking?.providers) ? info.tracking.providers : [];
  const events = providers.flatMap(p => (Array.isArray(p.events) ? p.events : []).map(e => ({
    time: String(e.time_iso || e.time_raw?.date || ''),
    description: String(e.description || ''),
    location: String(e.location || ''),
    provider: String(p.provider?.name || '')
  }))).filter(e => e.description);
  events.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
  return { number: item.number, source: '17TRACK', status: String(info.latest_status?.status || 'Unknown'),
    providers: [...new Set(events.map(e => e.provider).filter(Boolean))], events, retrievedAt: new Date().toISOString() };
}

export function createTrackingService({ apiKey = process.env.TRACK17_API_KEY, fetchImpl = fetch } = {}) {
  const cache = new Map();
  let day = '', used = 0;
  async function call(action, number) {
    let response;
    try {
      response = await fetchImpl(endpoint + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json', '17token': apiKey },
        body: JSON.stringify([{ number }]), signal: AbortSignal.timeout(15000), redirect: 'error'
      });
    } catch { throw new TrackingError(502, '暂时无法连接轨迹服务，请稍后重试'); }
    if ([401, 403].includes(response.status)) throw new TrackingError(502, '轨迹服务授权失败，请检查后端 API 配置');
    if (response.status === 429) throw new TrackingError(429, '轨迹服务查询频率或额度受限');
    if (!response.ok) throw new TrackingError(502, '轨迹服务暂时不可用');
    let result;
    try { result = await response.json(); } catch { throw new TrackingError(502, '轨迹服务返回的数据格式异常'); }
    if (result.code !== 0 || !result.data) throw new TrackingError(502, '轨迹服务拒绝了查询，请检查 API 授权与账户额度');
    return result.data;
  }
  return async ({ carrier, number }) => {
    if (typeof number !== 'string' || !/^[A-Za-z0-9-]{4,50}$/.test(number)) throw new TrackingError(400, '请输入有效单号');
    if (!supported.has(carrier)) throw new TrackingError(422, '该服务商尚未确认 API 覆盖，暂不能在本页查询');
    if (!apiKey) throw new TrackingError(503, '实时轨迹尚未开通：管理员需要配置后端查询服务及 API 密钥');
    const cached = cache.get(number);
    if (cached && Date.now() - cached.at < 60000) return cached.value;
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; used = 0; }
    // A conservative per-process quota bounds registrations while deployment
    // authentication and account limits are being configured.
    if (++used > 50) throw new TrackingError(429, '本服务今日查询上限已到，请稍后再试');
    // Query registered shipments first. Register only when no result exists.
    let data = await call('gettrackinfo', number);
    let item = data.accepted?.find(i => i.number === number && i.track_info);
    if (!item) {
      const registered = await call('register', number);
      if (!registered.accepted?.some(i => i.number === number)) {
        throw new TrackingError(422, '该单号无法登记，请检查单号、服务商支持范围和账户额度');
      }
      data = await call('gettrackinfo', number);
      item = data.accepted?.find(i => i.number === number && i.track_info);
    }
    if (!item) return { number, source: '17TRACK', status: 'Pending', providers: [], events: [], retrievedAt: new Date().toISOString() };
    const value = normalizeTracking(item);
    // Bound retained shipment data; no persistent tracking cache is written.
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(number, { value, at: Date.now() });
    return value;
  };
}

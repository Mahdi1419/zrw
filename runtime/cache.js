class MemoryCache {
  constructor() {
    this.map = new Map();
  }
  _key(request) {
    return typeof request === 'string' ? request : request.url;
  }
  async match(request) {
    const key = this._key(request);
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt && Date.now() > hit.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return hit.response.clone();
  }
  async put(request, response) {
    const key = this._key(request);
    const cc = response.headers.get('cache-control') || '';
    const m = cc.match(/max-age=(\d+)/i);
    const expiresAt = m ? Date.now() + Number(m[1]) * 1000 : 0;
    this.map.set(key, { response: response.clone(), expiresAt });
  }
  async delete(request) {
    return this.map.delete(this._key(request));
  }
}

export function installCacheCompat() {
  if (!globalThis.caches) {
    globalThis.caches = { default: new MemoryCache() };
  } else if (!globalThis.caches.default) {
    globalThis.caches.default = new MemoryCache();
  }
}

import { PACK_API } from '../../shared/interface-pack.ts'

/**
 * What a surface may load and do. The `sandbox` directive is in the header as well as on the frame, so that
 * the page is just as closed when someone opens its address on its own.
 *
 * The sandbox keeps a pack out of the host page, its credentials and browser storage. Fetch-like loads are limited
 * to the pack's own files. Scripts remain trusted input: browsers do not provide a CSP directive that prevents a
 * frame from navigating itself, so a hostile pack could put data in an outbound navigation URL.
 */
export const FRAME_POLICY = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ')

/** The headers of every file of a pack. */
export const PACK_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': FRAME_POLICY,
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-cache',
  'referrer-policy': 'no-referrer',
}

/**
 * The `rp` object a surface sees. It is plain ES5 so that it runs wherever the page does, and it only
 * posts messages: every decision is the page's. Requests time out after 20 seconds.
 */
export const BRIDGE_SCRIPT = `(function () {
  var API = ${PACK_API};
  var pending = {};
  var counter = 0;
  var watchers = [];
  var listeners = { turn: [], suggestions: [], theme: [] };
  var latest;
  function post(message) { message.rp = API; parent.postMessage(message, '*'); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++counter;
      var timer = setTimeout(function () { delete pending[id]; reject(new Error('rp.' + method + ' did not get an answer')); }, 20000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      post({ type: 'request', id: id, method: method, params: params });
    });
  }
  function each(list, value) { list.slice().forEach(function (listener) { try { listener(value); } catch (error) { console.error(error); } }); }
  function applyTheme(data) {
    var root = document.documentElement;
    root.setAttribute('data-rp-scheme', data.scheme);
    root.style.colorScheme = data.scheme;
    if (data.language) root.setAttribute('lang', data.language);
    Object.keys(data.tokens).forEach(function (name) { root.style.setProperty(name, data.tokens[name]); });
  }
  function remove(list, listener) { var index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }
  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var message = event.data;
    if (!message || message.rp !== API) return;
    if (message.type === 'response') {
      var entry = pending[message.id];
      if (!entry) return;
      delete pending[message.id];
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value); else entry.reject(new Error(message.error));
    } else if (message.type === 'event') {
      if (message.name === 'state') { latest = message.data; each(watchers, latest); }
      else if (message.name === 'theme') { applyTheme(message.data); each(listeners.theme, message.data); }
      else if (listeners[message.name]) each(listeners[message.name], message.data);
    }
  });
  function on(name, listener) {
    if (!listeners[name]) throw new Error('rp.on: there is no event "' + name + '"');
    listeners[name].push(listener);
    return function () { remove(listeners[name], listener); };
  }
  window.rp = Object.freeze({
    api: API,
    state: function () { return latest ? Promise.resolve(latest) : request('state'); },
    watch: function (listener) {
      watchers.push(listener);
      if (latest) listener(latest);
      return function () { remove(watchers, listener); };
    },
    on: on,
    say: function (text) { return request('say', { text: String(text) }); },
    fill: function (text) { return request('fill', { text: String(text) }); },
    choose: function (index) { return request('choose', { index: index }); },
    storage: {
      get: function (key) { return request('storage.get', { key: String(key) }); },
      set: function (key, value) { return request('storage.set', { key: String(key), value: value }); },
      remove: function (key) { return request('storage.remove', { key: String(key) }); }
    },
    history: function (limit) { return request('history', { limit: limit }); },
    open: function (surface) { return request('open', { surface: String(surface) }); },
    resize: function (height) { post({ type: 'resize', height: Number(height) }); },
    theme: function () { return request('theme'); }
  });
  post({ type: 'hello' });
})();`

/**
 * A surface's HTML with the bridge put first, so that `rp` exists before any script of the pack runs.
 * It goes right after the opening of `<head>`, else of `<html>`, else at the top (never before a doctype).
 */
export function withBridge(html: string): string {
  const script = `<script>${BRIDGE_SCRIPT}</script>`
  for (const opening of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = opening.exec(html)
    if (match !== null) return `${html.slice(0, match.index + match[0].length)}${script}${html.slice(match.index + match[0].length)}`
  }
  return `${script}${html}`
}

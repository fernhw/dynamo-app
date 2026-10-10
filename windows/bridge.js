/* Dynamo bridge for the Windows shell (WebView2). Mac uses web/bridge.js.
   Routes the engine's WebDAV I/O to the host; host replies {id, result}.
   Doesn't add the dynamo-native class, so the in-page File/Edit/Format/View
   menubar stays visible — Windows apps keep menus inside the window. */
(function () {
  'use strict';
  var wv = window.chrome && window.chrome.webview;
  if (!wv) return;

  var seq = 0, pending = {};
  wv.addEventListener('message', function (e) {
    var m = e.data;
    if (m && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; }
  });
  function send(msg) {
    return new Promise(function (resolve) {
      msg.id = ++seq;
      pending[msg.id] = resolve;
      wv.postMessage(msg);
    });
  }

  window.DynamoNative = {
    platform: 'windows',
    cmd: function (name, extra) {
      var msg = { cmd: name };
      if (extra) for (var k in extra) msg[k] = extra[k];
      return send(msg);
    }
  };

  /* no OS menu bar: file shortcuts handled here (engine already does Ctrl+S) */
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.altKey) return;
    var k = (e.key || '').toLowerCase(), c = null;
    if (k === 'n' && !e.shiftKey) c = 'new';
    else if (k === 'o' && !e.shiftKey) c = 'open';
    else if (k === 'w' && !e.shiftKey) c = 'close';
    else if (k === 's' && e.shiftKey) c = 'saveAs';
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    window.DynamoNative.cmd(c);
  }, true);

  /* engine menus print Mac glyphs; show Ctrl+/Shift+ instead */
  function winAccel(a) {
    if (!/[\u2318\u21E7]/.test(a)) return a;
    return (a.indexOf('\u2318') >= 0 ? 'Ctrl+' : '') + (a.indexOf('\u21E7') >= 0 ? 'Shift+' : '') +
           a.replace(/[\u2318\u21E7]/g, '');
  }
  new MutationObserver(function () {
    document.querySelectorAll('.sp-menu-accel').forEach(function (el) {
      var t = winAccel(el.textContent);
      if (t !== el.textContent) el.textContent = t;
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('dynamo:') !== 0 && url.indexOf('/remote.php/dav/') === -1) {
      return nativeFetch(input, opts);
    }
    var method = ((opts && opts.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      return send({ cmd: 'read' }).then(function (text) {
        return new Response(text || '', { status: 200 });
      });
    }
    if (method === 'PUT') {
      return send({ cmd: 'write', text: String((opts && opts.body) || '') }).then(function () {
        return new Response(null, { status: 204 });
      });
    }
    return Promise.resolve(new Response(null, { status: 201 }));
  };
})();

/* Dynamo native bridge. Injected by the desktop shell at document start.
   The engine still speaks WebDAV (GET/PUT/MKCOL); this routes those calls to
   the shell, which owns the real file. Shell must expose a reply-capable
   message handler named "dynamo" (WKScriptMessageHandlerWithReply on Apple). */
(function () {
  'use strict';
  var port = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dynamo;
  if (!port) return;
  document.documentElement.classList.add('dynamo-native');

  window.DynamoNative = {
    cmd: function (name, extra) {
      var msg = { cmd: name };
      if (extra) for (var k in extra) msg[k] = extra[k];
      return port.postMessage(msg);
    }
  };

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('dynamo:') !== 0 && url.indexOf('/remote.php/dav/') === -1) {
      return nativeFetch(input, opts);
    }
    var method = ((opts && opts.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      return port.postMessage({ cmd: 'read' }).then(function (text) {
        return new Response(text || '', { status: 200 });
      });
    }
    if (method === 'PUT') {
      return port.postMessage({ cmd: 'write', text: String((opts && opts.body) || '') }).then(function () {
        return new Response(null, { status: 204 });
      });
    }
    return Promise.resolve(new Response(null, { status: 201 }));
  };
})();

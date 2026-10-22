// Requests from the TV pages to the hub service (ES5, WebKit 537): window.Hub.request.
// The service's "start" method answers with a token (services/home/service.js); every
// request carries it in X-Hub-Token, so the hub knows it comes from this app and not from
// a web page in the TV's browser. A restarted service has a new token: a request that
// gets 401 or 403 asks for the token again and is sent once more.
(function () {
  var API = "http://127.0.0.1:8765";
  var token = null;
  var asking = false;
  var askSeq = 0; // the latest start call; an older call's timer must not act
  var noBridge = typeof PalmServiceBridge === "undefined"; // a desktop browser (screenshots)
  var waiting = [];

  function flush() {
    var list = waiting;
    waiting = [];
    for (var i = 0; i < list.length; i++) list[i]();
  }

  // Also starts the service; it keeps running after this app closes.
  function askToken() {
    if (asking) return;
    if (noBridge) return flush();
    asking = true;
    var my = ++askSeq;
    var bridge = new PalmServiceBridge();
    bridge.onservicecallback = function (text) {
      if (my !== askSeq) return;
      var r = null;
      try { r = JSON.parse(text); } catch (e) { r = null; }
      if (r && r.token) token = r.token;
      asking = false;
      flush();
    };
    bridge.call("luna://com.lgtvfastest.home.service/start", "{}");
    window.hubBridge = bridge; // keep a reference so the call is not collected
    // No answer (the service is still starting): send the requests anyway; they get 401
    // or 403, and the next request asks again.
    setTimeout(function () {
      if (my !== askSeq || !asking) return;
      asking = false;
      flush();
    }, 5000);
  }

  function send(method, path, body, done, retried) {
    var x = new XMLHttpRequest();
    x.open(method, API + path, true);
    x.timeout = 30000;
    if (body) x.setRequestHeader("Content-Type", "application/json");
    if (token) x.setRequestHeader("X-Hub-Token", token);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if ((x.status === 401 || x.status === 403) && !retried && !noBridge) {
        token = null;
        waiting.push(function () { send(method, path, body, done, true); });
        return askToken();
      }
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
      done(x.status, data);
    };
    x.send(body ? JSON.stringify(body) : null);
  }

  window.Hub = {
    request: function (method, path, body, done) {
      if (token || noBridge) return send(method, path, body, done);
      waiting.push(function () { send(method, path, body, done); });
      askToken();
    },
    start: askToken
  };
})();

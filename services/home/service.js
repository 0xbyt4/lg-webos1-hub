// webOS service wrapper: the Home Screen app calls "start" on launch, which brings up the
// hub server (server.js): phone remote, Claude assistant, health monitor and scheduler.
// Node 0.10, ES5.
//
// The server does not start by itself after the TV restarts: on webOS 1.4 a Developer Mode
// service cannot register an Activity Manager callback (the activity is stored with
// "callback": null and never runs). Opening the Home Screen app starts it.
var Service = require("webos-service");
var server = require("./server.js");

// One port for the phone page, the API and the games.
var PORTS = [8765];
var service = new Service("com.lgtvfastest.home.service");
// webos-service exits after 5 s without activities; the HTTP server must outlive that.
service.activityManager._stopTimer();
service.activityManager.exitOnTimeout = false;

var running = null;
var startedAt = 0;

// Remove an app that Developer Mode installed. The install service streams its progress
// ("app closing", "removing ipk", ... or "remove failed"). The subscription object must
// stay referenced, or Node may collect it and the progress messages are lost. The caller
// checks the app list afterwards, so a missed final message is not fatal.
function uninstall(appId, cb) {
  var finished = false;
  var sub = service.subscribe("luna://com.webos.appInstallService/dev/remove", { id: appId, subscribe: true });
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sub.cancel();
    cb(err);
  }
  var timer = setTimeout(function () { finish(null); }, 20000);
  sub.on("response", function (message) {
    var p = message.payload || {};
    var state = (p.details && p.details.state) || "";
    if (state) server.log("remove " + appId + ": " + state);
    if (p.returnValue === false || p.errorText || /fail/i.test(state)) {
      return finish(new Error(p.errorText || state || "remove failed"));
    }
    if (/^removed$|uninstalled|remove complete/i.test(state)) finish(null);
  });
}

process.on("uncaughtException", function (e) {
  // Keep running: one bad request or timer must not stop the remote or the monitor.
  server.log("uncaught: " + (e && e.stack ? e.stack : e));
});

// "start" also gives the caller the token that marks its HTTP requests as the Home
// Screen's (server.js). Only apps and services on the TV can call it.
service.register("start", function (message) {
  if (!running) {
    running = server.start(PORTS, { uninstall: uninstall });
    startedAt = Date.now();
  }
  message.respond({ returnValue: true, ports: PORTS, pid: process.pid, token: running.tvToken,
    upSeconds: Math.round((Date.now() - startedAt) / 1000) });
});

// "quit" stops the service, so the next "start" runs the newly installed code
// (scripts/deploy.sh calls it before installing).
service.register("quit", function (message) {
  server.log("quit requested");
  message.respond({ returnValue: true });
  setTimeout(function () { process.exit(0); }, 200);
});

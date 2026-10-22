// The TV control client (services/home/ssap.js) against fake TVs: a TV that never answers
// the handshake, a TV that drops the connection while the key socket is being set up, a
// TV that sends no key socket, and a TV that refuses pairing. No callback may be lost and
// nothing may throw.
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var http = require("http");
var net = require("net");
var h = require("./harness.js");
var wsserver = require("../services/home/wsserver.js");
var TVClient = require("../services/home/ssap.js").TVClient;

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ssap-"));
process.on("exit", function () { fs.rmSync(dir, { recursive: true, force: true }); });
var keyPath = path.join(dir, "tv_key");
var thrown = [];
process.on("uncaughtException", function (e) { thrown.push(e); });

function listen(server) {
  return new Promise(function (resolve) { server.listen(0, "127.0.0.1", function () { resolve(server.address().port); }); });
}

// A fake TV: onRequest(msg, conn) answers SSAP requests after the registration.
async function fakeTv(onRegister, onRequest) {
  var server = http.createServer();
  wsserver.attach(server, "/", function (conn) {
    conn.onmessage = function (text) {
      var msg = JSON.parse(text);
      if (msg.type === "register") return onRegister(msg, conn);
      onRequest(msg, conn);
    };
    conn.onclose = function () {};
  });
  return listen(server);
}

function registered(msg, conn) {
  conn.sendJson({ type: "registered", id: "register", payload: { "client-key": "test-key" } });
}

function callback() {
  var c = { calls: [] };
  c.fn = function (err, result) { c.calls.push(err ? err.message : result); };
  return c;
}

h.run(async function () {
  // 1. The TV accepts TCP but never answers the handshake: the request times out on time.
  var silent = net.createServer(function () {});
  var silentPort = await listen(silent);
  var tv1 = new TVClient("127.0.0.1", keyPath, silentPort);
  var c1 = callback();
  var started = Date.now();
  tv1.request("ssap://system/getSystemInfo", null, c1.fn, 300);
  await h.wait(500);
  assert.deepStrictEqual(c1.calls, ["timeout: ssap://system/getSystemInfo"]);
  assert.ok(Date.now() - started < 2000);

  // 2. The connection drops while the key socket is requested: the key fails, no throw.
  var port2 = await fakeTv(registered, function (msg, conn) {
    if (/getPointerInputSocket/.test(msg.uri)) conn.close(1000);
  });
  var tv2 = new TVClient("127.0.0.1", keyPath, port2);
  var c2 = callback();
  tv2.button("HOME", c2.fn);
  await h.wait(500);
  assert.deepStrictEqual(c2.calls.length, 1);
  assert.ok(/connection lost/.test(c2.calls[0]), c2.calls[0]);
  assert.strictEqual(tv2.pointer, null);
  assert.ok(fs.statSync(keyPath).mode % 512 === 384, "the pairing key is saved with mode 0600");

  // 3. The TV answers without a key socket: the key fails instead of waiting.
  var port3 = await fakeTv(registered, function (msg, conn) {
    conn.sendJson({ type: "response", id: msg.id, payload: { returnValue: true } });
  });
  var tv3 = new TVClient("127.0.0.1", keyPath, port3);
  var c3 = callback();
  tv3.button("HOME", c3.fn);
  await h.wait(500);
  assert.deepStrictEqual(c3.calls, ["no pointer socket from the TV"]);

  // 4. Pairing refused on the TV: the request says so.
  var port4 = await fakeTv(function (msg, conn) {
    conn.sendJson({ type: "error", id: "register", error: "403 the user denied access" });
  }, function () {});
  var tv4 = new TVClient("127.0.0.1", keyPath, port4);
  var c4 = callback();
  tv4.request("ssap://system/getSystemInfo", null, c4.fn, 3000);
  await h.wait(500);
  assert.strictEqual(c4.calls.length, 1);
  assert.ok(/pairing refused: 403/.test(c4.calls[0]), c4.calls[0]);

  // 5. A normal request still works.
  var port5 = await fakeTv(registered, function (msg, conn) {
    conn.sendJson({ type: "response", id: msg.id, payload: { modelName: "47LB652V" } });
  });
  var tv5 = new TVClient("127.0.0.1", keyPath, port5);
  var c5 = callback();
  tv5.request("ssap://system/getSystemInfo", null, c5.fn);
  await h.wait(300);
  assert.deepStrictEqual(c5.calls, [{ modelName: "47LB652V" }]);

  assert.deepStrictEqual(thrown.map(String), []);
});

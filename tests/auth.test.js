// The hub's access rules over the real server: the Host check, JSON only, the setup PIN
// for the first access code, the Home Screen token, CORS, changing the code, the lockout
// and the WebSocket checks. Requests from this test come from 127.0.0.1 like a web page
// in the TV's browser would, so without the token they count as any other device.
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var http = require("http");
var net = require("net");
var h = require("./harness.js");

var PORT = 18500 + Math.floor(Math.random() * 200);
process.env.HUB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "hub-auth-"));
process.on("exit", function () { fs.rmSync(process.env.HUB_DATA, { recursive: true, force: true }); });
var realLog = console.log;
console.log = function () {}; // the server logs every request
var servers = require("../services/home/server.js").start([PORT], { uninstall: function (id, cb) { cb(null); } });
var TOKEN = servers.tvToken;

// opts: { method, body (object, or a string sent as is), headers }
function call(p, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var data = opts.body === undefined ? null : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    var headers = { Host: "127.0.0.1:" + PORT };
    if (data !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    for (var k in opts.headers || {}) headers[k] = opts.headers[k];
    var r = http.request({ host: "127.0.0.1", port: PORT, method: opts.method || (data !== null ? "POST" : "GET"), path: p, headers: headers }, function (res) {
      var c = [];
      res.on("data", function (x) { c.push(x); });
      res.on("end", function () {
        var text = Buffer.concat(c).toString();
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, json: json, text: text });
      });
    });
    r.on("error", function (e) { resolve({ status: 0, error: e.message }); });
    r.end(data);
  });
}

// A raw WebSocket handshake; resolves with the status line.
function upgrade(headers) {
  return new Promise(function (resolve) {
    var s = net.connect(PORT, "127.0.0.1", function () {
      var lines = ["GET /ws HTTP/1.1", "Upgrade: websocket", "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13"];
      for (var k in headers) lines.push(k + ": " + headers[k]);
      s.write(lines.join("\r\n") + "\r\n\r\n");
    });
    s.once("data", function (d) { resolve(d.toString().split("\r\n")[0]); s.destroy(); });
  });
}

var tv = { "X-Hub-Token": TOKEN };

h.run(async function () {
  await h.wait(200);

  // DNS rebinding: a request for another host name is refused.
  assert.strictEqual((await call("/api/status", { headers: { Host: "rebind.example:" + PORT } })).status, 403);
  assert.strictEqual((await call("/", { headers: { Host: "rebind.example" } })).status, 403);

  // Without the token, a request from the TV's own address is not the Home Screen.
  var st = await call("/api/status");
  assert.deepStrictEqual(st.json, { accessCodeSet: false, authorized: false });
  assert.strictEqual((await call("/api/status", { headers: tv })).json.authorized, true);
  assert.strictEqual((await call("/api/settings")).status, 401);
  assert.notStrictEqual((await call("/api/games/tv?since=0")).status, 200);
  assert.strictEqual((await call("/api/games/tv?since=0", { headers: tv })).status, 200);

  // JSON only: a blind text/plain post from a web page is refused.
  var plain = await call("/api/access", { body: '{"code":"takeover1"}', headers: { "Content-Type": "text/plain" } });
  assert.strictEqual(plain.status, 415);

  // The first code needs the setup PIN that only the Home Screen gets.
  assert.strictEqual((await call("/api/access", { body: { code: "takeover1" } })).status, 403);
  assert.strictEqual((await call("/api/health")).json.setupPin, undefined, "the PIN is not public");
  var pin = (await call("/api/health", { headers: tv })).json.setupPin;
  assert.ok(/^\d{6}$/.test(pin));
  assert.strictEqual((await call("/api/access", { body: { code: "short", pin: pin } })).status, 400, "at least 6 characters");
  assert.strictEqual((await call("/api/access", { body: { code: "secret1", pin: pin } })).status, 200);
  assert.strictEqual((await call("/api/health", { headers: tv })).json.setupPin, null, "no PIN once a code exists");

  // The code, the token, and nothing else.
  assert.strictEqual((await call("/api/settings")).status, 401);
  assert.strictEqual((await call("/api/settings", { headers: { "X-Access-Code": "wrong-1" } })).status, 401);
  assert.strictEqual((await call("/api/settings", { headers: { "X-Access-Code": "secret1" } })).status, 200);
  assert.strictEqual((await call("/api/settings", { headers: tv })).status, 200);
  assert.strictEqual((await call("/api/settings", { headers: { "X-Hub-Token": "guess" } })).status, 401);

  // A phone with the access code still cannot act as the TV Games screen.
  assert.strictEqual((await call("/api/games/tv?since=0", { headers: { "X-Access-Code": "secret1" } })).status, 403);

  // Changing the code needs the old one.
  assert.strictEqual((await call("/api/access", { body: { code: "takeover1" } })).status, 403);
  assert.strictEqual((await call("/api/access", { body: { code: "secret22" }, headers: { "X-Access-Code": "secret1" } })).status, 200);

  // CORS: only the Home Screen's file:// pages (Origin "null") may read answers.
  var evil = await call("/api/status", { headers: { Origin: "http://evil.example" } });
  assert.strictEqual(evil.headers["access-control-allow-origin"], undefined);
  var app = await call("/api/status", { headers: { Origin: "null" } });
  assert.strictEqual(app.headers["access-control-allow-origin"], "null");
  assert.ok(/X-Hub-Token/.test(app.headers["access-control-allow-headers"]));

  // A body over the limit is refused.
  var big = await call("/api/log", { body: JSON.stringify({ message: new Array(6000).join("x") }), headers: tv });
  assert.ok(big.status === 400 || big.status === 0, "large body refused (" + big.status + ")");

  // WebSocket: wrong Host or a foreign page is refused; a page from here is accepted.
  assert.ok(/ 403 /.test(await upgrade({ Host: "rebind.example:" + PORT })));
  assert.ok(/ 403 /.test(await upgrade({ Host: "127.0.0.1:" + PORT, Origin: "http://evil.example" })));
  assert.ok(/ 101 /.test(await upgrade({ Host: "127.0.0.1:" + PORT, Origin: "http://127.0.0.1:" + PORT })));

  // Ten wrong codes lock out that address, even with the right code; not the Home Screen.
  for (var i = 0; i < 10; i++) await call("/api/settings", { headers: { "X-Access-Code": "wrong-" + i } });
  assert.strictEqual((await call("/api/settings", { headers: { "X-Access-Code": "secret22" } })).status, 429);
  assert.strictEqual((await call("/api/settings", { headers: tv })).status, 200);
  console.log = realLog;
});

// Minimal WebSocket server (RFC 6455) for the TV's Node.js 0.10 (ES5): text messages only.
// The hub has no npm packages, so this handles the upgrade and the frames itself.
// Used by the games: the TV Games screen and the phones keep one connection each.
var crypto = require("crypto");

var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var MAX_MESSAGE = 4096; // games send small JSON messages
var MAX_FRAGMENTS = 16; // a message in more pieces than this is not from a real browser
var MAX_BUFFERED = 64 * 1024; // a client that stops reading is dropped, not buffered for
var MAX_CONNECTIONS = 32;
var MAX_PER_ADDRESS = 6; // one device cannot take every connection

// Set by server.js: one short log line per connection event (the TV has no other trace).
var log = function () {};
var PING_MS = 20 * 1000;
var IDLE_MS = 60 * 1000; // no data or pong for this long: the client is gone

// One client connection. Set conn.onmessage(text) and conn.onclose().
function Connection(socket, req) {
  var self = this;
  this.socket = socket;
  this.remoteAddress = req.connection.remoteAddress;
  this.closed = false;
  this.onmessage = function () {};
  this.onclose = function () {};
  this.buf = new Buffer(0);
  this.parts = [];
  this.partsLength = 0;
  this.lastSeen = Date.now();
  socket.setNoDelay(true);
  socket.on("data", function (chunk) {
    self.lastSeen = Date.now();
    self.buf = Buffer.concat([self.buf, chunk]);
    self.parse();
  });
  socket.on("error", function () { self.close(); });
  socket.on("close", function () { self.close(); });
  this.timer = setInterval(function () {
    if (Date.now() - self.lastSeen > IDLE_MS) return self.close();
    self.frame(0x9, new Buffer(0));
  }, PING_MS);
}

Connection.prototype.parse = function () {
  while (!this.closed && this.buf.length >= 2) {
    var b1 = this.buf[0], b2 = this.buf[1];
    var n = b2 & 0x7f, offset = 2;
    if (!(b2 & 0x80)) return this.close(1002); // a client must mask its frames
    if (n === 126) {
      if (this.buf.length < 4) return;
      n = this.buf.readUInt16BE(2);
      offset = 4;
    } else if (n === 127) {
      if (this.buf.length < 10) return;
      if (this.buf.readUInt32BE(2) !== 0) return this.close(1009);
      n = this.buf.readUInt32BE(6);
      offset = 10;
    }
    if (n > MAX_MESSAGE) return this.close(1009);
    if (this.buf.length < offset + 4 + n) return;
    var mask = this.buf.slice(offset, offset + 4);
    var payload = new Buffer(n);
    for (var i = 0; i < n; i++) payload[i] = this.buf[offset + 4 + i] ^ mask[i % 4];
    this.buf = this.buf.slice(offset + 4 + n);
    var opcode = b1 & 0x0f;
    // Control frames must be whole and small (RFC 6455, section 5.5).
    if (opcode >= 0x8 && (!(b1 & 0x80) || n > 125)) return this.close(1002);
    if (opcode === 0x8) return this.close(1000);
    if (opcode === 0x9) {
      this.frame(0xa, payload);
      continue;
    }
    if (opcode === 0xa) continue;
    if (opcode !== 0x1 && opcode !== 0x0) return this.close(1003); // text only
    this.parts.push(payload);
    // Count the frame headers too, so empty fragments cannot pile up for free.
    this.partsLength += n + offset + 4;
    if (this.partsLength > MAX_MESSAGE || this.parts.length > MAX_FRAGMENTS) return this.close(1009);
    if (b1 & 0x80) {
      var text = Buffer.concat(this.parts).toString("utf8");
      this.parts = [];
      this.partsLength = 0;
      this.onmessage(text);
    }
  }
};

Connection.prototype.frame = function (opcode, data) {
  if (this.closed) return;
  var n = data.length, head;
  if (n < 126) {
    head = new Buffer(2);
    head[1] = n;
  } else if (n < 65536) {
    head = new Buffer(4);
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = new Buffer(10);
    head[1] = 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(n, 6);
  }
  head[0] = 0x80 | opcode;
  if (this.socket.bufferSize > MAX_BUFFERED) {
    this.closed = true; // the client does not read; do not queue more for it
    clearInterval(this.timer);
    this.socket.destroy();
    this.onclose();
    return;
  }
  this.socket.write(Buffer.concat([head, data]));
};

Connection.prototype.send = function (text) {
  this.frame(0x1, new Buffer(text, "utf8"));
};

Connection.prototype.sendJson = function (obj) {
  this.send(JSON.stringify(obj));
};

Connection.prototype.close = function (code) {
  if (this.closed) return;
  log("ws closed (" + (code || "socket") + ") " + this.remoteAddress);
  if (code) {
    var body = new Buffer(2);
    body.writeUInt16BE(code, 0);
    this.frame(0x8, body);
  }
  this.closed = true;
  clearInterval(this.timer);
  this.socket.end();
  this.socket.destroy();
  this.onclose();
};

// Accept WebSocket upgrades on `path` of an http.Server. onConnection(conn, req).
// allowed(req), optional: false refuses the upgrade (wrong Host or Origin).
// The connection count is shared by all servers, so one page cannot use up the hub.
var open = 0;
var perAddress = {};
function attach(server, path, onConnection, allowed) {
  server.on("upgrade", function (req, socket, head) {
    var address = req.connection.remoteAddress;
    log("ws handshake from " + address + " " + req.url + " v" + req.headers["sec-websocket-version"]);
    if (allowed && !allowed(req)) {
      log("ws refused: host " + req.headers.host + ", origin " + req.headers.origin);
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (open >= MAX_CONNECTIONS || (perAddress[address] || 0) >= MAX_PER_ADDRESS) {
      log("ws refused: too many connections (" + open + ", " + (perAddress[address] || 0) + " from " + address + ")");
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    var key = req.headers["sec-websocket-key"];
    var pathname = String(req.url || "").split("?")[0];
    if (pathname !== path || !key || String(req.headers.upgrade || "").toLowerCase() !== "websocket" ||
        req.headers["sec-websocket-version"] !== "13") {
      log("ws refused: bad handshake " + JSON.stringify(req.headers).slice(0, 300));
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    var accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept + "\r\n\r\n");
    var conn = new Connection(socket, req);
    open++;
    perAddress[address] = (perAddress[address] || 0) + 1;
    var counted = true;
    socket.on("close", function () {
      if (!counted) return;
      counted = false;
      open--;
      if (--perAddress[address] <= 0) delete perAddress[address];
    });
    onConnection(conn, req);
    // Frames that arrived together with the handshake.
    if (head && head.length) {
      conn.buf = Buffer.concat([conn.buf, head]);
      conn.parse();
    }
  });
}

module.exports = { attach: attach, MAX_MESSAGE: MAX_MESSAGE, setLog: function (fn) { log = fn; } };

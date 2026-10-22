// Minimal LG webOS (SSAP) client for the TV's own Node.js (v0.10, ES5, callbacks).
var crypto = require("crypto");
var fs = require("fs");
var net = require("net");
var url = require("url");

var PERMISSIONS = [
  "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "CONTROL_AUDIO", "CONTROL_DISPLAY",
  "CONTROL_POWER", "CONTROL_TV_SCREEN", "CONTROL_TV_STANBY", "CONTROL_INPUT_JOYSTICK",
  "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_MEDIA_RECORDING", "CONTROL_INPUT_TEXT",
  "CONTROL_INPUT_TV", "CONTROL_MOUSE_AND_KEYBOARD", "READ_APP_STATUS", "READ_COUNTRY_INFO",
  "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_INSTALLED_APPS", "READ_LGE_SDX",
  "READ_LGE_TV_INPUT_EVENTS", "READ_NETWORK_STATE", "READ_NOTIFICATIONS", "READ_POWER_STATE",
  "READ_RUNNING_APPS", "READ_SETTINGS", "READ_TV_CHANNEL_LIST", "READ_TV_CURRENT_TIME",
  "READ_UPDATE_INFO", "WRITE_NOTIFICATION_TOAST"
];

// Text-only WebSocket client for plain ws:// URLs.
function WebSocket(wsUrl, onOpen, onText, onClose) {
  var parts = url.parse(wsUrl);
  var self = this;
  var buf = new Buffer(0);
  var open = false;
  this.closed = false;
  this.sock = net.connect(parseInt(parts.port || "80", 10), parts.hostname);
  this.sock.setNoDelay(true);
  this.sock.on("connect", function () {
    self.sock.write(
      "GET " + (parts.path || "/") + " HTTP/1.1\r\nHost: " + parts.host + "\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: " + crypto.randomBytes(16).toString("base64") + "\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n");
  });
  this.sock.on("data", function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString("binary").indexOf("\r\n\r\n");
      if (end < 0) return;
      var status = buf.slice(0, end).toString().split("\r\n")[0];
      buf = buf.slice(end + 4);
      if (status.indexOf(" 101 ") < 0) {
        self.close();
        return;
      }
      open = true;
      onOpen();
    }
    parseFrames();
  });
  this.sock.on("error", function () { self.close(); });
  this.sock.on("close", function () { self.close(); });

  var message = [];
  function parseFrames() {
    while (buf.length >= 2) {
      var b1 = buf[0], b2 = buf[1], n = b2 & 0x7f, offset = 2;
      if (n === 126) {
        if (buf.length < 4) return;
        n = buf.readUInt16BE(2);
        offset = 4;
      } else if (n === 127) {
        if (buf.length < 10) return;
        n = buf.readUInt32BE(6); // payloads over 4 GB never happen here
        offset = 10;
      }
      if (buf.length < offset + n) return;
      var payload = buf.slice(offset, offset + n);
      buf = buf.slice(offset + n);
      var opcode = b1 & 0x0f;
      if (opcode === 0x8) {
        self.close();
        return;
      }
      if (opcode === 0x9) {
        self._frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      message.push(payload);
      if (b1 & 0x80) {
        var text = Buffer.concat(message).toString("utf8");
        message = [];
        onText(text);
      }
    }
  }

  this._onClose = onClose;
}

WebSocket.prototype._frame = function (opcode, data) {
  if (this.closed) return;
  var n = data.length, head;
  if (n < 126) {
    head = new Buffer(2);
    head[1] = 0x80 | n;
  } else if (n < 65536) {
    head = new Buffer(4);
    head[1] = 0x80 | 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = new Buffer(10);
    head[1] = 0x80 | 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(n, 6);
  }
  head[0] = 0x80 | opcode;
  var mask = crypto.randomBytes(4);
  var masked = new Buffer(n);
  for (var i = 0; i < n; i++) masked[i] = data[i] ^ mask[i % 4];
  this.sock.write(Buffer.concat([head, mask, masked]));
};

WebSocket.prototype.send = function (text) {
  this._frame(0x1, new Buffer(text, "utf8"));
};

WebSocket.prototype.close = function () {
  if (this.closed) return;
  this.closed = true;
  this.sock.destroy();
  if (this._onClose) this._onClose();
};

// The TV must answer the WebSocket handshake within HANDSHAKE_MS and accept the
// registration within REGISTER_MS (it can show an "Allow?" prompt first); otherwise the
// connection is dropped and waiting requests fail instead of waiting forever.
var HANDSHAKE_MS = 10000;
var REGISTER_MS = 90000;
var MAX_WAITING = 200;

// Keeps one SSAP connection; requests made while disconnected wait for the reconnect.
// port: 3000 on the TV; the tests use another.
function TVClient(host, keyPath, port) {
  this.host = host;
  this.port = port || 3000;
  this.keyPath = keyPath;
  this.ws = null;
  this.ready = false;
  this.waiting = [];
  this.pending = {};
  this.nextId = 1;
  this.pointer = null;
  this.pointerReady = false;
  this.pointerQueue = [];
  this.closeReason = "";
}

TVClient.prototype._connect = function () {
  var self = this;
  if (this.ws) return;
  var key = null;
  try {
    key = fs.readFileSync(this.keyPath, "utf8").replace(/\s+/g, "") || null;
  } catch (e) {
    console.log("no pairing key yet: " + e.message);
  }
  this.closeReason = "";
  var giveUp = setTimeout(function () {
    self.closeReason = "the TV did not answer";
    ws.close();
  }, HANDSHAKE_MS);
  var ws = new WebSocket("ws://" + this.host + ":" + this.port + "/", function () {
    clearTimeout(giveUp);
    giveUp = setTimeout(function () {
      self.closeReason = "the TV did not accept the connection (answer the prompt on the TV)";
      ws.close();
    }, REGISTER_MS);
    var payload = {
      forcePairing: false,
      pairingType: "PROMPT",
      manifest: { manifestVersion: 1, appVersion: "1.0", permissions: PERMISSIONS }
    };
    if (key) payload["client-key"] = key;
    ws.send(JSON.stringify({ type: "register", id: "register", payload: payload }));
  }, function (text) {
    var msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      console.log("bad SSAP message: " + e.message);
      return;
    }
    if (msg.id === "register") {
      if (msg.type === "registered") {
        clearTimeout(giveUp);
        var newKey = msg.payload && msg.payload["client-key"];
        if (newKey && newKey !== key) {
          try {
            fs.writeFileSync(self.keyPath, newKey);
            fs.chmodSync(self.keyPath, 384); // 0600: the key controls the TV
          } catch (e) {
            console.log("could not save pairing key: " + e.message);
          }
        }
        self.ready = true;
        var waiting = self.waiting;
        self.waiting = [];
        for (var i = 0; i < waiting.length; i++) waiting[i]();
      } else if (msg.type === "error") {
        console.log("pairing failed: " + msg.error);
        self.closeReason = "pairing refused: " + (msg.error || "no reason given");
        ws.close();
      }
      return;
    }
    var cb = self.pending[msg.id];
    if (!cb) return;
    delete self.pending[msg.id];
    if (msg.type === "error") cb(new Error(msg.error || "unknown error"));
    else cb(null, msg.payload || {});
  }, function () {
    clearTimeout(giveUp);
    if (self.ws !== ws) return;
    self.ws = null;
    self.ready = false;
    self._dropPointer();
    var pending = self.pending;
    self.pending = {};
    for (var id in pending) if (pending.hasOwnProperty(id)) pending[id](new Error("connection lost"));
    var waiting = self.waiting;
    self.waiting = [];
    var reason = self.closeReason || "TV unreachable";
    for (var i = 0; i < waiting.length; i++) waiting[i](new Error(reason));
  });
  this.ws = ws;
};

TVClient.prototype._whenReady = function (fn) {
  if (this.ready) return fn();
  if (this.waiting.length >= MAX_WAITING) return fn(new Error("too many requests waiting for the TV"));
  this.waiting.push(fn);
  this._connect();
};

// The timeout counts from the call, also while the connection is still being made.
TVClient.prototype.request = function (uri, payload, cb, timeoutMs) {
  var self = this;
  var done = false, id = null;
  function finish(err, result) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (id) delete self.pending[id];
    cb(err, result);
  }
  var timer = setTimeout(function () { finish(new Error("timeout: " + uri)); }, timeoutMs || 10000);
  this._whenReady(function (err) {
    if (done) return;
    if (err) return finish(err);
    id = "r" + self.nextId++;
    self.pending[id] = finish;
    var msg = { type: "request", id: id, uri: uri };
    if (payload) msg.payload = payload;
    self.ws.send(JSON.stringify(msg));
  });
};

// webOS 1 needs the launch session ID to close an app; it is base64("<appId>:undefined").
TVClient.prototype.closeApp = function (appId, cb) {
  var sessionId = new Buffer(appId + ":undefined").toString("base64");
  this.request("ssap://system.launcher/close", { id: appId, sessionId: sessionId }, function (err) {
    if (err && /^500/.test(err.message)) return cb(null, false); // not running
    if (err) return cb(err);
    cb(null, true);
  });
};

TVClient.prototype._dropPointer = function () {
  // While the socket path is requested, this.pointer is a placeholder without close().
  var wasReady = this.pointerReady;
  if (this.pointer && this.pointer.close) this.pointer.close();
  this.pointer = null;
  this.pointerReady = false;
  if (!wasReady) this._flushPointer(new Error("connection lost")); // keys waiting for the socket
};

TVClient.prototype._pointerSend = function (text, cb) {
  var self = this;
  if (this.pointerReady) {
    this.pointer.send(text);
    return cb(null);
  }
  this.pointerQueue.push({ text: text, cb: cb });
  if (this.pointer) return;
  var placeholder = this.pointer = {}; // placeholder while the socket path is requested
  this.request("ssap://com.webos.service.networkinput/getPointerInputSocket", null, function (err, res) {
    if (self.pointer !== placeholder) return; // the connection dropped in the meantime
    if (!err && !/^wss?:\/\//.test(String(res && res.socketPath))) err = new Error("no pointer socket from the TV");
    if (err) {
      self.pointer = null;
      return self._flushPointer(err);
    }
    var ws = new WebSocket(res.socketPath, function () {
      self.pointerReady = true;
      self._flushPointer(null);
    }, function () {}, function () {
      if (self.pointer !== ws) return;
      var wasReady = self.pointerReady;
      self.pointer = null;
      self.pointerReady = false;
      // A socket that closed before opening must not leave queued keys waiting forever.
      if (!wasReady) self._flushPointer(new Error("pointer socket failed"));
    });
    self.pointer = ws;
  });
};

TVClient.prototype._flushPointer = function (err) {
  var queue = this.pointerQueue;
  this.pointerQueue = [];
  for (var i = 0; i < queue.length; i++) {
    if (!err) this.pointer.send(queue[i].text);
    queue[i].cb(err);
  }
};

TVClient.prototype.button = function (name, cb) {
  this._pointerSend("type:button\nname:" + name + "\n\n", cb);
};

TVClient.prototype.move = function (dx, dy, cb) {
  this._pointerSend("type:move\ndx:" + dx + "\ndy:" + dy + "\ndown:0\n\n", cb);
};

TVClient.prototype.click = function (cb) {
  this._pointerSend("type:click\n\n", cb);
};

TVClient.prototype.scroll = function (dx, dy, cb) {
  this._pointerSend("type:scroll\ndx:" + dx + "\ndy:" + dy + "\n\n", cb);
};

module.exports = { TVClient: TVClient };

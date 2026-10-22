// TV hub server: phone remote, Claude assistant, health monitor and scheduler in one
// process (Node 0.10, ES5), on port 8765.
//
// Serves the phone page and a JSON API. Every /api call from another device needs the
// access code (header X-Access-Code); requests from the TV itself (the Home Screen app on
// 127.0.0.1, or the TV's own network address) do not. Public: /api/status, setting the
// first code, and app icons.
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var url = require("url");
var querystring = require("querystring");
var TVClient = require("./ssap.js").TVClient;
var Store = require("./store.js").Store;
var Health = require("./health.js").Health;
var schedulerModule = require("./scheduler.js");
var Tools = require("./tools.js").Tools;
var Agent = require("./agent.js").Agent;
var guidecache = require("./guidecache.js");
var claude = require("./claude.js");
var remoteModule = require("./remote.js");
var gamesModule = require("./games.js");
var wsserver = require("./wsserver.js");

var ROOT = __dirname;
var HOME_APP_ID = remoteModule.HOME_APP_ID;
var MAX_BODY = 4096;
var ANSWER_MAX_AGE_MS = 2 * 60 * 1000;
var ANSWER_MAX_CHARS = 400; // what fits on the answer screen with two programs
var AUTH_WINDOW_MS = 10 * 60 * 1000;
var AUTH_MAX_FAILURES = 10;

var logLines = [];
function log(msg) {
  var line = new Date().toISOString() + " " + msg;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  console.log(line);
}

function localAddresses() {
  var out = { "127.0.0.1": true };
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    if (!ifaces.hasOwnProperty(name)) continue;
    ifaces[name].forEach(function (a) {
      if (a.family === "IPv4") out[a.address] = true;
    });
  }
  return out;
}

// The address to open on the phone, shown by the Home Screen.
function pageAddress(port) {
  var all = Object.keys(localAddresses()).filter(function (a) { return a !== "127.0.0.1"; });
  return all.length ? "http://" + all[0] + ":" + port : null;
}

// TV actions used by the assistant, the health monitor and the scheduler. The app list
// and memory cleanup are the remote's, so both use the same cache.
function Actions(tv, remote) {
  this.tv = tv;
  this.remote = remote;
  this.answer = null; // the answer the Home Screen shows, see showAnswer
}

Actions.prototype.loadApps = function (cb) {
  this.remote.loadApps(false, cb);
};

// Close background apps; keep the app on screen, Live TV and the Home Screen.
Actions.prototype.freeMemory = function (cb) {
  this.remote.freeMemory(cb);
};

Actions.prototype.toast = function (text, cb) {
  this.tv.request("ssap://system.notifications/createToast", { message: String(text).slice(0, 200) }, cb);
};

// Bring the Home Screen to the front with an answer; the app polls /api/answer.
// a: { question, reply, guide } where guide is a channel_guide result or null.
Actions.prototype.showAnswer = function (a, cb) {
  var self = this;
  this.tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
    var from = err ? null : fg.appId; // unknown: Back only closes the answer
    var reply = a.reply.length > ANSWER_MAX_CHARS ? a.reply.slice(0, ANSWER_MAX_CHARS - 3) + "..." : a.reply;
    self.answer = {
      id: String(Date.now()),
      at: Date.now(),
      question: a.question,
      reply: reply,
      programs: a.guide ? a.guide.programs.slice(0, 4).map(function (p) {
        return { name: guidecache.cleanTitle(p.name), start: p.start, end: p.end, onNow: p.on_now };
      }) : [],
      returnTo: from === HOME_APP_ID ? null : from
    };
    if (from === HOME_APP_ID) return cb(null);
    self.tv.request("ssap://system.launcher/launch", { id: HOME_APP_ID }, cb);
  });
};

// The answer for the Home Screen, while it is new.
Actions.prototype.currentAnswer = function () {
  var a = this.answer;
  return a && Date.now() - a.at < ANSWER_MAX_AGE_MS ? a : null;
};

// The Home Screen closed the answer: go back to the app that was on screen before.
// A hidden app keeps counting down, so go back only while the Home Screen is in front;
// otherwise the user has opened something else in the meantime.
Actions.prototype.closeAnswer = function (id, cb) {
  var self = this;
  var a = this.answer;
  if (!a || a.id !== id) return cb(null);
  this.answer = null;
  if (!a.returnTo) return cb(null);
  this.tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
    if (err || fg.appId !== HOME_APP_ID) return cb(null);
    self.tv.request("ssap://system.launcher/launch", { id: a.returnTo }, cb);
  });
};

Actions.prototype.volumeDown = function (steps, cb) {
  var self = this;
  (function next(i) {
    if (i >= steps) return cb(null);
    self.tv.request("ssap://audio/volumeDown", null, function (err) {
      if (err) return cb(err);
      next(i + 1);
    });
  })(0);
};

Actions.prototype.powerOff = function (cb) {
  this.tv.request("ssap://system/turnOff", null, cb);
};

Actions.prototype.runSchedule = function (s, cb) {
  if (s.action === "toast") return this.toast(s.text, cb);
  if (s.action === "freeMemory") {
    var self = this;
    return this.freeMemory(function (err, closed) {
      if (err) return cb(err);
      self.toast(closed.length ? "Closed: " + closed.join(", ") : "Nothing was running in the background", cb);
    });
  }
  if (s.action === "volumeDown") return this.volumeDown(s.steps, cb);
  if (s.action === "powerOff") return this.powerOff(cb);
  cb(new Error("unknown action"));
};

function send(res, status, type, body, extraHeaders) {
  var headers = {
    "Content-Type": type,
    "Content-Length": Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Code"
  };
  for (var k in extraHeaders || {}) if (extraHeaders.hasOwnProperty(k)) headers[k] = extraHeaders[k];
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));
}

function readBody(req, cb, limit) {
  var size = 0, chunks = [], tooBig = false;
  req.on("data", function (c) {
    size += c.length;
    if (size > (limit || MAX_BODY)) tooBig = true;
    else chunks.push(c);
  });
  req.on("end", function () {
    if (tooBig) return cb(new Error("body too large"));
    if (!size) return cb(null, {});
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (e) {
      cb(new Error("invalid JSON"));
    }
  });
}

function publicSettings(data) {
  var key = data.secrets.apiKey;
  return {
    health: data.health,
    ai: data.ai,
    apiKey: { set: !!key, last4: key ? key.slice(-4) : "" },
    models: Object.keys(claude.MODELS).map(function (id) { return { id: id, label: claude.MODELS[id].label }; }),
    efforts: claude.EFFORTS
  };
}

function updateAiSettings(cfg, input) {
  for (var k in input) {
    if (!input.hasOwnProperty(k)) continue;
    var v = input[k];
    if (k === "model") {
      if (!claude.MODELS.hasOwnProperty(v)) throw new Error("unknown model");
      cfg.model = v;
    } else if (k === "effort") {
      if (claude.EFFORTS.indexOf(v) < 0) throw new Error("unknown effort");
      cfg.effort = v;
    } else if (k === "showOnTv" || k === "webSearch") {
      if (typeof v !== "boolean") throw new Error(k + " must be true or false");
      cfg[k] = v;
    } else if (k === "maxTokens" || k === "dailyLimit" || k === "historyMinutes") {
      var range = { maxTokens: [1024, 32000], dailyLimit: [1, 1000], historyMinutes: [0, 60] }[k];
      var n = Number(v);
      if (!(n >= range[0] && n <= range[1]) || Math.round(n) !== n) {
        throw new Error(k + " must be a whole number from " + range[0] + " to " + range[1]);
      }
      cfg[k] = n;
    } else {
      throw new Error("unknown setting: " + k);
    }
  }
}

// Apply settings from the phone; only known keys with the right type and range.
function updateHealthSettings(cfg, input) {
  var ranges = {
    lowMemoryMB: [50, 600], lowMemorySamples: [1, 10], cleanupCooldownMin: [1, 120],
    highCpuPercent: [50, 100], highCpuMinutes: [1, 60], cpuWarnCooldownMin: [5, 240]
  };
  for (var k in input) {
    if (!input.hasOwnProperty(k)) continue;
    if (k === "autoCleanup" || k === "cpuWarning") {
      if (typeof input[k] !== "boolean") throw new Error(k + " must be true or false");
      cfg[k] = input[k];
    } else if (ranges.hasOwnProperty(k)) {
      var v = Number(input[k]);
      if (!(v >= ranges[k][0] && v <= ranges[k][1]) || Math.round(v) !== v) {
        throw new Error(k + " must be a whole number from " + ranges[k][0] + " to " + ranges[k][1]);
      }
      cfg[k] = v;
    } else {
      throw new Error("unknown setting: " + k);
    }
  }
}

// ports: the first one is the address shown on the TV. options: { uninstall(appId, cb) }
function start(ports, options) {
  var port = ports[0];
  var store = new Store(log);
  var tv = new TVClient(process.env.TV_HOST || "127.0.0.1", path.join(ROOT, "tv_key"));
  var tools = null; // set below; the remote opens channels through the tools
  var remote = new remoteModule.Remote(tv, {
    uninstall: options.uninstall,
    openChannel: function (id, cb) { tools.run("open_channel", { channel_id: id }, cb); },
    localAddresses: localAddresses,
    log: log
  });
  var actions = new Actions(tv, remote);
  var health = new Health(store, actions, log);
  var scheduler = new schedulerModule.Scheduler(store, function (s, cb) { actions.runSchedule(s, cb); }, log);
  tools = new Tools(tv, actions);
  var agent = new Agent(store, tools, actions, log);
  var guide = new guidecache.GuideCache(tv, tools, log);
  var games = new gamesModule.GameHub({
    log: log,
    isLocal: function (address) { return !!localAddresses()[address]; },
    playAddress: function () { var a = pageAddress(port); return a ? a + "/play" : null; },
    store: store,
    ask: function (request, cb) { agent.oneShot(request, cb); }
  });
  var failures = [];

  // The TV itself (any of its own addresses) needs no code.
  function local(req) {
    return !!localAddresses()[req.connection.remoteAddress];
  }

  function authorized(req) {
    if (local(req)) return true;
    var code = store.data.accessCode;
    return !!code && req.headers["x-access-code"] === code;
  }

  function lockedOut() {
    var now = Date.now();
    failures = failures.filter(function (t) { return now - t < AUTH_WINDOW_MS; });
    return failures.length >= AUTH_MAX_FAILURES;
  }

  function handleApi(req, res, u, body) {
    var p = u.pathname;
    var q = querystring.parse(u.query);
    if (req.method === "GET" && p === "/api/health") {
      var h = health.status();
      h.upcoming = scheduler.upcoming();
      h.address = pageAddress(port);
      return sendJson(res, 200, h);
    }
    if (req.method === "GET" && p === "/api/state") return remote.state(function (st) { sendJson(res, 200, st); });
    if (req.method === "POST" && p === "/api/cmd") {
      var cmd = String(body.cmd || "");
      return remote.run(cmd, body.arg, function (err, result, badRequest) {
        if (err) {
          if (!badRequest) log("command " + cmd + " failed: " + err.message);
          return sendJson(res, badRequest ? 400 : 502, { error: err.message });
        }
        sendJson(res, 200, { ok: true, result: result || {} });
      });
    }
    if (req.method === "POST" && p === "/api/log") {
      log("TV page: " + String(body.message || "").slice(0, 500));
      return sendJson(res, 200, { ok: true });
    }
    // The TV Games screen (see games.js for why it polls instead of using a WebSocket).
    if (p === "/api/games/tv") {
      if (!local(req)) return sendJson(res, 403, { error: "only the TV itself" });
      if (req.method === "GET") {
        return games.tvPoll(Number(q.since) || 0, function (out) { sendJson(res, 200, out); },
          // "close" on the response: the connection went away before the answer.
          function (forget) { res.on("close", forget); });
      }
      if (req.method === "POST") return sendJson(res, games.tvCommand(body || {}) ? 200 : 409, { ok: true });
    }
    if (req.method === "GET" && p === "/api/now") return sendJson(res, 200, guide.now());
    if (req.method === "GET" && p === "/api/answer") return sendJson(res, 200, { answer: actions.currentAnswer() });
    if (req.method === "POST" && p === "/api/answer/close") {
      return actions.closeAnswer(String(body.id || ""), function (err) {
        if (err) return sendJson(res, 502, { error: err.message });
        sendJson(res, 200, { ok: true });
      });
    }
    if (req.method === "GET" && p === "/api/settings") return sendJson(res, 200, publicSettings(store.data));
    if (req.method === "POST" && p === "/api/settings") {
      updateHealthSettings(store.data.health, (body && body.health) || {});
      updateAiSettings(store.data.ai, (body && body.ai) || {});
      store.save();
      log("settings changed");
      return sendJson(res, 200, publicSettings(store.data));
    }
    if (req.method === "GET" && p === "/api/schedules") {
      return sendJson(res, 200, { schedules: store.data.schedules, upcoming: scheduler.upcoming() });
    }
    if (req.method === "POST" && p === "/api/schedules") {
      var added = scheduler.add(body);
      log("schedule added: " + added.id + " " + added.time + " " + added.action);
      return sendJson(res, 200, { schedule: added });
    }
    if (req.method === "POST" && p === "/api/schedules/delete") {
      if (!scheduler.remove(String(body.id || ""))) return sendJson(res, 404, { error: "no such schedule" });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/schedules/enable") {
      var s = scheduler.setEnabled(String(body.id || ""), body.enabled);
      if (!s) return sendJson(res, 404, { error: "no such schedule" });
      return sendJson(res, 200, { schedule: s });
    }
    if (req.method === "POST" && p === "/api/schedules/run") {
      var target = scheduler.find(String(body.id || q.id || ""));
      if (!target) return sendJson(res, 404, { error: "no such schedule" });
      return actions.runSchedule(target, function (err) {
        if (err) return sendJson(res, 502, { error: err.message });
        log("schedule " + target.id + " ran now from the phone");
        sendJson(res, 200, { ok: true });
      });
    }
    if (req.method === "POST" && p === "/api/apikey") {
      var key = String(body.key || "").replace(/\s+/g, "");
      if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) return sendJson(res, 400, { error: "this does not look like an Anthropic API key" });
      store.data.secrets.apiKey = key;
      store.save();
      log("API key saved (ending " + key.slice(-4) + ")");
      return sendJson(res, 200, publicSettings(store.data));
    }
    if (req.method === "POST" && p === "/api/apikey/delete") {
      store.data.secrets.apiKey = "";
      store.save();
      log("API key removed");
      return sendJson(res, 200, publicSettings(store.data));
    }
    if (req.method === "POST" && p === "/api/ask") {
      var text = String(body.text || "").replace(/^\s+|\s+$/g, "");
      if (!text || text.length > 500) return sendJson(res, 400, { error: "say something (at most 500 characters)" });
      log("ask: " + text.slice(0, 80));
      return agent.ask(text, function (err, out) {
        if (err) return sendJson(res, 502, { error: err.message });
        sendJson(res, 200, out);
      });
    }
    if (req.method === "POST" && p === "/api/ask/reset") {
      agent.reset();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/api/usage") {
      return sendJson(res, 200, { usage: agent.usageToday(), dailyLimit: store.data.ai.dailyLimit, model: store.data.ai.model });
    }
    if (req.method === "GET" && p === "/api/logs") {
      return send(res, 200, "text/plain; charset=utf-8", logLines.join("\n") + "\n");
    }
    sendJson(res, 404, { error: "not found" });
  }

  function handle(req, res) {
    var u = url.parse(req.url);
    if (req.method === "OPTIONS") return send(res, 204, "text/plain", "");
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/index.html")) {
      return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(ROOT, "static", "phone.html")));
    }
    // Games: the phone game page and the phone part of each game need no access code.
    if (req.method === "GET" && u.pathname === "/play") {
      return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(ROOT, "static", "play.html")));
    }
    if (req.method === "GET" && u.pathname === "/sound.js") {
      return send(res, 200, "application/javascript; charset=utf-8", fs.readFileSync(path.join(ROOT, "static", "sound.js")));
    }
    var gameFile = /^\/games\/([a-z0-9-]+)\.js$/.exec(u.pathname || "");
    if (req.method === "GET" && gameFile) {
      if (!games.hasGame(gameFile[1])) return sendJson(res, 404, { error: "not found" });
      return send(res, 200, "application/javascript; charset=utf-8",
        fs.readFileSync(path.join(ROOT, "static", "games", gameFile[1] + ".js")));
    }
    if (req.method === "GET" && u.pathname === "/icon.png") {
      return send(res, 200, "image/png", fs.readFileSync(path.join(ROOT, "static", "icon.png")),
        { "Cache-Control": "max-age=86400" });
    }
    if (u.pathname.indexOf("/api/") !== 0) return sendJson(res, 404, { error: "not found" });

    // Public: whether an access code exists, setting the first one, and app icons (an
    // <img> on the phone cannot send the code header; icons come from the TV itself).
    // The status never checks a code, so it cannot be used to guess one.
    if (req.method === "GET" && u.pathname === "/api/status") {
      return sendJson(res, 200, { accessCodeSet: !!store.data.accessCode, authorized: local(req) });
    }
    if (req.method === "GET" && u.pathname === "/api/icon") {
      return remote.icon(String(querystring.parse(u.query).id || ""), function (err, data) {
        if (err) return sendJson(res, err.message === "unknown app" ? 404 : 502, { error: err.message });
        send(res, 200, "image/png", data, { "Cache-Control": "max-age=86400" });
      });
    }
    readBody(req, function (err, body) {
      if (err) return sendJson(res, 400, { error: err.message });
      // Wrong codes lock other devices out for a while; the TV itself is never locked out,
      // so a phone with an old code cannot take the Home Screen down.
      if (!local(req) && lockedOut()) return sendJson(res, 429, { error: "too many wrong codes, wait 10 minutes" });
      if (req.method === "POST" && u.pathname === "/api/access") {
        // The first code can be set by anyone on the home network; changing it needs the old one.
        if (store.data.accessCode && !authorized(req)) {
          if (req.headers["x-access-code"]) failures.push(Date.now());
          return sendJson(res, 403, { error: "access code required" });
        }
        var code = String(body.code || "");
        if (code.length < 4 || code.length > 32) return sendJson(res, 400, { error: "code must be 4-32 characters" });
        var hadCode = !!store.data.accessCode;
        store.data.accessCode = code;
        store.save();
        log("access code " + (hadCode ? "changed" : "set"));
        return sendJson(res, 200, { ok: true });
      }
      if (!authorized(req)) {
        if (req.headers["x-access-code"]) failures.push(Date.now());
        return sendJson(res, 401, { error: store.data.accessCode ? "wrong or missing access code" : "set an access code first" });
      }
      try {
        handleApi(req, res, u, body);
      } catch (e) {
        sendJson(res, 400, { error: e.message });
      }
    }, MAX_BODY);
  }

  wsserver.setLog(log);
  // One HTTP server per port, all with the same handler.
  var servers = ports.map(function (p) {
    var server = http.createServer(handle);
    server.on("error", function (e) { log("server error on port " + p + ": " + e.message); });
    wsserver.attach(server, "/ws", function (conn) { games.connect(conn); });
    server.listen(p, "0.0.0.0");
    return server;
  });
  health.start();
  scheduler.start();
  guide.start();
  log("hub ready on ports " + ports.join(", "));
  return servers;
}

module.exports = { start: start, log: log };

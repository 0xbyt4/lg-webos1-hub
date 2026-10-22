// Game rooms for the hub (Node 0.10, ES5).
//
// The TV Games screen opens a room; phones join it with the room code shown on the TV.
// Phones keep one WebSocket each; the TV screen long-polls (below). The game logic runs here: the TV and the phones only send
// input and draw the views they get back. A game is a module in games/ with:
//   id, title, description, modes (["solo", "multi"]), topics, settings and customTopic
//   (all optional), create(api)
// and the instance has start(), onInput(player, data), onHost(data), tvView(),
// playerView(player); a game that runs on the TV also has onTvReport(data).
// api: mode, lang, topic, customTopic, settings, players(), update(), later(fn, ms), tvEvent(event),
// records(key), saveRecord(key, entry, lowerIsBetter), ask(request, cb), log(msg).
//
// Solo: only the host plays; the others watch. Multi ("together"): everyone plays.
//
// Phones need no access code here, so a guest can play. A phone sends game input; the
// host phone (the first connected player) can also start, skip and stop games. Only the
// TV itself can open or close a room. Games that call Claude ("paid") are limited per
// room: one request at a time and a pause between starts, on top of the daily limit.
var crypto = require("crypto");

var GAMES = [require("./games/hop.js"), require("./games/blocks.js"), require("./games/snake.js"), require("./games/quiz.js"),
  require("./games/buzzer.js")];
var MODES = { solo: "Solo", multi: "Together" };
var MAX_RECORDS = 5;
var PAID_PAUSE_MS = 30 * 1000; // between two starts of a game that calls Claude
var PAID_PER_ROOM = 20; // starts of such games while one room is open
var MAX_PLAYERS = 8;
var MAX_NAME = 16;
var COLORS = ["#f2b24c", "#4f8cff", "#3fb27f", "#e5484d", "#b07cf2", "#2fc4c4", "#f27cb0", "#c9cdd3"];
var RATE_PER_SECOND = 30;
var JOIN_FAILURES_PER_MINUTE = 20;
var GONE_MS = 60 * 1000; // a player gone this long can make space in a full room
var TV_GONE_MS = 2 * 60 * 1000; // close a room this long after the TV screen disconnects
var HELLO_MS = 5000; // a connection must say who it is within this time

function findGame(id) {
  for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
  return null;
}

// A string or number field from a message; anything else (objects, arrays) is ignored.
function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// A topic a player typed: one line, no markup, at most 60 characters.
function cleanTopic(s) {
  return String(s || "").replace(/[\u0000-\u001f\u007f<>{}"\\]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").slice(0, 60);
}

function cleanName(name, fallback) {
  var s = String(name || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/^\s+|\s+$/g, "");
  return s.slice(0, MAX_NAME) || fallback;
}

// The TV Games screen talks to the hub with HTTP long-polls, not a WebSocket: on webOS 1.4
// the web engine stops sending WebSocket handshakes after a while (the TCP connection
// opens, the handshake never comes) until the TV is unplugged, while plain HTTP keeps
// working. A TvChannel looks like a connection to the room code: sendJson() keeps the
// latest room state and errors until the next poll picks them up.
var TV_POLL_HOLD_MS = 20 * 1000; // a poll waits this long for a change
var TV_POLL_GONE_MS = 45 * 1000; // no poll for this long: the TV screen is gone

function TvChannel() {
  this.remoteAddress = "127.0.0.1";
  this.version = 0;
  this.state = null;
  this.errors = []; // recent errors as { version, text }, so a poll that is lost does not lose them
  this.events = []; // recent game events for the TV (taps in Sky Hop) as { version, event }
  this.stateVersion = 0; // changes only when the room state changes
  this.waiters = [];
  this.closed = false;
  this.lastSeen = Date.now();
  this.onclose = function () {};
}

TvChannel.prototype.sendJson = function (msg) {
  this.version++;
  if (msg.t === "room") {
    this.state = msg;
    this.stateVersion = this.version;
  } else if (msg.t === "event") {
    this.events = this.events.concat([{ version: this.version, event: msg.event }]).slice(-100);
    // Taps from several phones go to the TV together: one poll answer, not one per tap.
    var self = this;
    if (!this.batch) this.batch = setTimeout(function () { self.batch = null; self.flush(); }, 40);
    return;
  } else {
    this.errors = this.errors.concat([{ version: this.version, text: msg.error || msg.reason || msg.t }]).slice(-5);
  }
  this.flush();
};

TvChannel.prototype.flush = function () {
  var waiters = this.waiters;
  this.waiters = [];
  waiters.forEach(function (w) { w(); });
};

TvChannel.prototype.close = function () {
  if (this.closed) return;
  this.closed = true;
  clearInterval(this.watch);
  clearTimeout(this.batch);
  this.flush();
  this.onclose();
};

// options: { log(msg), isLocal(address), playAddress(), store, ask(request, cb) }
function GameHub(options) {
  this.options = options;
  this.room = null;
  this.joinFailures = {}; // address -> times of wrong room codes in the last minute
}

// GET /api/games/tv?since=N from the TV Games screen. Opens (or keeps) the room, then
// answers when the version differs from N (newer state, or a new room after the old one
// closed), or after TV_POLL_HOLD_MS. cb(body). onAbort(fn): fn runs if the client goes.
GameHub.prototype.tvPoll = function (since, cb, onAbort) {
  var self = this;
  var ch = this.tvChannel;
  if (!ch || ch.closed) {
    ch = this.tvChannel = new TvChannel();
    ch.onclose = function () { self.left({ role: "tv" }, ch); };
    ch.watch = setInterval(function () {
      if (!ch.waiters.length && Date.now() - ch.lastSeen > TV_POLL_GONE_MS) ch.close();
    }, 10000);
    this.openRoom(ch);
  }
  ch.lastSeen = Date.now();
  var done = false;
  var timer = null;
  function forget() {
    done = true;
    clearTimeout(timer);
    var i = ch.waiters.indexOf(reply);
    if (i >= 0) ch.waiters.splice(i, 1);
  }
  function reply() {
    if (done) return;
    forget();
    cb({
      version: ch.version,
      stateVersion: ch.stateVersion,
      room: ch.closed ? null : ch.state,
      errors: ch.errors.filter(function (e) { return e.version > since; }).map(function (e) { return e.text; }),
      events: ch.events.filter(function (e) { return e.version > since; }).map(function (e) { return e.event; })
    });
  }
  if (ch.version !== since) return reply();
  timer = setTimeout(reply, TV_POLL_HOLD_MS);
  ch.waiters.push(reply);
  // A poll whose client went away must not count as a TV that is still there.
  if (onAbort) onAbort(forget);
};

// POST /api/games/tv from the TV Games screen: start, stop, host, close.
GameHub.prototype.tvCommand = function (msg) {
  var ch = this.tvChannel;
  if (!ch || ch.closed || !this.room || this.room.tv !== ch) return false;
  this.fromTv(ch, msg);
  return true;
};

GameHub.prototype.list = function () {
  return GAMES.map(function (g) {
    return { id: g.id, title: g.title, description: g.description, modes: g.modes, topics: g.topics || null,
      settings: g.settings || null, customTopic: !!g.customTopic };
  });
};

GameHub.prototype.hasGame = function (id) {
  return !!findGame(id);
};

// A new WebSocket. The first message says who it is: {t:"hello", role:"tv"} or
// {t:"hello", role:"player", code, name, token}.
GameHub.prototype.connect = function (conn) {
  var self = this;
  var who = null;
  var windowStart = Date.now(), count = 0;
  var helloTimer = setTimeout(function () { if (!who) conn.close(1008); }, HELLO_MS);
  conn.onmessage = function (raw) {
    var now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > RATE_PER_SECOND) return conn.close(1008);
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return conn.close(1003);
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "ping") return conn.sendJson({ t: "pong", id: msg.id });
    if (!who) {
      who = self.hello(conn, msg);
      if (who) clearTimeout(helloTimer);
      return;
    }
    if (who.role === "tv") self.fromTv(conn, msg);
    else self.fromPlayer(who.player, msg);
  };
  conn.onclose = function () {
    clearTimeout(helloTimer);
    if (who) self.left(who, conn);
  };
};

GameHub.prototype.hello = function (conn, msg) {
  if (msg.t !== "hello") {
    conn.close(1008);
    return null;
  }
  if (msg.role === "tv") {
    // The TV screen uses /api/games/tv; two kinds of TV connection would take the room
    // from each other.
    conn.sendJson({ t: "error", error: "the TV screen uses /api/games/tv" });
    conn.close(1008);
    return null;
  }
  if (msg.role === "player") {
    var player = this.join(conn, msg);
    return player ? { role: "player", player: player } : null;
  }
  conn.close(1008);
  return null;
};

GameHub.prototype.openRoom = function (conn) {
  var room = this.room;
  if (room) {
    // The TV screen reconnected (or opened again): keep the room and its players.
    if (room.tv && room.tv !== conn) room.tv.close(1000);
    clearTimeout(room.closeTimer);
  } else {
    var code = String(1000 + crypto.randomBytes(2).readUInt16BE(0) % 9000);
    room = this.room = { code: code, players: [], tv: null, game: null, timers: [], closeTimer: null, nextId: 1 };
    this.options.log("game room " + code + " opened");
  }
  room.tv = conn;
  this.update();
};

GameHub.prototype.join = function (conn, msg) {
  var room = this.room;
  var now = Date.now();
  var address = conn.remoteAddress || "";
  var failures = (this.joinFailures[address] || []).filter(function (t) { return now - t < 60000; });
  if (failures.length) this.joinFailures[address] = failures;
  else delete this.joinFailures[address];
  function refuse(error) {
    conn.sendJson({ t: "error", error: error });
    conn.close(1008);
    return null;
  }
  var codeOk = !!room && text(msg.code) === room.code;
  var player = null;
  var token = text(msg.token);
  if (codeOk && token) {
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].token === token) player = room.players[i];
    }
  }
  // Wrong codes lock out only the address they came from, and never a returning player.
  if (!player && failures.length >= JOIN_FAILURES_PER_MINUTE) return refuse("too many tries, wait a minute");
  if (!codeOk) {
    this.joinFailures[address] = failures.concat([now]);
    return refuse(room ? "wrong room code" : "no game is open on the TV");
  }
  if (player) {
    // The same phone came back (reload, screen lock): keep its name, color and score.
    // If the old connection is still open (a copied tab), that one stops.
    if (player.conn && player.conn !== conn) {
      player.conn.sendJson({ t: "error", error: "you joined again in another tab" });
      player.conn.close(1000);
    }
  } else {
    if (room.players.length >= MAX_PLAYERS) this.dropGone(now);
    if (room.players.length >= MAX_PLAYERS) return refuse("the room is full");
    var id = room.nextId++;
    player = {
      id: id,
      name: cleanName(text(msg.name), "Player " + id),
      color: COLORS[(id - 1) % COLORS.length],
      token: crypto.randomBytes(12).toString("hex")
    };
    room.players.push(player);
    this.options.log("game room " + room.code + ": " + player.name + " joined");
  }
  player.conn = conn;
  player.connected = true;
  conn.sendJson({ t: "joined", id: player.id, token: player.token, name: player.name, color: player.color });
  this.update();
  return player;
};

GameHub.prototype.left = function (who, conn) {
  var self = this;
  var room = this.room;
  if (!room) return;
  if (who.role === "tv") {
    if (room.tv !== conn) return;
    room.tv = null;
    room.closeTimer = setTimeout(function () { self.closeRoom("the TV left the game screen"); }, TV_GONE_MS);
    return;
  }
  if (who.player.conn !== conn) return;
  who.player.conn = null;
  who.player.connected = false;
  who.player.leftAt = Date.now();
  this.update();
};

// A full room makes space by dropping the player who left longest ago (closed tab, phone
// that joined again without its token), if that was more than GONE_MS ago.
GameHub.prototype.dropGone = function (now) {
  var room = this.room, oldest = null;
  room.players.forEach(function (p) {
    if (!p.connected && now - p.leftAt >= GONE_MS && (!oldest || p.leftAt < oldest.leftAt)) oldest = p;
  });
  if (!oldest) return;
  room.players = room.players.filter(function (p) { return p !== oldest; });
  this.options.log("game room " + room.code + ": " + oldest.name + " removed (gone)");
};

// Start or stop a game, or press the host button (next round). The TV remote and the
// host phone both use this. A refusal goes back to the sender as {t:"error"}.
GameHub.prototype.control = function (conn, msg) {
  var room = this.room;
  if (msg.t === "start") {
    var game = findGame(text(msg.game));
    if (!game) return conn.sendJson({ t: "error", error: "unknown game" });
    var mode = text(msg.mode) || game.modes[0];
    if (game.modes.indexOf(mode) < 0) return conn.sendJson({ t: "error", error: game.title + " has no " + mode + " mode" });
    var count = this.connectedPlayers().length;
    var host = this.host();
    if (!host) return conn.sendJson({ t: "error", error: "join with a phone first" });
    if (mode === "multi" && count < 2) return conn.sendJson({ t: "error", error: "Together needs at least 2 players; play Solo or wait for someone to join" });
    if (game.paid) {
      // A guest can be host, so a paid game cannot be started again and again.
      if (room.paidBusy) return conn.sendJson({ t: "error", error: "Claude is still writing the questions" });
      if (Date.now() - (room.paidAt || 0) < PAID_PAUSE_MS) return conn.sendJson({ t: "error", error: "Wait half a minute before the next " + game.title });
      if ((room.paidCount || 0) >= PAID_PER_ROOM) return conn.sendJson({ t: "error", error: "This room has played enough " + game.title + "; open Games again" });
      room.paidAt = Date.now();
      room.paidCount = (room.paidCount || 0) + 1;
    }
    var topic = text(msg.topic);
    var customTopic = game.customTopic && topic === "custom" ? cleanTopic(text(msg.topicText)) : "";
    if (game.topics && !customTopic && !game.topics.some(function (t) { return t.id === topic; })) topic = game.topics[0].id;
    // Settings come from fixed lists in the game module; anything else gets the first value.
    var settings = {};
    var asked = msg.settings && typeof msg.settings === "object" ? msg.settings : {};
    for (var key in game.settings || {}) {
      if (!game.settings.hasOwnProperty(key)) continue;
      var allowed = game.settings[key].map(function (o) { return o.value; });
      settings[key] = allowed.indexOf(asked[key]) >= 0 ? asked[key] : allowed[0];
    }
    // The language of the questions: the host phone's, like "tr-TR" (from the TV remote: the TV's language).
    var lang = text(msg.lang);
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) lang = room.lang || "en";
    room.lang = lang;
    this.stopGame();
    var entry = { module: game, mode: mode, soloId: mode === "solo" ? host.id : null };
    room.game = entry;
    entry.instance = game.create(this.api(entry, { mode: mode, lang: lang, topic: topic, customTopic: customTopic, settings: settings }));
    this.options.log("game room " + room.code + ": " + game.id + " (" + mode + ") started with " + count + " player(s)");
    room.game.instance.start();
    this.update();
  } else if (msg.t === "stop") {
    this.stopGame();
    this.update();
  } else if (msg.t === "host" && room.game) {
    room.game.instance.onHost(msg.data && typeof msg.data === "object" ? msg.data : {});
  }
};

GameHub.prototype.fromTv = function (conn, msg) {
  var room = this.room;
  if (!room || room.tv !== conn) return;
  if (msg.t === "close") return this.closeRoom("the game screen was closed");
  // A game that runs on the TV (Sky Hop) reports what happened there.
  if (msg.t === "report") {
    var game = room.game;
    if (game && game.instance.onTvReport && msg.data && typeof msg.data === "object") game.instance.onTvReport(msg.data);
    return;
  }
  this.control(conn, msg);
};

// The host is the first player in join order who is still connected. The host's phone
// can start and stop games, so nobody has to switch to the TV remote.
GameHub.prototype.host = function () {
  return this.connectedPlayers()[0] || null;
};

GameHub.prototype.fromPlayer = function (player, msg) {
  var room = this.room;
  if (!room || !player.connected) return;
  if (msg.t === "input" && room.game) {
    if (room.game.soloId && player.id !== room.game.soloId) return; // watching a solo game
    if (msg.data && typeof msg.data === "object") room.game.instance.onInput(this.publicPlayer(player), msg.data);
  } else if ((msg.t === "start" || msg.t === "stop" || msg.t === "host") && player === this.host()) {
    this.control(player.conn, msg);
  } else if (msg.t === "leave") {
    room.players = room.players.filter(function (p) { return p !== player; });
    if (player.conn) player.conn.close(1000);
    this.update();
  }
};

GameHub.prototype.connectedPlayers = function () {
  return this.room ? this.room.players.filter(function (p) { return p.connected; }) : [];
};

GameHub.prototype.publicPlayer = function (p) {
  return { id: p.id, name: p.name, color: p.color, connected: !!p.connected };
};

// What a game may use. Timers are tracked so that stopping a game clears them.
// entry is this game's place in the room: a stopped game (or one replaced by a newer one)
// can no longer update the screens, set timers, save records or get Claude's answer.
GameHub.prototype.api = function (entry, opts) {
  var self = this;
  var room = this.room;
  var store = this.options.store;
  function alive() { return self.room === room && room.game === entry; }
  return {
    mode: opts.mode,
    lang: opts.lang,
    topic: opts.topic,
    customTopic: opts.customTopic,
    settings: opts.settings,
    // The players in the game: in Solo only the host who started it.
    players: function () {
      var soloId = room.game && room.game.soloId;
      return self.connectedPlayers().filter(function (p) { return !soloId || p.id === soloId; })
        .map(function (p) { return self.publicPlayer(p); });
    },
    records: function (key) { return (store.data.records[key] || []).slice(); },
    // Keep the best results. Returns the place of the new entry (1 = best) or 0.
    saveRecord: function (key, record, lowerIsBetter) {
      if (!alive()) return 0;
      var list = (store.data.records[key] || []).slice();
      record.at = Date.now();
      list.push(record);
      list.sort(function (a, b) { return lowerIsBetter ? a.value - b.value : b.value - a.value; });
      list = list.slice(0, MAX_RECORDS);
      store.data.records[key] = list;
      store.save();
      return list.indexOf(record) + 1;
    },
    ask: function (request, cb) {
      room.paidBusy = true;
      self.options.ask(request, function (err, answer) {
        room.paidBusy = false;
        if (alive()) cb(err, answer);
      });
    },
    update: function () { if (alive()) self.update(); },
    later: function (fn, ms) {
      var t = setTimeout(function () {
        room.timers = room.timers.filter(function (x) { return x !== t; });
        if (alive()) fn();
      }, ms);
      room.timers.push(t);
    },
    // Send an event to the TV screen at once (for games whose physics run on the TV).
    tvEvent: function (event) { if (alive() && room.tv) room.tv.sendJson({ t: "event", event: event }); },
    log: function (m) { self.options.log("game: " + m); }
  };
};

GameHub.prototype.stopGame = function () {
  var room = this.room;
  if (!room) return;
  room.timers.forEach(function (t) { clearTimeout(t); });
  room.timers = [];
  room.game = null;
};

GameHub.prototype.closeRoom = function (reason) {
  var room = this.room;
  if (!room) return;
  this.stopGame();
  clearTimeout(room.closeTimer);
  this.room = null;
  room.players.forEach(function (p) {
    if (!p.conn) return;
    p.conn.sendJson({ t: "closed", reason: reason });
    p.conn.close(1000);
  });
  if (room.tv) room.tv.close(1000);
  this.options.log("game room " + room.code + " closed: " + reason);
};

// Send everyone the current room and game view.
GameHub.prototype.update = function () {
  var self = this;
  var room = this.room;
  if (!room) return;
  var game = room.game;
  var players = room.players.map(function (p) { return self.publicPlayer(p); });
  var host = this.host();
  var games = this.list();
  var soloId = game ? game.soloId : null;
  var soloName = null;
  room.players.forEach(function (p) { if (p.id === soloId) soloName = p.name; });
  if (room.tv) {
    room.tv.sendJson({
      t: "room",
      code: room.code,
      address: this.options.playAddress(),
      players: players,
      games: games,
      host: host ? host.id : null,
      game: game ? game.module.id : null,
      mode: game ? game.mode : null,
      view: game ? game.instance.tvView() : null
    });
  }
  room.players.forEach(function (p) {
    if (!p.conn) return;
    var watching = !!(game && soloId && p.id !== soloId);
    p.conn.sendJson({
      t: "room",
      players: players,
      host: p === host,
      hostName: host ? host.name : null,
      games: p === host ? games : undefined,
      game: game ? game.module.id : null,
      mode: game ? game.mode : null,
      watching: watching,
      soloName: soloName,
      view: game && !watching ? game.instance.playerView(self.publicPlayer(p)) : null
    });
  });
};

module.exports = { GameHub: GameHub, MODES: MODES };

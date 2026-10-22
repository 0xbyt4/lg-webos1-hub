// Phone remote: app list, icons, keys, touchpad, typing and app actions (Node 0.10, ES5).
// The HTTP routes live in server.js.
var http = require("http");
var url = require("url");

var HOME_APP_ID = "com.lgtvfastest.home";
var LIVE_TV_ID = "com.webos.app.livetv";
var APPS_TTL = 5 * 60 * 1000;
var MAX_TEXT = 200;
var MAX_DELTA = 500;

var BUTTONS = {};
("UP DOWN LEFT RIGHT ENTER BACK HOME EXIT MENU INFO QMENU MUTE PLAY PAUSE STOP REWIND " +
  "FASTFORWARD RED GREEN YELLOW BLUE LIST GUIDE 0 1 2 3 4 5 6 7 8 9").split(" ").forEach(function (b) {
  BUTTONS[b] = true;
});

var SIMPLE_COMMANDS = {
  volumeUp: "ssap://audio/volumeUp",
  volumeDown: "ssap://audio/volumeDown",
  channelUp: "ssap://tv/channelUp",
  channelDown: "ssap://tv/channelDown",
  play: "ssap://media.controls/play",
  pause: "ssap://media.controls/pause",
  enter: "ssap://com.webos.service.ime/sendEnterKey",
  powerOff: "ssap://system/turnOff"
};

// Apps this project installed with Developer Mode; only these can be removed from the phone.
function canRemove(id) {
  return id.indexOf("com.lgtvfastest.") === 0 && id !== HOME_APP_ID;
}

function delta(arg) {
  if (!arg || typeof arg !== "object") throw new Error("delta must be an object");
  return ["dx", "dy"].map(function (k) {
    var v = arg[k] === undefined ? 0 : arg[k];
    if (typeof v !== "number" || isNaN(v)) throw new Error(k + " must be a number");
    return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(v)));
  });
}

// options: { uninstall(appId, cb), openChannel(channelId, cb), localAddresses(), log(msg) }
function Remote(tv, options) {
  this.tv = tv;
  this.options = options;
  this.log = options.log;
  this.apps = [];
  this.appsAt = 0;
  this.icons = {};
}

// Apps on the TV, without the Home Screen itself: user-installed apps (Netflix,
// YouTube...) first, then the built-in ones in TV order.
Remote.prototype.loadApps = function (refresh, cb) {
  var self = this;
  if (!refresh && this.apps.length && Date.now() - this.appsAt < APPS_TTL) return cb(null, this.apps);
  this.tv.request("ssap://com.webos.applicationManager/listLaunchPoints", null, function (err, res) {
    if (err) return cb(err);
    var apps = (res.launchPoints || []).filter(function (p) {
      return p.id !== HOME_APP_ID;
    }).map(function (p) {
      return { id: p.id, title: p.title || p.id, icon: p.icon || "", installed: !!p.removable };
    });
    self.apps = apps.filter(function (a) { return a.installed; })
      .concat(apps.filter(function (a) { return !a.installed; }));
    self.appsAt = Date.now();
    cb(null, self.apps);
  });
};

Remote.prototype.findApp = function (id, refresh, cb) {
  this.loadApps(refresh, function (err, apps) {
    if (err) return cb(err);
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return cb(null, apps[i]);
    cb(null, null);
  });
};

// What the phone remote and the Home Screen show: apps, the app on screen, the volume.
Remote.prototype.state = function (cb) {
  var self = this;
  var state = { connected: false, apps: [], foreground: null, volume: null };
  this.loadApps(false, function (err, apps) {
    if (err) {
      state.error = err.message;
      return cb(state);
    }
    state.connected = true;
    state.apps = apps.map(function (a) {
      return {
        id: a.id,
        title: a.title,
        icon: a.icon ? "/api/icon?id=" + encodeURIComponent(a.id) : "",
        canRemove: canRemove(a.id)
      };
    });
    self.tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (e2, fg) {
      if (!e2) {
        var title = fg.appId;
        apps.forEach(function (a) { if (a.id === fg.appId) title = a.title; });
        state.foreground = { id: fg.appId, title: fg.appId === HOME_APP_ID ? "Home Screen" : title };
      }
      self.tv.request("ssap://audio/getVolume", null, function (e3, vol) {
        if (!e3) state.volume = { level: vol.volume, muted: vol.muted };
        cb(state);
      });
    });
  });
};

// Fetch an app icon from the TV's own web server (never from anywhere else).
Remote.prototype.icon = function (id, cb) {
  var self = this;
  if (this.icons[id]) return cb(null, this.icons[id]);
  function fetch(refresh) {
    self.findApp(id, refresh, function (err, app) {
      if (err) return cb(err);
      if (!app || !app.icon) return cb(new Error("unknown app"));
      var u = url.parse(app.icon);
      if (u.protocol !== "http:" || u.port !== "3000" || !self.options.localAddresses()[u.hostname]) {
        return cb(new Error("no icon"));
      }
      http.get(app.icon, function (res) {
        if (res.statusCode !== 200) {
          res.resume();
          // Resource paths change when the TV session changes; reload them once.
          return refresh ? cb(new Error("icon " + res.statusCode)) : fetch(true);
        }
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          self.icons[id] = Buffer.concat(chunks);
          cb(null, self.icons[id]);
        });
      }).on("error", function (e) {
        if (refresh) cb(e);
        else fetch(true);
      });
    });
  }
  fetch(false);
};

// Close every app running in the background; keep the app on screen, Live TV and the
// Home Screen. The browser is closed too: it holds a lot of memory when left open.
// cb(err, closedTitles)
Remote.prototype.freeMemory = function (cb) {
  var self = this;
  this.tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
    if (err) return cb(err);
    var keep = {};
    keep[fg.appId] = keep[LIVE_TV_ID] = keep[HOME_APP_ID] = true;
    self.loadApps(false, function (e2, apps) {
      if (e2) return cb(e2);
      var targets = apps.filter(function (a) { return !keep[a.id]; });
      var closed = [];
      (function next(i) {
        if (i >= targets.length) {
          self.log("free memory: closed " + (closed.join(", ") || "nothing"));
          return cb(null, closed);
        }
        self.tv.closeApp(targets[i].id, function (e3, wasRunning) {
          if (!e3 && wasRunning) closed.push(targets[i].title);
          next(i + 1);
        });
      })(0);
    });
  });
};

// Run one phone command. cb(err, result, badRequest)
Remote.prototype.run = function (cmd, arg, cb) {
  var tv = this.tv;
  var self = this;
  function done(err) { cb(err, {}); }
  try {
    if (SIMPLE_COMMANDS.hasOwnProperty(cmd)) return tv.request(SIMPLE_COMMANDS[cmd], null, cb);
    if (cmd === "openHome") return tv.request("ssap://system.launcher/launch", { id: HOME_APP_ID }, cb);
    if (cmd === "freeMemory") {
      return this.freeMemory(function (err, closed) {
        if (err) return cb(err);
        cb(null, { closed: closed });
      });
    }
    if (cmd === "button") {
      if (!BUTTONS.hasOwnProperty(arg)) throw new Error("unknown button");
      return tv.button(arg, done);
    }
    if (cmd === "move" || cmd === "scroll") {
      var d = delta(arg);
      return cmd === "move" ? tv.move(d[0], d[1], done) : tv.scroll(d[0], d[1], done);
    }
    if (cmd === "click") return tv.click(done);
    if (cmd === "openChannel") {
      if (typeof arg !== "string" || !arg) throw new Error("channel id required");
      return this.options.openChannel(arg, function (err, out) {
        if (err && /unknown channel_id/.test(err.message)) return cb(err, null, true);
        cb(err, out);
      });
    }
    if (cmd === "uninstall") {
      var id = String(arg);
      if (!canRemove(id) || !this.options.uninstall) throw new Error("this app cannot be removed here");
      return this.findApp(id, true, function (err, app) {
        if (err) return cb(err);
        if (!app) return cb(new Error("unknown app"), null, true);
        self.options.uninstall(id, function (e2) {
          if (e2) return cb(e2);
          // Trust the app list, not the progress stream: confirm the app is gone.
          self.findApp(id, true, function (e3, still) {
            if (e3) return cb(e3);
            if (still) return cb(new Error("the TV did not remove the app"));
            delete self.icons[id];
            self.log("removed app " + id);
            cb(null, { removed: id });
          });
        });
      });
    }
    if (cmd === "launch") {
      return this.findApp(String(arg), false, function (err, app) {
        if (err) return cb(err);
        if (!app) return cb(new Error("unknown app"), null, true);
        // Free memory first so the app opens faster on this TV's small RAM.
        self.freeMemory(function () {
          tv.request("ssap://system.launcher/launch", { id: app.id }, cb);
        });
      });
    }
    if (cmd === "text") {
      if (typeof arg !== "string" || !arg.length || arg.length > MAX_TEXT) {
        throw new Error("text must be 1-" + MAX_TEXT + " characters");
      }
      return tv.request("ssap://com.webos.service.ime/insertText", { text: arg, replace: 0 }, cb);
    }
    if (cmd === "backspace") return tv.request("ssap://com.webos.service.ime/deleteCharacters", { count: 1 }, cb);
    throw new Error("unknown command");
  } catch (e) {
    cb(e, null, true);
  }
};

module.exports = { Remote: Remote, HOME_APP_ID: HOME_APP_ID };

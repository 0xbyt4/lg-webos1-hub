// Program guide cache for the "On now" list on the Home Screen (Node 0.10, ES5).
//
// The TV answers guide requests only while Live TV is on screen, and the Home Screen is on
// screen when it shows the list. So this reads the guide while Live TV is on and keeps
// the next 24 hours: the channel being watched first, then the lowest-numbered TV
// channels (radio channels have no guide).
var toolsModule = require("./tools.js");
var parseGuideTime = toolsModule.parseGuideTime;
var LIVE_TV_ID = toolsModule.LIVE_TV_ID;

var CHECK_MS = 2 * 60 * 1000;
var REFRESH_MS = 30 * 60 * 1000;
var KEEP_MS = 24 * 60 * 60 * 1000;
var ROWS = 4;

// "The Chase / 189" -> "The Chase": the guide adds episode numbers.
function cleanTitle(name) {
  return String(name || "").replace(/\s*\/\s*\d+\s*$/, "").replace(/^\s+|\s+$/g, "");
}

function hhmm(t) {
  var d = new Date(t);
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function GuideCache(tv, tools, log) {
  this.tv = tv;
  this.tools = tools;
  this.log = log;
  this.channels = [];
  this.at = 0;
  this.watchedId = null;
  this.busy = false;
  this.timer = null;
}

GuideCache.prototype.start = function () {
  var self = this;
  if (this.timer) return;
  this.check();
  this.timer = setInterval(function () { self.check(); }, CHECK_MS);
};

// Refresh when Live TV is on and the data is old or the watched channel changed.
GuideCache.prototype.check = function () {
  var self = this;
  if (this.busy) return;
  this.tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
    if (err || fg.appId !== LIVE_TV_ID) return;
    self.tv.request("ssap://tv/getCurrentChannel", null, function (e2, cur) {
      if (e2) return;
      var changed = cur.channelId !== self.watchedId;
      if (!changed && Date.now() - self.at < REFRESH_MS) return;
      self.refresh(cur.channelId);
    });
  });
};

GuideCache.prototype.refresh = function (watchedId) {
  var self = this;
  this.busy = true;
  this.tools.loadChannels(function (err, all) {
    if (err) {
      self.busy = false;
      return self.log("guide cache: " + err.message);
    }
    var tvChannels = all.filter(function (c) { return c.tv; })
      .sort(function (a, b) { return Number(a.number) - Number(b.number); });
    var picks = tvChannels.filter(function (c) { return c.id === watchedId; });
    for (var i = 0; i < tvChannels.length && picks.length < ROWS + 2; i++) {
      if (tvChannels[i].id !== watchedId) picks.push(tvChannels[i]);
    }
    var found = [];
    (function next(i) {
      if (i >= picks.length || found.length >= ROWS) {
        self.busy = false;
        // Remember the attempt even without data, so the next try waits for REFRESH_MS.
        self.at = Date.now();
        self.watchedId = watchedId;
        if (!found.length) return self.log("guide cache: no guide data");
        self.channels = found;
        return;
      }
      var ch = picks[i];
      self.tv.request("ssap://tv/getChannelProgramInfo", { channelId: ch.id }, function (e2, res) {
        var now = Date.now();
        var programs = [];
        ((!e2 && res && res.programList) || []).forEach(function (p) {
          var start = parseGuideTime(p.localStartTime), end = parseGuideTime(p.localEndTime);
          if (!start || !end || end.getTime() <= now || start.getTime() > now + KEEP_MS) return;
          programs.push({ name: cleanTitle(p.programName), start: start.getTime(), end: end.getTime() });
        });
        if (programs.length) found.push({ id: ch.id, number: ch.number, name: String(ch.name || "").replace(/\s+HD$/i, ""), programs: programs });
        next(i + 1);
      }, 15000);
    })(0);
  });
};

// The list for the Home Screen, worked out for the current time.
GuideCache.prototype.now = function () {
  var t = Date.now();
  var rows = [];
  this.channels.forEach(function (c) {
    var current = null, next = null;
    for (var i = 0; i < c.programs.length; i++) {
      var p = c.programs[i];
      if (p.end <= t) continue;
      if (p.start <= t && !current) current = p;
      else if (p.start > t) {
        next = p;
        break;
      }
    }
    if (!current && !next) return;
    rows.push({
      id: c.id,
      number: c.number,
      name: c.name,
      now: current ? { name: current.name, start: hhmm(current.start), end: hhmm(current.end),
        progress: Math.round((t - current.start) * 100 / (current.end - current.start)) } : null,
      next: next ? { name: next.name, start: hhmm(next.start) } : null
    });
  });
  return { updatedAt: this.at || null, channels: rows };
};

module.exports = { GuideCache: GuideCache, cleanTitle: cleanTitle };

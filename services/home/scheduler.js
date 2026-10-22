// Scheduler: runs saved tasks at a time of day, on chosen weekdays (Node 0.10, ES5).
//
// A schedule is { id, time: "HH:MM", days: [1..7] (Monday = 1; empty = every day),
// action, text, steps, enabled, lastRun: "YYYY-MM-DD" }. It runs at most once a day,
// in the minute it is set for. A task missed while the TV was off is not run late:
// "turn off at 23:00" must not fire the next morning.
var crypto = require("crypto");

var TICK_MS = 20 * 1000;
var ACTIONS = { toast: true, freeMemory: true, volumeDown: true, powerOff: true };
var MAX_SCHEDULES = 30;
var MAX_TEXT = 120;

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function localDate(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function weekday(d) {
  var day = d.getDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

// Check and normalize a schedule sent by the phone. Throws on invalid input.
function validate(input) {
  if (!input || typeof input !== "object") throw new Error("schedule must be an object");
  var time = String(input.time || "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("time must be HH:MM");
  var days = input.days instanceof Array ? input.days : [];
  days = days.map(Number).filter(function (d, i, all) {
    return d >= 1 && d <= 7 && all.indexOf(d) === i;
  }).sort();
  var action = String(input.action || "");
  if (!ACTIONS.hasOwnProperty(action)) throw new Error("unknown action");
  var s = { time: time, days: days, action: action, enabled: input.enabled !== false };
  if (action === "toast") {
    var text = String(input.text || "").replace(/^\s+|\s+$/g, "");
    if (!text || text.length > MAX_TEXT) throw new Error("message must be 1-" + MAX_TEXT + " characters");
    s.text = text;
  }
  if (action === "volumeDown") {
    var steps = parseInt(input.steps, 10);
    if (!(steps >= 1 && steps <= 30)) throw new Error("steps must be 1-30");
    s.steps = steps;
  }
  return s;
}

// run(schedule, cb(err)) performs the action.
function Scheduler(store, run, log) {
  this.store = store;
  this.run = run;
  this.log = log;
  this.timer = null;
}

Scheduler.prototype.start = function () {
  var self = this;
  if (this.timer) return;
  this.timer = setInterval(function () { self.tick(new Date()); }, TICK_MS);
  this.tick(new Date());
};

Scheduler.prototype.tick = function (now) {
  var hhmm = pad(now.getHours()) + ":" + pad(now.getMinutes());
  var today = localDate(now);
  var day = weekday(now);
  var self = this;
  this.store.data.schedules.forEach(function (s) {
    if (!s.enabled || s.time !== hhmm || s.lastRun === today) return;
    if (s.days.length && s.days.indexOf(day) < 0) return;
    s.lastRun = today; // mark first, so a slow action cannot run twice
    self.store.save();
    self.execute(s, "scheduled");
  });
};

Scheduler.prototype.execute = function (s, reason) {
  var self = this;
  this.run(s, function (err) {
    if (err) self.log("schedule " + s.id + " (" + s.action + ") failed: " + err.message);
    else self.log("schedule " + s.id + " (" + s.action + " at " + s.time + ") ran: " + reason);
  });
};

Scheduler.prototype.add = function (input) {
  if (this.store.data.schedules.length >= MAX_SCHEDULES) throw new Error("too many schedules");
  var s = validate(input);
  s.id = crypto.randomBytes(4).toString("hex");
  s.lastRun = "";
  this.store.data.schedules.push(s);
  this.store.data.schedules.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  this.store.save();
  return s;
};

Scheduler.prototype.find = function (id) {
  var list = this.store.data.schedules;
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};

Scheduler.prototype.remove = function (id) {
  var before = this.store.data.schedules.length;
  this.store.data.schedules = this.store.data.schedules.filter(function (s) { return s.id !== id; });
  if (this.store.data.schedules.length === before) return false;
  this.store.save();
  return true;
};

Scheduler.prototype.setEnabled = function (id, enabled) {
  var s = this.find(id);
  if (!s) return null;
  s.enabled = !!enabled;
  this.store.save();
  return s;
};

// The next run of each enabled schedule, for the phone page and the Home Screen.
Scheduler.prototype.upcoming = function (now) {
  now = now || new Date();
  var out = [];
  this.store.data.schedules.forEach(function (s) {
    if (!s.enabled) return;
    var parts = s.time.split(":");
    for (var add = 0; add < 8; add++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, +parts[0], +parts[1]);
      if (d <= now) continue;
      if (s.days.length && s.days.indexOf(weekday(d)) < 0) continue;
      out.push({ id: s.id, at: d.getTime(), action: s.action, text: s.text || "" });
      break;
    }
  });
  return out.sort(function (a, b) { return a.at - b.at; });
};

module.exports = { Scheduler: Scheduler, validate: validate, ACTIONS: ACTIONS };

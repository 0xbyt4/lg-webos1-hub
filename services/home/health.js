// Health monitor: samples memory and CPU once a minute and acts on two rules
// (Node 0.10, ES5).
//
//   Low memory  - available memory under the limit for N samples in a row:
//                 close background apps, then show a toast with what was closed.
//   High CPU    - CPU busy above the limit for N minutes in a row: show a warning.
//                 The TV exposes no temperature, so long high load is the only sign.
//
// "Available" memory is MemFree + Buffers + Cached: this 3.10 kernel has no MemAvailable.
// Storage is the flash partition that holds the Developer Mode apps and the settings.
var fs = require("fs");
var execFile = require("child_process").execFile;

var SAMPLE_MS = 60 * 1000;
var HISTORY = 60; // one hour of samples
var EVENTS = 30;
var DISK_MS = 10 * 60 * 1000; // storage changes slowly

function readMemory() {
  var fields = {};
  fs.readFileSync("/proc/meminfo", "utf8").split("\n").forEach(function (line) {
    var m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) fields[m[1]] = parseInt(m[2], 10);
  });
  return {
    totalMB: Math.round(fields.MemTotal / 1024),
    availableMB: Math.round((fields.MemFree + fields.Buffers + fields.Cached) / 1024)
  };
}

function readCpuTimes() {
  var parts = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  var idle = parts[3] + (parts[4] || 0); // idle + iowait
  var total = 0;
  for (var i = 0; i < parts.length; i++) total += parts[i];
  return { idle: idle, total: total };
}

// Node 0.10 has no statfs, so this asks busybox df (tested on webOS 1.4).
function readDisk(dir, cb) {
  execFile("df", ["-k", dir], { timeout: 5000 }, function (err, stdout) {
    if (err) return cb(err);
    // The last fields are: 1K-blocks Used Available Use% Mounted-on
    var f = String(stdout).split("\n").slice(1).join(" ").trim().split(/\s+/);
    var total = parseInt(f[f.length - 5], 10), free = parseInt(f[f.length - 3], 10);
    if (isNaN(total) || isNaN(free)) return cb(new Error("unexpected df output"));
    cb(null, { totalMB: Math.round(total / 1024), freeMB: Math.round(free / 1024) });
  });
}

function readUptime() {
  return Math.round(parseFloat(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]));
}

// actions: { freeMemory(cb(err, closedTitles)), toast(text, cb) }
function Health(store, actions, log) {
  this.store = store;
  this.actions = actions;
  this.log = log;
  this.samples = [];
  this.events = [];
  this.lastCpu = null;
  this.lowCount = 0;
  this.highCount = 0;
  this.lastCleanup = 0;
  this.lastCpuWarning = 0;
  this.timer = null;
  this.diskTimer = null;
  this.disk = null;
}

Health.prototype.event = function (type, text) {
  this.events.push({ t: Date.now(), type: type, text: text });
  if (this.events.length > EVENTS) this.events.shift();
  this.log(type + ": " + text);
};

Health.prototype.start = function () {
  var self = this;
  if (this.timer) return;
  this.sample();
  this.timer = setInterval(function () { self.sample(); }, SAMPLE_MS);
  this.sampleDisk();
  this.diskTimer = setInterval(function () { self.sampleDisk(); }, DISK_MS);
};

Health.prototype.sampleDisk = function () {
  var self = this;
  readDisk(__dirname, function (err, disk) {
    if (err) return self.log("cannot read storage: " + err.message);
    self.disk = disk;
  });
};

Health.prototype.sample = function () {
  var mem, cpuTimes;
  try {
    mem = readMemory();
    cpuTimes = readCpuTimes();
  } catch (e) {
    this.event("error", "cannot read /proc: " + e.message);
    return;
  }
  var cpu = null;
  if (this.lastCpu) {
    var dTotal = cpuTimes.total - this.lastCpu.total;
    var dIdle = cpuTimes.idle - this.lastCpu.idle;
    if (dTotal > 0) cpu = Math.round((dTotal - dIdle) * 100 / dTotal);
  }
  this.lastCpu = cpuTimes;
  this.samples.push({ t: Date.now(), availableMB: mem.availableMB, totalMB: mem.totalMB, cpu: cpu });
  if (this.samples.length > HISTORY) this.samples.shift();
  this.checkMemory(mem.availableMB);
  if (cpu !== null) this.checkCpu(cpu);
};

Health.prototype.checkMemory = function (availableMB) {
  var cfg = this.store.data.health;
  var self = this;
  if (!cfg.autoCleanup || availableMB >= cfg.lowMemoryMB) {
    this.lowCount = 0;
    return;
  }
  this.lowCount++;
  if (this.lowCount < cfg.lowMemorySamples) return;
  if (Date.now() - this.lastCleanup < cfg.cleanupCooldownMin * 60000) return;
  this.lastCleanup = Date.now();
  this.lowCount = 0;
  this.actions.freeMemory(function (err, closed) {
    if (err) return self.event("error", "cleanup failed: " + err.message);
    if (!closed.length) return self.event("memory", "low memory (" + availableMB + " MB), nothing to close");
    var text = "Low memory (" + availableMB + " MB): closed " + closed.join(", ");
    self.event("memory", text);
    self.actions.toast(text, function () {});
  });
};

Health.prototype.checkCpu = function (cpu) {
  var cfg = this.store.data.health;
  if (!cfg.cpuWarning || cpu < cfg.highCpuPercent) {
    this.highCount = 0;
    return;
  }
  this.highCount++; // one sample per minute, so the count is minutes
  if (this.highCount < cfg.highCpuMinutes) return;
  if (Date.now() - this.lastCpuWarning < cfg.cpuWarnCooldownMin * 60000) return;
  this.lastCpuWarning = Date.now();
  var text = "The TV has been under heavy load for " + this.highCount + " minutes (CPU " + cpu + "%)";
  this.event("cpu", text);
  this.actions.toast(text, function () {});
};

Health.prototype.status = function () {
  var last = this.samples[this.samples.length - 1] || null;
  var uptime = null;
  try {
    uptime = readUptime();
  } catch (e) {
    uptime = null;
  }
  return { now: last, disk: this.disk, uptimeSeconds: uptime, history: this.samples, events: this.events };
};

module.exports = { Health: Health };

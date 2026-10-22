// Settings and schedules, kept as one JSON file on the TV (Node 0.10, ES5).
//
// The service runs as its own user in its own jail, which does not see every folder
// the SSH shell sees (/media/developer/temp is missing there). So the first writable
// folder from this list is used, best first: outside the service folder (a reinstall
// replaces that folder), then inside it, then /tmp (lost at restart).
var fs = require("fs");
var path = require("path");

var CANDIDATES = [
  process.env.HUB_DATA,
  "/media/developer/temp/lgtvfastest-hub",
  path.join(__dirname, "..", "com.lgtvfastest.home.data"),
  process.env.HOME && path.join(process.env.HOME, "lgtvfastest-hub"),
  path.join(__dirname, "data"),
  "/tmp/lgtvfastest-hub"
].filter(Boolean);

function writable(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    var probe = path.join(dir, ".probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

var DIR = null;
for (var i = 0; i < CANDIDATES.length && !DIR; i++) {
  if (writable(CANDIDATES[i])) DIR = CANDIDATES[i];
}
var FILE = DIR ? path.join(DIR, "config.json") : null;

var DEFAULTS = {
  accessCode: "",
  health: {
    autoCleanup: true,
    lowMemoryMB: 150,
    lowMemorySamples: 2,
    cleanupCooldownMin: 10,
    cpuWarning: true,
    highCpuPercent: 85,
    highCpuMinutes: 5,
    cpuWarnCooldownMin: 30
  },
  ai: {
    model: "claude-opus-5-5",
    effort: "default",
    maxTokens: 16000,
    dailyLimit: 50,
    showOnTv: true,
    webSearch: true,
    historyMinutes: 10
  },
  // Never sent back to the phone; only "set" and the last four characters are shown.
  secrets: { apiKey: "" },
  usage: { date: "", requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costUSD: 0 },
  schedules: [],
  // Best results of the solo games: { "buzzer:solo": [{ name, value, at }, ...] }
  records: {}
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

// Fill in defaults for keys an older config file does not have yet.
function withDefaults(saved) {
  var data = copy(DEFAULTS);
  if (!saved || typeof saved !== "object") return data;
  if (typeof saved.accessCode === "string") data.accessCode = saved.accessCode;
  ["health", "ai", "secrets", "usage"].forEach(function (section) {
    var from = saved[section];
    if (!from || typeof from !== "object") return;
    for (var k in data[section]) {
      if (data[section].hasOwnProperty(k) && typeof from[k] === typeof data[section][k]) {
        data[section][k] = from[k];
      }
    }
  });
  if (saved.schedules instanceof Array) data.schedules = saved.schedules;
  if (saved.records && typeof saved.records === "object" && !(saved.records instanceof Array)) data.records = saved.records;
  return data;
}

function Store(log) {
  this.log = log;
  var saved = null;
  if (!FILE) {
    log("no writable folder for settings; changes are kept in memory only");
  } else {
    log("settings file: " + FILE);
    try {
      saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") log("config unreadable, using defaults: " + e.message);
    }
  }
  this.data = withDefaults(saved);
}

Store.prototype.save = function () {
  if (!FILE) return;
  try {
    // Write a temporary file and rename it, so a power cut never leaves half a file.
    var tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    this.log("could not save config: " + e.message);
  }
};

module.exports = { Store: Store, DEFAULTS: DEFAULTS, FILE: FILE };

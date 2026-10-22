// Tools Claude can use to control the TV (Node 0.10, ES5).
//
// Each tool has a strict JSON schema and a handler that runs on the TV over SSAP.
// Results stay small on purpose: find_channel searches the 484-channel list here
// and returns the best five matches, not the whole list.
var LIVE_TV_ID = "com.webos.app.livetv";
var CHANNELS_TTL = 24 * 60 * 60 * 1000;

function schema(properties, required) {
  return { type: "object", properties: properties, required: required || [], additionalProperties: false };
}

var DEFINITIONS = [
  {
    name: "tv_status",
    description: "What the TV shows now: the app on screen, the volume, and the channel when Live TV is on.",
    input_schema: schema({})
  },
  {
    name: "find_channel",
    description: "Search the TV's channel list by name or number. Returns up to five matches with their channel_id. Use it before open_channel or channel_guide when you only know a channel name.",
    input_schema: schema({ query: { type: "string", description: "Channel name or number, for example \"BBC One\" or \"101\". Write numbers as digits." } }, ["query"])
  },
  {
    name: "open_channel",
    description: "Switch the TV to a channel. Opens Live TV first if another app is on screen.",
    input_schema: schema({ channel_id: { type: "string", description: "channel_id from find_channel" } }, ["channel_id"])
  },
  {
    name: "channel_guide",
    description: "Programs on a channel: what is on now and what comes next. Without channel_id it uses the channel on screen (Live TV must be on). With channel_id it opens Live TV first if another app is on screen.",
    input_schema: schema({
      channel_id: { type: "string", description: "channel_id from find_channel; leave out for the current channel" },
      hours_ahead: { type: "integer", description: "How many hours ahead to list, 1-24 (default 6)" }
    })
  },
  {
    name: "list_apps",
    description: "The apps installed on the TV, with their app_id.",
    input_schema: schema({})
  },
  {
    name: "open_app",
    description: "Open an app on the TV.",
    input_schema: schema({ app_id: { type: "string", description: "app_id from list_apps" } }, ["app_id"])
  },
  {
    name: "volume",
    description: "Change the volume: up or down by a number of steps, or mute and unmute.",
    input_schema: schema({
      action: { type: "string", enum: ["up", "down", "mute"] },
      steps: { type: "integer", description: "Steps for up or down, 1-20 (default 3)" }
    }, ["action"])
  },
  {
    name: "show_message",
    description: "Show a short message on the TV screen.",
    input_schema: schema({ text: { type: "string", description: "At most 120 characters" } }, ["text"])
  },
  {
    name: "free_memory",
    description: "Close apps that run in the background, so the TV has more memory. Use it when the TV is slow.",
    input_schema: schema({})
  }
];
DEFINITIONS.forEach(function (d) { d.strict = true; });

// Lowercase, accented Latin letters to ASCII, no spaces or punctuation, no trailing "hd".
// Letters of other scripts (Cyrillic, Greek, ...) stay as they are.
// Node 0.10 has no String.prototype.normalize, so this uses a small table.
var FOLD = {
  a: "àáâãäåāăą", c: "çćčĉ", d: "ďđ", e: "èéêëēĕėęě", g: "ğĝġģ", i: "ìíîïıīĭįĩ", l: "łľĺļ",
  n: "ñńňņ", o: "òóôõöøōŏő", r: "řŕŗ", s: "śšşŝș", t: "ťţț", u: "ùúûüūŭůűųũ", y: "ýÿŷ", z: "źżž"
};
var FOLD_MAP = { "ß": "ss", "æ": "ae", "œ": "oe" };
Object.keys(FOLD).forEach(function (base) {
  FOLD[base].split("").forEach(function (c) { FOLD_MAP[c] = base; });
});
var FOLD_RE = new RegExp("[" + Object.keys(FOLD_MAP).join("") + "]", "g");

function normalize(s) {
  return String(s).toLowerCase()
    .replace(FOLD_RE, function (c) { return FOLD_MAP[c]; })
    .replace(/[\u0300-\u036f]/g, "") // combining marks, e.g. the dot that "İ" leaves behind
    .replace(/[\s!-\/:-@\[-`{-~\u00a0-\u00bf]/g, "") // spaces and punctuation
    .replace(/hd$/, "");
}

function parseGuideTime(s) {
  // "2026,10,20,03,00,00" in the TV's local time
  var p = String(s || "").split(",").map(Number);
  return p.length >= 5 ? new Date(p[0], p[1] - 1, p[2], p[3], p[4], p[5] || 0) : null;
}

function hhmm(d) {
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// actions: { freeMemory(cb), toast(text, cb), loadApps(cb) } from server.js
function Tools(tv, actions) {
  this.tv = tv;
  this.actions = actions;
  this.channels = [];
  this.channelsAt = 0;
}

Tools.prototype.loadChannels = function (cb) {
  var self = this;
  if (this.channels.length && Date.now() - this.channelsAt < CHANNELS_TTL) return cb(null, this.channels);
  this.tv.request("ssap://tv/getChannelList", null, function (err, res) {
    if (err) return cb(err);
    self.channels = (res.channelList || []).filter(function (c) { return !c.Invisible; }).map(function (c) {
      return { id: c.channelId, number: String(c.channelNumber), name: c.channelName, key: normalize(c.channelName), tv: !!c.TV && !c.Radio };
    });
    self.channelsAt = Date.now();
    cb(null, self.channels);
  }, 20000);
};

Tools.prototype.findChannel = function (query, cb) {
  this.loadChannels(function (err, channels) {
    if (err) return cb(err);
    var raw = String(query || "");
    var q = normalize(raw);
    var digits = /^\d+$/.test(raw.trim()) ? raw.trim() : null;
    var scored = [];
    channels.forEach(function (c) {
      var score = 0;
      if (digits && c.number === digits) score = 100;
      else if (c.key === q) score = 90;
      else if (q && c.key.indexOf(q) === 0) score = 70 - (c.key.length - q.length);
      else if (q && c.key.indexOf(q) > 0) score = 40 - (c.key.length - q.length);
      if (score > 0) scored.push({ c: c, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || Number(a.c.number) - Number(b.c.number); });
    cb(null, {
      matches: scored.slice(0, 5).map(function (s) { return { channel_id: s.c.id, number: s.c.number, name: s.c.name }; })
    });
  });
};

Tools.prototype.channelById = function (id, cb) {
  this.loadChannels(function (err, channels) {
    if (err) return cb(err);
    for (var i = 0; i < channels.length; i++) if (channels[i].id === id) return cb(null, channels[i]);
    cb(null, null);
  });
};

Tools.prototype.ensureLiveTv = function (cb) {
  var tv = this.tv;
  tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
    if (err) return cb(err);
    if (fg.appId === LIVE_TV_ID) return cb(null);
    tv.request("ssap://system.launcher/launch", { id: LIVE_TV_ID }, function (e2) {
      if (e2) return cb(e2);
      setTimeout(function () { cb(null); }, 3000); // Live TV needs a moment before channel calls
    });
  });
};

Tools.prototype.guide = function (channelId, hoursAhead, cb, retried) {
  var self = this;
  var hours = Math.max(1, Math.min(24, hoursAhead || 6));
  var payload = channelId ? { channelId: channelId } : null;
  this.tv.request("ssap://tv/getChannelProgramInfo", payload, function (err, res) {
    if (err) {
      if (!channelId) return cb(new Error("Live TV is not on screen; give a channel_id"));
      return cb(err);
    }
    // Once, an empty guide came back for a channel that has one; the TV may load it lazily.
    if (!retried && !(res.programList || []).length) {
      return setTimeout(function () { self.guide(channelId, hoursAhead, cb, true); }, 1500);
    }
    var now = new Date();
    var until = new Date(now.getTime() + hours * 3600000);
    var programs = [];
    (res.programList || []).forEach(function (p) {
      var start = parseGuideTime(p.localStartTime), end = parseGuideTime(p.localEndTime);
      if (!start || !end || end <= now || start > until) return;
      programs.push({
        name: String(p.programName || "").replace(/\s+$/, ""),
        start: hhmm(start),
        end: hhmm(end),
        on_now: start <= now && now < end,
        description: String(p.description || p.extendedDescription || "").slice(0, 160)
      });
    });
    var ch = res.channel || {};
    cb(null, { channel: { number: String(ch.channelNumber || ""), name: ch.channelName || "" }, now: hhmm(now), programs: programs.slice(0, 12) });
  }, 15000);
};

// Run one tool call. cb(err, result) - result is JSON-serializable.
Tools.prototype.run = function (name, input, cb) {
  var tv = this.tv, self = this;
  input = input || {};
  switch (name) {
    case "tv_status":
      return tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
        if (err) return cb(err);
        tv.request("ssap://audio/getVolume", null, function (e2, vol) {
          var out = { app_on_screen: fg.appId, volume: e2 ? null : vol.volume, muted: e2 ? null : vol.muted, time: hhmm(new Date()) };
          if (fg.appId !== LIVE_TV_ID) return cb(null, out);
          tv.request("ssap://tv/getCurrentChannel", null, function (e3, ch) {
            if (!e3) out.channel = { channel_id: ch.channelId, number: String(ch.channelNumber), name: ch.channelName };
            cb(null, out);
          });
        });
      });
    case "find_channel":
      return this.findChannel(input.query, cb);
    case "open_channel":
      return this.channelById(String(input.channel_id || ""), function (err, ch) {
        if (err) return cb(err);
        if (!ch) return cb(new Error("unknown channel_id; use find_channel first"));
        self.ensureLiveTv(function (e2) {
          if (e2) return cb(e2);
          tv.request("ssap://tv/openChannel", { channelId: ch.id }, function (e3) {
            if (e3) return cb(e3);
            cb(null, { opened: { number: ch.number, name: ch.name } });
          });
        });
      });
    case "channel_guide":
      if (input.channel_id) {
        return this.channelById(String(input.channel_id), function (err, ch) {
          if (err) return cb(err);
          if (!ch) return cb(new Error("unknown channel_id; use find_channel first"));
          // The TV answers guide requests only while Live TV is on screen.
          self.ensureLiveTv(function (e2) {
            if (e2) return cb(e2);
            self.guide(ch.id, input.hours_ahead, cb);
          });
        });
      }
      return this.guide(null, input.hours_ahead, cb);
    case "list_apps":
      return this.actions.loadApps(function (err, apps) {
        if (err) return cb(err);
        cb(null, { apps: apps.map(function (a) { return { app_id: a.id, title: a.title }; }) });
      });
    case "open_app":
      return this.actions.loadApps(function (err, apps) {
        if (err) return cb(err);
        var app = apps.filter(function (a) { return a.id === input.app_id; })[0];
        if (!app) return cb(new Error("unknown app_id; use list_apps first"));
        tv.request("ssap://system.launcher/launch", { id: app.id }, function (e2) {
          if (e2) return cb(e2);
          cb(null, { opened: app.title });
        });
      });
    case "volume":
      if (input.action === "mute") {
        // The remote's MUTE key toggles mute (tested on webOS 1.4).
        return tv.button("MUTE", function (err) {
          if (err) return cb(err);
          setTimeout(function () {
            tv.request("ssap://audio/getVolume", null, function (e2, vol) {
              cb(null, { muted: e2 ? null : vol.muted });
            });
          }, 300);
        });
      }
      var steps = Math.max(1, Math.min(20, input.steps || 3));
      var uri = input.action === "up" ? "ssap://audio/volumeUp" : "ssap://audio/volumeDown";
      return (function next(i) {
        if (i >= steps) {
          return tv.request("ssap://audio/getVolume", null, function (err, vol) {
            cb(null, { volume: err ? null : vol.volume });
          });
        }
        tv.request(uri, null, function (err) {
          if (err) return cb(err);
          next(i + 1);
        });
      })(0);
    case "show_message":
      return this.actions.toast(String(input.text || "").slice(0, 120), function (err) {
        if (err) return cb(err);
        cb(null, { shown: true });
      });
    case "free_memory":
      return this.actions.freeMemory(function (err, closed) {
        if (err) return cb(err);
        cb(null, { closed: closed });
      });
    default:
      cb(new Error("unknown tool"));
  }
};

module.exports = { Tools: Tools, DEFINITIONS: DEFINITIONS, normalize: normalize, parseGuideTime: parseGuideTime, LIVE_TV_ID: LIVE_TV_ID };

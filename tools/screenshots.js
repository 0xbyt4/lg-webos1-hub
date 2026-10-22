// Regenerate the screenshots in docs/images from the real pages, with sample data.
//
// Usage (on a computer, Node.js 22 or later, Google Chrome installed):
//   node tools/screenshots.js
//
// The pages are the real static/phone.html and apps/home/index.html. A small local server
// answers their API calls with fixed sample data (generic channel names, no real schedules
// or answers), and the clock is fixed at 20:45. Headless Chrome is driven over the
// DevTools protocol, so the tool can set an exact viewport, press keys and type.
//
// App icons come from .devmode/screenshot-icons (PNG files named by app id, saved from the
// TV's own icons, not committed); without them the tiles show the first letter.
//
// The game screens use the real game room code (services/home/games.js) on the same local
// server, with a TV tab and two phone tabs.
//
// The TV page uses Museo Sans from the TV's /usr/share/fonts. Copy MuseoSansThin.ttf,
// MuseoSansLight.ttf, MuseoSansMedium.ttf and MuseoSansBold.ttf to .devmode/fonts (not
// committed) to render it with the same font; without them it falls back to sans-serif.
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const gamesModule = require("../services/home/games.js");
const wsserver = require("../services/home/wsserver.js");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "images");
const FONTS = path.join(ROOT, ".devmode", "fonts");
const ICONS = path.join(ROOT, ".devmode", "screenshot-icons");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE_PORT = 8799;
const DEVTOOLS_PORT = 9231;
const NOW = new Date(2026, 9, 20, 20, 45, 0).getTime(); // Tuesday 20 October, 20:45 local

function at(h, m) {
  return new Date(2026, 9, 20, h, m, 0).getTime();
}

// Sample data

// Apps that ship with the TV.
const APPS = [
  ["netflix", "Netflix"], ["youtube.leanback.v4", "YouTube"], ["amazon.row", "Amazon Video"],
  ["com.webos.app.livetv", "Live TV"], ["com.webos.app.tvguide", "TV Guide"], ["com.webos.app.browser", "Web Browser"],
  ["com.webos.app.smartshare", "SmartShare"], ["com.webos.app.miracast", "Screen Share"], ["com.webos.app.discovery", "LG Store"],
  ["com.webos.app.connectionwizard", "Device Connector"], ["com.webos.app.notificationcenter", "Notifications"],
  ["com.webos.app.tvuserguide", "User Guide"]
];

function state() {
  return {
    connected: true,
    apps: APPS.map((a) => ({ id: a[0], title: a[1], icon: "/api/icon?id=" + encodeURIComponent(a[0]), canRemove: false })),
    foreground: { id: "com.webos.app.livetv", title: "Live TV" },
    volume: { level: 12, muted: false }
  };
}

const CHANNELS = [
  { number: "1", name: "Channel One", now: ["Evening Film", 20, 0, 22, 15], next: ["Late News", "22:15"] },
  { number: "2", name: "News Channel", now: ["World Tonight", 20, 30, 21, 30], next: ["Weather", "21:30"] },
  { number: "3", name: "Sports Channel", now: ["Football: Second Half", 19, 45, 21, 45], next: ["Match Review", "21:45"] },
  { number: "4", name: "Movie Channel", now: ["Classic Cinema", 20, 15, 22, 40], next: ["Documentary Hour", "22:40"] }
];

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function nowList() {
  return {
    updatedAt: NOW - 12 * 60000,
    channels: CHANNELS.map((c) => {
      const start = at(c.now[1], c.now[2]), end = at(c.now[3], c.now[4]);
      return {
        id: "ch" + c.number,
        number: c.number,
        name: c.name,
        now: { name: c.now[0], start: pad(c.now[1]) + ":" + pad(c.now[2]), end: pad(c.now[3]) + ":" + pad(c.now[4]),
          progress: Math.round((NOW - start) * 100 / (end - start)) },
        next: { name: c.next[0], start: c.next[1] }
      };
    })
  };
}

const SAMPLE_QUIZ = {
  questions: [
    { question: "Which planet is closest to the Sun?", choices: ["Mercury", "Venus", "Earth", "Mars"], answer: 0, fact: "Mercury orbits the Sun in just 88 days." },
    { question: "How many continents are there on Earth?", choices: ["Five", "Six", "Seven", "Eight"], answer: 2, fact: "Africa, Antarctica, Asia, Australia, Europe, North and South America." },
    { question: "What do bees make?", choices: ["Milk", "Honey", "Silk", "Wax paper"], answer: 1, fact: "A hive can make more than 30 kg of honey in a year." },
    { question: "Which is the largest ocean?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3, fact: "The Pacific covers about a third of the Earth's surface." }
  ]
};

const GUIDE_REPLY = "Channel One is showing Evening Film until 22:15. Late News follows at 22:15, then Talk Tonight at 22:45.";

const ANSWER = {
  id: "sample",
  at: NOW,
  question: "What is on Channel One tonight?",
  reply: GUIDE_REPLY,
  programs: [
    { name: "Evening Film", start: "20:00", end: "22:15", onNow: true },
    { name: "Late News", start: "22:15", end: "22:45", onNow: false },
    { name: "Talk Tonight", start: "22:45", end: "23:40", onNow: false }
  ],
  returnTo: "com.webos.app.livetv"
};

const ASK = {
  "What is on Channel One tonight?": {
    reply: GUIDE_REPLY,
    actions: [{ tool: "find_channel", ok: true }, { tool: "channel_guide", ok: true }],
    costUSD: 0.0172
  },
  "Turn the volume down a little": {
    reply: "I turned the volume down by 3 steps. It is at 12 now.",
    actions: [{ tool: "volume", ok: true }],
    costUSD: 0.0051
  }
};

const SCHEDULES = [
  { id: "s1", time: "09:00", days: [], action: "toast", text: "Time for your medicine", steps: 0, enabled: true, lastRun: "" },
  { id: "s2", time: "22:30", days: [1, 2, 3, 4, 5], action: "volumeDown", text: "", steps: 5, enabled: true, lastRun: "" },
  { id: "s3", time: "23:30", days: [6, 7], action: "powerOff", text: "", steps: 0, enabled: false, lastRun: "" }
];

function health() {
  const history = [];
  for (let i = 59; i >= 0; i--) {
    history.push({
      t: NOW - i * 60000,
      availableMB: Math.round(345 + 18 * Math.sin(i / 7) - (i < 12 ? 10 : 0)),
      totalMB: 931,
      cpu: Math.round(14 + 9 * Math.abs(Math.sin(i / 4)) + (i > 40 && i < 46 ? 40 : 0))
    });
  }
  return {
    now: history[history.length - 1],
    disk: { totalMB: 973, freeMB: 855 },
    uptimeSeconds: 96 * 60,
    history,
    events: [
      { t: at(19, 31), type: "memory", text: "Low memory (142 MB): closed Web Browser" },
      { t: at(20, 12), type: "cpu", text: "The TV has been under heavy load for 5 minutes (CPU 91%)" }
    ],
    upcoming: [{ id: "s2", at: at(22, 30), action: "volumeDown", text: "" }, { id: "s1", at: at(33, 0), action: "toast", text: "Time for your medicine" }],
    address: "http://192.168.1.50:8765"
  };
}

const SETTINGS = {
  health: { autoCleanup: true, lowMemoryMB: 150, lowMemorySamples: 2, cleanupCooldownMin: 10, cpuWarning: true,
    highCpuPercent: 85, highCpuMinutes: 5, cpuWarnCooldownMin: 30 },
  ai: { model: "claude-opus-5-5", effort: "default", maxTokens: 16000, dailyLimit: 50, showOnTv: true, webSearch: true, historyMinutes: 10 },
  apiKey: { set: true, last4: "Xk2Q" },
  models: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }
  ],
  efforts: ["default", "low", "medium", "high", "xhigh", "max"]
};

// Local server: the real pages plus a fake API

function tvPage(file) {
  let html = fs.readFileSync(path.join(ROOT, "apps", "home", file || "index.html"), "utf8")
    .replace('var API = "http://127.0.0.1:8765";', 'var API = "";')
    .replace('var WS_URL = "ws://127.0.0.1:8765/ws";', 'var WS_URL = "ws://127.0.0.1:' + PAGE_PORT + '/ws";');
  if (fs.existsSync(path.join(FONTS, "MuseoSansBold.ttf"))) {
    html = html.replace(/file:\/\/\/usr\/share\/fonts\//g, "/fonts/");
  }
  return html;
}

function startServer() {
  let asked = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const json = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (p === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(path.join(ROOT, "static", "phone.html")));
      }
      if (p === "/tv" || p === "/tv-answer") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(tvPage());
      }
      // The TV Games screen and its files, at the same relative paths as in the app.
      if (p === "/tvapp/games.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(tvPage("games.html"));
      }
      if (p.indexOf("/tvapp/") === 0) {
        // Any other file of the TV app (sound.js, games/<id>.js), from apps/home only.
        const rel = path.normalize(p.slice("/tvapp/".length));
        const file = path.join(ROOT, "apps", "home", rel);
        if (rel.indexOf("..") === 0 || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": file.endsWith(".svg") ? "image/svg+xml" : "application/javascript" });
        return res.end(fs.readFileSync(file));
      }
      if (p === "/games.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        return res.end(fs.readFileSync(path.join(ROOT, "apps", "home", "games.svg")));
      }
      if (p === "/sound.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        return res.end(fs.readFileSync(path.join(ROOT, "static", "sound.js")));
      }
      if (p === "/play") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(path.join(ROOT, "static", "play.html")));
      }
      const phoneGame = /^\/games\/([a-z0-9-]+)\.js$/.exec(p);
      if (phoneGame && fs.existsSync(path.join(ROOT, "static", "games", phoneGame[1] + ".js"))) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        return res.end(fs.readFileSync(path.join(ROOT, "static", "games", phoneGame[1] + ".js")));
      }
      if (p === "/icon.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(fs.readFileSync(path.join(ROOT, "static", "icon.png")));
      }
      if (p.indexOf("/fonts/") === 0) {
        const file = path.join(FONTS, path.basename(p));
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "font/ttf" });
        return res.end(fs.readFileSync(file));
      }
      if (p === "/api/status") return json({ accessCodeSet: true, authorized: true });
      if (p === "/api/games/tv" && req.method === "GET") return games.tvPoll(Number(url.searchParams.get("since")) || 0, json);
      if (p === "/api/games/tv") return json({ ok: games.tvCommand(JSON.parse(body || "{}")) });
      if (p === "/api/state") return json(state());
      if (p === "/api/cmd") return json({ ok: true, result: {} });
      if (p === "/api/log") {
        console.log("page error: " + body); // script errors from the TV pages (window.onerror)
        return json({ ok: true });
      }
      if (p === "/api/icon") {
        const file = path.join(ICONS, path.basename(url.searchParams.get("id") || "") + ".png");
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(fs.readFileSync(file));
      }
      if (p === "/api/health") return json(health());
      if (p === "/api/settings") return json(SETTINGS);
      if (p === "/api/schedules") return json({ schedules: SCHEDULES, upcoming: health().upcoming });
      if (p === "/api/usage") {
        return json({ usage: { date: "2026-10-20", requests: 6 + asked, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
          cacheWriteTokens: 0, webSearches: 1, costUSD: 0.1561 + (asked ? 0.0223 : 0) }, dailyLimit: 50, model: "claude-opus-5-5" });
      }
      if (p === "/api/now") return json(nowList());
      if (p === "/api/answer") {
        const fromAnswerPage = String(req.headers.referer || "").indexOf("/tv-answer") >= 0;
        return json({ answer: fromAnswerPage ? ANSWER : null });
      }
      if (p === "/api/ask") {
        const text = JSON.parse(body || "{}").text;
        const a = ASK[text] || { reply: "Done.", actions: [], costUSD: 0.004 };
        asked++;
        return json({ reply: a.reply, actions: a.actions, model: "claude-opus-5-5", usage: {}, webSearches: 0, costUSD: a.costUSD });
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"not found"}');
    });
  });
  const games = new gamesModule.GameHub({
    log: () => {},
    isLocal: () => true,
    playAddress: () => "http://192.168.1.50:8765/play",
    store: { data: { records: { "quiz:solo": [{ name: "Leo", value: 1320 }, { name: "Grandma", value: 1180 }],
      "blocks:solo": [{ name: "Mia", value: 4200 }, { name: "Grandma", value: 2650 }, { name: "Leo", value: 980 }] } }, save: () => {} },
    // Sample questions instead of Claude.
    ask: (request, cb) => setTimeout(() => cb(null, JSON.stringify(SAMPLE_QUIZ)), 300)
  });
  wsserver.attach(server, "/ws", (conn) => games.connect(conn));
  return new Promise((resolve) => server.listen(PAGE_PORT, "127.0.0.1", () => resolve(server)));
}

// Chrome over the DevTools protocol

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-shots-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--remote-debugging-port=" + DEVTOOLS_PORT, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + DEVTOOLS_PORT + "/json/new?about:blank", { method: "PUT" });
      if (r.ok) return { chrome, profile, target: await r.json() };
    } catch (e) {
      // Chrome is still starting
    }
    await sleep(200);
  }
  chrome.kill();
  throw new Error("Chrome did not start");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
      }
    };
    ws.onerror = () => reject(new Error("DevTools connection failed"));
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((ok, fail) => {
          id++;
          pending.set(id, { ok, fail });
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
      },
      close() { ws.close(); }
    });
  });
}

// Fix the clock for the page: new Date() and Date.now() return NOW, plus the time passed.
const FIXED_CLOCK = `(() => {
  const offset = ${NOW} - Date.now();
  const RealDate = Date;
  function FixedDate(...args) {
    if (!(this instanceof FixedDate)) return new RealDate(RealDate.now() + offset).toString();
    return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset);
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = () => RealDate.now() + offset;
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  Date = FixedDate;
})();`;

async function shoot(cdp, file, opts) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: opts.width, height: opts.height, deviceScaleFactor: opts.scale, mobile: !!opts.mobile
  });
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PAGE_PORT + opts.path });
  await sleep(opts.wait || 2000);
  if (opts.script) {
    await cdp.send("Runtime.evaluate", { expression: opts.script, awaitPromise: true });
    await sleep(opts.after || 800);
  }
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, "base64"));
  console.log("wrote docs/images/" + file);
}

// Type a request into the ask box and wait for the answer.
function askScript(texts) {
  return `(async () => {
    for (const t of ${JSON.stringify(texts)}) {
      document.getElementById("askText").value = t;
      document.getElementById("askForm").requestSubmit();
      await new Promise((r) => setTimeout(r, 700));
    }
    window.scrollTo(0, 0);
  })()`;
}

// A second and third browser tab, as two more phones (each tab is its own player).
async function openTab() {
  const r = await fetch("http://127.0.0.1:" + DEVTOOLS_PORT + "/json/new?about:blank", { method: "PUT" });
  const cdp = await connect((await r.json()).webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FIXED_CLOCK });
  return cdp;
}

async function evaluate(cdp, expression) {
  const out = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return out.result.value;
}

async function waitFor(cdp, expression) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(cdp, expression)) return;
    await sleep(50);
  }
  throw new Error("timed out: " + expression);
}

async function capture(cdp, file) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, "base64"));
  console.log("wrote docs/images/" + file);
}

// The games: the TV lobby with three players, a phone at "Go", the TV result.
async function gameShots(tv, phone) {
  await tv.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await tv.send("Page.navigate", { url: "http://127.0.0.1:" + PAGE_PORT + "/tvapp/games.html" });
  await waitFor(tv, "/^\\d{4}$/.test(document.getElementById('code').textContent)");
  const code = await evaluate(tv, "document.getElementById('code').textContent");
  const phones = [];
  for (const name of ["Grandma", "Leo", "Mia"]) {
    const p = await openTab();
    await p.send("Emulation.setDeviceMetricsOverride", { width: phone.width, height: phone.height, deviceScaleFactor: phone.scale, mobile: true });
    await p.send("Page.navigate", { url: "http://127.0.0.1:" + PAGE_PORT + "/play?code=" + code });
    await waitFor(p, "!!document.getElementById('joinForm')");
    await evaluate(p, `document.getElementById('name').value = ${JSON.stringify(name)}; document.getElementById('joinForm').requestSubmit(); true`);
    phones.push(p);
  }
  await waitFor(tv, "document.getElementById('people').textContent.indexOf('Mia') >= 0");
  await sleep(300);
  await capture(tv, "tv-games.png");
  // Rows: Sky Hop, Block Drop, Snake Arena, Quiz, Buzzer; right picks Together.
  await evaluate(tv, pressKeys([40, 40, 40, 40, 39, 13]));
  await waitFor(phones[0], "!!document.querySelector('.btn.go')");
  await sleep(100);
  await capture(phones[0], "phone-buzzer.png");
  const press = "document.querySelector('.buzz .btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true";
  await evaluate(phones[1], press);
  await sleep(140);
  await evaluate(phones[0], press);
  await sleep(90);
  await evaluate(phones[2], press);
  await waitFor(tv, "document.getElementById('gameBox').textContent.indexOf('was first') >= 0");
  await sleep(300);
  await capture(tv, "tv-buzzer.png");
  // The quiz, Together, started from the host phone (Grandma joined first).
  await evaluate(phones[0], "document.querySelector('#hostbar button:last-child').click(); true");
  await waitFor(phones[0], "[...document.querySelectorAll('.modes button')].some((b) => b.textContent === 'Together')");
  await evaluate(phones[0], "[...document.querySelectorAll('.g')].find((g) => g.textContent.indexOf('Quiz') >= 0).querySelectorAll('.modes button')[1].click(); true");
  await waitFor(tv, "!!document.querySelector('.qz-c')");
  await evaluate(phones[1], "document.querySelectorAll('.qz .ans')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
  await sleep(400);
  await capture(tv, "tv-quiz.png");
  await capture(phones[0], "phone-quiz.png");
  // Sky Hop, Together: the three phones tap now and then while the TV runs the birds.
  await evaluate(phones[0], "document.querySelector('#hostbar button:last-child').click(); true");
  await waitFor(phones[0], "[...document.querySelectorAll('.g')].some((g) => g.textContent.indexOf('Sky Hop') >= 0)");
  await evaluate(phones[0], "[...document.querySelectorAll('.g')].find((g) => g.textContent.indexOf('Sky Hop') >= 0).querySelectorAll('.modes button')[1].click(); true");
  // The TV tab must be in front: Chrome pauses animation frames in background tabs.
  await tv.send("Page.bringToFront");
  await waitFor(phones[0], "!!document.querySelector('.hp .btn.go')");
  const hop = "document.querySelector('.hp .btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true";
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < phones.length; k++) if ((i + k) % 2 === 0 || i < 3) await evaluate(phones[k], hop);
    await sleep(330);
  }
  await capture(tv, "tv-hop.png");
  await capture(phones[1], "phone-hop.png");
  // Block Drop, Together: each phone turns and moves a piece, then drops it.
  await startFromHost(phones[0], "Block Drop", 1);
  await waitFor(phones[0], "!!document.querySelector('.bk:not(.off)')");
  async function placePiece(p, i, k) {
    for (let r = 0; r < (i + k) % 4; r++) await evaluate(p, padPress(".bk .rotate"));
    const shift = ((i * 3 + k * 5) % 9) - 4;
    for (let s = 0; s < Math.abs(shift); s++) await evaluate(p, padPress(".bk ." + (shift < 0 ? "left" : "right")));
    await evaluate(p, padPress(".bk .drop"));
  }
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < phones.length; k++) await placePiece(phones[k], i, k);
    await sleep(250);
  }
  await capture(tv, "tv-blocks.png");
  await capture(phones[1], "phone-blocks.png");
  // Snake Arena, Together: each snake turns a few times (the board moves 8 steps a second).
  await startFromHost(phones[0], "Snake Arena", 1);
  await waitFor(phones[0], "!!document.querySelector('.sk.go')");
  const turns = [[8, 1, "down"], [10, 0, "down"], [12, 1, "left"], [12, 2, "down"], [14, 0, "right"], [15, 2, "right"],
    [24, 0, "up"], [24, 1, "up"], [26, 2, "up"]];
  for (let t = 0; t <= 30; t++) {
    for (const [at, k, dir] of turns) if (at === t) await evaluate(phones[k], padPress(".sk ." + dir));
    await sleep(100);
  }
  await capture(tv, "tv-snake.png");
  await capture(phones[0], "phone-snake.png");
  // Block Drop, Solo: the well with the next piece and the best scores.
  await startFromHost(phones[0], "Block Drop", 0);
  await waitFor(phones[0], "!!document.querySelector('.bk:not(.off)')");
  for (let i = 0; i < 7; i++) {
    await placePiece(phones[0], i, 0);
    await sleep(250);
  }
  await capture(tv, "tv-blocks-solo.png");
  for (const p of phones) p.close();
}

// The host phone opens the game list and starts a game (mode 0 Solo, 1 Together).
async function startFromHost(host, title, mode) {
  await evaluate(host, "document.querySelector('#hostbar button:last-child').click(); true");
  const card = `[...document.querySelectorAll('.g')].find((g) => g.textContent.indexOf(${JSON.stringify(title)}) >= 0)`;
  await waitFor(host, "!!" + card);
  await evaluate(host, card + ".querySelectorAll('.modes button')[" + mode + "].click(); true");
}

function padPress(selector) {
  return `(() => { const b = document.querySelector(${JSON.stringify(selector)}); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`;
}

// Press remote keys on the TV page (key codes: 37-40 arrows, 13 OK).
function pressKeys(codes) {
  return `(async () => {
    for (const k of ${JSON.stringify(codes)}) {
      document.dispatchEvent(new KeyboardEvent("keydown", { keyCode: k, which: k, bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    }
  })()`;
}

function scrollToScript(id) {
  return `document.getElementById(${JSON.stringify(id)}).closest("section").scrollIntoView({ block: "start" }); window.scrollBy(0, -12);`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const { chrome, profile, target } = await startChrome();
  try {
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FIXED_CLOCK });
    await shoot(cdp, "tv-home.png", { path: "/tv", width: 1920, height: 1080, scale: 1, wait: 2500 });
    await shoot(cdp, "tv-guide.png", { path: "/tv", width: 1920, height: 1080, scale: 1, wait: 2500, script: pressKeys([40, 40, 40, 40]) });
    await shoot(cdp, "tv-answer.png", { path: "/tv-answer", width: 1920, height: 1080, scale: 1, wait: 3500 });
    const phone = { width: 390, height: 844, scale: 3, mobile: true };
    await shoot(cdp, "phone-remote.png", Object.assign({ path: "/?shot=remote#remote" }, phone));
    await shoot(cdp, "phone-ask.png", Object.assign({ path: "/?shot=ask#assistant", script: askScript(Object.keys(ASK)) }, phone));
    await shoot(cdp, "phone-health.png", Object.assign({ path: "/?shot=health#settings" }, phone));
    await shoot(cdp, "phone-schedules.png", Object.assign({ path: "/?shot=schedules#settings", script: scrollToScript("schedules") }, phone));
    await shoot(cdp, "phone-claude.png", Object.assign({ path: "/?shot=claude#settings", script: scrollToScript("aiForm") }, phone));
    await gameShots(cdp, phone);
    cdp.close();
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited; // Chrome writes to its profile until it exits
    server.close();
    // Chrome's helper processes may still write for a moment after it exits.
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

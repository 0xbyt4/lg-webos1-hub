// The assistant: sends what the user said to Claude, runs the tools Claude asks for on
// the TV, and returns Claude's answer (Node 0.10, ES5).
//
// API rules this follows (Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5):
// - The assistant's content goes back into the history unchanged (it can hold thinking
//   blocks and fallback blocks), and the history is append-only.
// - All tool results of one turn go back in a single user message.
// - Forced tool_choice is not available; Claude picks tools itself ("auto").
// - The system prompt and tool list never change, so prompt caching can reuse them
//   (turning web search on or off in Settings changes the tool list once).
// - Web search runs on Anthropic's side. A long server-side search loop can stop with
//   "pause_turn"; sending the history again lets the server continue.
var claude = require("./claude.js");
var DEFINITIONS = require("./tools.js").DEFINITIONS;

var MAX_STEPS = 8;
var MAX_HISTORY_MESSAGES = 40;
var MAX_SEARCHES = 3; // web searches per request

var SYSTEM = [
  "You control an LG smart TV in a family home through the tools below. The person talking to you",
  "may be older and not technical. They write or speak short requests from a phone.",
  "",
  "How to work:",
  "- Do what is asked with the tools, then answer in one or two short sentences. The answer is",
  "  also shown on the TV screen, so keep it brief and plain.",
  "- Answer in the language the person uses.",
  "- Write plain text only: no Markdown, no asterisks, no lists. The TV shows the text as it is.",
  "- For a channel by name: call find_channel, pick the best match (prefer HD), then open_channel.",
  "  Never make up a channel_id or an app_id.",
  "- For \"what is on\" questions: use channel_guide (and find_channel first for a named channel).",
  "  Give times in 24-hour format.",
  "- Only change what the person asked for. If a request is unclear, ask one short question.",
  "- If a tool fails, say so simply and suggest what to try.",
  "- For news, weather, scores or facts you are not sure of, use web_search when it is available.",
  "  Sum up the result in a few short sentences, without links or a list of sources."
].join("\n");

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function localStamp(d) {
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[d.getDay()] + " " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function today() {
  var d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// store.data.ai: { model, effort, maxTokens, dailyLimit, showOnTv, webSearch, historyMinutes }
// store.data.secrets.apiKey, store.data.usage
function Agent(store, tools, actions, log) {
  this.store = store;
  this.tools = tools;
  this.actions = actions;
  this.log = log;
  this.messages = [];
  this.lastAt = 0;
  this.busy = false;
}

Agent.prototype.usageToday = function () {
  var u = this.store.data.usage;
  if (u.date !== today()) {
    this.store.data.usage = { date: today(), requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costUSD: 0 };
  }
  return this.store.data.usage;
};

Agent.prototype.reset = function () {
  this.messages = [];
  this.lastAt = 0;
};

Agent.prototype.request = function () {
  var ai = this.store.data.ai;
  var model = claude.MODELS[ai.model];
  var tools = DEFINITIONS;
  if (ai.webSearch && model) tools = DEFINITIONS.concat([{ type: model.webSearch, name: "web_search", max_uses: MAX_SEARCHES }]);
  var body = {
    model: ai.model,
    max_tokens: ai.maxTokens,
    cache_control: { type: "ephemeral" }, // caches the stable prefix: tools + system
    system: SYSTEM,
    tools: tools,
    tool_choice: { type: "auto" },
    messages: this.messages
  };
  if (ai.effort !== "default") body.output_config = { effort: ai.effort };
  if (model && model.fallback) body.fallbacks = "default";
  return body;
};

// ask(text, cb(err, { reply, actions, model, usage, costUSD }))
// One request without tools or history, for the games (quiz questions). It counts toward
// the daily limit and the usage like a question from the phone.
// req: { model, system, prompt, schema, maxTokens, effort }. cb(err, text)
Agent.prototype.oneShot = function (req, cb) {
  var self = this;
  var ai = this.store.data.ai;
  var apiKey = this.store.data.secrets.apiKey;
  if (!apiKey) return cb(new Error("Add your Anthropic API key in Settings first"));
  var usage = this.usageToday();
  if (usage.requests >= ai.dailyLimit) return cb(new Error("Daily limit reached (" + ai.dailyLimit + " requests). Change it in Settings."));
  usage.requests++;
  var body = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } }
  };
  claude.createMessage(apiKey, body, function (err, res) {
    if (!err && res) {
      var u = res.usage || {};
      usage.inputTokens += u.input_tokens || 0;
      usage.outputTokens += u.output_tokens || 0;
      usage.cacheReadTokens += u.cache_read_input_tokens || 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
      usage.costUSD = Math.round((usage.costUSD + claude.cost(res.model || req.model, u)) * 10000) / 10000;
    }
    self.store.save();
    if (err) {
      self.log("claude error " + err.status + " " + err.type + ": " + err.message);
      return cb(new Error(err.status === 401 ? "The API key was not accepted" : "Claude is not reachable: " + err.message));
    }
    if (res.stop_reason === "refusal") return cb(new Error("Claude declined this request"));
    if (res.stop_reason === "max_tokens") return cb(new Error("The answer was cut off"));
    var text = (res.content || []).filter(function (b) { return b.type === "text"; })
      .map(function (b) { return b.text; }).join("");
    cb(null, text);
  });
};

Agent.prototype.ask = function (text, cb) {
  var self = this;
  var ai = this.store.data.ai;
  var apiKey = this.store.data.secrets.apiKey;
  if (!apiKey) return cb(new Error("Add your Anthropic API key in Settings first"));
  if (this.busy) return cb(new Error("Still working on the previous request"));
  var usage = this.usageToday();
  if (usage.requests >= ai.dailyLimit) return cb(new Error("Daily limit reached (" + ai.dailyLimit + " requests). Change it in Settings."));

  // Keep a short conversation for follow-up questions; start fresh after a pause.
  if (Date.now() - this.lastAt > ai.historyMinutes * 60000 || this.messages.length > MAX_HISTORY_MESSAGES) this.reset();
  this.messages.push({ role: "user", content: [{ type: "text", text: "Local time: " + localStamp(new Date()) + "\n\n" + text }] });
  this.busy = true;

  var actionsDone = [];
  var lastGuide = null; // the last channel_guide result, for the answer screen
  var screenChanged = false; // a channel or app was opened, so the answer stays a toast
  var searched = false; // web search ran, so the answer is worth the answer screen
  var searches = 0;
  var total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  var spent = 0;
  var model = ai.model;

  function finish(err, reply) {
    self.busy = false;
    self.lastAt = Date.now();
    var u = self.usageToday();
    u.inputTokens += total.input_tokens;
    u.outputTokens += total.output_tokens;
    u.cacheReadTokens += total.cache_read_input_tokens;
    u.cacheWriteTokens += total.cache_creation_input_tokens;
    u.webSearches += searches;
    u.costUSD = Math.round((u.costUSD + spent) * 10000) / 10000;
    self.store.save();
    if (err) {
      self.reset(); // a failed turn may leave the history half-done; start clean next time
      return cb(err);
    }
    if (ai.showOnTv && reply) {
      // Guide and web answers are too long for a toast, so they go to the answer screen.
      var hasGuide = lastGuide && lastGuide.programs.length;
      if ((hasGuide || searched) && !screenChanged) {
        self.actions.showAnswer({ question: text, reply: reply, guide: hasGuide ? lastGuide : null }, function (e) {
          if (!e) return;
          self.log("answer screen failed: " + e.message);
          self.actions.toast(reply.slice(0, 200), function () {});
        });
      } else {
        self.actions.toast(reply.slice(0, 200), function () {});
      }
    }
    cb(null, { reply: reply, actions: actionsDone, model: model, usage: total, webSearches: searches, costUSD: Math.round(spent * 10000) / 10000 });
  }

  (function step(n) {
    if (n >= MAX_STEPS) return finish(new Error("Stopped after " + MAX_STEPS + " steps without an answer"));
    self.usageToday().requests++;
    claude.createMessage(apiKey, self.request(), function (err, res) {
      if (err) {
        self.log("claude error " + err.status + " " + err.type + ": " + err.message);
        return finish(new Error(err.status === 401 ? "The API key was not accepted" : "Claude is not reachable: " + err.message));
      }
      model = res.model || model;
      var u = res.usage || {};
      for (var k in total) if (total.hasOwnProperty(k)) total[k] += u[k] || 0;
      spent += claude.cost(model, u);
      searches += claude.webSearches(u);

      if (res.stop_reason === "refusal") return finish(new Error("Claude declined this request"));
      self.messages.push({ role: "assistant", content: res.content });
      for (var b = 0; b < res.content.length; b++) if (res.content[b].type === "server_tool_use") searched = true;
      if (res.stop_reason === "pause_turn") return step(n + 1); // the server continues its search

      // Citations split a sentence into several text blocks, so join them without breaks.
      var text = res.content.filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; }).join("").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      var calls = res.content.filter(function (b) { return b.type === "tool_use"; });

      if (res.stop_reason !== "tool_use" || !calls.length) {
        if (res.stop_reason === "max_tokens") text = (text ? text + " " : "") + "(The answer was cut off.)";
        return finish(null, text || "Done.");
      }

      // Run the tool calls one by one (the TV handles one command at a time well),
      // then send all results back together.
      var results = [];
      (function runCall(i) {
        if (i >= calls.length) {
          self.messages.push({ role: "user", content: results });
          return step(n + 1);
        }
        var call = calls[i];
        self.tools.run(call.name, call.input, function (toolErr, out) {
          actionsDone.push({ tool: call.name, input: call.input, ok: !toolErr });
          if (!toolErr && call.name === "channel_guide") lastGuide = out;
          if (!toolErr && (call.name === "open_channel" || call.name === "open_app")) screenChanged = true;
          self.log("tool " + call.name + " " + JSON.stringify(call.input) + (toolErr ? " failed: " + toolErr.message : " ok"));
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: toolErr ? "Error: " + toolErr.message : JSON.stringify(out),
            is_error: !!toolErr
          });
          runCall(i + 1);
        });
      })(0);
    });
  })(0);
};

module.exports = { Agent: Agent, SYSTEM: SYSTEM };

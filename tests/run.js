// Runs every tests/*.test.js file in its own Node.js process and prints a summary.
// Usage: node tests/run.js   (Node.js 22 or later, no packages to install)
var fs = require("fs");
var path = require("path");
var spawnSync = require("child_process").spawnSync;

var files = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
var failed = [];
files.forEach(function (f) {
  var started = Date.now();
  var r = spawnSync(process.execPath, ["--no-deprecation", path.join(__dirname, f)], { encoding: "utf8", timeout: 120000 });
  var ok = r.status === 0;
  console.log((ok ? "pass " : "FAIL ") + f + " (" + ((Date.now() - started) / 1000).toFixed(1) + " s)");
  if (!ok) {
    failed.push(f);
    process.stdout.write((r.stdout || "") + (r.stderr || "") + (r.error ? String(r.error) + "\n" : ""));
  }
});
console.log(failed.length ? failed.length + " of " + files.length + " failed" : "all " + files.length + " passed");
process.exit(failed.length ? 1 : 0);

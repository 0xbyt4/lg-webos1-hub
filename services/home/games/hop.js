// Sky Hop: tap the phone to hop; fly through the gaps (Node 0.10, ES5).
// The physics and drawing run on the TV (apps/home/games/hop.js); runs, standings and
// records are the shared real-time game logic in tvrun.js. Together: up to 8 birds.
var tvrun = require("./tvrun.js");

module.exports = tvrun.make({
  id: "hop",
  title: "Sky Hop",
  description: "Tap your phone to hop and fly through the gaps. Solo: beat your best score. Together: the last bird flying wins.",
  maxPlayers: 8,
  input: function (data) { return data.hop === true ? { hop: true } : null; }
});

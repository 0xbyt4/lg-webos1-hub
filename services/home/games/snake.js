// Snake Arena: the snakes move on the TV, the phones send the turns.
// Solo: eat apples, the snake gets longer and faster; the best scores are kept.
// Together: up to 8 snakes on one board; walls, bodies and head-on hits end a snake;
// the last one in wins.
var tvrun = require("./tvrun.js");

var DIRS = ["up", "down", "left", "right"];

module.exports = tvrun.make({
  id: "snake",
  title: "Snake Arena",
  description: "Steer your snake to the apples and keep away from the walls. Solo: beat your best score. Together: up to 8 snakes; the last one in wins.",
  maxPlayers: 8,
  input: function (data) {
    return DIRS.indexOf(data.dir) >= 0 ? { dir: data.dir } : null;
  }
});

// Block Drop (falling blocks): the wells run on the TV, the phones send the buttons.
// Solo: one well, the best scores are kept. Together: up to 4 wells with the same
// pieces; clearing 2 or more lines sends junk rows to the others; the last one in wins.
var tvrun = require("./tvrun.js");

var MOVES = ["left", "right", "rotate", "down", "drop"];

module.exports = tvrun.make({
  id: "blocks",
  title: "Block Drop",
  description: "Turn and drop the blocks to clear lines. Solo: beat your best score. Together: send junk rows to the others; the last one in wins.",
  maxPlayers: 4,
  input: function (data) {
    return MOVES.indexOf(data.move) >= 0 ? { move: data.move } : null;
  }
});

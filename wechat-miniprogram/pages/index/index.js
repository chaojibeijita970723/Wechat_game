const { startGame } = require('../../game.js');

Page({
  onReady() {
    wx.createSelectorQuery().in(this).select('#game-canvas').fields({ node: true, size: true }).exec(result => {
      const canvas = result[0] && result[0].node;
      if (canvas) this.game = startGame(canvas);
    });
  },
  onTouchStart(e) { if (this.game) this.game.touchStart(e); },
  onTouchMove(e) { if (this.game) this.game.touchMove(e); },
  onTouchEnd(e) { if (this.game) this.game.touchEnd(e); }
});

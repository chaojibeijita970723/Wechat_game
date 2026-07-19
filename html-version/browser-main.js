(function startBrowserGame(global){
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const loading = document.getElementById('loading');
  const hint = document.getElementById('hint');
  const api = global.module && global.module.exports;

  if (!api || typeof api.startGame !== 'function') {
    loading.textContent = '游戏脚本加载失败，请刷新页面';
    return;
  }

  if (!canvas.requestAnimationFrame && global.requestAnimationFrame) {
    canvas.requestAnimationFrame = global.requestAnimationFrame.bind(global);
  }
  const game = api.startGame(canvas);
  const pointers = new Map();
  const makeTouch = event => ({
    identifier: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: event.clientX,
    y: event.clientY,
  });
  const activeTouches = () => Array.from(pointers.values());

  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    const touch = makeTouch(event);
    pointers.set(event.pointerId, touch);
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    // 只把本次新增指针交给 touchStart，保证升级卡等按钮可以被第二指针点击。
    game.touchStart({ touches: [touch] });
    hint.classList.add('hidden');
  });

  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, makeTouch(event));
    game.touchMove({ touches: activeTouches() });
  });

  const endPointer = event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.delete(event.pointerId);
    game.touchEnd({ touches: activeTouches() });
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  loading.remove();
  global.setTimeout(() => hint.classList.add('hidden'), 5500);
})(window);

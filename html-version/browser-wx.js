(function initBrowserCompatibility(global){
  'use strict';

  const memoryStorage = Object.create(null);
  const AudioContextCtor = global.AudioContext || global.webkitAudioContext;

  global.wx = {
    getSystemInfoSync(){
      return {
        windowWidth: global.innerWidth || 390,
        windowHeight: global.innerHeight || 844,
        pixelRatio: global.devicePixelRatio || 1,
      };
    },
    getStorageSync(key){
      try { return global.localStorage.getItem(key) || ''; }
      catch (err) { return memoryStorage[key] || ''; }
    },
    setStorageSync(key, value){
      const text = String(value);
      memoryStorage[key] = text;
      try { global.localStorage.setItem(key, text); } catch (err) {}
    },
    createInnerAudioContext(){
      const audio = new Audio();
      return {
        set src(value){ audio.src = value; },
        get src(){ return audio.src; },
        set loop(value){ audio.loop = !!value; },
        get loop(){ return audio.loop; },
        set volume(value){ audio.volume = Number(value); },
        get volume(){ return audio.volume; },
        set obeyMuteSwitch(value){ void value; },
        play(){
          const promise = audio.play();
          if (promise && promise.catch) promise.catch(function(){});
        },
        pause(){ audio.pause(); },
        stop(){ audio.pause(); audio.currentTime = 0; },
        destroy(){ audio.pause(); audio.removeAttribute('src'); },
      };
    },
    createWebAudioContext(){
      return AudioContextCtor ? new AudioContextCtor() : null;
    },
  };

  // game.js 同时服务于微信 CommonJS 和浏览器经典脚本。
  global.module = { exports: {} };
  global.exports = global.module.exports;
})(window);


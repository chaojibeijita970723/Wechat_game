function startGame(canvas){
"use strict";

/* ============================================================
   基础设置 / Canvas
   ============================================================ */
const ctx = canvas.getContext('2d');
const sysInfo = wx.getSystemInfoSync();
let W = 0, H = 0, DPR = Math.min(sysInfo.pixelRatio || 1, 2);
// 小游戏的 RAF 以 Canvas 实例为准；保留 setTimeout 后备，避免部分基础库报
// “requestAnimationFrame is not defined”。
const raf = canvas.requestAnimationFrame
  ? canvas.requestAnimationFrame.bind(canvas)
  : (cb)=>setTimeout(()=>cb(Date.now()), 16);

function resize(){
  W = sysInfo.windowWidth; H = sysInfo.windowHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
resize();

/* ============================================================
   人物头像精灵图
   生成图按整张设定板加载，再在 Canvas 中按网格裁切；加载失败时继续使用
   下方的矢量卡通头像，避免弱网或旧版基础库出现空白角色。
   ============================================================ */
const PORTRAIT_SHEETS = {
  players:{src:'assets/images/players-roster-v2.jpg',cols:4,rows:1,crop:.98,rowOffsets:[0]},
  enemies:{src:'assets/images/enemies-roster-v2.jpg',cols:5,rows:2,crop:.98,rowOffsets:[.04,-.04]},
  bosses:{src:'assets/images/bosses-roster-v2.jpg',cols:3,rows:2,crop:.98,rowOffsets:[0,0]},
};
const PORTRAIT_MAP = {
  striker:{sheet:'players',col:0,row:0}, defender:{sheet:'players',col:1,row:0},
  playmaker:{sheet:'players',col:2,row:0}, haaland:{sheet:'players',col:3,row:0},
  brute:{sheet:'enemies',col:0,row:0}, winger:{sheet:'enemies',col:1,row:0},
  tackler:{sheet:'enemies',col:2,row:0}, midfielder:{sheet:'enemies',col:3,row:0},
  keeper:{sheet:'enemies',col:4,row:0}, commander:{sheet:'enemies',col:0,row:1},
  dribbler:{sheet:'enemies',col:1,row:1}, passer:{sheet:'enemies',col:2,row:1},
  sweeper:{sheet:'enemies',col:3,row:1}, medic:{sheet:'enemies',col:4,row:1},
  messi:{sheet:'bosses',col:0,row:0}, ronaldo9:{sheet:'bosses',col:1,row:0},
  mbappe:{sheet:'bosses',col:2,row:0}, cr7:{sheet:'bosses',col:0,row:1},
  ronaldinho:{sheet:'bosses',col:1,row:1}, zidane:{sheet:'bosses',col:2,row:1},
};

function loadPortraitSheets(){
  for(const sheet of Object.values(PORTRAIT_SHEETS)){
    sheet.image=null; sheet.loaded=false; sheet.failed=false;
    try{
      const image=canvas.createImage ? canvas.createImage() : (typeof Image!=='undefined' ? new Image() : null);
      if(!image){ sheet.failed=true; continue; }
      image.onload=()=>{ sheet.loaded=true; sheet.failed=false; };
      image.onerror=()=>{ sheet.failed=true; sheet.loaded=false; };
      image.src=sheet.src;
      sheet.image=image;
    }catch(err){ sheet.failed=true; }
  }
}
loadPortraitSheets();

/* ============================================================
   视觉Token（球场主题）
   ============================================================ */
const COL = {
  pitchA:'#0E4B33', pitchB:'#12583C', line:'rgba(242,240,230,0.55)',
  chalk:'#F2F0E6', gold:'#D8B23A', red:'#E1483D', yellow:'#F4C542',
  navy:'#08222B', playerBlue:'#3C8DBC', hpGreen:'#4CAF6B', hpRed:'#E1483D',
  eliteRed:'#B5233A', bossGold:'#E8B93A', dim:'rgba(4,10,7,0.55)'
};

/* ============================================================
   工具函数
   ============================================================ */
function rand(a,b){ return a + Math.random()*(b-a); }
function pick(arr){ return arr[(Math.random()*arr.length)|0]; }
function dist(x1,y1,x2,y2){ return Math.hypot(x2-x1,y2-y1); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
function mixColor(hex1,hex2,t){
  const c1=parseInt(hex1.slice(1),16), c2=parseInt(hex2.slice(1),16);
  const r1=(c1>>16)&255,g1=(c1>>8)&255,b1=c1&255;
  const r2=(c2>>16)&255,g2=(c2>>8)&255,b2=c2&255;
  const r=Math.round(lerp(r1,r2,t)),g=Math.round(lerp(g1,g2,t)),b=Math.round(lerp(b1,b2,t));
  return `rgb(${r},${g},${b})`;
}

/* ============================================================
   代码合成音效（Web Audio API，无 mp3 / wav 包体）
   必须由首次触摸解锁；不支持的基础库会自动静默降级。
   ============================================================ */
const SFX = { ctx:null, failed:false, lastKick:0, lastPickup:0 };
const BGM = { audio:null, started:false };

function startBgm(){
  // InnerAudioContext 适合长音乐；Web Audio 继续专注短促的代码合成 SFX。
  if(BGM.started || typeof wx==='undefined' || !wx.createInnerAudioContext) return;
  try{
    const audio=wx.createInnerAudioContext();
    audio.src='assets/audio/final-whistle-rush.mp3';
    audio.loop=true;
    audio.volume=.32;
    audio.obeyMuteSwitch=true;
    audio.play();
    BGM.audio=audio; BGM.started=true;
  }catch(err){}
}

function unlockAudio(){
  if(SFX.failed) return null;
  try{
    if(!SFX.ctx){
      if(typeof wx!=='undefined' && wx.createWebAudioContext){
        SFX.ctx=wx.createWebAudioContext();
      }else{
        const AudioCtor=typeof AudioContext!=='undefined' ? AudioContext : (typeof webkitAudioContext!=='undefined' ? webkitAudioContext : null);
        if(!AudioCtor){ SFX.failed=true; return null; }
        SFX.ctx=new AudioCtor();
      }
    }
    if(SFX.ctx.resume) SFX.ctx.resume();
    return SFX.ctx;
  }catch(err){ SFX.failed=true; return null; }
}

function synthTone(freq, endFreq, duration, volume, type, when){
  const ac=unlockAudio(); if(!ac) return;
  try{
    const t=when===undefined ? ac.currentTime : when;
    const osc=ac.createOscillator(), gain=ac.createGain();
    osc.type=type||'sine';
    osc.frequency.setValueAtTime(Math.max(20,freq),t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),t+duration);
    gain.gain.setValueAtTime(Math.max(.0001,volume),t);
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t); osc.stop(t+duration+.015);
  }catch(err){}
}

function playKickSfx(){
  const now=Date.now(); if(now-SFX.lastKick<55) return; SFX.lastKick=now;
  const ac=unlockAudio(); if(!ac) return;
  // 低频下坠提供“砰”的重量，短三角波补出球接触的硬边。
  synthTone(145,48,.115,.20,'sine');
  synthTone(310,82,.052,.075,'triangle');
}

function playPickupSfx(){
  const now=Date.now(); if(now-SFX.lastPickup<72) return; SFX.lastPickup=now;
  const ac=unlockAudio(); if(!ac) return;
  const t=ac.currentTime;
  synthTone(780,1160,.075,.07,'square',t);
  synthTone(1180,1560,.055,.045,'sine',t+.028);
}

function playLevelUpSfx(){
  const ac=unlockAudio(); if(!ac) return;
  const t=ac.currentTime;
  synthTone(660,660,.12,.075,'sine',t);
  synthTone(880,880,.14,.085,'sine',t+.085);
  synthTone(1320,1320,.22,.10,'triangle',t+.18);
}

/* ============================================================
   对象池
   ============================================================ */
function makePool(n, factory){ const p=[]; for(let i=0;i<n;i++){ const o=factory(); o.active=false; p.push(o);} return p; }
function firstFree(pool){ for(const o of pool){ if(!o.active) return o; } return null; }

const MAX_BULLETS = 220;
const MAX_ENEMIES = 54;   // 50 个小怪 + Boss/分裂怪的少量缓冲位
const MAX_MINIONS = 50;   // 普通、精英、重装怪共用的硬上限，优先保证帧率
const MAX_ORBS = 160;
const MAX_PARTICLES = 140;
const MAX_DAMAGE_TEXTS = 48;
const MAX_TRAPS = 8;
const MAX_EFFECTS = 24;
const MAX_POWERUPS = 18;

const bullets = makePool(MAX_BULLETS, ()=>({x:0,y:0,vx:0,vy:0,r:5,dmg:0,pierce:0,color:COL.chalk,
  life:0,fromPlayer:true,homing:false,target:null,bounce:0,explode:false,explodeChance:0,lastHit:null,trailT:0,
  trailColor:'rgba(235,250,255,.8)',splashRadius:0}));
const enemies = makePool(MAX_ENEMIES, ()=>({x:0,y:0,r:14,hp:0,maxhp:0,speed:0,color:'#888',
  contactDmg:0,expVal:1,elite:false,boss:false,affix:null,stunT:0,slowT:0,hitFlash:0,
  bossTimer:0,fused:false,kx:0,ky:0,knockT:0,knockDuration:0,orbitHitT:0,chargeHitId:0,
  kind:'grunt',aiTimer:0,aiState:'chase',aiAngle:0,aiPhase:0,shieldActive:false,commandBuffT:0,
  bossId:'',bossName:''}));
const orbs = makePool(MAX_ORBS, ()=>({x:0,y:0,r:5,value:1}));
const particles = makePool(MAX_PARTICLES, ()=>({x:0,y:0,vx:0,vy:0,life:0,maxlife:0,color:COL.chalk,r:2}));
const damageTexts = makePool(MAX_DAMAGE_TEXTS, ()=>({x:0,y:0,vx:0,vy:0,value:0,life:0,maxlife:0,crit:false}));
const traps = makePool(MAX_TRAPS, ()=>({x:0,y:0,r:60,life:0}));
const effects = makePool(MAX_EFFECTS, ()=>({type:'',x:0,y:0,r:0,maxr:0,life:0,maxlife:0,color:COL.chalk}));
const powerups = makePool(MAX_POWERUPS, ()=>({x:0,y:0,r:12,type:'medkit',life:0,pulse:0}));

function spawnParticleBurst(x,y,color,count){
  for(let i=0;i<count;i++){
    const p = firstFree(particles); if(!p) return;
    const a = rand(0,Math.PI*2), sp = rand(40,180);
    p.x=x; p.y=y; p.vx=Math.cos(a)*sp; p.vy=Math.sin(a)*sp;
    p.life=p.maxlife=rand(0.25,0.5); p.color=color; p.r=rand(1.5,3.5);
    p.active=true;
  }
}
function spawnBallTrail(x,y,color,size){
  const p=firstFree(particles); if(!p) return;
  p.x=x; p.y=y; p.vx=rand(-12,12); p.vy=rand(-12,12);
  p.life=p.maxlife=.18; p.color=color||'rgba(235,250,255,.8)'; p.r=rand(2,(size||3.5)); p.active=true;
}
function spawnSmokeBurst(x,y,count){
  for(let i=0;i<count;i++){
    const p=firstFree(particles); if(!p) return;
    const a=rand(0,Math.PI*2), sp=rand(25,80);
    p.x=x; p.y=y; p.vx=Math.cos(a)*sp; p.vy=Math.sin(a)*sp-18;
    p.life=p.maxlife=rand(.32,.56); p.color='rgba(209,224,214,.72)'; p.r=rand(3,6); p.active=true;
  }
}
function spawnEffect(type,x,y,maxr,life,color){
  const e = firstFree(effects); if(!e) return;
  e.type=type; e.x=x; e.y=y; e.r=0; e.maxr=maxr; e.life=e.maxlife=life; e.color=color; e.active=true;
}
function spawnDamageText(x,y,value,crit){
  const t=firstFree(damageTexts); if(!t) return;
  t.x=x+rand(-7,7); t.y=y-10; t.vx=rand(-10,10); t.vy=crit?-92:-70; t.value=Math.max(1,Math.round(value));
  t.life=t.maxlife=crit?.62:.46; t.crit=!!crit; t.active=true;
}

/* ============================================================
   角色预设
   ============================================================ */
const CHARACTERS = [
  { id:'striker', name:'锋线魔术师 · 内马尔', role:'前锋 / 敏捷爆发', color:'#E1483D',
    desc:'高速变向与连珠射门，穿透多个敌人，适合在怪群中撕开缺口。',
    maxhp:92, speed:230, dmg:16, atkCooldown:0.46, pickupRange:78, attackType:'straight', pierce:3 },
  { id:'defender', name:'飞翼铁卫 · 哈基米', role:'后卫 / 高容错', color:'#3C8DBC',
    desc:'三颗护体足球持续环绕，贴身伤害并击退来犯敌人。',
    maxhp:150, speed:198, dmg:13, atkCooldown:1.35, pickupRange:78, attackType:'orbit', orbitCount:3, orbitRadius:48, knockback:420 },
  { id:'playmaker', name:'大脑 · 莫德里奇', role:'中场 / 全图牵制', color:'#D8B23A',
    desc:'自动追踪多目标弹射射门，拾取范围极大，发育飞快。',
    maxhp:104, speed:214, dmg:10, atkCooldown:0.62, pickupRange:170, attackType:'homing', bounce:3 },
  { id:'haaland', name:'重炮前锋 · 哈兰德', role:'前锋 / 力量冲撞', color:'#FF7A45',
    desc:'重炮抽射，穿透力极强；练出【冲锋破阵】后可定期向前猛冲撞飞挡路之敌。',
    maxhp:120, speed:206, dmg:22, atkCooldown:0.58, pickupRange:82, attackType:'straight', pierce:5,
    locked:true, unlockCost:600 },
];

/* ============================================================
   升级卡池
   ============================================================ */
const STAT_CARDS = [
  {id:'speed', name:'冲刺战靴', desc:'移动速度 +12%', icon:'⚡', apply:p=>{ p.speed*=1.12; p.statLevels.speed++; }},
  {id:'atkspeed', name:'快速出球', desc:'攻击冷却 -10%', icon:'⏱', apply:p=>{ p.atkCooldown=Math.max(0.12,p.atkCooldown*0.9); p.statLevels.atkspeed++; }},
  {id:'dmg', name:'力量训练', desc:'伤害 +15%', icon:'💥', apply:p=>{ p.dmg*=1.15; p.statLevels.dmg++; }},
  {id:'pickup', name:'战术视野', desc:'拾取范围 +25%', icon:'👁', apply:p=>{ p.pickupRange*=1.25; p.statLevels.pickup++; }},
  {id:'hp', name:'体能强化', desc:'最大生命 +20%，并回满', icon:'❤', apply:p=>{ p.maxhp*=1.2; p.hp=p.maxhp; p.statLevels.hp++; }},
];
const SKILL_CARDS = [
  {id:'banana', name:'香蕉球', desc:'定期弧线轰炸，范围群伤', icon:'🌙', maxLv:5},
  {id:'offside', name:'越位陷阱', desc:'留下减速陷阱，限制追兵', icon:'🕸', maxLv:5},
  {id:'yellow', name:'黄牌警告', desc:'定期眩晕周围全部敌人', icon:'🟨', maxLv:5},
  {id:'bottle', name:'易爆水瓶', desc:'命中有几率引爆连锁伤害', icon:'💣', maxLv:5},
  {id:'charge', name:'冲锋破阵', desc:'定期向前猛冲，撞飞路径上的所有敌人', icon:'🏃', maxLv:5},
];

const POWERUP_DEFS = {
  redcard:{name:'红牌清场',icon:'🟥',color:'#E1483D'},
  drink:{name:'能量饮料',icon:'🥤',color:'#62E7FF'},
  medkit:{name:'医疗包',icon:'✚',color:'#4CAF6B'},
  magnet:{name:'全场磁铁',icon:'🧲',color:'#C77DFF'},
  golden:{name:'金球时刻',icon:'★',color:'#F4C542'},
};

const PITCH_EVENTS = [
  {id:'rain',name:'大雨湿滑',desc:'全员移速降低，转向空间更大',color:'#62E7FF'},
  {id:'fans',name:'球迷助威',desc:'自动攻击频率提高 30%',color:'#F4C542'},
  {id:'extra',name:'加时压迫',desc:'敌人更快，但击杀士气翻倍',color:'#E1483D'},
  {id:'goldrain',name:'金色经验雨',desc:'场上持续出现额外经验球',color:'#D8B23A'},
];

const ACHIEVEMENTS = [
  {id:'wave5',name:'初露锋芒',desc:'抵达第 5 阵',reward:50,check:g=>g.waveNumber>=5},
  {id:'combo20',name:'行云流水',desc:'达成 20 连击',reward:80,check:g=>g.maxCombo>=20},
  {id:'boss3',name:'巨人杀手',desc:'累计击败 3 名 Boss',reward:120,check:g=>g.totalBossKills>=3},
  {id:'nodamage60',name:'滴水不漏',desc:'连续 60 秒未受伤',reward:100,check:g=>g.maxNoDamageTime>=60},
];

/* ============================================================
   游戏状态
   ============================================================ */
const GAME = {
  state:'select',   // select | playing | paused | levelup | revive | gameover
  player:null,
  camX:0, camY:0,
  waveNumber:1, waveTimer:0, WAVE_DURATION:18,
  spawnTimer:0,
  bossActive:false, bossRef:null,
  gameTime:0,
  eliteKills:0,
  hasRevived:false,
  currentCards:[], pendingLevelUps:0,
  isEvolutionChoice:false,
  evolutionLevel:0,
  currentEvent:null, eventTimer:0, eventSpawnTimer:0,
  combo:0, comboTimer:0, maxCombo:0, morale:0, frenzyT:0,
  killCount:0, bossKills:0, totalBossKills:Number(wx.getStorageSync('wcs_boss_kills')||0),
  noDamageTime:0, maxNoDamageTime:0, lastPickupName:'', pickupToastT:0,
  newAchievements:[],
  shakeT:0, shakeMag:0, shakeDuration:0, shakePhase:0, hitstopT:0,
  selectedCharIdx:0,
  buttons:[], // 当前帧可点击区域 {x,y,w,h,action}
  best: Number(wx.getStorageSync('wcs_best')||0),
  bestWave: Number(wx.getStorageSync('wcs_best_wave')||1),
  coins: Number(wx.getStorageSync('wcs_coins')||0),   // 局外货币：跨局累计，本局暂不设商店消耗入口
  coinsAwarded:false, lastCoinsEarned:0,
  unlockedChars: loadUnlockedChars(),
  achievements: loadStoredSet('wcs_achievements'),
  mastery: loadStoredObject('wcs_mastery'),
};

function loadStoredSet(key){
  try{ return new Set(JSON.parse(wx.getStorageSync(key)||'[]')); }catch(err){ return new Set(); }
}
function loadStoredObject(key){
  try{ return JSON.parse(wx.getStorageSync(key)||'{}')||{}; }catch(err){ return {}; }
}

function loadUnlockedChars(){
  let arr=[];
  try{ arr = JSON.parse(wx.getStorageSync('wcs_unlocked_chars')||'[]'); }catch(err){ arr=[]; }
  const set = new Set(arr);
  CHARACTERS.forEach(c=>{ if(!c.locked) set.add(c.id); }); // 基础角色恒定解锁
  return set;
}
function isCharUnlocked(c){ return !c.locked || GAME.unlockedChars.has(c.id); }
function unlockCharacter(c){
  if(isCharUnlocked(c) || GAME.coins < c.unlockCost) return false;
  GAME.coins -= c.unlockCost;
  wx.setStorageSync('wcs_coins', String(GAME.coins));
  GAME.unlockedChars.add(c.id);
  wx.setStorageSync('wcs_unlocked_chars', JSON.stringify([...GAME.unlockedChars]));
  return true;
}

function newPlayer(charDef){
  return {
    x:0, y:0, r:16, vx:0, vy:0,
    maxhp:charDef.maxhp, hp:charDef.maxhp, speed:charDef.speed, dmg:charDef.dmg,
    atkCooldown:charDef.atkCooldown, atkTimer:0.2, pickupRange:charDef.pickupRange,
    def:charDef, level:1, exp:0, expToNext:12, invulnT:0,
    skills:{}, skillTimers:{}, orbitAngle:0, evolutionQueue:[],
    synergies:{}, statLevels:{speed:0,atkspeed:0,dmg:0,pickup:0,hp:0},
    speedBoostT:0, attackBoostT:0, magnetT:0, critBoostT:0,
    // 攻击动画：facingAngle 决定起脚方向，atkAnimT 倒计时驱动挤压变形与踢球特效
    atkAnimT:0, atkAnimDur:0.22, facingAngle:-Math.PI/2, kickSide:1,
    // 冲锋破阵技能：dashT>0 期间强制位移替代摇杆控制
    dashT:0, dashDur:0.34, dashAngle:0, dashId:0,
    evo:{comet:0,rail:0,meteor:0,cyclone:0,shockwave:0,bulwark:0,prism:0,chain:0,nova:0},
    special:{pierce:0, volley:0, shotPower:0, orbitCount:0, orbitRadius:0, orbitSpin:0, orbitPower:0, passBounce:0, passExtra:0, passPower:0},
    color:charDef.color,
  };
}

function resetGame(charDef){
  bullets.forEach(o=>o.active=false);
  enemies.forEach(o=>o.active=false);
  orbs.forEach(o=>o.active=false);
  particles.forEach(o=>o.active=false);
  damageTexts.forEach(o=>o.active=false);
  traps.forEach(o=>o.active=false);
  effects.forEach(o=>o.active=false);
  powerups.forEach(o=>o.active=false);

  GAME.player = newPlayer(charDef);
  GAME.waveNumber = 1; GAME.waveTimer = GAME.WAVE_DURATION;
  GAME.spawnTimer = 0.6;
  GAME.bossActive = false; GAME.bossRef = null;
  GAME.gameTime = 0; GAME.eliteKills = 0; GAME.hasRevived = false;
  GAME.coinsAwarded = false; GAME.lastCoinsEarned = 0;
  GAME.isEvolutionChoice=false; GAME.evolutionLevel=0;
  GAME.currentEvent=null; GAME.eventTimer=0; GAME.eventSpawnTimer=0;
  GAME.combo=0; GAME.comboTimer=0; GAME.maxCombo=0; GAME.morale=0; GAME.frenzyT=0;
  GAME.killCount=0; GAME.bossKills=0; GAME.noDamageTime=0; GAME.maxNoDamageTime=0;
  GAME.lastPickupName=''; GAME.pickupToastT=0; GAME.newAchievements=[];
  GAME.camX = 0; GAME.camY = 0;
  GAME.shakeT=0; GAME.shakeDuration=0; GAME.shakePhase=0; GAME.hitstopT=0;
  GAME.state = 'playing';
}

/* ============================================================
   输入：虚拟摇杆 + 通用点击
   ============================================================ */
const joystick = { active:false, pointerId:null, baseX:0, baseY:0, curX:0, curY:0, maxR:56 };

function onTouchStart(e){
  // 微信/iOS 仅允许在用户手势内创建或恢复 AudioContext。
  unlockAudio();
  startBgm();
  // 多指操作时 touches[0] 往往仍是摇杆手指；按钮必须读取本次新增的触点。
  const started = e.changedTouches && e.changedTouches.length ? e.changedTouches : e.touches;
  const touch = started && started[0];
  if(!touch) return;
  const x = touch.clientX===undefined ? touch.x : touch.clientX;
  const y = touch.clientY===undefined ? touch.y : touch.clientY;

  // 先检测按钮命中（各状态的UI按钮）
  // 后绘制的覆盖层按钮优先命中。
  for(let i=GAME.buttons.length-1;i>=0;i--){
    const b=GAME.buttons[i];
    if(x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h){
      b.action();
      return;
    }
  }
  if(GAME.state === 'playing' && !joystick.active){
    joystick.active = true; joystick.pointerId = touch.identifier;
    joystick.baseX = x; joystick.baseY = y; joystick.curX = x; joystick.curY = y;
  }
}
function onTouchMove(e){
  if(!joystick.active) return;
  for(const t of e.touches){
    if(t.identifier === joystick.pointerId){
      joystick.curX = t.clientX===undefined ? t.x : t.clientX;
      joystick.curY = t.clientY===undefined ? t.y : t.clientY;
      break;
    }
  }
}
function endJoystick(e){
  if(!joystick.active) return;
  const touches=Array.from(e.touches||[]);
  const stillActive = touches.some(t=>t.identifier===joystick.pointerId);
  if(!stillActive){ joystick.active=false; joystick.pointerId=null; }
}

function clearJoystick(){
  joystick.active=false; joystick.pointerId=null;
  joystick.baseX=0; joystick.baseY=0; joystick.curX=0; joystick.curY=0;
}
function pauseGame(){
  if(GAME.state!=='playing') return;
  clearJoystick(); GAME.state='paused';
}
function resumeGame(){
  if(GAME.state==='paused') GAME.state='playing';
}

/* ============================================================
   敌人生成 / 波次 / 融合变异
   ============================================================ */
const JERSEY_COLORS = ['#C0392B','#E67E22','#8E44AD','#2C3E50','#16A085'];

// 每 5 阵轮换一名传奇 Boss；超过第 30 阵后从梅西重新循环，并继续沿用波次成长。
const BOSS_LEGENDS = [
  {id:'messi',name:'传奇大师 · 梅西',shortName:'梅西',number:'10',jersey:'#3C70B5',accent:'#7A4ED1',pattern:'curve',hpMul:.9,speedMul:1.12,dmgMul:.95,sizeMul:.92},
  {id:'ronaldo9',name:'外星人 · 罗纳尔多',shortName:'罗纳尔多',number:'9',jersey:'#E7C62F',accent:'#36A15B',pattern:'power',hpMul:1.18,speedMul:.96,dmgMul:1.18,sizeMul:1.08},
  {id:'mbappe',name:'闪电前锋 · 姆巴佩',shortName:'姆巴佩',number:'10',jersey:'#244E9B',accent:'#62E7FF',pattern:'speed',hpMul:.94,speedMul:1.35,dmgMul:1.02,sizeMul:.94},
  {id:'cr7',name:'禁区王者 · C罗',shortName:'C罗',number:'7',jersey:'#B5233A',accent:'#F2F0E6',pattern:'air',hpMul:1.08,speedMul:1.12,dmgMul:1.2,sizeMul:1.04},
  {id:'ronaldinho',name:'足球精灵 · 罗纳尔迪尼奥',shortName:'小罗',number:'10',jersey:'#E5BD2F',accent:'#54C779',pattern:'trick',hpMul:1,speedMul:1.05,dmgMul:1.06,sizeMul:1},
  {id:'zidane',name:'中场大师 · 齐达内',shortName:'齐达内',number:'10',jersey:'#E8E6DF',accent:'#3C70B5',pattern:'control',hpMul:1.12,speedMul:.92,dmgMul:1.12,sizeMul:1.06},
];
function bossProfileForWave(wave){ return BOSS_LEGENDS[(Math.max(1,Math.floor(wave/5))-1)%BOSS_LEGENDS.length]; }
function bossProfileById(id){ return BOSS_LEGENDS.find(b=>b.id===id)||BOSS_LEGENDS[0]; }

function scaledHP(base, wave){ return base * Math.pow(1.1, wave); }
function scaledSpeed(base, wave){ return Math.min(base*(1+wave*0.035), base*2.35); }
function scaledDmg(base, wave){ return base*(1+wave*0.06); }
function minionCount(){ let n=0; for(const e of enemies) if(e.active && !e.boss) n++; return n; }

function trySpawnEnemy(kind, wave, spawnX, spawnY){
  if(kind!=='boss' && minionCount()>=MAX_MINIONS){
    reinforceNearest();
    return false;
  }
  let slot = firstFree(enemies);
  if(!slot){
    if(kind==='boss'){
      // Boss 波绝不被同屏上限吞掉：移除一只离玩家最远的普通敌人，腾出 Boss 位。
      let replace=null, farthest=-1;
      const p=GAME.player;
      for(const e of enemies){
        if(!e.active || e.boss) continue;
        const d=dist(e.x,e.y,p.x,p.y);
        if(d>farthest){ farthest=d; replace=e; }
      }
      if(!replace) return false;
      replace.active=false;
      slot=replace;
    }else{
      reinforceNearest();
      return false;
    }
  }
  const p = GAME.player;
  const ang = rand(0, Math.PI*2);
  const spawnR = Math.max(W,H)*0.62 + 60;
  const x = spawnX===undefined ? p.x + Math.cos(ang)*spawnR : spawnX;
  const y = spawnY===undefined ? p.y + Math.sin(ang)*spawnR : spawnY;

  const bossProfile=kind==='boss'?bossProfileForWave(wave):null;
  let base;
  if(kind==='boss') base = {hp:300, speed:52, dmg:18, r:62, exp:8};
  else if(kind==='brute') base = {hp:55, speed:58, dmg:13, r:21, exp:4};
  else if(kind==='winger') base = {hp:14, speed:138, dmg:6, r:11, exp:2};
  else if(kind==='tackler') base = {hp:36, speed:72, dmg:12, r:17, exp:3};
  else if(kind==='midfielder') base = {hp:25, speed:64, dmg:8, r:14, exp:3};
  else if(kind==='keeper') base = {hp:72, speed:48, dmg:11, r:22, exp:5};
  else if(kind==='commander') base = {hp:48, speed:56, dmg:9, r:19, exp:5};
  else if(kind==='dribbler') base = {hp:22, speed:116, dmg:7, r:13, exp:3};
  else if(kind==='passer') base = {hp:30, speed:62, dmg:7, r:15, exp:4};
  else if(kind==='sweeper') base = {hp:68, speed:54, dmg:14, r:21, exp:5};
  else if(kind==='medic') base = {hp:34, speed:58, dmg:6, r:15, exp:5};
  else base = {hp:18, speed:92, dmg:7, r:13, exp:1};

  slot.x=x; slot.y=y; slot.r=base.r*(bossProfile?bossProfile.sizeMul:1);
  slot.hp = slot.maxhp = kind==='boss' ? scaledHP(base.hp, wave)*3*bossProfile.hpMul : scaledHP(base.hp, wave);
  slot.speed = scaledSpeed(base.speed, wave)*(bossProfile?bossProfile.speedMul:1);
  slot.contactDmg = scaledDmg(base.dmg, wave)*(bossProfile?bossProfile.dmgMul:1);
  slot.expVal = base.exp;
  slot.color = bossProfile ? bossProfile.jersey : pick(JERSEY_COLORS);
  slot.elite = false; slot.affix = null; slot.boss = (kind==='boss');
  slot.stunT=0; slot.slowT=0; slot.hitFlash=0; slot.orbitHitT=0; slot.chargeHitId=0; slot.bossTimer = 1.6; slot.fused=false; slot.kx=0; slot.ky=0; slot.knockT=0; slot.knockDuration=0;
  slot.kind=kind; slot.aiTimer=rand(.8,1.8); slot.aiState='chase'; slot.aiAngle=rand(0,Math.PI*2); slot.aiPhase=0; slot.shieldActive=kind==='keeper'; slot.commandBuffT=0;
  slot.bossId=bossProfile?bossProfile.id:''; slot.bossName=bossProfile?bossProfile.shortName:'';

  if(kind==='winger') slot.color='#26A69A';
  else if(kind==='tackler') slot.color='#8E44AD';
  else if(kind==='midfielder') slot.color='#D35400';
  else if(kind==='keeper') slot.color='#F1C40F';
  else if(kind==='commander') slot.color='#34495E';
  else if(kind==='dribbler') slot.color='#D94FA4';
  else if(kind==='passer') slot.color='#2EA66B';
  else if(kind==='sweeper') slot.color='#52616B';
  else if(kind==='medic') slot.color='#E8E6DF';

  // 精英词缀：第10波起
  if(!slot.boss && wave>=6 && Math.random()<0.24){
    slot.elite = true;
    slot.hp = slot.maxhp = slot.maxhp*1.8;
    slot.r *= 1.22;
    slot.affix = pick(['reflect','split','armor','haste']);
    if(slot.affix==='haste') slot.speed *= 1.5;
    slot.color = mixColor(slot.color, COL.eliteRed, 0.55);
  }
  slot.active = true;
  if(slot.boss) GAME.bossRef=slot;
  return true;
}

// 数量超上限时只做轻微数值增援，不改变小兵体型、颜色或 Boss 身份。
function reinforceNearest(){
  const p = GAME.player;
  let best=null, bestD=Infinity;
  for(const e of enemies){
    if(!e.active || e.boss) continue;
    const d = dist(e.x,e.y,p.x,p.y);
    if(d<bestD){ bestD=d; best=e; }
  }
  if(!best) return;
  best.maxhp *= 1.08;
  best.hp = Math.min(best.hp + best.maxhp*0.08, best.maxhp);
  best.contactDmg *= 1.04;
  // 不设置 elite / fused，不加红色描边，不修改 r；视觉上仍是原本的小兵。
}

function spawnBatch(){
  const w = GAME.waveNumber;
  const count = 2 + Math.min(6, Math.floor(w/2));
  const formation = w<3 ? 'scatter' : pick(['scatter','line','ring','wedge']);
  const kinds=['grunt'];
  if(w>=3) kinds.push('winger');
  if(w>=4) kinds.push('dribbler');
  if(w>=5) kinds.push('brute','tackler');
  if(w>=6) kinds.push('passer');
  if(w>=7) kinds.push('midfielder','sweeper');
  if(w>=8) kinds.push('keeper');
  if(w>=9) kinds.push('medic');
  if(w>=10 && Math.random()<.32) kinds.push('commander');
  const kind = pick(kinds);
  const specials=kinds.filter(k=>k!=='grunt'&&k!=='commander');
  const squadKind=i=>{
    if(i===0) return kind;
    if(w>=5&&i%3===0&&specials.length) return pick(specials);
    return 'grunt';
  };
  const p=GAME.player, spawnR=Math.max(W,H)*.62+70, baseA=rand(0,Math.PI*2);

  if(formation==='ring'){
    const n=8+Math.min(8,Math.floor(w/2));
    for(let i=0;i<n;i++){
      const a=baseA+i*Math.PI*2/n;
      if(!trySpawnEnemy(w>=5&&i%3===0?squadKind(i):'grunt',w,p.x+Math.cos(a)*spawnR,p.y+Math.sin(a)*spawnR)) break;
    }
  }else if(formation==='line'){
    const n=Math.max(5,count+2), cx=p.x+Math.cos(baseA)*spawnR, cy=p.y+Math.sin(baseA)*spawnR;
    for(let i=0;i<n;i++){
      const off=(i-(n-1)/2)*42;
      if(!trySpawnEnemy(i===Math.floor(n/2)?kind:squadKind(i),w,cx+Math.cos(baseA+Math.PI/2)*off,cy+Math.sin(baseA+Math.PI/2)*off)) break;
    }
  }else if(formation==='wedge'){
    const n=Math.max(6,count+2);
    for(let i=0;i<n;i++){
      const row=Math.floor((i+1)/2), side=i%2===0?1:-1;
      const forward=row*28, lateral=row*34*side;
      const x=p.x+Math.cos(baseA)*(spawnR+forward)+Math.cos(baseA+Math.PI/2)*lateral;
      const y=p.y+Math.sin(baseA)*(spawnR+forward)+Math.sin(baseA+Math.PI/2)*lateral;
      if(!trySpawnEnemy(squadKind(i),w,x,y)) break;
    }
  }else{
    for(let i=0;i<count;i++) if(!trySpawnEnemy(squadKind(i),w)) break;
  }
}

function spawnInterval(){
  return Math.max(0.18, 0.76 - GAME.waveNumber*0.022);
}

/* ============================================================
   玩家攻击
   ============================================================ */
function findNearestEnemy(x,y, exclude){
  let best=null, bestD=Infinity;
  for(const e of enemies){
    if(!e.active || e===exclude) continue;
    const d = dist(e.x,e.y,x,y);
    if(d<bestD){ bestD=d; best=e; }
  }
  return best;
}

function performAttack(){
  const p = GAME.player;
  const type = p.def.attackType;

  if(type==='orbit'){
    // 足球环在 updateOrbitBalls 中持续造成伤害；普通攻击不再额外发射。
    return;
  }

  const target = findNearestEnemy(p.x,p.y);
  if(!target) return;

  // 触发起脚动画：朝目标方向、挤压变形 + 一颗小球飞出
  p.atkAnimT = p.atkAnimDur;
  p.facingAngle = Math.atan2(target.y-p.y, target.x-p.x);
  p.kickSide = (p.kickSide||1) * -1;

  if(type==='straight'){
    const baseA = Math.atan2(target.y-p.y, target.x-p.x);
    const count = 1+p.special.volley+p.evo.comet*2+(p.synergies.fireNet?2:0);
    for(let i=0;i<count;i++){
      const b = firstFree(bullets); if(!b) break;
      const a=baseA+(i-(count-1)/2)*(p.evo.comet ? .13 : .16), spd=520+p.evo.rail*120;
      b.x=p.x; b.y=p.y; b.vx=Math.cos(a)*spd; b.vy=Math.sin(a)*spd;
      b.r=5+p.evo.meteor*1.5; b.dmg=p.dmg*(1+p.special.shotPower*.18)*(1+p.evo.meteor*.28); b.pierce=p.def.pierce+p.special.pierce+p.evo.rail*3;
      b.color=p.evo.rail?'#62E7FF':p.evo.meteor?'#FFB23D':COL.chalk; b.life=1.4;
      b.fromPlayer=true; b.homing=false; b.target=null; b.bounce=0; b.lastHit=null;
      b.trailColor=p.evo.rail?'rgba(98,231,255,.85)':p.evo.meteor?'rgba(255,178,61,.82)':'rgba(235,250,255,.8)';
      b.splashRadius=p.evo.meteor ? 28+p.evo.meteor*10 : 0;
      setBulletBottleFlag(b, p); b.active=true;
    }
  } else if(type==='homing'){
    const count=1+p.special.passExtra+p.evo.prism*2;
    for(let i=0;i<count;i++){
      const b=firstFree(bullets); if(!b) break;
      b.x=p.x; b.y=p.y; b.vx=0; b.vy=0;
      b.r=5+p.evo.nova; b.dmg=p.dmg*(1+p.special.passPower*.16)*(1+p.evo.nova*.22); b.pierce=0; b.color=p.evo.prism?'#C77DFF':COL.gold; b.life=2.2;
      b.fromPlayer=true; b.homing=true; b.target=i===0?target:findNearestEnemy(p.x+i*18,p.y-i*18,target)||target; b.bounce=p.def.bounce+p.special.passBounce+p.evo.chain*2; b.lastHit=null;
      b.trailColor=p.evo.prism?'rgba(199,125,255,.85)':'rgba(255,216,90,.8)'; b.splashRadius=p.evo.nova ? 24+p.evo.nova*8 : 0;
      setBulletBottleFlag(b, p); b.active=true;
    }
  }
}

function setBulletBottleFlag(b, p){
  if(p.skills.bottle){
    b.explode = true;
    b.explodeChance = 0.22 + p.skills.bottle*0.06;
  } else { b.explode=false; }
}

// 铁闸专属：三颗足球随角色转动。每个敌人有短暂受击间隔，既有贴身爽感也不会
// 因每帧重复结算造成伤害失控。
function updateOrbitBalls(dt){
  const p = GAME.player;
  if(!p || p.def.attackType!=='orbit') return;
  p.orbitAngle += dt * (3.8+p.special.orbitSpin);
  const count=p.def.orbitCount+p.special.orbitCount+p.evo.cyclone*2, radius=p.def.orbitRadius+p.special.orbitRadius+p.evo.bulwark*12;
  for(let i=0;i<count;i++){
    const a=p.orbitAngle+i*Math.PI*2/count;
    const bx=p.x+Math.cos(a)*radius, by=p.y+Math.sin(a)*radius;
    for(const e of enemies){
      if(!e.active) continue;
      if(e.orbitHitT>0) continue;
      if(dist(bx,by,e.x,e.y)<e.r+9){
        damageEnemy(e,p.dmg*(0.72+p.special.orbitPower*.15+p.evo.cyclone*.13),false,bx,by);
        e.orbitHitT=0.28;
        p.atkAnimT = p.atkAnimDur*0.65;
        p.facingAngle = Math.atan2(e.y-p.y, e.x-p.x);
        if(!e.affix || e.affix!=='armor'){
          const push=Math.atan2(e.y-p.y,e.x-p.x);
          e.x+=Math.cos(push)*18; e.y+=Math.sin(push)*18;
        }
        spawnEffect('orbit',bx,by,18+p.evo.cyclone*3,0.14,p.evo.cyclone?'#72E6FF':COL.chalk);
      }
    }
  }
}

/* ============================================================
   冲锋破阵：周期性向最近之敌全力冲刺，冲刺途中撞飞路径上的敌人
   ============================================================ */
function updateCharge(dt){
  const p = GAME.player;
  if(p.skills.charge){
    ensureSkillTimer(p,'charge', 2.2);
    p.skillTimers.charge -= dt;
    if(p.skillTimers.charge<=0 && p.dashT<=0){
      const target = findNearestEnemy(p.x,p.y);
      const angle = target ? Math.atan2(target.y-p.y, target.x-p.x) : p.facingAngle;
      p.dashT = p.dashDur;
      p.dashAngle = angle;
      p.dashId = (p.dashId||0)+1;
      p.facingAngle = angle;
      p.invulnT = Math.max(p.invulnT, p.dashDur+0.1); // 冲刺途中免疫伤害
      p.atkAnimT = p.atkAnimDur*0.8;
      triggerShake(5,0.16);
      const lv = p.skills.charge;
      p.skillTimers.charge = Math.max(1.8, 4.0 - lv*0.35);
    }
  }
  if(p.dashT>0){
    p.dashT -= dt;
    const lv = p.skills.charge||1;
    const dashSpd = 620 + lv*30;
    p.x += Math.cos(p.dashAngle)*dashSpd*dt;
    p.y += Math.sin(p.dashAngle)*dashSpd*dt;
    for(const e of enemies){
      if(!e.active || e.chargeHitId===p.dashId) continue;
      if(dist(e.x,e.y,p.x,p.y) < e.r+p.r+6){
        damageEnemy(e, p.dmg*(1.1+lv*0.22)*(p.synergies.steelCharge?1.45:1), false, p.x, p.y);
        applyKnockback(e, p.x, p.y, 460+lv*40);
        e.chargeHitId = p.dashId;
      }
    }
    if(p.dashT<=0 && p.synergies.steelCharge) p.invulnT=Math.max(p.invulnT,.45);
  }
}


/* ============================================================
   伤害结算 / 敌人死亡
   ============================================================ */
function applyKnockback(e, fromX, fromY, strength){
  // 速度向量允许与敌人的追击移动自然叠加；指数阻尼在不同帧率下保持一致。
  const a=Math.atan2(e.y-fromY,e.x-fromX);
  const mass=e.boss ? 3.6 : e.kind==='sweeper' ? 2.4 : e.elite ? 1.8 : 1;
  e.kx += Math.cos(a)*(strength/mass);
  e.ky += Math.sin(a)*(strength/mass);
  e.knockDuration=e.knockT=Math.max(e.knockT, e.boss ? .09 : .13);
}

function damagePlayer(amount, invulnTime){
  const p=GAME.player;
  if(!p || p.invulnT>0 || amount<=0) return false;
  p.hp-=amount;
  if(invulnTime) p.invulnT=Math.max(p.invulnT,invulnTime);
  GAME.combo=0; GAME.comboTimer=0; GAME.noDamageTime=0;
  return true;
}

function damageEnemy(e, dmg, isBullet, hitX, hitY){
  if(!e.active) return;
  const p=GAME.player;
  let actualDmg=dmg*(GAME.frenzyT>0?1.35:1), critical=false;
  if(p && p.critBoostT>0 && Math.random()<.25){ actualDmg*=1.7; critical=true; }
  if(e.kind==='keeper' && e.shieldActive && isBullet){
    actualDmg*=.45;
    spawnEffect('keepershield',e.x,e.y,e.r*1.7,.16,'#F4C542');
  }
  e.hp -= actualDmg;
  e.hitFlash = 0.10;
  const sourceX=hitX===undefined?p.x:hitX, sourceY=hitY===undefined?p.y:hitY;
  const force=(isBullet?210:145)*(e.boss ? .28 : e.elite ? .58 : 1);
  applyKnockback(e,sourceX,sourceY,force);
  if(isBullet) playKickSfx();
  spawnDamageText(e.x,e.y,actualDmg,critical||e.elite||e.boss);
  spawnParticleBurst(e.x,e.y, e.boss?COL.bossGold:'#fff', e.boss?6:3);
  if(e.elite || e.boss){
    triggerShake(e.boss ? 8 : 3, e.boss ? .16 : .09);
    GAME.hitstopT=Math.max(GAME.hitstopT, e.boss ? .035 : .018);
  }

  if(e.affix==='reflect'){
    if(dist(e.x,e.y,p.x,p.y) < 140 && p.invulnT<=0){
      damagePlayer(4,.3);
    }
  }
  if(e.hp<=0) killEnemy(e);
}

function killEnemy(e){
  e.active = false;
  // Boss 拆成一大团蓝色经验球，形成清场后的强烈成长反馈。
  const dropCount = e.boss ? 20 : 1;
  for(let i=0;i<dropCount;i++){
    const orb = firstFree(orbs); if(!orb) break;
    const a=rand(0,Math.PI*2), spread=e.boss?rand(0,96):rand(0,5);
    orb.x=e.x+Math.cos(a)*spread; orb.y=e.y+Math.sin(a)*spread;
    orb.r=e.boss?7:5; orb.value=e.expVal; orb.active=true;
  }
  spawnParticleBurst(e.x,e.y, e.color, e.boss?18:6);
  spawnSmokeBurst(e.x,e.y,e.boss?12:4);
  if(e.elite && !e.boss) GAME.eliteKills++;
  if(e.boss){
    GAME.eliteKills+=3; GAME.bossKills++; GAME.totalBossKills++;
    wx.setStorageSync('wcs_boss_kills',String(GAME.totalBossKills));
    triggerShake(10,0.4); GAME.hitstopT=0.08; GAME.bossActive=false; GAME.bossRef=null;
  }
  registerKill(e);
  tryDropPowerup(e);

  if(e.affix==='split'){
    for(let i=0;i<2;i++){
      if(minionCount()>=MAX_MINIONS) break;
      const s = firstFree(enemies); if(!s) break;
      s.x = e.x+rand(-14,14); s.y = e.y+rand(-14,14);
      s.r = Math.max(8, e.r*0.55); s.hp=s.maxhp = Math.max(6, e.maxhp*0.28);
      s.speed = e.speed*1.15; s.contactDmg = e.contactDmg*0.6; s.expVal=1;
      s.color = e.color; s.elite=false; s.affix=null; s.boss=false;
      s.stunT=0; s.slowT=0; s.hitFlash=0.2; s.orbitHitT=0; s.fused=false; s.kx=0; s.ky=0; s.knockT=0; s.knockDuration=0;
      s.kind='grunt'; s.aiTimer=rand(.8,1.8); s.aiState='chase'; s.aiAngle=0; s.aiPhase=0; s.shieldActive=false; s.commandBuffT=0;
      s.bossId=''; s.bossName='';
      s.active = true;
    }
  }
}

function registerKill(e){
  GAME.killCount++;
  GAME.combo=GAME.comboTimer>0?GAME.combo+1:1;
  GAME.comboTimer=2.6;
  GAME.maxCombo=Math.max(GAME.maxCombo,GAME.combo);
  const eventMul=GAME.currentEvent&&GAME.currentEvent.id==='extra'?2:1;
  GAME.morale+=eventMul*(1.5+Math.min(20,GAME.combo)*.1);
  if(GAME.morale>=100){
    GAME.morale-=100; GAME.frenzyT=6;
    spawnEffect('morale',GAME.player.x,GAME.player.y,150,.55,COL.gold);
    triggerShake(5,.2);
  }
}

function tryDropPowerup(e){
  const chance = e.boss ? 1 : (e.elite ? 0.24 : 0.045);
  if(Math.random()>chance) return;
  const pu=firstFree(powerups); if(!pu) return;
  pu.x=e.x; pu.y=e.y; pu.r=e.boss?15:12; pu.type=pick(Object.keys(POWERUP_DEFS));
  pu.life=e.boss?18:12; pu.pulse=rand(0,Math.PI*2); pu.active=true;
}

/* ============================================================
   技能：香蕉球 / 越位陷阱 / 黄牌警告
   ============================================================ */
function ensureSkillTimer(p, id, initial){
  if(p.skillTimers[id]===undefined) p.skillTimers[id]=initial;
}

function updateSkills(dt){
  const p = GAME.player;
  // 铁闸的 10 级进化：环绕球蓄力后释放低频冲击波，不进入常规升级卡池。
  if(p.evo.shockwave){
    ensureSkillTimer(p,'evoShockwave',2.8);
    p.skillTimers.evoShockwave-=dt;
    if(p.skillTimers.evoShockwave<=0){
      const r=92+p.evo.shockwave*24;
      spawnEffect('shockwave',p.x,p.y,r,.38,'#72E6FF');
      for(const e of enemies){
        if(e.active && dist(e.x,e.y,p.x,p.y)<r+e.r) damageEnemy(e,p.dmg*(.8+p.evo.shockwave*.18),false,p.x,p.y);
      }
      p.skillTimers.evoShockwave=Math.max(1.7,3.2-p.evo.shockwave*.3);
    }
  }
  if(p.skills.banana){
    ensureSkillTimer(p,'banana',1.0);
    p.skillTimers.banana -= dt;
    if(p.skillTimers.banana<=0){
      const lv = p.skills.banana;
      const target = findNearestEnemy(p.x,p.y) || {x:p.x+rand(-100,100), y:p.y+rand(-100,100)};
      const r = 64 + lv*10;
      spawnEffect('banana', target.x, target.y, r, 0.4, COL.yellow);
      for(const e of enemies){
        if(!e.active) continue;
        if(dist(e.x,e.y,target.x,target.y) < r+e.r) damageEnemy(e, p.dmg*1.1 + lv*4, false);
      }
      if(p.synergies.explosiveCurve){
        spawnEffect('boom',target.x,target.y,r*.78,.32,COL.red);
        for(const e of enemies){
          if(e.active&&dist(e.x,e.y,target.x,target.y)<r*.78+e.r) damageEnemy(e,p.dmg*(.65+lv*.08),false,target.x,target.y);
        }
      }
      p.skillTimers.banana = Math.max(1.1, 3.3 - lv*0.28);
    }
  }
  if(p.skills.offside){
    ensureSkillTimer(p,'offside',2.0);
    p.skillTimers.offside -= dt;
    if(p.skillTimers.offside<=0){
      const t = firstFree(traps);
      if(t){ t.x=p.x; t.y=p.y; t.r=55+p.skills.offside*6; t.life=5+p.skills.offside*0.5; t.active=true; }
      p.skillTimers.offside = Math.max(2.4, 4.2 - p.skills.offside*0.25);
    }
  }
  if(p.skills.yellow){
    ensureSkillTimer(p,'yellow',3.0);
    p.skillTimers.yellow -= dt;
    if(p.skillTimers.yellow<=0){
      const lv = p.skills.yellow;
      const r = 110 + lv*8;
      spawnEffect('yellowcard', p.x, p.y, r, 0.5, COL.yellow);
      for(const e of enemies){
        if(!e.active) continue;
        if(dist(e.x,e.y,p.x,p.y) < r+e.r && !e.boss) e.stunT = 1.0 + lv*0.15;
      }
      if(p.synergies.refereeLock){
        const t=firstFree(traps);
        if(t){ t.x=p.x; t.y=p.y; t.r=r*.72; t.life=5.5; t.active=true; }
      }
      p.skillTimers.yellow = Math.max(4.5, 7.5 - lv*0.4);
    }
  }
}

/* ============================================================
   自动拾取道具 / 随机赛场事件
   ============================================================ */
function applyPowerup(type){
  const p=GAME.player, def=POWERUP_DEFS[type];
  if(type==='redcard'){
    for(const e of enemies){
      if(!e.active) continue;
      if(e.boss) damageEnemy(e,e.maxhp*.12,false,p.x,p.y);
      else damageEnemy(e,e.hp+1,false,p.x,p.y);
    }
    triggerShake(10,.32);
  }else if(type==='drink'){
    p.speedBoostT=Math.max(p.speedBoostT,8); p.attackBoostT=Math.max(p.attackBoostT,8);
  }else if(type==='medkit'){
    p.hp=Math.min(p.maxhp,p.hp+p.maxhp*.35);
  }else if(type==='magnet'){
    p.magnetT=Math.max(p.magnetT,7);
  }else if(type==='golden'){
    p.critBoostT=Math.max(p.critBoostT,8);
  }
  GAME.lastPickupName=def.name; GAME.pickupToastT=1.8;
  spawnEffect('pickup',p.x,p.y,72,.35,def.color);
  playPickupSfx();
}

function updatePowerups(dt){
  const p=GAME.player;
  for(const pu of powerups){
    if(!pu.active) continue;
    pu.life-=dt; pu.pulse+=dt*4;
    if(pu.life<=0){ pu.active=false; continue; }
    const d=dist(pu.x,pu.y,p.x,p.y);
    if(d<p.pickupRange*.72){
      const a=Math.atan2(p.y-pu.y,p.x-pu.x), sp=220+(p.pickupRange-d);
      pu.x+=Math.cos(a)*sp*dt; pu.y+=Math.sin(a)*sp*dt;
    }
    if(d<p.r+pu.r){ pu.active=false; applyPowerup(pu.type); }
  }
}

function startPitchEvent(){
  let choices=PITCH_EVENTS;
  if(GAME.currentEvent) choices=PITCH_EVENTS.filter(e=>e.id!==GAME.currentEvent.id);
  GAME.currentEvent=pick(choices); GAME.eventTimer=GAME.WAVE_DURATION;
  GAME.eventSpawnTimer=.5;
}

function updatePitchEvent(dt){
  if(!GAME.currentEvent) return;
  GAME.eventTimer-=dt;
  if(GAME.currentEvent.id==='goldrain'){
    GAME.eventSpawnTimer-=dt;
    if(GAME.eventSpawnTimer<=0){
      const o=firstFree(orbs);
      if(o){
        const a=rand(0,Math.PI*2),r=rand(80,Math.min(W,H)*.48);
        o.x=GAME.player.x+Math.cos(a)*r; o.y=GAME.player.y+Math.sin(a)*r;
        o.r=6; o.value=2; o.active=true;
      }
      GAME.eventSpawnTimer=.7;
    }
  }
  if(GAME.eventTimer<=0){ GAME.currentEvent=null; GAME.eventTimer=0; }
}

/* ============================================================
   升级卡片
   ============================================================ */
function buildCardPool(){
  const p = GAME.player;
  const pool = [...STAT_CARDS];
  for(const s of SKILL_CARDS){
    const lv = p.skills[s.id]||0;
    if(lv < s.maxLv) pool.push({
      id:s.id, name:s.name + (lv>0?` Lv.${lv+1}`:''), desc:s.desc, icon:s.icon,
      apply:pl=>{ pl.skills[s.id]=(pl.skills[s.id]||0)+1; }
    });
  }
  pool.push(...buildCharacterCards(p));
  pool.push(...buildSynergyCards(p));
  // 洗牌取3个不重复id
  const shuffled = pool.sort(()=>Math.random()-0.5);
  const chosen=[]; const seen=new Set();
  for(const c of shuffled){
    if(seen.has(c.id)) continue;
    seen.add(c.id); chosen.push(c);
    if(chosen.length>=3) break;
  }
  return chosen;
}

// 每个角色都有独立、可多次抽到的构筑卡。随着层数增加，攻击的数量、范围、
// 路径和命中方式都会变化，而不是只做简单数值加成。
function buildCharacterCards(p){
  const s=p.special, cards=[];
  const add=(id,name,desc,icon,key,max,apply)=>{ if(s[key]<max) cards.push({id,name:`${name} Lv.${s[key]+1}`,desc,icon,apply}); };
  if(p.def.id==='striker'){
    add('striker_pierce','破网射门','足球额外穿透 1 个敌人','⚽','pierce',4,pl=>pl.special.pierce++);
    add('striker_volley','连珠炮','每次射门额外发射一颗扇形足球','🔥','volley',2,pl=>pl.special.volley++);
    add('striker_power','爆杆抽射','精准射门伤害 +18%','💥','shotPower',4,pl=>pl.special.shotPower++);
  }else if(p.def.id==='defender'){
    add('defender_orbit','禁区铁壁','护体足球 +1 颗','🛡','orbitCount',3,pl=>pl.special.orbitCount++);
    add('defender_radius','防线扩张','足球环绕半径 +12','🌀','orbitRadius',4,pl=>pl.special.orbitRadius+=12);
    add('defender_spin','全力解围','环绕速度和撞击伤害提升','💪','orbitPower',4,pl=>{pl.special.orbitPower++;pl.special.orbitSpin+=.7;});
  }else if(p.def.id==='playmaker'){
    add('playmaker_bounce','一脚出球','手术刀传球额外弹射 1 次','✨','passBounce',4,pl=>pl.special.passBounce++);
    add('playmaker_extra','双线渗透','每轮额外放出一颗追踪足球','🎯','passExtra',2,pl=>pl.special.passExtra++);
    add('playmaker_power','穿透直塞','追踪足球伤害 +16%','🧠','passPower',4,pl=>pl.special.passPower++);
  }else if(p.def.id==='haaland'){
    add('haaland_pierce','攻城重炮','足球额外穿透 2 个敌人','🚀','pierce',4,pl=>pl.special.pierce+=2);
    add('haaland_power','雷霆抽射','重炮伤害 +22%','⚡','shotPower',4,pl=>pl.special.shotPower++);
    add('haaland_volley','双响重炮','每次射门额外发射一颗重炮','🔥','volley',2,pl=>pl.special.volley++);
  }
  return cards;
}

function buildSynergyCards(p){
  const cards=[];
  const add=(id,name,desc,icon,condition)=>{
    if(!p.synergies[id] && condition()) cards.push({id:`synergy_${id}`,name,desc,icon,apply:pl=>{pl.synergies[id]=true;}});
  };
  add('explosiveCurve','爆裂香蕉球','香蕉球落点追加一次爆炸伤害','🌋',()=>p.skills.banana&&p.skills.bottle);
  add('refereeLock','裁判禁区','黄牌发动时同步铺设强化越位陷阱','🚫',()=>p.skills.offside&&p.skills.yellow);
  add('steelCharge','钢铁冲锋','冲锋伤害提高，并在结束后延长无敌时间','🛡',()=>p.skills.charge&&p.statLevels.hp>0);
  add('fireNet','全自动火力网','自动射门额外发射 2 颗足球','⚽',()=>p.special.volley>0&&p.statLevels.atkspeed>0);
  return cards;
}

// 仅在 10 / 20 / 30 ... 级弹出的攻击进化池，不会混入普通的三选一卡。
function buildEvolutionCards(p){
  const e=p.evo, cards=[];
  const add=(id,name,desc,icon,key,apply)=>cards.push({id,name,desc,icon,apply:pl=>{ pl.evo[key]++; apply&&apply(pl); }});
  if(p.def.id==='striker'){
    add('evo_comet','彗星连射','普通射门额外发射 2 颗高速扇形足球','☄️','comet');
    add('evo_rail','霓虹穿云','足球变为青色高速射线，穿透 +3','⚡','rail');
    add('evo_meteor','陨星抽射','足球变大、伤害提升，并在命中时小范围爆裂','🌠','meteor');
  }else if(p.def.id==='defender'){
    add('evo_cyclone','飓风禁区','环绕足球 +2，获得青色能量光环','🌀','cyclone');
    add('evo_shockwave','大地解围','周期性释放击退周围敌人的冲击波','💠','shockwave');
    add('evo_bulwark','移动城墙','环绕半径扩大，足球体积随之提升','🏰','bulwark');
  }else if(p.def.id==='playmaker'){
    add('evo_prism','棱镜直塞','每轮额外发射 2 颗紫色追踪足球','🔮','prism');
    add('evo_chain','全场串联','追踪足球额外弹射 2 次','⛓️','chain');
    add('evo_nova','星爆传球','追踪足球变大，命中时触发小范围星爆','✨','nova');
  }else if(p.def.id==='haaland'){
    add('evo_h_comet','雷神齐射','重炮额外发射 2 颗扇形足球','🌩','comet');
    add('evo_h_rail','贯场炮击','重炮获得极高球速与额外穿透','🚄','rail');
    add('evo_h_meteor','禁区陨星','重炮变大并造成范围爆裂','☄️','meteor');
  }
  return cards;
}

function triggerLevelUp(){
  const p=GAME.player;
  const evolutionLevel=p.evolutionQueue.shift();
  GAME.isEvolutionChoice=!!evolutionLevel;
  GAME.evolutionLevel=evolutionLevel||0;
  GAME.currentCards=evolutionLevel ? buildEvolutionCards(p) : buildCardPool();
  GAME.state = 'levelup';
  playLevelUpSfx();
}

/* ============================================================
   屏幕震动
   ============================================================ */
function triggerShake(mag, t){
  GAME.shakeMag=Math.max(GAME.shakeMag,mag);
  GAME.shakeT=Math.max(GAME.shakeT,t);
  GAME.shakeDuration=Math.max(GAME.shakeDuration,t);
  GAME.shakePhase=Math.random()*Math.PI*2;
}

function spawnEnemyBall(e,angle,speed,damage,radius,color){
  const b=firstFree(bullets); if(!b) return;
  b.x=e.x; b.y=e.y; b.vx=Math.cos(angle)*speed; b.vy=Math.sin(angle)*speed;
  b.r=radius||6; b.dmg=damage; b.pierce=0; b.color=color||COL.red; b.life=3;
  b.fromPlayer=false; b.homing=false; b.target=null; b.bounce=0; b.lastHit=null;
  b.explode=false; b.explodeChance=0; b.splashRadius=0; b.active=true;
}

function moveEnemy(e,angle,speed,dt){
  let eventMul=1;
  if(GAME.currentEvent&&GAME.currentEvent.id==='rain') eventMul=.82;
  else if(GAME.currentEvent&&GAME.currentEvent.id==='extra') eventMul=1.18;
  if(e.commandBuffT>0) eventMul*=1.2;
  e.x+=Math.cos(angle)*speed*eventMul*dt;
  e.y+=Math.sin(angle)*speed*eventMul*dt;
}

function updateBossAI(e,dt,p){
  const profile=bossProfileById(e.bossId);
  const styles={
    curve:{count:12,speed:175,dmg:1,r:6,spread:.17},
    power:{count:8,speed:158,dmg:1.28,r:9,spread:.13},
    speed:{count:10,speed:225,dmg:.92,r:5,spread:.12},
    air:{count:12,speed:188,dmg:1.2,r:8,spread:.15},
    trick:{count:14,speed:172,dmg:1.04,r:6,spread:.2},
    control:{count:16,speed:148,dmg:1.08,r:7,spread:.16},
  };
  const style=styles[profile.pattern]||styles.curve;
  const hpRatio=e.hp/e.maxhp;
  const phase=hpRatio>.66?1:(hpRatio>.33?2:3);
  const toPlayer=Math.atan2(p.y-e.y,p.x-e.x);
  moveEnemy(e,toPlayer,e.speed*(phase===3?1.35:1),dt);
  e.bossTimer-=dt;
  if(e.bossTimer>0) return;
  e.aiPhase++;
  if(phase===1){
    const n=style.count,offset=(profile.pattern==='curve'||profile.pattern==='trick')?e.aiPhase*.18:0;
    for(let i=0;i<n;i++) spawnEnemyBall(e,offset+i*Math.PI*2/n,style.speed,(8+GAME.waveNumber*.35)*style.dmg,style.r,profile.accent);
    e.bossTimer=1.9;
  }else if(phase===2){
    if(e.aiPhase%2===0){
      const aimed=profile.pattern==='speed'?7:(profile.pattern==='power'?3:5);
      for(let i=0;i<aimed;i++) spawnEnemyBall(e,toPlayer+(i-(aimed-1)/2)*style.spread,style.speed*1.38,(9+GAME.waveNumber*.38)*style.dmg,style.r+1,profile.accent);
    }else{
      const n=style.count+2,offset=(e.aiPhase%4)*.16;
      for(let i=0;i<n;i++) spawnEnemyBall(e,offset+i*Math.PI*2/n,style.speed*1.08,(8+GAME.waveNumber*.35)*style.dmg,style.r,profile.accent);
    }
    e.bossTimer=1.45;
  }else{
    const n=style.count+4,offset=e.aiPhase*.22;
    for(let i=0;i<n;i++) spawnEnemyBall(e,offset+i*Math.PI*2/n,style.speed*1.18,(10+GAME.waveNumber*.4)*style.dmg,style.r+1,profile.accent);
    for(let i=-1;i<=1;i++) spawnEnemyBall(e,toPlayer+i*.12,style.speed*1.65,(12+GAME.waveNumber*.42)*style.dmg,style.r+2,profile.accent);
    if(e.aiPhase%3===0){
      const signature={messi:'dribbler',ronaldo9:'sweeper',mbappe:'winger',cr7:'tackler',ronaldinho:'passer',zidane:'commander'}[profile.id]||'winger';
      for(let i=0;i<3;i++) trySpawnEnemy(i===0?signature:'winger',GAME.waveNumber,e.x+rand(-90,90),e.y+rand(-90,90));
    }
    e.bossTimer=1.15;
  }
  spawnEffect('bossattack',e.x,e.y,e.r*1.5,.3,profile.accent);
  triggerShake(phase===3?8:5,.2);
}

function updateEnemyAI(e,dt,p){
  if(e.boss){ updateBossAI(e,dt,p); return; }
  e.aiTimer-=dt;
  if(e.commandBuffT>0) e.commandBuffT-=dt;
  const a=Math.atan2(p.y-e.y,p.x-e.x),d=dist(e.x,e.y,p.x,p.y);
  if(e.kind==='winger'){
    if(e.aiTimer<=0){ e.aiTimer=2.2; e.aiState='burst'; e.aiPhase=.55; }
    if(e.aiState==='burst'){
      e.aiPhase-=dt; moveEnemy(e,a,e.speed*1.9,dt);
      if(e.aiPhase<=0) e.aiState='chase';
    }else moveEnemy(e,a,e.speed,dt);
  }else if(e.kind==='tackler'){
    if(e.aiState==='windup'){
      e.aiPhase-=dt;
      if(e.aiPhase<=0){ e.aiState='dash'; e.aiPhase=.48; e.aiAngle=Math.atan2(p.y-e.y,p.x-e.x); }
    }else if(e.aiState==='dash'){
      e.aiPhase-=dt; moveEnemy(e,e.aiAngle,e.speed*4.2,dt);
      if(e.aiPhase<=0){ e.aiState='chase'; e.aiTimer=2.8; }
    }else{
      moveEnemy(e,a,e.speed,dt);
      if(e.aiTimer<=0){ e.aiState='windup'; e.aiPhase=.58; spawnEffect('warning',e.x,e.y,48,.58,'#C77DFF'); }
    }
  }else if(e.kind==='midfielder'){
    const moveA=d>250?a:(d<155?a+Math.PI:a+Math.PI/2);
    moveEnemy(e,moveA,e.speed,dt);
    if(e.aiTimer<=0){
      spawnEnemyBall(e,a,190,e.contactDmg*.85,6); e.aiTimer=2.1;
      spawnEffect('kick',e.x,e.y,28,.18,'#FF9B45');
    }
  }else if(e.kind==='keeper'){
    moveEnemy(e,a,e.speed,dt);
    if(e.aiTimer<=0){ e.shieldActive=!e.shieldActive; e.aiTimer=e.shieldActive?2.4:1.25; }
  }else if(e.kind==='commander'){
    moveEnemy(e,a,e.speed,dt);
    if(e.aiTimer<=0){
      for(const ally of enemies){
        if(ally.active&&!ally.boss&&ally!==e&&dist(ally.x,ally.y,e.x,e.y)<170) ally.commandBuffT=3.2;
      }
      spawnEffect('command',e.x,e.y,170,.45,'#62E7FF'); e.aiTimer=2.8;
    }
  }else if(e.kind==='dribbler'){
    e.aiAngle+=dt*5.2;
    moveEnemy(e,a+Math.sin(e.aiAngle)*.72,e.speed,dt);
  }else if(e.kind==='passer'){
    const moveA=d>260?a:(d<170?a+Math.PI:a+Math.PI/2);
    moveEnemy(e,moveA,e.speed,dt);
    if(e.aiTimer<=0){
      for(let i=-1;i<=1;i++) spawnEnemyBall(e,a+i*.18,176,e.contactDmg*.72,5,'#54C779');
      spawnEffect('pass',e.x,e.y,34,.2,'#54C779');e.aiTimer=2.45;
    }
  }else if(e.kind==='sweeper'){
    moveEnemy(e,a,e.speed,dt);
    if(e.aiTimer<=0){
      const radius=92;spawnEffect('sweep',e.x,e.y,radius,.38,'#BFC8CE');
      if(d<radius+p.r){damagePlayer(e.contactDmg*.55,.25);triggerShake(5,.16);}
      e.aiTimer=3.1;
    }
  }else if(e.kind==='medic'){
    const moveA=d>245?a:(d<165?a+Math.PI:a+Math.PI/2);
    moveEnemy(e,moveA,e.speed,dt);
    if(e.aiTimer<=0){
      for(const ally of enemies){
        if(ally.active&&!ally.boss&&dist(ally.x,ally.y,e.x,e.y)<155) ally.hp=Math.min(ally.maxhp,ally.hp+ally.maxhp*.1);
      }
      spawnEffect('heal',e.x,e.y,155,.48,'#62E58A');e.aiTimer=3.4;
    }
  }else{
    moveEnemy(e,a,e.speed,dt);
  }
}

/* ============================================================
   主更新
   ============================================================ */
function update(dt){
  if(GAME.hitstopT>0){ GAME.hitstopT -= dt; return; }
  if(GAME.shakeT>0) GAME.shakeT -= dt; else GAME.shakeMag=0;

  if(GAME.state !== 'playing'){
    // 粒子仍然可以缓慢淡出，保持画面不死
    updateParticlesOnly(dt);
    return;
  }

  const p = GAME.player;
  GAME.gameTime += dt;
  GAME.noDamageTime+=dt; GAME.maxNoDamageTime=Math.max(GAME.maxNoDamageTime,GAME.noDamageTime);
  if(GAME.comboTimer>0){ GAME.comboTimer-=dt; if(GAME.comboTimer<=0) GAME.combo=0; }
  GAME.frenzyT=Math.max(0,GAME.frenzyT-dt);
  GAME.pickupToastT=Math.max(0,GAME.pickupToastT-dt);
  p.speedBoostT=Math.max(0,p.speedBoostT-dt); p.attackBoostT=Math.max(0,p.attackBoostT-dt);
  p.magnetT=Math.max(0,p.magnetT-dt); p.critBoostT=Math.max(0,p.critBoostT-dt);
  updatePitchEvent(dt);

  // 摇杆移动（冲锋期间由 updateCharge 接管位移，摇杆输入暂时失效）
  if(p.dashT>0){
    p.vx=0; p.vy=0;
  } else if(joystick.active){
    const dx = joystick.curX-joystick.baseX, dy = joystick.curY-joystick.baseY;
    const len = Math.hypot(dx,dy);
    if(len>4){
      const nx=dx/len, ny=dy/len, mag=Math.min(len,joystick.maxR)/joystick.maxR;
      let moveMul=p.speedBoostT>0?1.28:1;
      if(GAME.frenzyT>0) moveMul*=1.12;
      if(GAME.currentEvent&&GAME.currentEvent.id==='rain') moveMul*=.82;
      p.vx = nx*p.speed*mag*moveMul; p.vy = ny*p.speed*mag*moveMul;
    } else { p.vx=0; p.vy=0; }
  } else { p.vx=0; p.vy=0; }
  p.x += p.vx*dt; p.y += p.vy*dt;
  p.invulnT = Math.max(0, p.invulnT-dt);
  p.atkAnimT = Math.max(0, p.atkAnimT-dt);
  // 移动时朝向跟随走位方向，站桩时保留最近一次起脚方向
  if(p.vx*p.vx+p.vy*p.vy > 900) p.facingAngle = Math.atan2(p.vy,p.vx);

  // 攻击
  let attackRate=1;
  if(p.attackBoostT>0) attackRate*=1.35;
  if(GAME.frenzyT>0) attackRate*=1.5;
  if(GAME.currentEvent&&GAME.currentEvent.id==='fans') attackRate*=1.3;
  p.atkTimer -= dt*attackRate;
  if(p.atkTimer<=0){ performAttack(); p.atkTimer = p.atkCooldown; }
  updateSkills(dt);
  updateOrbitBalls(dt);
  updateCharge(dt);
  updatePowerups(dt);

  // 陷阱
  for(const t of traps){
    if(!t.active) continue;
    t.life -= dt;
    if(t.life<=0){ t.active=false; continue; }
    for(const e of enemies){
      if(!e.active) continue;
      if(dist(e.x,e.y,t.x,t.y) < t.r+e.r) e.slowT = 0.25;
    }
  }

  // 子弹
  for(const b of bullets){
    if(!b.active) continue;
    if(b.homing && b.fromPlayer){
      if(!b.target || !b.target.active){ b.active=false; continue; }
      const a = Math.atan2(b.target.y-b.y, b.target.x-b.x);
      const spd=440;
      b.vx = Math.cos(a)*spd; b.vy = Math.sin(a)*spd;
    }
    b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
    if(b.life<=0){ b.active=false; continue; }
    if(b.fromPlayer){
      b.trailT-=dt;
      if(b.trailT<=0){ spawnBallTrail(b.x,b.y,b.trailColor,b.r*.7); b.trailT=.045; }
    }

    if(b.fromPlayer){
      for(const e of enemies){
        if(!e.active || e===b.lastHit) continue;
        if(dist(e.x,e.y,b.x,b.y) < b.r+e.r){
          damageEnemy(e, b.dmg, true, b.x-b.vx*dt, b.y-b.vy*dt);
          if(!e.affix || e.affix!=='armor'){
            const a = Math.atan2(e.y-b.y, e.x-b.x);
            e.x += Math.cos(a)*10; e.y += Math.sin(a)*10;
          }
          if(b.splashRadius>0){
            spawnEffect('evoNova',b.x,b.y,b.splashRadius,.24,b.color);
            for(const e2 of enemies){
              if(!e2.active || e2===e) continue;
              if(dist(e2.x,e2.y,b.x,b.y)<b.splashRadius+e2.r) damageEnemy(e2,b.dmg*.45,false,b.x,b.y);
            }
          }
          if(b.explode && Math.random()<b.explodeChance){
            spawnEffect('boom', b.x, b.y, 46, 0.3, COL.red);
            for(const e2 of enemies){
              if(!e2.active || e2===e) continue;
              if(dist(e2.x,e2.y,b.x,b.y) < 46+e2.r) damageEnemy(e2, GAME.player.dmg*0.55, true);
            }
          }
          b.lastHit = e;
          if(b.homing){
            b.bounce--;
            if(b.bounce<0){ b.active=false; }
            else { const nt=findNearestEnemy(b.x,b.y,e); if(nt) b.target=nt; else b.active=false; }
          } else {
            b.pierce--;
            if(b.pierce<0) b.active=false;
          }
          break;
        }
      }
    } else {
      if(dist(p.x,p.y,b.x,b.y) < b.r+p.r && p.invulnT<=0){
        damagePlayer(b.dmg,.35); triggerShake(6,0.18); b.active=false;
      }
    }
  }

  // 敌人
  for(const e of enemies){
    if(!e.active) continue;
    if(e.hitFlash>0) e.hitFlash -= dt;
    if(e.orbitHitT>0) e.orbitHitT -= dt;
    if(e.stunT>0){ e.stunT -= dt; }
    else if(e.slowT>0){
      const original=e.speed; e.speed*=.4; updateEnemyAI(e,dt,p); e.speed=original;
    }else updateEnemyAI(e,dt,p);
    // 受击击退：前段位移强、后段快速收束，视觉上像弹开而不是被持续推走。
    e.x += e.kx*dt; e.y += e.ky*dt;
    const knockProgress=e.knockDuration>0 ? 1-e.knockT/e.knockDuration : 1;
    const knockDamp=Math.pow(0.0007 + knockProgress*0.003,dt);
    e.kx*=knockDamp; e.ky*=knockDamp;
    e.knockT=Math.max(0,e.knockT-dt);
    if(e.slowT>0) e.slowT -= dt;

    // 接触伤害（持续）
    if(dist(e.x,e.y,p.x,p.y) < e.r+p.r){
      damagePlayer(e.contactDmg*dt,0);
    }
  }

  // 经验球
  for(const o of orbs){
    if(!o.active) continue;
    const d = dist(o.x,o.y,p.x,p.y);
    const pickupRange=p.magnetT>0?Math.max(W,H)*1.6:p.pickupRange;
    if(d < pickupRange){
      const a = Math.atan2(p.y-o.y, p.x-o.x);
      const sp = 260 + Math.max(0,pickupRange-d)*.18;
      o.x += Math.cos(a)*sp*dt; o.y += Math.sin(a)*sp*dt;
    }
    if(d < p.r+o.r){
      o.active=false;
      playPickupSfx();
      p.exp += o.value;
      while(p.exp >= p.expToNext){
        p.exp -= p.expToNext; p.level++; p.expToNext = Math.floor(p.expToNext*1.22+5);
        if(p.level%10===0) p.evolutionQueue.push(p.level);
        GAME.pendingLevelUps++;
      }
    }
  }
  if(GAME.pendingLevelUps>0){
    GAME.pendingLevelUps--;
    triggerLevelUp();
    return;
  }

  // 波次 / 生成
  if(!GAME.bossActive){
    GAME.spawnTimer -= dt;
    if(GAME.spawnTimer<=0){ spawnBatch(); GAME.spawnTimer = spawnInterval(); }
    GAME.waveTimer -= dt;
    if(GAME.waveTimer<=0){
      GAME.waveNumber++;
      if(GAME.waveNumber>GAME.bestWave){
        GAME.bestWave=GAME.waveNumber;
        wx.setStorageSync('wcs_best_wave', String(GAME.bestWave));
      }
      GAME.waveTimer = GAME.WAVE_DURATION;
      if(GAME.waveNumber%5===0){
        GAME.bossActive = true;
        trySpawnEnemy('boss', GAME.waveNumber);
      }else if(GAME.waveNumber%3===0){
        startPitchEvent();
      }
    }
  } else {
    // Boss 波：检查Boss是否还存在
    let alive=false;
    for(const e of enemies){ if(e.active && e.boss){ alive=true; break; } }
    if(!alive){ GAME.bossActive = false; GAME.bossRef=null; }
  }

  // 死亡判定
  if(p.hp<=0){
    p.hp = 0;
    if(!GAME.hasRevived){ GAME.state='revive'; }
    else {
      GAME.state='gameover';
      const score = computeScore();
      if(score>GAME.best){ GAME.best=score; wx.setStorageSync('wcs_best', String(score)); }
      awardCoins();
    }
  }

  updateParticlesOnly(dt);
}

function updateParticlesOnly(dt){
  for(const pt of particles){
    if(!pt.active) continue;
    pt.x+=pt.vx*dt; pt.y+=pt.vy*dt; pt.vx*=0.92; pt.vy*=0.92;
    pt.life-=dt; if(pt.life<=0) pt.active=false;
  }
  for(const t of damageTexts){
    if(!t.active) continue;
    t.x+=t.vx*dt; t.y+=t.vy*dt; t.vy+=150*dt; t.life-=dt;
    if(t.life<=0) t.active=false;
  }
  for(const ef of effects){
    if(!ef.active) continue;
    ef.life-=dt; if(ef.life<=0){ ef.active=false; continue; }
    const t = 1-(ef.life/ef.maxlife);
    ef.r = ef.maxr*t;
  }
}

function computeScore(){
  return Math.floor(GAME.gameTime*10 + GAME.waveNumber*100 + GAME.eliteKills*50 + GAME.maxCombo*8 + GAME.killCount*2);
}

// 局外货币：按存活时间/阵型/精英击杀结算，跨局持久化。
// 阵型奖励做成指数型曲线：前期给的少，越往后（对应怪物越强）给的越多。
// 具体消耗（商店）先不接入，这里只负责"赚"，为后续扩展预留字段。
function computeCoinsEarned(){
  const waveBonus = Math.pow(Math.max(0,GAME.waveNumber), 1.65) * 1.8;
  const timeBonus = GAME.gameTime * 0.25;
  const eliteBonus = GAME.eliteKills * 6;
  const styleBonus = GAME.maxCombo * .8;
  return Math.floor(waveBonus + timeBonus + eliteBonus + styleBonus);
}
function unlockRunAchievements(){
  let reward=0;
  for(const a of ACHIEVEMENTS){
    if(GAME.achievements.has(a.id)||!a.check(GAME)) continue;
    GAME.achievements.add(a.id); GAME.newAchievements.push(a.name); reward+=a.reward;
  }
  if(GAME.newAchievements.length) wx.setStorageSync('wcs_achievements',JSON.stringify([...GAME.achievements]));
  return reward;
}
function awardCoins(){
  if(GAME.coinsAwarded) return 0;
  const achievementReward=unlockRunAchievements();
  const earned = computeCoinsEarned()+achievementReward;
  GAME.coins += earned;
  wx.setStorageSync('wcs_coins', String(GAME.coins));
  const charId=GAME.player.def.id;
  GAME.mastery[charId]=(GAME.mastery[charId]||0)+Math.max(1,Math.floor(computeScore()/120));
  wx.setStorageSync('wcs_mastery',JSON.stringify(GAME.mastery));
  GAME.lastCoinsEarned = earned;
  GAME.coinsAwarded = true;
  return earned;
}

function finishRun(){
  clearJoystick();
  GAME.state = 'gameover';
  const score = computeScore();
  if(score > GAME.best){
    GAME.best = score;
    wx.setStorageSync('wcs_best', String(score));
  }
  awardCoins();
}

/* ============================================================
   渲染
   ============================================================ */
function drawBackground(){
  ctx.fillStyle = COL.pitchA;
  ctx.fillRect(0,0,W,H);
  const stripe = 64;
  const startI = Math.floor((GAME.camX-100)/stripe);
  const endI = Math.floor((GAME.camX+W+100)/stripe);
  for(let i=startI;i<=endI;i++){
    if(i%2===0){
      ctx.fillStyle = COL.pitchB;
      const sx = i*stripe - GAME.camX;
      ctx.fillRect(sx,0,stripe,H);
    }
  }
  // 中心圈地标（世界坐标原点）
  ctx.strokeStyle = COL.line; ctx.lineWidth=3;
  ctx.beginPath();
  ctx.arc(-GAME.camX, -GAME.camY, 90, 0, Math.PI*2);
  ctx.stroke();
  // 外圈网格地标，营造无限球场感
  ctx.lineWidth=2;
  for(let r=400; r<5200; r+=400){
    ctx.globalAlpha=0.25;
    ctx.beginPath();
    ctx.arc(-GAME.camX, -GAME.camY, r, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.globalAlpha=1;
  // 泛光灯氛围（角落压暗）
  const grad = ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.75);
  grad.addColorStop(0,'rgba(0,0,0,0)');
  grad.addColorStop(1,'rgba(0,0,0,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);
}

function toScreen(x,y){ return [x-GAME.camX, y-GAME.camY]; }

function drawTraps(){
  for(const t of traps){
    if(!t.active) continue;
    const [sx,sy]=toScreen(t.x,t.y);
    ctx.strokeStyle='rgba(216,178,58,0.7)'; ctx.setLineDash([6,5]); ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(sx,sy,t.r,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawOrbs(){
  for(const o of orbs){
    if(!o.active) continue;
    const [sx,sy]=toScreen(o.x,o.y);
    ctx.fillStyle = '#48B9FF';
    ctx.beginPath(); ctx.arc(sx,sy,o.r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.82)';ctx.beginPath();ctx.arc(sx-o.r*.3,sy-o.r*.32,Math.max(1,o.r*.28),0,Math.PI*2);ctx.fill();
  }
}

function drawPowerups(){
  for(const pu of powerups){
    if(!pu.active) continue;
    const [sx,sy]=toScreen(pu.x,pu.y),def=POWERUP_DEFS[pu.type];
    const pulse=1+Math.sin(pu.pulse)*.1;
    ctx.save(); ctx.translate(sx,sy); ctx.scale(pulse,pulse);
    ctx.globalAlpha=.22; ctx.fillStyle=def.color; ctx.beginPath();ctx.arc(0,0,pu.r*1.8,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1; ctx.fillStyle='rgba(8,34,43,.92)';ctx.beginPath();ctx.arc(0,0,pu.r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=def.color;ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle=def.color;ctx.textAlign='center';ctx.font='bold 13px sans-serif';ctx.fillText(def.icon,0,5);
    ctx.restore();
  }
}

function drawEnemyBackdrop(e,sx,sy){
  const r=e.r;
  ctx.save();
  if(e.kind==='winger'){
    ctx.strokeStyle='rgba(98,231,255,.62)';ctx.lineWidth=Math.max(1.5,r*.13);
    for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(sx-r*1.55,sy+i*r*.38);ctx.lineTo(sx-r*(.86+i*.08),sy+i*r*.25);ctx.stroke();}
  }
  if(e.kind==='commander'){
    ctx.globalAlpha=.16;ctx.fillStyle='#62E7FF';ctx.beginPath();ctx.arc(sx,sy,170,0,Math.PI*2);ctx.fill();
  }
  if(e.kind==='dribbler'){
    ctx.fillStyle='rgba(255,105,195,.5)';for(let i=1;i<=3;i++){ctx.beginPath();ctx.arc(sx-r*(.75+i*.32),sy+Math.sin(e.aiAngle-i)*r*.42,Math.max(1.5,r*.11),0,Math.PI*2);ctx.fill();}
  }
  if(e.kind==='medic'){
    ctx.globalAlpha=.12;ctx.fillStyle='#62E58A';ctx.beginPath();ctx.arc(sx,sy,r*1.7,0,Math.PI*2);ctx.fill();
  }
  if(e.boss){
    const pulse=1+Math.sin(GAME.gameTime*5)*.08;
    ctx.globalAlpha=.16;ctx.fillStyle=COL.bossGold;ctx.beginPath();ctx.arc(sx,sy,r*1.55*pulse,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawEnemyTypeDetails(e,sx,sy){
  const r=e.r,headY=sy-r*.28;
  ctx.save();
  if(e.boss){
    // Boss：金色三尖王冠和红色宝石。
    ctx.fillStyle=COL.bossGold;ctx.beginPath();ctx.moveTo(sx-r*.72,headY-r*.75);ctx.lineTo(sx-r*.5,headY-r*1.2);ctx.lineTo(sx-r*.16,headY-r*.84);ctx.lineTo(sx,headY-r*1.34);ctx.lineTo(sx+r*.18,headY-r*.84);ctx.lineTo(sx+r*.52,headY-r*1.2);ctx.lineTo(sx+r*.72,headY-r*.75);ctx.closePath();ctx.fill();
    ctx.fillStyle=COL.red;ctx.beginPath();ctx.arc(sx,headY-r*.98,r*.11,0,Math.PI*2);ctx.fill();
  }else if(isPortraitReady(e.kind)){
    // 精灵图本身已经包含职业装备；这里只保留下面的精英标记和职业标签。
  }else if(e.kind==='brute'){
    // 重装：护肩与粗黑头带。
    ctx.fillStyle='#26343D';ctx.beginPath();ctx.arc(sx-r*.78,sy+r*.46,r*.34,0,Math.PI*2);ctx.arc(sx+r*.78,sy+r*.46,r*.34,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#18242B';roundRect(sx-r*.82,headY-r*.5,r*1.64,r*.24,r*.08);ctx.fill();
  }else if(e.kind==='winger'){
    // 边锋：青色流线发带和侧翼标记。
    ctx.fillStyle='#62E7FF';ctx.beginPath();ctx.moveTo(sx-r*.78,headY-r*.58);ctx.lineTo(sx+r*.92,headY-r*.34);ctx.lineTo(sx+r*.66,headY-r*.08);ctx.lineTo(sx-r*.72,headY-r*.36);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#D8FFFF';ctx.lineWidth=Math.max(1,r*.1);ctx.beginPath();ctx.moveTo(sx+r*.62,sy+r*.34);ctx.lineTo(sx+r*1.03,sy+r*.12);ctx.lineTo(sx+r*.88,sy+r*.5);ctx.stroke();
  }else if(e.kind==='tackler'){
    // 铲球手：紫色护头与警示三角。
    ctx.strokeStyle='#C77DFF';ctx.lineWidth=Math.max(2,r*.18);ctx.beginPath();ctx.arc(sx,headY-r*.08,r*.84,Math.PI*1.08,Math.PI*1.92);ctx.stroke();
    ctx.fillStyle='#C77DFF';ctx.beginPath();ctx.moveTo(sx,sy+r*.38);ctx.lineTo(sx-r*.2,sy+r*.72);ctx.lineTo(sx+r*.2,sy+r*.72);ctx.closePath();ctx.fill();
  }else if(e.kind==='midfielder'){
    // 中场：橙色战术目镜与胸前准星。
    ctx.strokeStyle='#FF9B45';ctx.lineWidth=Math.max(1.5,r*.12);ctx.beginPath();ctx.arc(sx+r*.32,headY+r*.05,r*.25,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-r*.68,headY-r*.15);ctx.lineTo(sx+r*.08,headY-r*.02);ctx.stroke();
    ctx.beginPath();ctx.arc(sx,sy+r*.63,r*.16,0,Math.PI*2);ctx.moveTo(sx-r*.25,sy+r*.63);ctx.lineTo(sx+r*.25,sy+r*.63);ctx.moveTo(sx,sy+r*.38);ctx.lineTo(sx,sy+r*.88);ctx.stroke();
  }else if(e.kind==='keeper'){
    // 门将：亮色帽檐和两只白色手套。
    ctx.fillStyle='#F4C542';ctx.beginPath();ctx.arc(sx,headY-r*.58,r*.66,Math.PI,Math.PI*2);ctx.fill();
    roundRect(sx-r*.68,headY-r*.54,r*1.36,r*.16,r*.06);ctx.fill();
    ctx.fillStyle='#F2F0E6';roundRect(sx-r*1.02,sy+r*.22,r*.32,r*.42,r*.1);ctx.fill();roundRect(sx+r*.7,sy+r*.22,r*.32,r*.42,r*.1);ctx.fill();
  }else if(e.kind==='commander'){
    // 指挥官：蓝色队长帽与 C 字徽章。
    ctx.fillStyle='#62E7FF';ctx.beginPath();ctx.moveTo(sx-r*.72,headY-r*.58);ctx.lineTo(sx+r*.72,headY-r*.58);ctx.lineTo(sx+r*.55,headY-r*.22);ctx.lineTo(sx-r*.55,headY-r*.22);ctx.closePath();ctx.fill();
    ctx.fillStyle='#08222B';ctx.textAlign='center';ctx.font=`bold ${Math.max(8,r*.65)}px sans-serif`;ctx.fillText('C',sx,sy+r*.78);
  }else if(e.kind==='dribbler'){
    // 盘带手：粉色卷发、头带和脚边小球。
    ctx.fillStyle='#FF69C3';for(let i=-2;i<=2;i++){ctx.beginPath();ctx.arc(sx+i*r*.26,headY-r*.66-Math.abs(i)*r*.03,r*.23,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#F2F0E6';roundRect(sx-r*.78,headY-r*.45,r*1.56,r*.12,r*.05);ctx.fill();
    drawFootball(sx+r*.55,sy+r*.88,Math.max(3,r*.22));
  }else if(e.kind==='passer'){
    // 传球手：绿色双镜片和向两侧展开的传球箭头。
    ctx.strokeStyle='#54C779';ctx.lineWidth=Math.max(1.5,r*.12);ctx.beginPath();ctx.arc(sx-r*.31,headY+r*.04,r*.22,0,Math.PI*2);ctx.arc(sx+r*.31,headY+r*.04,r*.22,0,Math.PI*2);ctx.moveTo(sx-r*.09,headY+r*.04);ctx.lineTo(sx+r*.09,headY+r*.04);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx,sy+r*.62);ctx.lineTo(sx-r*.42,sy+r*.42);ctx.moveTo(sx-r*.42,sy+r*.42);ctx.lineTo(sx-r*.3,sy+r*.68);ctx.moveTo(sx,sy+r*.62);ctx.lineTo(sx+r*.42,sy+r*.42);ctx.moveTo(sx+r*.42,sy+r*.42);ctx.lineTo(sx+r*.3,sy+r*.68);ctx.stroke();
  }else if(e.kind==='sweeper'){
    // 清道夫：钢灰护额、大盾和加宽肩甲。
    ctx.fillStyle='#BFC8CE';roundRect(sx-r*.86,headY-r*.56,r*1.72,r*.22,r*.08);ctx.fill();
    ctx.fillStyle='#38464F';ctx.beginPath();ctx.arc(sx-r*.8,sy+r*.46,r*.36,0,Math.PI*2);ctx.arc(sx+r*.8,sy+r*.46,r*.36,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#E2E8EB';ctx.lineWidth=Math.max(2,r*.14);roundRect(sx+r*.56,sy+r*.08,r*.46,r*.76,r*.15);ctx.stroke();
  }else if(e.kind==='medic'){
    // 队医：白色医疗帽和绿色十字标志。
    ctx.fillStyle='#F2F0E6';ctx.beginPath();ctx.arc(sx,headY-r*.55,r*.68,Math.PI,Math.PI*2);ctx.fill();
    ctx.fillStyle='#35B86B';ctx.fillRect(sx-r*.08,headY-r*.63,r*.16,r*.42);ctx.fillRect(sx-r*.21,headY-r*.5,r*.42,r*.16);
    ctx.fillRect(sx-r*.09,sy+r*.42,r*.18,r*.48);ctx.fillRect(sx-r*.24,sy+r*.57,r*.48,r*.18);
  }

  if(e.elite&&!e.boss){
    ctx.fillStyle=COL.eliteRed;ctx.beginPath();ctx.moveTo(sx+r*.72,headY-r*.72);ctx.lineTo(sx+r*.96,headY-r*.48);ctx.lineTo(sx+r*.72,headY-r*.24);ctx.lineTo(sx+r*.48,headY-r*.48);ctx.closePath();ctx.fill();
  }

  if(!e.boss&&e.kind!=='grunt'){
    const labels={brute:'重装',winger:'边锋',tackler:'铲球手',midfielder:'远射中场',keeper:'门将',commander:'指挥官',dribbler:'盘带手',passer:'传球手',sweeper:'清道夫',medic:'队医'};
    const colors={brute:'#26343D',winger:'#168F91',tackler:'#8E44AD',midfielder:'#D35400',keeper:'#B28A05',commander:'#277D9B',dribbler:'#B73A8A',passer:'#278D58',sweeper:'#52616B',medic:'#26985A'};
    const label=labels[e.kind]||'敌军';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
    const w=ctx.measureText(label).width+10,y=sy+r+8;
    ctx.fillStyle=colors[e.kind]||'#26343D';roundRect(sx-w/2,y,w,15,7);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillText(label,sx,y+11);
  }
  ctx.restore();
}

function drawEnemies(){
  for(const e of enemies){
    if(!e.active) continue;
    const [sx,sy]=toScreen(e.x,e.y);
    const portraitStyle=e.boss?(e.bossId||'messi'):(e.kind==='grunt'?'enemy':e.kind);
    const portraitReady=isPortraitReady(portraitStyle);
    drawEnemyBackdrop(e,sx,sy);
    drawBigHead(sx,sy,e.r,e.color,portraitStyle);
    // Canvas 2D 没有精灵 Shader 时，用一层白色轮廓覆盖整个角色；
    // 0.10 秒内以 ease-out 淡出，连脸、头发和球衣都会同时闪白。
    if(e.hitFlash>0){
      const flashAlpha=Math.min(1,e.hitFlash/0.10);
      ctx.save(); ctx.globalAlpha=flashAlpha*.92; ctx.fillStyle='#fff';
      if(portraitReady){
        ctx.beginPath();ctx.arc(sx,sy-e.r*.28,e.r*1.08,0,Math.PI*2);ctx.fill();
      }else{
        ctx.beginPath(); ctx.arc(sx,sy-e.r*.28,e.r*.96,0,Math.PI*2); ctx.fill();
        roundRect(sx-e.r*.74,sy+e.r*.15,e.r*1.48,e.r*.94,e.r*.28); ctx.fill();
      }
      ctx.restore();
    }
    drawEnemyTypeDetails(e,sx,sy);
    ctx.save();
    if(e.boss || e.elite){
      ctx.beginPath(); ctx.arc(sx,sy-e.r*.28,e.r*(portraitReady?1.11:1.04),0,Math.PI*2);
      ctx.strokeStyle = e.boss ? COL.chalk : COL.eliteRed;
      ctx.lineWidth = e.boss ? 3 : 2.5; ctx.stroke();
    }
    if(e.stunT>0){
      ctx.fillStyle = COL.yellow;
      ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
      ctx.fillText('★', sx, sy-e.r-8);
    }
    if(e.kind==='keeper'&&e.shieldActive){
      ctx.strokeStyle=COL.yellow;ctx.lineWidth=4;ctx.beginPath();ctx.arc(sx,sy,e.r*1.35,-Math.PI*.85,Math.PI*.15);ctx.stroke();
    }
    if(e.kind==='tackler'&&e.aiState==='windup'){
      ctx.fillStyle='#C77DFF';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText('!',sx,sy-e.r-13);
    }
    if(e.commandBuffT>0){
      ctx.strokeStyle='#62E7FF';ctx.lineWidth=2;ctx.beginPath();ctx.arc(sx,sy,e.r*1.25,0,Math.PI*2);ctx.stroke();
    }
    if(e.boss){
      const phase=e.hp/e.maxhp>.66?1:(e.hp/e.maxhp>.33?2:3);
      const profile=bossProfileById(e.bossId);
      ctx.fillStyle=profile.accent;ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(e.bossName||profile.shortName,sx,sy+e.r+20);
      ctx.fillStyle=COL.chalk;ctx.font='bold 10px sans-serif';ctx.fillText(`PHASE ${phase}`,sx,sy+e.r+34);
    }
    ctx.restore();
    // 血条
    if(e.hp<e.maxhp){
      const w=e.r*2, hh=4;
      const [bx,by]=[sx-e.r, sy-e.r-10];
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx,by,w,hh);
      ctx.fillStyle = e.boss?COL.bossGold:COL.hpGreen;
      ctx.fillRect(bx,by,w*Math.max(0,e.hp/e.maxhp),hh);
    }
  }
}

function drawBullets(){
  for(const b of bullets){
    if(!b.active) continue;
    const [sx,sy]=toScreen(b.x,b.y);
    if(b.fromPlayer){
      // 进化后的彩色拖尾配合低成本圆形光晕：仅多一次 fill，不增加贴图或粒子数量。
      if(b.trailColor!=='rgba(235,250,255,.8)'){
        ctx.save(); ctx.globalAlpha=.28; ctx.fillStyle=b.color; ctx.beginPath();ctx.arc(sx,sy,b.r*2.3,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      drawFootball(sx,sy,b.r);
    }
    else { ctx.fillStyle=b.color; ctx.beginPath();ctx.arc(sx,sy,b.r,0,Math.PI*2);ctx.fill(); }
  }
}

function drawParticles(){
  for(const pt of particles){
    if(!pt.active) continue;
    const [sx,sy]=toScreen(pt.x,pt.y);
    ctx.globalAlpha = Math.max(0,pt.life/pt.maxlife);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(sx,sy,pt.r,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }
}

function drawDamageTexts(){
  for(const t of damageTexts){
    if(!t.active) continue;
    const [sx,sy]=toScreen(t.x,t.y), progress=1-t.life/t.maxlife;
    const alpha=Math.max(0,1-progress*progress);
    // 开头快速放大再回弹，结尾平滑消失；不需要每字创建动画对象。
    const pop=1 + (t.crit ? .48 : .28)*Math.sin(Math.min(1,progress/.32)*Math.PI);
    ctx.save(); ctx.globalAlpha=alpha; ctx.textAlign='center'; ctx.translate(sx,sy); ctx.scale(pop,pop);
    ctx.font=`bold ${t.crit?18:14}px sans-serif`;
    const label=`${t.crit?'! ':''}${t.value}`;
    ctx.lineWidth=3; ctx.strokeStyle='rgba(7,22,28,.82)'; ctx.strokeText(label,0,0);
    ctx.fillStyle=t.crit?'#FFD85A':'#FFFFFF'; ctx.fillText(label,0,0); ctx.restore();
  }
}

function drawEffects(){
  for(const ef of effects){
    if(!ef.active) continue;
    const [sx,sy]=toScreen(ef.x,ef.y);
    const alpha = Math.max(0, ef.life/ef.maxlife);
    ctx.globalAlpha = alpha*0.8;
    ctx.strokeStyle = ef.color; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(sx,sy,ef.r,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1;
  }
}

function drawFootball(x,y,r){
  ctx.save();
  ctx.fillStyle=COL.chalk; ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#233640';ctx.lineWidth=Math.max(1,r*.16);ctx.stroke();
  ctx.fillStyle='#233640';ctx.beginPath();
  for(let i=0;i<5;i++){const a=-Math.PI/2+i*Math.PI*2/5,px=x+Math.cos(a)*r*.42,py=y+Math.sin(a)*r*.42;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();
  ctx.restore();
}

function isPortraitReady(style){
  const entry=PORTRAIT_MAP[style],sheet=entry&&PORTRAIT_SHEETS[entry.sheet];
  return !!(sheet&&sheet.loaded&&sheet.image&&(sheet.image.naturalWidth||sheet.image.width));
}

function drawPortraitIcon(x,y,r,style){
  const entry=PORTRAIT_MAP[style],sheet=entry&&PORTRAIT_SHEETS[entry.sheet];
  if(!sheet||!sheet.loaded||!sheet.image) return false;
  const image=sheet.image,imageW=image.naturalWidth||image.width,imageH=image.naturalHeight||image.height;
  if(!imageW||!imageH) return false;

  const cellW=imageW/sheet.cols,cellH=imageH/sheet.rows;
  const side=Math.min(cellW,cellH)*(sheet.crop||1);
  const rowOffset=(sheet.rowOffsets&&sheet.rowOffsets[entry.row]||0)*cellH;
  const sourceX=(entry.col+.5)*cellW-side/2;
  const sourceY=(entry.row+.5)*cellH+rowOffset-side/2;
  const iconR=r*1.08,centerY=y-r*.28;

  ctx.save();
  ctx.beginPath();ctx.arc(x,centerY,iconR,0,Math.PI*2);ctx.clip();
  ctx.imageSmoothingEnabled=true;
  if('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,sourceX,sourceY,side,side,x-iconR,centerY-iconR,iconR*2,iconR*2);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle=sheet===PORTRAIT_SHEETS.bosses?COL.bossGold:'rgba(242,240,230,.86)';
  ctx.lineWidth=Math.max(1.2,r*.08);ctx.beginPath();ctx.arc(x,centerY,iconR,0,Math.PI*2);ctx.stroke();
  ctx.restore();
  return true;
}

function drawBigHead(x,y,r,jersey,style){
  if(drawPortraitIcon(x,y,r,style)) return;
  const isEnemy=style==='enemy';
  const looks={
    striker:{skin:'#C9825D',hair:'#18181C',accent:'#D7A727',eye:'#241A18',number:'10',faceW:.96},
    defender:{skin:'#A86545',hair:'#171516',accent:'#34231E',eye:'#201716',number:'2',faceW:1.0},
    playmaker:{skin:'#F0C5A2',hair:'#8B5B38',accent:'#B47A49',eye:'#35516A',number:'10',faceW:.9},
    haaland:{skin:'#F2C7AA',hair:'#E1C05E',accent:'#F2DC86',eye:'#4F7897',number:'9',faceW:1.04},
    messi:{skin:'#E8B18A',hair:'#30231F',accent:'#6E4333',eye:'#3C3029',number:'10',faceW:.94},
    ronaldo9:{skin:'#A96945',hair:'#171516',accent:'#2B201D',eye:'#29201D',number:'9',faceW:1.04},
    mbappe:{skin:'#8B563C',hair:'#171516',accent:'#2A211E',eye:'#201716',number:'10',faceW:1.02},
    cr7:{skin:'#C9825D',hair:'#1B191C',accent:'#51332A',eye:'#2A2420',number:'7',faceW:.98},
    ronaldinho:{skin:'#925B3C',hair:'#1B1718',accent:'#33251F',eye:'#241B18',number:'10',faceW:1},
    zidane:{skin:'#D7A47F',hair:'#5C493D',accent:'#6E4A3B',eye:'#33485B',number:'10',faceW:1.02},
    enemy:{skin:'#E5B188',hair:'#4B2E27',accent:'#36201D',eye:'#172530',number:'',faceW:1},
  };
  const look=looks[style]||looks.enemy,headR=r*.92,headY=y-r*.28;
  ctx.save();

  // 球衣、领口和号码：选人卡与局内模型使用完全相同的卡通形象。
  ctx.fillStyle=jersey;roundRect(x-r*.74,y+r*.18,r*1.48,r*.88,r*.28);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.78)';ctx.beginPath();ctx.moveTo(x-r*.28,y+r*.19);ctx.lineTo(x,y+r*.43);ctx.lineTo(x+r*.28,y+r*.19);ctx.lineTo(x+r*.15,y+r*.19);ctx.lineTo(x,y+r*.32);ctx.lineTo(x-r*.15,y+r*.19);ctx.closePath();ctx.fill();
  if(!isEnemy){
    ctx.fillStyle='rgba(255,255,255,.9)';ctx.textAlign='center';ctx.font=`bold ${Math.max(7,r*.52)}px sans-serif`;ctx.fillText(look.number,x,y+r*.78);
  }
  ctx.fillStyle=look.skin;ctx.fillRect(x-r*.18,y+r*.06,r*.36,r*.3);

  // 长发和马尾需要先画在脸部后方。
  if(style==='playmaker'){
    ctx.fillStyle=look.hair;roundRect(x-headR*1.02,headY-headR*.32,headR*.3,headR*1.25,headR*.13);ctx.fill();
    roundRect(x+headR*.72,headY-headR*.32,headR*.3,headR*1.25,headR*.13);ctx.fill();
  }else if(style==='haaland'){
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x+headR*.78,headY-headR*.48,headR*.34,0,Math.PI*2);ctx.fill();
    roundRect(x+headR*.72,headY-headR*.46,headR*.28,headR*1.22,headR*.14);ctx.fill();
  }else if(style==='ronaldinho'){
    ctx.fillStyle=look.hair;
    for(let i=-3;i<=3;i++){roundRect(x+i*headR*.23-headR*.08,headY-headR*.3,headR*.16,headR*1.42,headR*.08);ctx.fill();}
  }

  // 不同脸宽和肤色建立第一层辨识度。
  ctx.save();ctx.translate(x,headY);ctx.scale(look.faceW,1);ctx.fillStyle=look.skin;
  ctx.beginPath();ctx.arc(0,0,headR,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(35,29,24,.5)';ctx.lineWidth=1.3;ctx.stroke();ctx.restore();
  ctx.fillStyle=look.skin;ctx.beginPath();ctx.arc(x-headR*look.faceW,headY,headR*.16,0,Math.PI*2);ctx.arc(x+headR*look.faceW,headY,headR*.16,0,Math.PI*2);ctx.fill();

  if(isEnemy){
    // 敌人继续使用低成本统一短发，避免同屏大量角色造成额外绘制压力。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.22,headR*.94,Math.PI*.95,Math.PI*2.05);ctx.lineTo(x+headR*.72,headY-headR*.04);ctx.quadraticCurveTo(x,headY-headR*.55,x-headR*.74,headY-headR*.04);ctx.closePath();ctx.fill();
  }else if(style==='striker'){
    // 内马尔：两侧渐短、顶部卷发、金色挑染和耳钉。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.3,headR*.9,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.62,headY-headR*.07);ctx.quadraticCurveTo(x,headY-headR*.52,x-headR*.62,headY-headR*.07);ctx.closePath();ctx.fill();
    for(let i=-2;i<=2;i++){ctx.beginPath();ctx.arc(x+i*headR*.24,headY-headR*(.73+Math.abs(i)*.03),headR*.24,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle=look.accent;ctx.lineWidth=Math.max(1.5,r*.12);ctx.beginPath();ctx.moveTo(x-headR*.32,headY-headR*.85);ctx.quadraticCurveTo(x,headY-headR*1.02,x+headR*.3,headY-headR*.78);ctx.stroke();
    ctx.fillStyle='#D8B23A';ctx.beginPath();ctx.arc(x-headR*1.02,headY+headR*.12,headR*.075,0,Math.PI*2);ctx.fill();
  }else if(style==='defender'){
    // 哈基米：紧贴头皮的短发、清晰发际线和修整过的短胡须。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.27,headR*.91,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.7,headY-headR*.06);ctx.lineTo(x+headR*.3,headY-headR*.18);ctx.lineTo(x,headY-headR*.1);ctx.lineTo(x-headR*.3,headY-headR*.18);ctx.lineTo(x-headR*.7,headY-headR*.06);ctx.closePath();ctx.fill();
  }else if(style==='playmaker'){
    // 莫德里奇：中分浅棕长发和细发带。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.3,headR*.96,Math.PI*.96,Math.PI*2.04);ctx.lineTo(x+headR*.74,headY);ctx.quadraticCurveTo(x+headR*.24,headY-headR*.68,x,headY-headR*.55);ctx.quadraticCurveTo(x-headR*.25,headY-headR*.68,x-headR*.74,headY);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#E9E4D4';ctx.lineWidth=Math.max(1.5,r*.1);ctx.beginPath();ctx.arc(x,headY-headR*.2,headR*.8,Math.PI*1.02,Math.PI*1.98);ctx.stroke();
    ctx.strokeStyle=look.accent;ctx.lineWidth=Math.max(1,r*.08);ctx.beginPath();ctx.moveTo(x,headY-headR*.93);ctx.lineTo(x,headY-headR*.45);ctx.stroke();
  }else if(style==='haaland'){
    // 哈兰德：浅金色中长发、后束马尾和明显中分。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.28,headR*.96,Math.PI*.96,Math.PI*2.04);ctx.lineTo(x+headR*.72,headY+headR*.22);ctx.quadraticCurveTo(x+headR*.34,headY-headR*.66,x,headY-headR*.5);ctx.quadraticCurveTo(x-headR*.25,headY-headR*.62,x-headR*.75,headY+headR*.12);ctx.closePath();ctx.fill();
    ctx.strokeStyle=look.accent;ctx.lineWidth=Math.max(1,r*.08);ctx.beginPath();ctx.moveTo(x,headY-headR*.9);ctx.lineTo(x,headY-headR*.42);ctx.stroke();
    ctx.fillStyle='#2E5366';roundRect(x-headR*.76,headY-headR*.52,headR*1.52,headR*.12,headR*.05);ctx.fill();
  }else if(style==='messi'){
    // 梅西：短侧分深棕发与整齐短胡须。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.28,headR*.94,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.7,headY-headR*.02);ctx.quadraticCurveTo(x+headR*.18,headY-headR*.74,x-headR*.72,headY-headR*.12);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#8C5B3E';ctx.lineWidth=Math.max(1,r*.07);ctx.beginPath();ctx.moveTo(x-headR*.26,headY-headR*.84);ctx.lineTo(x+headR*.1,headY-headR*.72);ctx.stroke();
  }else if(style==='ronaldo9'){
    // 罗纳尔多：标志性光头与额前小块短发。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.83,headR*.26,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.2,headY-headR*.62);ctx.lineTo(x-headR*.18,headY-headR*.62);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(35,29,24,.28)';ctx.lineWidth=Math.max(1,r*.05);ctx.beginPath();ctx.arc(x,headY-headR*.08,headR*.82,Math.PI*1.05,Math.PI*1.95);ctx.stroke();
  }else if(style==='mbappe'){
    // 姆巴佩：紧贴头皮的黑色短寸。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.3,headR*.9,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.7,headY-headR*.1);ctx.quadraticCurveTo(x,headY-headR*.38,x-headR*.7,headY-headR*.1);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#62E7FF';ctx.lineWidth=Math.max(1,r*.07);ctx.beginPath();ctx.moveTo(x-headR*.65,headY-headR*.4);ctx.lineTo(x+headR*.65,headY-headR*.4);ctx.stroke();
  }else if(style==='cr7'){
    // C罗：向上定型的黑色尖刺发型。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.moveTo(x-headR*.72,headY-headR*.08);ctx.lineTo(x-headR*.62,headY-headR*.74);ctx.lineTo(x-headR*.3,headY-headR*.58);ctx.lineTo(x-headR*.12,headY-headR*1.02);ctx.lineTo(x+headR*.12,headY-headR*.62);ctx.lineTo(x+headR*.42,headY-headR*.96);ctx.lineTo(x+headR*.72,headY-headR*.12);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#D7A727';ctx.lineWidth=Math.max(1,r*.06);ctx.beginPath();ctx.moveTo(x+headR*.18,headY-headR*.84);ctx.lineTo(x+headR*.42,headY-headR*.62);ctx.stroke();
  }else if(style==='ronaldinho'){
    // 罗纳尔迪尼奥：长辫、白色发带和宽阔笑容。
    ctx.fillStyle=look.hair;ctx.beginPath();ctx.arc(x,headY-headR*.28,headR*.94,Math.PI,Math.PI*2);ctx.lineTo(x+headR*.72,headY);ctx.lineTo(x-headR*.72,headY);ctx.closePath();ctx.fill();
    ctx.fillStyle='#F2F0E6';roundRect(x-headR*.8,headY-headR*.55,headR*1.6,headR*.14,headR*.06);ctx.fill();
  }else if(style==='zidane'){
    // 齐达内：光头、两侧短发与下巴短须。
    ctx.strokeStyle=look.hair;ctx.lineWidth=Math.max(2,r*.12);ctx.beginPath();ctx.arc(x,headY-headR*.02,headR*.84,Math.PI*.82,Math.PI*1.12);ctx.moveTo(x+headR*.84,headY);ctx.arc(x,headY-headR*.02,headR*.84,Math.PI*1.88,Math.PI*2.18);ctx.stroke();
  }

  // 眉眼、鼻子和嘴部。
  const eyeY=headY+headR*.06,eyeGap=headR*.34;
  ctx.strokeStyle=look.hair;ctx.lineWidth=Math.max(1.2,r*.09);ctx.beginPath();ctx.moveTo(x-eyeGap-headR*.16,eyeY-headR*.22);ctx.lineTo(x-eyeGap+headR*.14,eyeY-headR*.25);ctx.moveTo(x+eyeGap-headR*.14,eyeY-headR*.25);ctx.lineTo(x+eyeGap+headR*.16,eyeY-headR*.22);ctx.stroke();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-eyeGap,eyeY,headR*.19,0,Math.PI*2);ctx.arc(x+eyeGap,eyeY,headR*.19,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=look.eye;ctx.beginPath();ctx.arc(x-eyeGap,eyeY+headR*.02,headR*.09,0,Math.PI*2);ctx.arc(x+eyeGap,eyeY+headR*.02,headR*.09,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(119,67,54,.72)';ctx.lineWidth=Math.max(1,r*.07);ctx.beginPath();ctx.moveTo(x,headY+headR*.12);ctx.lineTo(x-headR*.06,headY+headR*.27);ctx.lineTo(x+headR*.06,headY+headR*.28);ctx.stroke();

  if(style==='defender'||style==='messi'){
    ctx.fillStyle=look.accent;ctx.globalAlpha=.88;ctx.beginPath();ctx.arc(x,headY+headR*.35,headR*.55,0,Math.PI);ctx.lineTo(x-headR*.52,headY+headR*.24);ctx.quadraticCurveTo(x,headY+headR*.68,x+headR*.52,headY+headR*.24);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle='#7B3E34';ctx.beginPath();ctx.arc(x,headY+headR*.36,headR*.22,.18,Math.PI-.18);ctx.stroke();
  }else{
    ctx.strokeStyle='#9E584B';ctx.lineWidth=Math.max(1.2,r*.09);ctx.beginPath();ctx.arc(x,headY+headR*.34,headR*(style==='haaland'?.27:.23),.15,Math.PI-.15);ctx.stroke();
    if(style==='striker'){
      ctx.fillStyle='rgba(40,29,25,.55)';ctx.beginPath();ctx.arc(x,headY+headR*.48,headR*.14,0,Math.PI);ctx.fill();
    }else if(style==='zidane'){
      ctx.fillStyle='rgba(74,50,41,.72)';ctx.beginPath();ctx.arc(x,headY+headR*.5,headR*.17,0,Math.PI);ctx.fill();
    }else if(style==='ronaldo9'||style==='ronaldinho'){
      ctx.fillStyle='#fff';roundRect(x-headR*.22,headY+headR*.32,headR*.44,headR*.16,headR*.06);ctx.fill();
    }
  }
  ctx.fillStyle='rgba(240,112,110,.25)';ctx.beginPath();ctx.arc(x-headR*.59,headY+headR*.27,headR*.12,0,Math.PI*2);ctx.arc(x+headR*.59,headY+headR*.27,headR*.12,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

function drawOrbitBalls(){
  const p=GAME.player;
  if(!p || p.def.attackType!=='orbit') return;
  const count=p.def.orbitCount+p.special.orbitCount+p.evo.cyclone*2, radius=p.def.orbitRadius+p.special.orbitRadius+p.evo.bulwark*12;
  for(let i=0;i<count;i++){
    const a=p.orbitAngle+i*Math.PI*2/count;
    const [sx,sy]=toScreen(p.x+Math.cos(a)*radius,p.y+Math.sin(a)*radius);
    if(p.evo.cyclone){
      ctx.save(); ctx.globalAlpha=.35; ctx.fillStyle='#72E6FF'; ctx.beginPath();ctx.arc(sx,sy,14+p.evo.cyclone,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    drawFootball(sx,sy,9+p.evo.bulwark*.5);
  }
}

function drawPlayer(){
  const p = GAME.player;
  const sx=W/2, sy=H/2;
  ctx.save();
  if(p.invulnT>0 && Math.floor(GAME.gameTime*20)%2===0) ctx.globalAlpha=0.4;

  // 起脚动画：atkAnimT 倒计时驱动"挤压反弹"变形 + 朝出球方向的微倾，
  // 用简单的正弦包络制造"蓄力-命中-回弹"的力量感，不依赖任何位图素材，
  // canvas 只绘制角色形状本身，其余区域天然透明。
  let scaleX=1, scaleY=1, lean=0;
  if(p.atkAnimT>0){
    const t = 1 - p.atkAnimT/p.atkAnimDur; // 0(起脚瞬间) -> 1(动作结束)
    const punch = Math.sin(Math.min(1,t)*Math.PI); // 0 -> 1 -> 0 的包络
    scaleX = 1 - punch*0.16;
    scaleY = 1 + punch*0.16;
    lean = punch*0.14*(p.kickSide||1);
  }
  ctx.translate(sx,sy);
  ctx.rotate(lean);
  ctx.scale(scaleX,scaleY);
  ctx.translate(-sx,-sy);
  drawBigHead(sx,sy,p.r,p.color,p.def.id);
  ctx.restore();

  // 出球动画：仅对"射门/传球"型角色额外踢出一颗沿朝向飞出并淡出的足球，
  // 环绕球（铁闸）已有持续环绕的球体，不再重复踢球特效。
  if(p.atkAnimT>0 && p.def.attackType!=='orbit'){
    const t = 1 - p.atkAnimT/p.atkAnimDur;
    const kickDist = 10 + t*36;
    const kx = sx+Math.cos(p.facingAngle)*kickDist, ky = sy+Math.sin(p.facingAngle)*kickDist;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1-t*1.15);
    drawFootball(kx,ky, 6.5*(1-t*0.35));
    ctx.restore();
  }
}

function drawJoystick(){
  if(!joystick.active) return;
  ctx.save();
  ctx.globalAlpha=0.35;
  ctx.strokeStyle = COL.chalk; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(joystick.baseX,joystick.baseY,joystick.maxR,0,Math.PI*2); ctx.stroke();
  ctx.globalAlpha=0.55;
  ctx.fillStyle = COL.chalk;
  const dx=joystick.curX-joystick.baseX, dy=joystick.curY-joystick.baseY;
  const len=Math.hypot(dx,dy), r=Math.min(len,joystick.maxR);
  const a=Math.atan2(dy,dx);
  ctx.beginPath(); ctx.arc(joystick.baseX+Math.cos(a)*r, joystick.baseY+Math.sin(a)*r, 22, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawHUD(){
  const p = GAME.player;
  // 左上信息板：角色、等级与波次纪录始终可见。
  ctx.fillStyle='rgba(4,18,13,0.72)'; roundRect(10,10,222,76,12); ctx.fill();
  // 顶部血条
  const barW = Math.min(W*0.48, 210), barX=16, barY=16;
  ctx.fillStyle='rgba(0,0,0,0.4)'; roundRect(barX,barY,barW,16,8); ctx.fill();
  ctx.fillStyle=COL.hpRed; roundRect(barX,barY,barW*Math.max(0,p.hp/p.maxhp),16,8); ctx.fill();
  ctx.strokeStyle=COL.chalk; ctx.lineWidth=1.5; roundRect(barX,barY,barW,16,8); ctx.stroke();
  ctx.fillStyle=COL.chalk; ctx.font='12px sans-serif'; ctx.textAlign='left';
  ctx.fillText(`HP ${Math.ceil(p.hp)}/${Math.floor(p.maxhp)}`, barX+8, barY+12);

  ctx.textAlign='left'; ctx.font='bold 13px sans-serif'; ctx.fillStyle=COL.chalk;
  ctx.fillText(p.def.name, barX, 52);
  ctx.font='12px sans-serif'; ctx.fillStyle=COL.gold;
  ctx.fillText(`Lv.${p.level}   阵别 ${GAME.waveNumber}   最高 ${GAME.bestWave}`, barX, 71);

  // 阵型（原"波次"）
  ctx.textAlign='center'; ctx.font='bold 18px sans-serif'; ctx.fillStyle=COL.chalk;
  const bossTitle=GAME.bossRef&&GAME.bossRef.active?GAME.bossRef.bossName:'';
  ctx.fillText(GAME.bossActive?`${bossTitle||'传奇 BOSS'} · 第 ${GAME.waveNumber} 阵`:`第 ${GAME.waveNumber} 阵`, W/2, 30);
  ctx.font='12px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.7)';
  ctx.fillText(`${Math.floor(GAME.gameTime)}s`, W/2, 48);
  if(GAME.currentEvent){
    ctx.font='bold 11px sans-serif';ctx.fillStyle=GAME.currentEvent.color;
    ctx.fillText(`${GAME.currentEvent.name} · ${Math.ceil(GAME.eventTimer)}s`,W/2,66);
    if(GAME.eventTimer>GAME.WAVE_DURATION-3){
      ctx.font='10px sans-serif';ctx.fillStyle='rgba(242,240,230,.78)';ctx.fillText(GAME.currentEvent.desc,W/2,81);
    }
  }

  if(GAME.combo>=2){
    ctx.textAlign='right';ctx.font=`bold ${GAME.combo>=20?19:15}px sans-serif`;ctx.fillStyle=GAME.combo>=20?COL.gold:COL.chalk;
    ctx.fillText(`${GAME.combo} 连击`,W-16,66);
  }
  if(GAME.frenzyT>0){
    ctx.textAlign='center';ctx.font='bold 14px sans-serif';ctx.fillStyle=COL.gold;
    ctx.fillText(`士气爆发 ${GAME.frenzyT.toFixed(1)}s`,W/2,88);
  }
  if(GAME.pickupToastT>0){
    ctx.textAlign='center';ctx.font='bold 14px sans-serif';ctx.fillStyle=COL.chalk;
    ctx.fillText(`获得：${GAME.lastPickupName}`,W/2,H*.18);
  }

  // 右上暂停 / 结束按钮。窄屏改为上下排列，并扩大实际触控热区。
  if(GAME.state==='playing'){
    const ctlW=60,ctlH=34,gap=10,stacked=W<370;
    const controls=stacked
      ? [{x:W-ctlW-12,y:12,label:'暂停',color:'#3C8DBC',action:pauseGame},{x:W-ctlW-12,y:12+ctlH+gap,label:'结束',color:COL.red,action:finishRun}]
      : [{x:W-ctlW*2-gap-12,y:12,label:'暂停',color:'#3C8DBC',action:pauseGame},{x:W-ctlW-12,y:12,label:'结束',color:COL.red,action:finishRun}];
    for(const c of controls){
      ctx.fillStyle='rgba(7,25,27,.9)';roundRect(c.x,c.y,ctlW,ctlH,10);ctx.fill();
      ctx.strokeStyle=c.color;ctx.lineWidth=1.8;roundRect(c.x,c.y,ctlW,ctlH,10);ctx.stroke();
      ctx.textAlign='center';ctx.font='bold 12px sans-serif';ctx.fillStyle=COL.chalk;ctx.fillText(c.label,c.x+ctlW/2,c.y+22);
      GAME.buttons.push({x:c.x-4,y:c.y-4,w:ctlW+8,h:ctlH+8,action:c.action});
    }
  }

  // 底部士气与经验条
  const ebW = W-32, ebX=16, ebY=H-26;
  const moraleY=ebY-18;
  ctx.fillStyle='rgba(0,0,0,.4)';roundRect(ebX,moraleY,ebW,7,4);ctx.fill();
  ctx.fillStyle=GAME.frenzyT>0?'#FFF07A':COL.yellow;roundRect(ebX,moraleY,ebW*clamp(GAME.morale/100,0,1),7,4);ctx.fill();
  ctx.textAlign='left';ctx.fillStyle=COL.chalk;ctx.font='10px sans-serif';ctx.fillText('士气',ebX,moraleY-3);
  ctx.fillStyle='rgba(0,0,0,0.4)'; roundRect(ebX,ebY,ebW,10,5); ctx.fill();
  ctx.fillStyle=COL.gold; roundRect(ebX,ebY,ebW*(p.exp/p.expToNext),10,5); ctx.fill();
  ctx.textAlign='left'; ctx.fillStyle=COL.chalk; ctx.font='11px sans-serif';
  ctx.fillText(`Lv.${p.level}`, ebX, ebY-4);
}

/* ---------- 按钮/覆盖层：选人 / 升级 / 复活 / 结算 ---------- */
function drawButton(x,y,w,h,label,sub,accent){
  ctx.fillStyle='rgba(10,20,15,0.85)';
  roundRect(x,y,w,h,14); ctx.fill();
  ctx.strokeStyle=accent||COL.gold; ctx.lineWidth=2; roundRect(x,y,w,h,14); ctx.stroke();
  ctx.fillStyle=COL.chalk; ctx.textAlign='center'; ctx.font='bold 18px sans-serif';
  ctx.fillText(label, x+w/2, y+h/2 - (sub?6:-5));
  if(sub){ ctx.font='12px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.75)'; ctx.fillText(sub, x+w/2, y+h/2+16); }
}

function drawSelectScreen(){
  drawBackground();
  ctx.textAlign='center';
  ctx.fillStyle=COL.chalk; ctx.font='bold 26px sans-serif';
  ctx.fillText('无尽球场突围', W/2, H*0.1);
  ctx.font='12px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.7)';
  ctx.fillText('走位躲避 · 自动射门 · 无尽阵型', W/2, H*0.1+21);
  ctx.fillStyle=COL.gold; ctx.font='11px sans-serif';
  ctx.fillText(`本地最佳分数：${GAME.best}`, W/2, H*0.1+38);
  ctx.fillStyle='#F4C542'; ctx.font='bold 12px sans-serif';
  ctx.fillText(`🪙 金币 ${GAME.coins}   🏆 成就 ${GAME.achievements.size}/${ACHIEVEMENTS.length}`, W/2, H*0.1+55);

  GAME.buttons = [];
  const cardW = Math.min(W-40, 360), cardH = 80, gap=9;
  const startY = H*0.2;
  CHARACTERS.forEach((c,i)=>{
    const x=(W-cardW)/2, y=startY+i*(cardH+gap);
    const unlocked = isCharUnlocked(c);

    ctx.save();
    if(!unlocked) ctx.globalAlpha=0.55;
    ctx.fillStyle='rgba(10,20,15,0.85)';
    roundRect(x,y,cardW,cardH,14); ctx.fill();
    ctx.strokeStyle=unlocked?c.color:'rgba(242,240,230,0.35)'; ctx.lineWidth=2.5; roundRect(x,y,cardW,cardH,14); ctx.stroke();

    ctx.fillStyle='rgba(242,240,230,.1)';ctx.beginPath();ctx.arc(x+39,y+cardH/2,28,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=unlocked?c.color:'rgba(242,240,230,.28)';ctx.lineWidth=1.5;ctx.stroke();
    drawBigHead(x+39,y+cardH/2+2,18,unlocked?c.color:'#555',c.id);

    ctx.textAlign='left';
    ctx.fillStyle=COL.chalk; ctx.font='bold 15px sans-serif';
    ctx.fillText(c.name, x+68, y+24);
    ctx.font='11px sans-serif'; ctx.fillStyle=unlocked?COL.gold:'rgba(242,240,230,0.5)';
    ctx.fillText(c.role, x+68, y+40);
    ctx.fillStyle='rgba(242,240,230,0.72)'; ctx.font='10px sans-serif';
    wrapText(c.desc, x+68, y+55, cardW-140, 12);
    ctx.textAlign='right';ctx.fillStyle='rgba(242,240,230,.62)';ctx.font='10px sans-serif';
    ctx.fillText(`熟练度 ${GAME.mastery[c.id]||0}`,x+cardW-14,y+cardH-11);

    if(!unlocked){
      ctx.textAlign='right'; ctx.font='bold 12px sans-serif'; ctx.fillStyle=COL.gold;
      ctx.fillText(`🔒 ${c.unlockCost}`, x+cardW-14, y+cardH/2+4);
    }
    ctx.restore();

    GAME.buttons.push({x,y,w:cardW,h:cardH, action:()=>{
      if(unlocked) resetGame(c); else GAME.state='shop';
    }});
  });

  // 商城入口
  const shopY = startY + CHARACTERS.length*(cardH+gap) + 4;
  const shopW = cardW, shopH=42, shopX=(W-shopW)/2;
  ctx.fillStyle='rgba(20,16,6,0.85)'; roundRect(shopX,shopY,shopW,shopH,12); ctx.fill();
  ctx.strokeStyle=COL.gold; ctx.lineWidth=2; roundRect(shopX,shopY,shopW,shopH,12); ctx.stroke();
  ctx.textAlign='center'; ctx.font='bold 15px sans-serif'; ctx.fillStyle=COL.gold;
  ctx.fillText('🏪 商城', W/2, shopY+shopH/2+5);
  GAME.buttons.push({x:shopX,y:shopY,w:shopW,h:shopH, action:()=>{ GAME.state='shop'; }});
}

function drawShopScreen(){
  drawBackground();
  GAME.buttons = [];
  ctx.textAlign='center';
  ctx.fillStyle=COL.chalk; ctx.font='bold 24px sans-serif';
  ctx.fillText('商城', W/2, H*0.1);
  ctx.fillStyle='#F4C542'; ctx.font='bold 13px sans-serif';
  ctx.fillText(`🪙 金币 ${GAME.coins}`, W/2, H*0.1+24);

  const backW=64,backH=32,backX=16,backY=16;
  ctx.fillStyle='rgba(10,20,15,0.85)'; roundRect(backX,backY,backW,backH,10); ctx.fill();
  ctx.strokeStyle=COL.chalk; ctx.lineWidth=1.5; roundRect(backX,backY,backW,backH,10); ctx.stroke();
  ctx.textAlign='center'; ctx.font='12px sans-serif'; ctx.fillStyle=COL.chalk;
  ctx.fillText('‹ 返回', backX+backW/2, backY+21);
  GAME.buttons.push({x:backX,y:backY,w:backW,h:backH, action:()=>{ GAME.state='select'; }});

  const shopItems = CHARACTERS.filter(c=>c.locked);
  const cardW = Math.min(W-40,360), cardH=120, gap=16;
  const startY = H*0.22;
  shopItems.forEach((c,i)=>{
    const x=(W-cardW)/2, y=startY+i*(cardH+gap);
    const unlocked = isCharUnlocked(c);
    ctx.fillStyle='rgba(10,20,15,0.9)'; roundRect(x,y,cardW,cardH,14); ctx.fill();
    ctx.strokeStyle=c.color; ctx.lineWidth=2.5; roundRect(x,y,cardW,cardH,14); ctx.stroke();

    ctx.fillStyle='rgba(242,240,230,.1)';ctx.beginPath();ctx.arc(x+42,y+40,31,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=c.color;ctx.lineWidth=1.5;ctx.stroke();
    drawBigHead(x+42,y+42,21,c.color,c.id);

    ctx.textAlign='left';
    ctx.fillStyle=COL.chalk; ctx.font='bold 16px sans-serif';
    ctx.fillText(c.name, x+76, y+28);
    ctx.font='11px sans-serif'; ctx.fillStyle=COL.gold;
    ctx.fillText(c.role, x+76, y+46);
    ctx.fillStyle='rgba(242,240,230,0.75)'; ctx.font='11px sans-serif';
    wrapText(c.desc, x+76, y+64, cardW-96, 14);

    const btnW=cardW-32, btnH=30, btnX=x+16, btnY=y+cardH-42;
    if(unlocked){
      ctx.fillStyle='rgba(40,70,40,0.5)'; roundRect(btnX,btnY,btnW,btnH,8); ctx.fill();
      ctx.strokeStyle=COL.hpGreen; ctx.lineWidth=1.5; roundRect(btnX,btnY,btnW,btnH,8); ctx.stroke();
      ctx.textAlign='center'; ctx.font='bold 13px sans-serif'; ctx.fillStyle=COL.chalk;
      ctx.fillText('✓ 已解锁，去首页选用', btnX+btnW/2, btnY+20);
    } else {
      const canAfford = GAME.coins>=c.unlockCost;
      ctx.fillStyle = canAfford? 'rgba(216,178,58,0.25)':'rgba(60,60,60,0.4)';
      roundRect(btnX,btnY,btnW,btnH,8); ctx.fill();
      ctx.strokeStyle = canAfford?COL.gold:'rgba(242,240,230,0.3)'; ctx.lineWidth=1.5; roundRect(btnX,btnY,btnW,btnH,8); ctx.stroke();
      ctx.textAlign='center'; ctx.font='bold 13px sans-serif'; ctx.fillStyle = canAfford?COL.gold:'rgba(242,240,230,0.45)';
      ctx.fillText(canAfford?`🪙 解锁 · ${c.unlockCost}`:`还差 ${c.unlockCost-GAME.coins} 金币`, btnX+btnW/2, btnY+20);
      if(canAfford){
        GAME.buttons.push({x:btnX,y:btnY,w:btnW,h:btnH, action:()=>{ unlockCharacter(c); }});
      }
    }
  });

  if(shopItems.length===0){
    ctx.textAlign='center'; ctx.fillStyle='rgba(242,240,230,0.6)'; ctx.font='13px sans-serif';
    ctx.fillText('暂无更多可解锁内容，敬请期待', W/2, H*0.4);
  }
}

function wrapText(text,x,y,maxW,lh){
  let line='', cy=y;
  for(const ch of text){
    const test=line+ch;
    if(ctx.measureText(test).width>maxW){ ctx.fillText(line,x,cy); line=ch; cy+=lh; }
    else line=test;
  }
  ctx.fillText(line,x,cy);
}

function drawLevelUpOverlay(){
  ctx.fillStyle=COL.dim; ctx.fillRect(0,0,W,H);
  ctx.textAlign='center'; ctx.fillStyle=GAME.isEvolutionChoice?COL.gold:COL.chalk; ctx.font='bold 22px sans-serif';
  ctx.fillText(GAME.isEvolutionChoice?`⚡ Lv.${GAME.evolutionLevel} 攻击进化 ⚡`:'升级！三选一', W/2, H*0.22);
  if(GAME.isEvolutionChoice){
    ctx.font='12px sans-serif'; ctx.fillStyle='rgba(242,240,230,.78)';
    ctx.fillText('此卡池不会出现在普通升级中',W/2,H*.22+21);
  }

  GAME.buttons = [];
  const cardW = Math.min(W-48, 320), cardH=100, gap=16;
  const startY = H*0.32;
  GAME.currentCards.forEach((c,i)=>{
    const x=(W-cardW)/2, y=startY+i*(cardH+gap);
    ctx.fillStyle='rgba(10,20,15,0.9)'; roundRect(x,y,cardW,cardH,14); ctx.fill();
    ctx.strokeStyle=COL.gold; ctx.lineWidth=2; roundRect(x,y,cardW,cardH,14); ctx.stroke();
    ctx.textAlign='left';
    ctx.font='24px sans-serif'; ctx.fillStyle=COL.chalk;
    ctx.fillText(c.icon||'★', x+18, y+42);
    ctx.font='bold 16px sans-serif';
    ctx.fillText(c.name, x+56, y+34);
    ctx.font='12px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.75)';
    wrapText(c.desc, x+56, y+56, cardW-72, 15);

    GAME.buttons.push({x,y,w:cardW,h:cardH, action:()=>{
      c.apply(GAME.player);
      if(GAME.pendingLevelUps>0){ GAME.pendingLevelUps--; triggerLevelUp(); }
      else GAME.state='playing';
    }});
  });
}

function drawPauseOverlay(){
  ctx.fillStyle='rgba(4,10,7,.72)';ctx.fillRect(0,0,W,H);
  ctx.textAlign='center';ctx.fillStyle=COL.chalk;ctx.font='bold 28px sans-serif';
  ctx.fillText('比赛暂停',W/2,H*.32);
  ctx.font='13px sans-serif';ctx.fillStyle='rgba(242,240,230,.78)';
  ctx.fillText('计时、敌人和技能均已暂停',W/2,H*.32+28);

  GAME.buttons=[];
  const w=Math.min(W-60,300),h=56,x=(W-w)/2,y=H*.44;
  drawButton(x,y,w,h,'继续比赛','返回球场',COL.hpGreen);
  GAME.buttons.push({x:x-5,y:y-5,w:w+10,h:h+10,action:resumeGame});
  drawButton(x,y+h+18,w,h,'结束本局','进入结算',COL.red);
  GAME.buttons.push({x:x-5,y:y+h+13,w:w+10,h:h+10,action:finishRun});
}

function drawReviveOverlay(){
  ctx.fillStyle=COL.dim; ctx.fillRect(0,0,W,H);
  ctx.textAlign='center'; ctx.fillStyle=COL.red; ctx.font='bold 24px sans-serif';
  ctx.fillText('严重犯规！', W/2, H*0.36);
  ctx.font='13px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.8)';
  ctx.fillText('观看广告 / 分享到群，立即清屏并恢复 50% 体力', W/2, H*0.36+26);

  GAME.buttons = [];
  const w=Math.min(W-60,300), h=54;
  const x=(W-w)/2;
  drawButton(x,H*0.48,w,h,'复活（清屏 + 回血50%）','',COL.gold);
  GAME.buttons.push({x,y:H*0.48,w,h, action:()=>{
    for(const e of enemies) e.active=false;
    for(const b of bullets) if(!b.fromPlayer) b.active=false;
    const p=GAME.player;
    p.hp = p.maxhp*0.5; p.invulnT=1.2;
    GAME.hasRevived = true; GAME.state='playing';
  }});
  drawButton(x,H*0.48+h+16,w,h,'放弃，结束本局','',COL.red);
  GAME.buttons.push({x,y:H*0.48+h+16,w,h, action:()=>{
    finishRun();
  }});
}

function drawGameOverOverlay(){
  ctx.fillStyle=COL.dim; ctx.fillRect(0,0,W,H);
  ctx.textAlign='center';
  const score = computeScore();
  const isNew = score>=GAME.best && score>0;
  ctx.fillStyle=COL.chalk; ctx.font='bold 26px sans-serif';
  ctx.fillText('比赛结束', W/2, H*0.28);
  if(isNew){ ctx.fillStyle=COL.gold; ctx.font='bold 14px sans-serif'; ctx.fillText('★ 新纪录 ★', W/2, H*0.28+24); }

  ctx.font='14px sans-serif'; ctx.fillStyle='rgba(242,240,230,0.85)';
  const lines = [
    `存活时间：${Math.floor(GAME.gameTime)} 秒`,
    `突破阵型：第 ${GAME.waveNumber} 阵`,
    `击败精英：${GAME.eliteKills} 个`,
    `最佳连击：${GAME.maxCombo} · 击败 Boss：${GAME.bossKills}`,
    `总战力评分：${score}`,
    `🪙 本局获得 ${GAME.lastCoinsEarned} 金币（累计 ${GAME.coins}）`,
    `角色熟练度：${GAME.mastery[GAME.player.def.id]||0}`,
  ];
  if(GAME.newAchievements.length) lines.push(`🏆 新成就：${GAME.newAchievements.join('、')}`);
  lines.forEach((l,i)=> ctx.fillText(l, W/2, H*0.4+i*24));

  GAME.buttons = [];
  const w=Math.min(W-60,280), h=52, x=(W-w)/2, y=H*0.4+lines.length*24+30;
  drawButton(x,y,w,h,'再次出场','',COL.gold);
  GAME.buttons.push({x,y,w,h, action:()=>{ GAME.state='select'; }});
}

/* ============================================================
   渲染主入口
   ============================================================ */
function render(){
  ctx.save();
  if(GAME.shakeT>0){
    // 二次衰减保证震动“短促且收尾干净”；正弦噪声比每帧纯随机更稳定。
    const k=clamp(GAME.shakeT/GAME.shakeDuration,0,1);
    const m=GAME.shakeMag*k*k;
    const q=GAME.gameTime*92+GAME.shakePhase;
    ctx.translate(Math.sin(q*1.73)*m,Math.cos(q*2.31)*m*.72);
  }

  if(GAME.state==='select'){
    drawSelectScreen();
    ctx.restore();
    return;
  }
  if(GAME.state==='shop'){
    drawShopScreen();
    ctx.restore();
    return;
  }

  const p = GAME.player;
  GAME.camX = p.x - W/2; GAME.camY = p.y - H/2;

  // 每帧先清空再由 HUD / 覆盖层登记当前可点击控件，避免旧按钮残留。
  GAME.buttons = [];

  drawBackground();
  drawTraps();
  drawOrbs();
  drawPowerups();
  drawEffects();
  drawEnemies();
  drawBullets();
  drawParticles();
  drawDamageTexts();
  drawPlayer();
  drawOrbitBalls();
  drawHUD();
  drawJoystick();

  ctx.restore();

  if(GAME.state==='paused') drawPauseOverlay();
  else if(GAME.state==='levelup') drawLevelUpOverlay();
  else if(GAME.state==='revive') drawReviveOverlay();
  else if(GAME.state==='gameover') drawGameOverOverlay();
}

/* ============================================================
   主循环
   ============================================================ */
let lastT = Date.now();
function loop(now){
  let dt = (now-lastT)/1000; lastT = now;
  dt = Math.min(dt, 0.05);
  update(dt);
  render();
  raf(loop);
}
raf(loop);

return { touchStart:onTouchStart, touchMove:onTouchMove, touchEnd:endJoystick };
}

module.exports = { startGame };

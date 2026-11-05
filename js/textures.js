// ============================================================
// textures.js — all textures are generated procedurally on canvas,
// so the game boots with ZERO external image assets. Color maps get
// SRGBColorSpace; data maps (roughness / normal) stay linear.
// ============================================================

import * as THREE from 'three';

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

function toTexture(cnv, { repeat = [1, 1], srgb = true, clamp = false } = {}) {
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseOverlay(ctx, w, h, count, alpha, size = 2, hue = 0) {
  for (let i = 0; i < count; i++) {
    const g = Math.floor(120 + Math.random() * 130);
    ctx.fillStyle = `rgba(${g + hue},${g},${g},${alpha * (0.4 + Math.random() * 0.6)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

// ---------- floor / walls / structure ----------

function makeMarbleFloor() {
  const { c, ctx } = canvas2d(1024, 1024);
  ctx.fillStyle = '#3a3f47';                       // dark wet-looking stone
  ctx.fillRect(0, 0, 1024, 1024);
  // 2m tiles (texture covers 8m)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    const p = i * 256;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(1024, p); ctx.stroke();
  }
  // tile shading + marble veining
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const v = 52 + Math.floor(Math.random() * 18);
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.35)`;
      ctx.fillRect(tx * 256 + 3, ty * 256 + 3, 250, 250);
      for (let k = 0; k < 5; k++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        const sx = tx * 256 + Math.random() * 256, sy = ty * 256 + Math.random() * 256;
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx + 60, sy + 30, sx - 40, sy + 80, sx + 20, sy + 130);
        ctx.stroke();
      }
    }
  }
  noiseOverlay(ctx, 1024, 1024, 5000, 0.10);
  // wet reflection streaks (vertical light smears)
  for (let i = 0; i < 26; i++) {
    const g = ctx.createLinearGradient(0, Math.random() * 1024, 0, Math.random() * 1024 + 200);
    g.addColorStop(0, 'rgba(200,220,255,0)');
    g.addColorStop(0.5, `rgba(200,220,255,${0.02 + Math.random() * 0.05})`);
    g.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.random() * 1024, 0, 8 + Math.random() * 26, 1024);
  }
  return toTexture(c, { repeat: [10, 10] });
}

function makeFloorRoughness() {
  const { c, ctx } = canvas2d(512, 512);
  ctx.fillStyle = '#7a7a7a';        // medium-low roughness base (wet-ish)
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(${40 + Math.random() * 110},0,0,0.25)`.replace('rgba', 'rgba');
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, Math.random() * 512, 10 + Math.random() * 70, 6 + Math.random() * 40, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { repeat: [10, 10], srgb: false });
}

function makeConcrete() {
  const { c, ctx } = canvas2d(512, 512);
  ctx.fillStyle = '#565b63';
  ctx.fillRect(0, 0, 512, 512);
  noiseOverlay(ctx, 512, 512, 9000, 0.12);
  // panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * 256, 0); ctx.lineTo(i * 256, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 256); ctx.lineTo(512, i * 256); ctx.stroke();
  }
  return toTexture(c, { repeat: [4, 4] });
}

function makeConcreteDark() {
  const { c, ctx } = canvas2d(256, 256);
  ctx.fillStyle = '#23262c';
  ctx.fillRect(0, 0, 256, 256);
  noiseOverlay(ctx, 256, 256, 3000, 0.1);
  return toTexture(c, { repeat: [6, 6] });
}

function makeMetalBrushed() {
  const { c, ctx } = canvas2d(256, 256);
  ctx.fillStyle = '#8b9096';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const g = 110 + Math.floor(Math.random() * 90);
    ctx.strokeStyle = `rgba(${g},${g},${g + 6},0.16)`;
    ctx.beginPath();
    const y = Math.random() * 256;
    ctx.moveTo(0, y); ctx.lineTo(256, y + (Math.random() * 3 - 1.5));
    ctx.stroke();
  }
  return toTexture(c, { repeat: [2, 2] });
}

function makeGravel() {
  const { c, ctx } = canvas2d(256, 256);
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const g = 40 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${g},${g + 4},${g + 10},0.8)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return toTexture(c, { repeat: [12, 4] });
}

// ---------- signage (canvas text) ----------

function signCanvas(w, h, bg, draw) {
  const { c, ctx } = canvas2d(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  draw(ctx);
  return toTexture(c, { clamp: true });
}

const JP_FONT = '"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';

function makeHangingSign(main, sub, bg = '#1d4f9c', arrow = '→') {
  return signCanvas(512, 128, bg, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 44px ${JP_FONT}`;
    ctx.fillText(main, 240, 46);
    ctx.font = `22px ${JP_FONT}`;
    if (sub) ctx.fillText(sub, 240, 94);
    if (arrow) {
      ctx.font = `bold 46px ${JP_FONT}`;
      ctx.fillText(arrow, 462, 52);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 116);
  });
}

function makeStationNameSign() {
  return signCanvas(512, 128, '#f4f2ec', (ctx) => {
    ctx.fillStyle = '#c8332b';
    ctx.fillRect(0, 0, 26, 128);                    // station color band
    ctx.fillStyle = '#17181a';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 52px ${JP_FONT}`;
    ctx.fillText('桜見台', 56, 44);
    ctx.font = `bold 26px ${JP_FONT}`;
    ctx.fillText('SAKURADAI', 262, 46);
    ctx.fillStyle = '#454a52';
    ctx.font = `20px ${JP_FONT}`;
    ctx.fillText('← 2 · SAKURADAI · 3 →', 56, 100);
    ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 504, 120);
  });
}

function makeExitSign() {
  return signCanvas(256, 96, '#0f6f45', (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 40px ${JP_FONT}`;
    ctx.fillText('出口', 100, 34);
    ctx.font = `bold 24px ${JP_FONT}`;
    ctx.fillText('EXIT ↗', 100, 72);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 248, 88);
  });
}

function makeAdPoster(seed) {
  const { c, ctx } = canvas2d(256, 384);
  const palettes = [
    ['#1b1f3b', '#ff4d6d', '#ffd166'],
    ['#04222b', '#06d6a0', '#ef476f'],
    ['#241436', '#b388ff', '#00e5ff'],
    ['#3b1d0e', '#ffb347', '#fff3b0'],
  ];
  const [bg, a, b] = palettes[seed % palettes.length];
  const g = ctx.createLinearGradient(0, 0, 0, 384);
  g.addColorStop(0, bg); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = a;
  ctx.beginPath(); ctx.arc(128, 150, 74, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(150, 132, 46, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = b;
  ctx.fillRect(30, 252, 196, 6);
  ctx.fillRect(30, 300, 120, 6);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `bold 34px ${JP_FONT}`;
  const words = ['サクラビア', '深夜も営業', '駅ナカカフェ', '桜見弁当'];
  ctx.fillText(words[seed % words.length], 128, 340);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.strokeRect(8, 8, 240, 368);
  return toTexture(c, { clamp: true });
}

function makeInfoScreen() {
  const { c, ctx } = canvas2d(512, 256);
  ctx.fillStyle = '#04070a';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#16324a';
  ctx.fillRect(0, 0, 512, 40);
  ctx.fillStyle = '#9fd7ff';
  ctx.font = `bold 24px ${JP_FONT}`;
  ctx.fillText('のりば 1・2', 16, 29);
  ctx.textAlign = 'right';
  ctx.fillText('23:41', 496, 29);
  ctx.textAlign = 'left';
  ctx.font = `20px ${JP_FONT}`;
  const rows = [
    ['23:47', '普通', '高崎 行', '#b8ffb0'],
    ['23:54', '準急', '川越 行', '#b8ffb0'],
    ['00:02', '最終', '熊谷 行', '#ffd166'],
    ['00:11', '普通', '大宮 行', '#8fa3b8'],
    ['00:24', '区快速', '前橋 行', '#8fa3b8'],
  ];
  rows.forEach((r, i) => {
    const y = 76 + i * 34;
    ctx.fillStyle = '#e8eef4'; ctx.fillText(r[0], 18, y);
    ctx.fillStyle = r[3]; ctx.fillText(r[1], 118, y);
    ctx.fillStyle = '#dfe6ee'; ctx.fillText(r[2], 250, y);
    ctx.strokeStyle = 'rgba(120,160,200,0.18)';
    ctx.beginPath(); ctx.moveTo(12, y + 10); ctx.lineTo(500, y + 10); ctx.stroke();
  });
  return toTexture(c, { clamp: true });
}

function makeTimetable() {
  const { c, ctx } = canvas2d(256, 384);
  ctx.fillStyle = '#f2f0e9';
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = '#20242b';
  ctx.fillRect(0, 0, 256, 40);
  ctx.fillStyle = '#fff';
  ctx.font = `bold 22px ${JP_FONT}`;
  ctx.fillText('時刻表', 90, 28);
  ctx.font = `16px ${JP_FONT}`;
  ctx.fillStyle = '#20242b';
  for (let i = 0; i < 14; i++) {
    const y = 68 + i * 22;
    const mm = String((41 + i) % 60).padStart(2, '0');
    ctx.fillText(`23:${mm}`, 26, y);
    ctx.fillStyle = i % 2 ? '#3a6db5' : '#20242b';
    ctx.fillText(i % 2 ? '普通 高崎' : '普通 大宮', 108, y);
    ctx.fillStyle = '#20242b';
    ctx.strokeStyle = '#c9c4b6';
    ctx.beginPath(); ctx.moveTo(14, y + 7); ctx.lineTo(242, y + 7); ctx.stroke();
  }
  return toTexture(c, { clamp: true });
}

function makeVendingFace(seed) {
  const { c, ctx } = canvas2d(256, 384);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, 256, 384);
  // lit product window
  const g = ctx.createLinearGradient(0, 30, 0, 250);
  g.addColorStop(0, '#fff7dd'); g.addColorStop(1, '#d8e6ff');
  ctx.fillStyle = g;
  ctx.fillRect(22, 34, 212, 214);
  const cols = ['#e63946', '#2a9d8f', '#f4a261', '#4361ee', '#b5179e', '#606c38'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = cols[(row * 4 + col + seed) % cols.length];
      const x = 34 + col * 52, y = 46 + row * 68;
      ctx.fillRect(x, y, 34, 54);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x, y + 20, 34, 10);
    }
  }
  ctx.fillStyle = '#12161c';
  ctx.fillRect(22, 262, 212, 66);
  ctx.fillStyle = '#ff2b3a';
  ctx.fillRect(164, 268, 56, 18);
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(22, 336, 212, 24);
  ctx.fillStyle = '#cfd6de';
  ctx.font = `bold 17px ${JP_FONT}`;
  ctx.fillText('AUTO SHOP', 26, 304);
  return toTexture(c, { clamp: true });
}

function makeStoreSign() {
  return signCanvas(512, 128, '#ffffff', (ctx) => {
    ctx.fillStyle = '#d0202c';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#fff';
    ctx.fillRect(10, 10, 492, 108);
    ctx.fillStyle = '#d0202c';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 42px ${JP_FONT}`;
    ctx.fillText('駅コンビニ', 256, 42);
    ctx.font = `bold 28px ${JP_FONT}`;
    ctx.fillText('STATION MARKET', 256, 88);
  });
}

function makeDestinationLED() {
  return signCanvas(256, 48, '#050505', (ctx) => {
    ctx.fillStyle = '#ffb400';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 26px ${JP_FONT}`;
    ctx.fillText('各駅停車 桜見台', 128, 26);
  });
}

function makeBuildingFacade() {
  const { c, ctx } = canvas2d(128, 256);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 250; y += 18) {
    for (let x = 8; x < 122; x += 18) {
      if (Math.random() < 0.16) {
        const warm = Math.random() < 0.7;
        ctx.fillStyle = warm ? `rgba(255,${180 + Math.random() * 50},110,${0.5 + Math.random() * 0.5})`
                             : `rgba(160,200,255,${0.3 + Math.random() * 0.4})`;
        ctx.fillRect(x, y, 9, 12);
      }
    }
  }
  return toTexture(c, { repeat: [1, 1] });
}

// ---------- particle / fx sprites ----------

function makeSoftDot(inner, outer) {
  const { c, ctx } = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { clamp: true });
}

function makeMuzzleFlash() {
  const { c, ctx } = canvas2d(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,214,140,0.9)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.25)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // star spikes
  ctx.strokeStyle = 'rgba(255,240,200,0.9)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = i % 2 === 0 ? 56 : 34;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    ctx.stroke();
  }
  return toTexture(c, { clamp: true });
}

function makePetal() {
  const { c, ctx } = canvas2d(32, 32);
  ctx.translate(16, 16);
  const g = ctx.createRadialGradient(0, -2, 1, 0, 0, 14);
  g.addColorStop(0, 'rgba(255,225,235,1)');
  g.addColorStop(0.7, 'rgba(255,175,200,0.95)');
  g.addColorStop(1, 'rgba(250,140,175,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, { clamp: true });
}

function makeShard() {
  const { c, ctx } = canvas2d(32, 32);
  ctx.fillStyle = 'rgba(210,235,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(6, 26); ctx.lineTo(18, 4); ctx.lineTo(26, 22); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.moveTo(10, 22); ctx.lineTo(17, 9); ctx.lineTo(21, 19); ctx.closePath();
  ctx.fill();
  return toTexture(c, { clamp: true });
}

function makeBulletHole() {
  const { c, ctx } = canvas2d(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 3, 32, 32, 26);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.45, 'rgba(10,8,6,0.65)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 14;
    ctx.fillRect(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 2, 2);
  }
  return toTexture(c, { clamp: true });
}

// ---------- memoized accessors ----------

const _cache = {};
function memo(name, factory) {
  if (!_cache[name]) _cache[name] = factory();
  return _cache[name];
}

export const TEX = {
  get marbleFloor()    { return memo('marble', makeMarbleFloor); },
  get floorRough()     { return memo('floorRough', makeFloorRoughness); },
  get concrete()       { return memo('concrete', makeConcrete); },
  get concreteDark()   { return memo('concreteDark', makeConcreteDark); },
  get metalBrushed()   { return memo('metal', makeMetalBrushed); },
  get gravel()         { return memo('gravel', makeGravel); },
  get infoScreen()     { return memo('info', makeInfoScreen); },
  get timetable()      { return memo('tt', makeTimetable); },
  get storeSign()      { return memo('storeSign', makeStoreSign); },
  get destLED()        { return memo('led', makeDestinationLED); },
  get stationName()    { return memo('namesign', makeStationNameSign); },
  get exitSign()       { return memo('exitsign', makeExitSign); },
  get buildingFacade() { return memo('facade', makeBuildingFacade); },
  get muzzleFlash()    { return memo('flash', makeMuzzleFlash); },
  get petal()          { return memo('petal', makePetal); },
  get shard()          { return memo('shard', makeShard); },
  get bulletHole()     { return memo('hole', makeBulletHole); },
  get spark()          { return memo('spark', () => makeSoftDot('rgba(255,255,235,1)', 'rgba(255,120,20,0)')); },
  get smoke()          { return memo('smoke', () => makeSoftDot('rgba(190,190,195,0.55)', 'rgba(60,60,70,0)')); },
  get dust()           { return memo('dust', () => makeSoftDot('rgba(200,195,185,0.4)', 'rgba(90,85,80,0)')); },
  hangingSign: (main, sub, bg, arrow) => memo(`sign-${main}-${bg}`, () => makeHangingSign(main, sub, bg, arrow)),
  adPoster: (i) => memo(`ad-${i}`, () => makeAdPoster(i)),
  vendingFace: (i) => memo(`vend-${i}`, () => makeVendingFace(i)),
};

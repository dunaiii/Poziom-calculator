/* БУДОВА RUSH — original canvas arcade, no external assets. */
(() => {
  'use strict';

  const W = 520;
  const H = 780;
  const PLAYER_Y = 633;
  const RETURN_TARGET = 160;
  const RUN_RATE = 20;
  const VAN_RATE = 25; // +25% compared with running
  const CUP_SECONDS = 6;
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const ui = {
    overlay: $('overlay'), kicker: $('overlayKicker'), title: $('overlayTitle'),
    description: $('overlayDescription'), footnote: $('overlayFootnote'),
    primary: $('primaryButton'), pause: $('pauseButton'),
    score: $('scoreValue'), best: $('bestValue'), toast: $('toast'),
    pill: $('modePill'), rate: $('rateLabel'), effect: $('effectLabel'),
    goal: $('runGoal'), progressLabel: $('progressLabel'), progressFill: $('progressFill'),
    left: $('leftButton'), right: $('rightButton')
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const scoreText = (n) => Math.floor(Math.max(0, n)).toString().padStart(5, '0');
  const savedBest = () => {
    try { return Math.max(0, Number(localStorage.getItem('budova-rush-best') || 0) || 0); }
    catch { return 0; }
  };

  const game = {
    phase: 'menu', mode: 'van', score: 0, best: savedBest(),
    runProgress: 0, time: 0, worldY: 0, x: W / 2, vx: 0,
    cupTimer: 0, spawnTimer: 1.2, obstacles: [], particles: [],
    toastTimer: 0, flash: 0, shake: 0, steering: 0, keys: { left: false, right: false }
  };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ui.best.textContent = scoreText(game.best);

  function persistBest() {
    try { localStorage.setItem('budova-rush-best', String(Math.floor(game.best))); }
    catch { /* Private browsing may disable storage. */ }
  }

  function resetInputs() {
    game.keys.left = false;
    game.keys.right = false;
    ui.left.classList.remove('pressed');
    ui.right.classList.remove('pressed');
  }

  function showOverlay(kicker, title, description, button, footnote) {
    ui.kicker.textContent = kicker;
    ui.title.innerHTML = title;
    ui.description.textContent = description;
    ui.primary.firstChild.textContent = button + ' ';
    ui.footnote.textContent = footnote;
    ui.overlay.classList.remove('hidden');
  }

  function syncHud() {
    const running = game.mode === 'run';
    ui.score.textContent = scoreText(game.score);
    ui.best.textContent = scoreText(game.best);
    ui.pill.textContent = running ? '● ПІШКИ' : '● БУС';
    ui.pill.classList.toggle('run', running);
    ui.rate.textContent = running ? '+20 ОЧКІВ / СЕК' : '+25 ОЧКІВ / СЕК';
    const impaired = game.cupTimer > 0;
    ui.effect.classList.toggle('active', impaired);
    ui.effect.textContent = impaired
      ? (running ? '⚡ ТУРБО-БІГ / РІЗКИЙ РУХ' : '⚠ РІЗКЕ КЕРМО') + ' ' + Math.ceil(game.cupTimer) + 'с'
      : 'КЕРУВАННЯ: НОРМА';
    ui.goal.hidden = !running;
    if (running) {
      ui.progressLabel.textContent = Math.floor(game.runProgress) + ' / ' + RETURN_TARGET;
      ui.progressFill.style.width = (100 * clamp(game.runProgress / RETURN_TARGET, 0, 1)) + '%';
    }
    ui.pause.disabled = game.phase === 'menu' || game.phase === 'over';
    ui.pause.textContent = game.phase === 'paused' ? '▶' : 'Ⅱ';
    ui.pause.setAttribute('aria-label', game.phase === 'paused' ? 'Продовжити' : 'Пауза');
  }

  function toast(message, type = '') {
    ui.toast.textContent = message;
    ui.toast.className = 'toast show ' + type;
    game.toastTimer = 2.25;
  }

  function begin() {
    resetInputs();
    Object.assign(game, {
      phase: 'playing', mode: 'van', score: 0, runProgress: 0,
      time: 0, worldY: 0, x: W / 2, vx: 0, cupTimer: 0,
      spawnTimer: 1.25, obstacles: [], particles: [],
      toastTimer: 0, flash: 0, shake: 0
    });
    ui.toast.className = 'toast';
    ui.overlay.classList.add('hidden');
    syncHud();
    canvas.focus({ preventScroll: true });
  }

  function pause() {
    if (game.phase !== 'playing') return;
    game.phase = 'paused';
    resetInputs();
    persistBest();
    showOverlay('ЗУПИНКА НА МАРШРУТІ', 'ПАУЗА',
      'Бус і перешкоди зачекають. Продовжуй, коли будеш готовий.',
      'ПРОДОВЖИТИ', 'P / ESC — ПОВЕРНУТИСЯ ДО ГРИ');
    syncHud();
  }

  function resume() {
    if (game.phase !== 'paused') return;
    game.phase = 'playing';
    ui.overlay.classList.add('hidden');
    resetInputs();
    syncHud();
    canvas.focus({ preventScroll: true });
  }

  function finish() {
    game.phase = 'over';
    game.flash = 0.5;
    resetInputs();
    persistBest();
    showOverlay('АЛКОТРУБКА · РЕЙС СКАСОВАНО', 'ПРИЇХАЛИ.',
      'Алкотрубка зупинила твій рейс! Результат: ' + Math.floor(game.score) +
      ' очок. Рекорд: ' + Math.floor(game.best) + '. Спробуєш ще раз?',
      'НОВИЙ РЕЙС', 'ENTER — ПОЧАТИ ЗНОВУ');
    syncHud();
  }

  function spawn() {
    const choice = Math.random();
    const type = choice < 0.29 ? 'tube' : choice < 0.67 ? 'cup' : 'boss';
    const lanes = [111, 209, 311, 409];
    let x = lanes[Math.floor(Math.random() * lanes.length)] + rand(-13, 13);
    const last = game.obstacles[game.obstacles.length - 1];
    // Avoid impossible stacks in the same lane.
    if (last && last.y < 80 && Math.abs(x - last.x) < 64) x = lanes[(Math.floor(Math.random() * 3) + 1) % 4];
    game.obstacles.push({ type, x, y: -85, turn: rand(-0.09, 0.09), passed: false });
  }

  function puff(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI, Math.PI), speed = rand(55, 225);
      game.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: rand(0.3, 0.85), maxLife: 0.85, color, size: rand(2, 6) });
    }
  }

  function hit(obstacle) {
    game.shake = 0.18;
    if (obstacle.type === 'tube') {
      puff(obstacle.x, obstacle.y, '#f06f6c', 16);
      if (game.mode === 'van') {
        finish();
      } else {
        game.score = Math.max(0, game.score - 60);
        game.runProgress = Math.max(0, game.runProgress - 60);
        toast('АЛКОТРУБКА: −60 ОЧОК', 'bad');
      }
    } else if (obstacle.type === 'cup') {
      puff(obstacle.x, obstacle.y, '#ffc95c', 12);
      game.cupTimer = CUP_SECONDS;
      toast(game.mode === 'van' ? 'СТАКАНЧИК: РІЗКЕ КЕРМО!' : 'СТАКАНЧИК: ТУРБО-БІГ!', 'bad');
    } else {
      puff(obstacle.x, obstacle.y, '#ffd34a', 16);
      game.cupTimer = 0;
      game.vx = 0;
      if (game.mode === 'van') {
        game.mode = 'run';
        game.runProgress = 0;
        toast('НАЧАЛЬСТВО ЗАБРАЛО БУС! БІЖИ!', 'bad');
      } else {
        persistBest();
        game.score = 0;
        game.runProgress = 0;
        toast('НАЧАЛЬСТВО: УСІ ОЧКИ ЗАБРАНО!', 'bad');
      }
    }
    syncHud();
  }

  function restoreVan() {
    game.mode = 'van';
    game.runProgress = 0;
    game.vx = 0;
    game.cupTimer = 0;
    game.shake = 0.14;
    puff(game.x, PLAYER_Y - 25, '#81f1c7', 22);
    toast('БУС ПОВЕРНУЛИ! +25 ОЧОК/СЕК', 'good');
  }

  function update(dt) {
    // Background road animation continues on the start screen.
    if (game.phase === 'menu') { game.worldY += 70 * dt; return; }
    if (game.phase !== 'playing') return;
    game.time += dt;
    game.cupTimer = Math.max(0, game.cupTimer - dt);
    game.toastTimer = Math.max(0, game.toastTimer - dt);
    game.flash = Math.max(0, game.flash - dt);
    game.shake = Math.max(0, game.shake - dt);
    if (game.toastTimer === 0) ui.toast.classList.remove('show');

    const running = game.mode === 'run';
    const turbo = game.cupTimer > 0;
    const roadSpeed = (running ? 300 : 352) * (running && turbo ? 1.55 : 1);
    game.worldY += roadSpeed * dt;
    const earn = (running ? RUN_RATE : VAN_RATE) * dt;
    game.score += earn;
    if (running) game.runProgress += earn;
    game.best = Math.max(game.best, Math.floor(game.score));

    const direction = Number(game.keys.right) - Number(game.keys.left);
    const speed = (running ? 390 : 335) * (turbo ? 1.9 : 1);
    const responsiveness = turbo ? 22 : 9;
    const desiredV = direction * speed;
    game.vx += (desiredV - game.vx) * Math.min(1, responsiveness * dt);
    game.x = clamp(game.x + game.vx * dt, 93, 427);
    if ((game.x <= 93 && game.vx < 0) || (game.x >= 427 && game.vx > 0)) game.vx = 0;

    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      spawn();
      game.spawnTimer = Math.max(0.57, 1.19 - game.time * 0.007) + rand(0, 0.30);
    }

    // Check collision on the travel path. Remove only the obstacle that was hit.
    for (let i = game.obstacles.length - 1; i >= 0; i--) {
      const ob = game.obstacles[i];
      ob.y += roadSpeed * dt;
      if (ob.y > H + 100) { game.obstacles.splice(i, 1); continue; }
      const width = ob.type === 'boss' ? 51 : 43;
      const height = ob.type === 'boss' ? 64 : 51;
      const playerWidth = running ? 32 : 57;
      const playerHeight = running ? 49 : 87;
      if (Math.abs(ob.x - game.x) < (width + playerWidth) * 0.44 &&
          Math.abs(ob.y - PLAYER_Y) < (height + playerHeight) * 0.42) {
        game.obstacles.splice(i, 1);
        hit(ob);
        if (game.phase !== 'playing') break;
      }
    }

    if (game.phase === 'playing' && game.mode === 'run' && game.runProgress >= RETURN_TARGET) restoreVan();

    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      p.life -= dt;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
    syncHud();
  }

  function rounded(x, y, w, h, r, color) {
    const a = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + a, y);
    ctx.lineTo(x + w - a, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + a);
    ctx.lineTo(x + w, y + h - a);
    ctx.quadraticCurveTo(x + w, y + h, x + w - a, y + h);
    ctx.lineTo(x + a, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - a);
    ctx.lineTo(x, y + a);
    ctx.quadraticCurveTo(x, y, x + a, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawRoad() {
    ctx.fillStyle = '#354b45';
    ctx.fillRect(0, 0, W, H);
    // Sidewalks / construction surroundings, drawn with original shapes.
    ctx.fillStyle = '#59645b';
    ctx.fillRect(0, 0, 65, H);
    ctx.fillRect(455, 0, 65, H);
    const tileShift = game.worldY % 80;
    for (let y = tileShift - 80; y < H + 80; y += 80) {
      ctx.fillStyle = '#788077';
      ctx.fillRect(0, y, 64, 2);
      ctx.fillRect(456, y, 64, 2);
      ctx.fillStyle = '#425750';
      ctx.fillRect(14, y + 16, 24, 50);
      ctx.fillRect(482, y + 16, 24, 50);
      ctx.fillStyle = '#798675';
      ctx.fillRect(17, y + 20, 18, 4);
      ctx.fillRect(485, y + 20, 18, 4);
    }

    // Construction barriers and staggered work lights.
    for (let y = (game.worldY * 0.78) % 176 - 176; y < H + 176; y += 176) {
      rounded(12, y + 25, 39, 18, 3, '#e3a93b');
      rounded(469, y + 105, 39, 18, 3, '#e3a93b');
      ctx.fillStyle = '#303a3e';
      ctx.save();
      ctx.translate(31, y + 34);
      ctx.rotate(-0.32);
      ctx.fillRect(-18, -3, 36, 6);
      ctx.restore();
      ctx.save();
      ctx.translate(489, y + 114);
      ctx.rotate(-0.32);
      ctx.fillRect(-18, -3, 36, 6);
      ctx.restore();
    }

    ctx.fillStyle = '#1c292d';
    ctx.fillRect(65, 0, 390, H);
    ctx.fillStyle = '#26363a';
    ctx.fillRect(75, 0, 370, H);
    ctx.fillStyle = '#2a373b';
    ctx.fillRect(89, 0, 342, H);
    ctx.fillStyle = '#edc755';
    ctx.fillRect(79, 0, 4, H);
    ctx.fillRect(437, 0, 4, H);
    const roadShift = game.worldY % 114;
    for (let y = roadShift - 114; y < H + 114; y += 114) {
      rounded(174, y, 5, 57, 2, '#8997975f');
      rounded(259, y, 5, 57, 2, '#8997975f');
      rounded(345, y, 5, 57, 2, '#8997975f');
    }
    // Road markings.
    for (let y = (game.worldY * 0.6) % 450 - 450; y < H + 450; y += 450) {
      ctx.save();
      ctx.globalAlpha = 0.095;
      ctx.translate(260, y + 35);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#d7e0d4';
      ctx.font = '900 33px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('БУДОВА  ▸', 0, 0);
      ctx.restore();
    }
    // Subtle vignette that keeps the player legible.
    const vignette = ctx.createLinearGradient(0, 0, 0, H);
    vignette.addColorStop(0, '#10171945');
    vignette.addColorStop(0.25, '#00000000');
    vignette.addColorStop(1, '#0a14194a');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawVan(x, y) {
    ctx.save();
    ctx.translate(x, y);
    rounded(-39, -48, 78, 109, 16, '#0c1319b0');
    rounded(-38, -38, 13, 30, 4, '#131c22');
    rounded(25, -38, 13, 30, 4, '#131c22');
    rounded(-38, 20, 13, 30, 4, '#131c22');
    rounded(25, 20, 13, 30, 4, '#131c22');
    rounded(-30, -54, 60, 110, 12, '#e9a93b');
    rounded(-25, -49, 50, 99, 9, '#ffc94c');
    rounded(-23, -45, 46, 25, 6, '#324a57');
    rounded(-21, -42, 42, 18, 4, '#61818b');
    ctx.fillStyle = '#a8c0be';
    ctx.fillRect(-2, -42, 3, 18);
    rounded(-23, 4, 46, 38, 5, '#eeb246');
    rounded(-19, 7, 38, 26, 4, '#ffd97a');
    rounded(-17, 35, 34, 7, 3, '#c5872c');
    rounded(-19, -54, 13, 8, 2, '#f9f0cd');
    rounded(6, -54, 13, 8, 2, '#f9f0cd');
    rounded(-20, 50, 12, 5, 2, '#f77b60');
    rounded(8, 50, 12, 5, 2, '#f77b60');
    ctx.fillStyle = '#594722';
    ctx.font = '900 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('BUS', 0, 26);
    ctx.restore();
  }

  function drawRunner(x, y) {
    const step = Math.sin(game.time * (game.cupTimer > 0 ? 28 : 18)) * 12;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0e151ab0';
    ctx.beginPath();
    ctx.ellipse(4, 8, 21, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#273640';
    ctx.beginPath();
    ctx.moveTo(-8, 12); ctx.lineTo(-12 + step * 0.45, 32);
    ctx.moveTo(8, 12); ctx.lineTo(12 - step * 0.45, 32);
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#e8a66d';
    ctx.beginPath();
    ctx.moveTo(-9, -13); ctx.lineTo(-21 - step * 0.4, 6);
    ctx.moveTo(9, -13); ctx.lineTo(21 + step * 0.4, 6);
    ctx.stroke();
    rounded(-16, -25, 32, 40, 10, '#eeb84f');
    rounded(-10, -20, 20, 32, 6, '#f9d765');
    rounded(-12, -41, 24, 26, 10, '#dca67c');
    rounded(-17, -42, 34, 12, 5, '#ffdd4c');
    rounded(-19, -34, 38, 6, 3, '#f1bb36');
    rounded(-10, -12, 20, 8, 2, '#466765');
    ctx.restore();
  }

  function drawTube(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.25 + angle);
    rounded(-15, -29, 30, 59, 7, '#11191f89');
    rounded(-17, -29, 34, 54, 7, '#7a9196');
    rounded(-13, -25, 26, 46, 5, '#384b55');
    rounded(-8, -16, 16, 19, 3, '#b7dc9a');
    ctx.fillStyle = '#253d2a';
    ctx.font = '900 9px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0.0', 0, -4);
    rounded(-9, 9, 18, 4, 2, '#a6bdc2');
    rounded(-7, -39, 14, 13, 3, '#dee2d6');
    rounded(-5, -49, 10, 13, 3, '#e2d4bf');
    ctx.restore();
  }

  function drawCup(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#0c131880';
    ctx.beginPath();
    ctx.ellipse(4, 17, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-21, -15); ctx.lineTo(21, -15);
    ctx.lineTo(15, 28); ctx.lineTo(-15, 28); ctx.closePath();
    ctx.fillStyle = '#ffad4b';ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-12, -9);ctx.lineTo(12, -9);ctx.lineTo(9, 18);ctx.lineTo(-9, 18);ctx.closePath();
    ctx.fillStyle = '#f8d6a8';ctx.fill();
    rounded(-24, -20, 48, 8, 3, '#eee4d9');
    rounded(-22, -26, 44, 7, 3, '#d2c7bd');
    ctx.save();ctx.translate(9,-26);ctx.rotate(0.23);
    rounded(-3,-20,6,24,3,'#ec7e74');ctx.restore();
    ctx.fillStyle = '#a56036';
    ctx.font = '900 12px system-ui';ctx.textAlign = 'center';ctx.fillText('★',0,10);
    ctx.restore();
  }

  function drawBoss(x, y, angle) {
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    ctx.fillStyle = '#11191f99';
    ctx.beginPath();ctx.ellipse(3,20,28,20,0,0,Math.PI*2);ctx.fill();
    rounded(-22,-7,44,48,11,'#273b43');
    rounded(-16,0,32,34,7,'#6f8f99');
    rounded(-23,-9,11,28,5,'#e2ac81');
    rounded(12,-9,11,28,5,'#e2ac81');
    rounded(-16,-33,32,28,10,'#d2a079');
    rounded(-22,-38,44,15,6,'#f9ce45');
    rounded(-24,-27,48,6,3,'#dfab28');
    rounded(16,0,17,24,3,'#f0e1bb');
    rounded(19,2,11,3,1,'#e19b45');
    rounded(-19,27,38,12,3,'#d14c43');
    ctx.fillStyle='#fff0cb';ctx.font='900 10px system-ui';ctx.textAlign='center';ctx.fillText('ШЕФ',0,36);
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (game.shake > 0 && game.phase === 'playing') ctx.translate(rand(-4, 4), rand(-4, 4));
    drawRoad();
    for (const ob of game.obstacles) {
      if (ob.type === 'tube') drawTube(ob.x, ob.y, ob.turn);
      else if (ob.type === 'cup') drawCup(ob.x, ob.y, ob.turn);
      else drawBoss(ob.x, ob.y, ob.turn);
    }
    if (game.cupTimer > 0 && game.phase === 'playing') {
      ctx.fillStyle = '#fbc04b13';
      ctx.fillRect(75, 0, 370, H);
    }
    if (game.mode === 'van') drawVan(game.x, PLAYER_Y);
    else drawRunner(game.x, PLAYER_Y);
    for (const p of game.particles) {
      ctx.globalAlpha = Math.min(1, p.life / p.maxLife * 1.7);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(239,108,100,' + (game.flash * 0.55) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  ui.primary.addEventListener('click', () => game.phase === 'paused' ? resume() : begin());
  ui.pause.addEventListener('click', () => game.phase === 'playing' ? pause() : resume());
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowleft','arrowright',' ','escape'].includes(key)) event.preventDefault();
    if (key === 'arrowleft' || key === 'a') game.keys.left = true;
    if (key === 'arrowright' || key === 'd') game.keys.right = true;
    if ((key === 'p' || key === 'escape') && !event.repeat) {
      if (game.phase === 'playing') pause();
      else if (game.phase === 'paused') resume();
    }
    if (key === 'enter' && !event.repeat) {
      if (game.phase === 'menu' || game.phase === 'over') begin();
      else if (game.phase === 'paused') resume();
    }
  });
  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') game.keys.left = false;
    if (key === 'arrowright' || key === 'd') game.keys.right = false;
  });

  function bindTouch(button, side) {
    const down = (event) => {
      event.preventDefault();
      if (game.phase !== 'playing') return;
      button.setPointerCapture?.(event.pointerId);
      game.keys[side] = true;
      button.classList.add('pressed');
    };
    const up = (event) => {
      event.preventDefault();
      game.keys[side] = false;
      button.classList.remove('pressed');
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', () => {
      game.keys[side] = false;
      button.classList.remove('pressed');
    });
  }
  bindTouch(ui.left, 'left');
  bindTouch(ui.right, 'right');
  window.addEventListener('blur', () => { if (game.phase === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'playing') pause();
  });
  window.addEventListener('pagehide', persistBest);

  let lastTime = 0;
  function frame(timestamp) {
    const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, 0.04);
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  syncHud();
  requestAnimationFrame(frame);
})();
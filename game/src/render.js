// Drawing only: the world's state and the current screen in, pixels out. The 1280x720 logical
// view is scaled to fit the window; the camera follows the player through the city. Flat shapes
// and canvas text, no images and no network. The minimap is drawn in the same canvas.
import { CAR_TYPES, DAY, FIELD, FONT, MISSIONS, PALETTE, PLAYER } from './config.js';
import { CITY } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_MISSION = 'mission';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_COMPLETE = 'complete';

const PANEL = { width: 640, top: 150, line: 32, bottom: 64 };
const MINIMAP = { x: 1036, y: 556, w: 220, h: 148 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = baseline || 'alphabetic';
    context.fillText(value, x, y);
  }

  function hourOf(clock) {
    return Math.floor(clock / 3600) % 24;
  }

  function isNight(clock) {
    const h = hourOf(clock);
    return h < DAY.dayStart || h >= DAY.dayEnd;
  }

  function clockLabel(clock) {
    const h = hourOf(clock);
    const m = Math.floor((clock % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function districtName(city, x, y) {
    return city.districtAt(x, y) || 'Neon Bay';
  }

  // ------------------------------------------------------------ world drawing
  function drawCity(state, city) {
    const camX = state.camX;
    const camY = state.camY;
    const vx0 = camX - FIELD.width / 2;
    const vy0 = camY - FIELD.height / 2;
    const vx1 = camX + FIELD.width / 2;
    const vy1 = camY + FIELD.height / 2;

    // Ground: grass base, then beach, water, parks.
    context.fillStyle = PALETTE.grass;
    context.fillRect(vx0, vy0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.sand;
    context.fillRect(city.beach.x, city.beach.y, city.beach.w, city.beach.h);
    context.fillStyle = PALETTE.water;
    context.fillRect(city.water.x, city.water.y, city.water.w, city.water.h);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.lineWidth = 2;
    for (let i = 0; i < 5; i += 1) {
      const y = city.water.y + 18 + i * 22;
      context.beginPath();
      context.moveTo(vx0, y);
      context.lineTo(vx1, y);
      context.stroke();
    }
    for (const park of city.parks) {
      context.fillStyle = PALETTE.park;
      context.fillRect(park.x, park.y, park.w, park.h);
    }
    // Roads + sidewalks.
    for (const road of city.roads) {
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(road.x - 16, road.y - 16, road.w + 32, road.h + 32);
      context.fillStyle = PALETTE.road;
      context.fillRect(road.x, road.y, road.w, road.h);
    }
    // Centre dashes.
    context.strokeStyle = PALETTE.roadLine;
    context.lineWidth = 3;
    context.setLineDash([18, 22]);
    for (const road of city.roads) {
      context.beginPath();
      if (road.horizontal) {
        const y = road.y + road.h / 2;
        context.moveTo(road.x, y);
        context.lineTo(road.x + road.w, y);
      } else {
        const x = road.x + road.w / 2;
        context.moveTo(x, road.y);
        context.lineTo(x, road.y + road.h);
      }
      context.stroke();
    }
    context.setLineDash([]);
    // District labels.
    text('DOWNTOWN', 1920, 700, 34, 'rgba(255,255,255,0.10)', 'center');
    text('NEON STRIP', 1920, 1180, 34, 'rgba(255,80,180,0.16)', 'center');
    text('BEACH', 1920, 2650, 34, 'rgba(255,255,255,0.10)', 'center');
    text('PARK', 480, 1100, 30, 'rgba(255,255,255,0.10)', 'center');
    // Buildings (only those near the view).
    for (const b of city.buildings) {
      if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      context.strokeStyle = PALETTE.buildingEdge;
      context.lineWidth = 2;
      context.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      if (b.height > 60) {
        context.fillStyle = 'rgba(255,255,255,0.08)';
        context.fillRect(b.x + 6, b.y + 6, b.w - 12, 10);
      }
    }
    // Trees.
    for (const t of city.trees) {
      if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) continue;
      context.fillStyle = PALETTE.tree;
      context.beginPath();
      context.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,0.15)';
      context.beginPath();
      context.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.4, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawCarShape(car, isPlayer) {
    const spec = CAR_TYPES[car.type];
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    const w = spec.width;
    const l = spec.length;
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.35)';
    context.fillRect(-l / 2 + 4, -w / 2 + 5, l, w);
    // Body.
    context.fillStyle = car.color;
    context.beginPath();
    context.roundRect(-l / 2, -w / 2, l, w, 9);
    context.fill();
    // Cabin / windshield.
    context.fillStyle = 'rgba(10,16,28,0.85)';
    context.beginPath();
    context.roundRect(-l * 0.18, -w / 2 + 6, l * 0.36, w - 12, 5);
    context.fill();
    // Headlights + taillights.
    context.fillStyle = '#fff8c0';
    context.fillRect(l / 2 - 3, -w / 2 + 4, 4, 8);
    context.fillRect(l / 2 - 3, w / 2 - 12, 4, 8);
    context.fillStyle = '#ff3b30';
    context.fillRect(-l / 2 - 1, -w / 2 + 4, 4, 8);
    context.fillRect(-l / 2 - 1, w / 2 - 12, 4, 8);
    if (car.type === 'taxi') {
      context.fillStyle = '#111';
      context.fillRect(-6, -w / 2 - 2, 14, 7);
      context.fillStyle = '#f2c94c';
      text('TAXI', 1, -w / 2 + 4, 8, '#111', 'center');
    }
    if (car.type === 'police') {
      const flash = Math.floor(performance.now() / 180) % 2 === 0;
      context.fillStyle = flash ? '#ff3b30' : '#2f7bff';
      context.fillRect(-4, -w / 2 - 3, 10, 6);
      context.fillStyle = flash ? '#2f7bff' : '#ff3b30';
      context.fillRect(-4, w / 2 - 3, 10, 6);
    }
    if (car.isTarget) {
      context.strokeStyle = '#ffd700';
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(-l / 2 - 5, -w / 2 - 5, l + 10, w + 10, 12);
      context.stroke();
    }
    if (isPlayer) {
      context.strokeStyle = '#4fc3f7';
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(-l / 2 - 4, -w / 2 - 4, l + 8, w + 8, 11);
      context.stroke();
    }
    context.restore();
  }

  function drawPerson(x, y, angle, color, isPlayer, isCop) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = 'rgba(0,0,0,0.35)';
    context.beginPath();
    context.arc(2, 3, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    context.beginPath();
    context.arc(0, 0, 12, 0, Math.PI * 2);
    context.fill();
    // Facing tick.
    context.fillStyle = '#111';
    context.beginPath();
    context.arc(8, 0, 4, 0, Math.PI * 2);
    context.fill();
    if (isCop) {
      context.fillStyle = '#1b3a6b';
      context.fillRect(-10, -12, 20, 6);
    }
    if (isPlayer) {
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 15, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function drawEntities(state) {
    // Mission target marker (pulsing).
    const m = state.mission;
    if (m && m.target) {
      const pulse = 1 + 0.15 * Math.sin(state.time * 5);
      context.save();
      context.translate(m.target.x, m.target.y);
      context.scale(pulse, pulse);
      context.strokeStyle = PALETTE.marker;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 0, 26, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.moveTo(0, -14);
      context.lineTo(10, 6);
      context.lineTo(-10, 6);
      context.closePath();
      context.fill();
      context.restore();
    }
    // Pickups.
    for (const pk of state.pickups) {
      const bob = Math.sin(state.time * 3 + pk.x) * 3;
      context.fillStyle = pk.kind === 'money' ? PALETTE.gold : pk.kind === 'health' ? '#ff6b6b' : '#7ab8ff';
      context.beginPath();
      context.arc(pk.x, pk.y + bob, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#111';
      text(pk.kind === 'money' ? '$' : pk.kind === 'health' ? '+' : 'A', pk.x, pk.y + bob + 4, 13, '#111', 'center');
    }
    // Cars.
    for (const car of state.cars) {
      drawCarShape(car, car.driver === 'player');
    }
    // Pedestrians.
    for (const ped of state.peds) {
      if (ped.state === 'down') {
        context.save();
        context.translate(ped.x, ped.y);
        context.rotate(0.6);
        context.fillStyle = ped.color;
        context.fillRect(-12, -5, 24, 10);
        context.restore();
        continue;
      }
      drawPerson(ped.x, ped.y, ped.angle, ped.color, false, false);
    }
    // Foot police.
    for (const cop of state.cops) {
      if (cop.down > 0) {
        context.save();
        context.translate(cop.x, cop.y);
        context.rotate(0.6);
        context.fillStyle = PALETTE.police;
        context.fillRect(-12, -5, 24, 10);
        context.restore();
        continue;
      }
      drawPerson(cop.x, cop.y, cop.angle, PALETTE.police, false, true);
    }
    // Bullets.
    context.fillStyle = PALETTE.bullet;
    for (const b of state.bullets) {
      context.beginPath();
      context.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    // Particles.
    for (const pt of state.particles) {
      context.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      context.fillStyle = pt.color;
      context.beginPath();
      context.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    // Player on foot.
    const p = state.player;
    if (p.onFoot) {
      const blink = p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0;
      if (!blink) drawPerson(p.x, p.y, p.angle, PALETTE.player, true, false);
    }
  }

  function drawNight(state, city) {
    if (!isNight(state.clock)) return;
    context.fillStyle = `rgba(8,12,30,${DAY.nightAlpha})`;
    context.fillRect(state.camX - FIELD.width / 2, state.camY - FIELD.height / 2, FIELD.width, FIELD.height);
    // Streetlights glow at intersections.
    context.fillStyle = 'rgba(255,220,120,0.5)';
    for (const road of city.roads) {
      if (!road.horizontal) continue;
      for (let x = 240; x < CITY.width; x += 480) {
        const sx = x;
        const sy = road.y + road.h / 2;
        if (Math.abs(sx - state.camX) > 700 || Math.abs(sy - state.camY) > 420) continue;
        context.beginPath();
        context.arc(sx, sy, 5, 0, Math.PI * 2);
        context.fill();
      }
    }
    // Headlight cones for the player's car and police at night.
    const cars = state.cars.filter((c) => c.driver === 'player' || c.type === 'police');
    for (const car of cars) {
      context.save();
      context.translate(car.x, car.y);
      context.rotate(car.angle);
      const grad = context.createLinearGradient(0, 0, 220, 0);
      grad.addColorStop(0, 'rgba(255,240,170,0.20)');
      grad.addColorStop(1, 'rgba(255,240,170,0)');
      context.fillStyle = grad;
      context.beginPath();
      context.moveTo(30, -14);
      context.lineTo(220, -70);
      context.lineTo(220, 70);
      context.lineTo(30, 14);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  // ------------------------------------------------------------ HUD + minimap
  function drawMinimap(state, city) {
    const { x, y, w, h } = MINIMAP;
    const sx = w / CITY.width;
    const sy = h / CITY.height;
    context.fillStyle = 'rgba(16,20,31,0.88)';
    context.fillRect(x, y, w, h);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, w, h);
    context.save();
    context.translate(x, y);
    context.scale(sx, sy);
    context.fillStyle = PALETTE.water;
    context.fillRect(city.water.x, city.water.y, city.water.w, city.water.h);
    for (const park of city.parks) {
      context.fillStyle = PALETTE.park;
      context.fillRect(park.x, park.y, park.w, park.h);
    }
    context.fillStyle = '#4a5468';
    for (const road of city.roads) context.fillRect(road.x, road.y, road.w, road.h);
    context.fillStyle = '#8b93a3';
    for (const b of city.buildings) context.fillRect(b.x, b.y, b.w, b.h);
    // Cars.
    context.fillStyle = '#fff';
    for (const car of state.cars) {
      if (car.driver === 'player') continue;
      context.fillRect(car.x - 14, car.y - 14, 28, 28);
    }
    // Police.
    context.fillStyle = '#ff3b30';
    for (const car of state.cars) {
      if (car.type === 'police') context.fillRect(car.x - 18, car.y - 18, 36, 36);
    }
    for (const cop of state.cops) {
      if (cop.down <= 0) context.fillRect(cop.x - 16, cop.y - 16, 32, 32);
    }
    // Mission target.
    const m = state.mission;
    if (m && m.target) {
      const pulse = 1 + 0.3 * Math.sin(state.time * 5);
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.arc(m.target.x, m.target.y, 34 * pulse, 0, Math.PI * 2);
      context.fill();
    }
    // Player.
    context.fillStyle = '#4fc3f7';
    context.beginPath();
    context.arc(state.player.x, state.player.y, 34, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 6;
    context.beginPath();
    context.arc(state.player.x, state.player.y, 34, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    // Viewport rectangle.
    context.strokeStyle = 'rgba(255,255,255,0.5)';
    context.lineWidth = 1;
    context.strokeRect(
      x + (state.camX - FIELD.width / 2) * sx,
      y + (state.camY - FIELD.height / 2) * sy,
      FIELD.width * sx,
      FIELD.height * sy,
    );
    text('NEON BAY', x + 6, y + h - 6, 13, '#8b93a3', 'left');
  }

  function drawHud(state, city) {
    context.textBaseline = 'top';
    // Health bar.
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(16, 16, 220, 26);
    context.fillStyle = state.health > 30 ? PALETTE.green : PALETTE.red;
    context.fillRect(18, 18, 216 * clamp(state.health / PLAYER.health, 0, 1), 22);
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.strokeRect(16, 16, 220, 26);
    text(`HP ${Math.ceil(state.health)}`, 24, 20, 16, '#fff', 'left');
    // Money + ammo.
    text(`$${state.money}`, 16, 50, 28, PALETTE.gold, 'left');
    text(`Ammo ${state.ammo}`, 16, 82, 18, '#cfe3ff', 'left');
    // Wanted stars (top centre-right).
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
    text(stars, FIELD.width - 16, 16, 30, state.wanted > 0 ? PALETTE.red : '#8b93a3', 'right');
    text(state.wanted > 0 ? 'WANTED' : 'CLEAN', FIELD.width - 16, 50, 16, state.wanted > 0 ? PALETTE.red : '#8b93a3', 'right');
    // Clock + district.
    text(`${clockLabel(state.clock)} ${isNight(state.clock) ? '🌙' : '☀️'}`, FIELD.width - 16, 74, 18, '#cfe3ff', 'right');
    text(districtName(city, state.player.x, state.player.y), FIELD.width - 16, 98, 16, '#8b93a3', 'right');
    // Mission objective (bottom left).
    const m = state.mission;
    if (m) {
      const def = MISSIONS[m.index];
      const step = def ? def.steps[m.stepIndex] : null;
      context.fillStyle = 'rgba(0,0,0,0.55)';
      context.fillRect(16, FIELD.height - 84, 460, 68);
      context.strokeStyle = PALETTE.marker;
      context.lineWidth = 2;
      context.strokeRect(16, FIELD.height - 84, 460, 68);
      text(def ? def.title : '', 28, FIELD.height - 76, 18, PALETTE.marker, 'left');
      text(step ? step.label : '', 28, FIELD.height - 52, 16, '#fff', 'left');
      if (step && step.timed) {
        text(`⏱ ${Math.max(0, Math.ceil(m.timer))}s`, 452, FIELD.height - 76, 18, '#ff8a80', 'right');
      }
      if (step && step.type === 'hold') {
        const pct = clamp(m.holdProgress / step.seconds, 0, 1);
        context.fillStyle = '#333';
        context.fillRect(28, FIELD.height - 30, 436, 8);
        context.fillStyle = PALETTE.marker;
        context.fillRect(28, FIELD.height - 30, 436 * pct, 8);
      }
    }
    // Toast.
    if (state.missionToastTimer > 0 && state.missionToast) {
      context.textBaseline = 'top';
      const tw = context.measureText(state.missionToast).width + 32;
      context.fillStyle = 'rgba(0,0,0,0.65)';
      context.fillRect((FIELD.width - tw) / 2, 120, tw, 36);
      text(state.missionToast, FIELD.width / 2, 128, 18, PALETTE.gold, 'center');
    }
    drawMinimap(state, city);
  }

  function drawPanel(title, lines, prompt, accent) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(10,13,22,0.92)';
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = accent || PALETTE.panelEdge;
    context.lineWidth = 3;
    context.strokeRect(x, y, PANEL.width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 78, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 20, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 22, PALETTE.gold, 'center');
  }

  function drawCrosshair(ui) {
    if (!ui || !ui.showCrosshair || !ui.mouseLogical) return;
    const mx = ui.mouseLogical.x;
    const my = ui.mouseLogical.y;
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(mx, my, 10, 0, Math.PI * 2);
    context.moveTo(mx - 14, my);
    context.lineTo(mx - 5, my);
    context.moveTo(mx + 5, my);
    context.lineTo(mx + 14, my);
    context.moveTo(mx, my - 14);
    context.lineTo(mx, my - 5);
    context.moveTo(mx, my + 5);
    context.lineTo(mx, my + 14);
    context.stroke();
  }

  /** Paint one frame: the city, then the HUD or a panel for the screen the game is on. */
  function draw(world, screen, ui) {
    const state = world.state;
    const city = world.city;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Camera + shake.
    const shX = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 22 : 0;
    const shY = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 22 : 0;
    context.setTransform(
      view.scale, 0, 0, view.scale,
      view.x + (-state.camX + FIELD.width / 2 + shX) * view.scale,
      view.y + (-state.camY + FIELD.height / 2 + shY) * view.scale,
    );
    drawCity(state, city);
    drawEntities(state);
    drawNight(state, city);
    // Back to screen space for HUD and panels.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      const lines = [
        'Neon Bay — a city that never sleeps.',
        'Jax is a driver for hire. Take the jobs, dodge the law, get paid.',
        'WASD drive & walk · E enter / steal a car · F punch · Mouse aim + click shoot',
        'Space handbrake · P pause · M mute · Shift run',
        ui && ui.hasSave ? `Save found: $${ui.saveMoney} · mission ${ui.saveMission + 1}/6 — press C to continue` : '',
      ].filter((l) => l !== '');
      drawPanel('NEON BAY', lines, ui && ui.hasSave ? 'Space: new game · C: continue' : 'Press Space or click to start', '#ff5fa2');
      return;
    }
    drawHud(state, city);
    drawCrosshair(ui);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city will wait for you.', 'M mute · P resume'], 'Press P to resume');
    } else if (screen === SCREEN_MISSION) {
      const intro = state.missionIntro || { title: '', intro: '', reward: 0 };
      const wrapped = wrapText(intro.intro, 58);
      drawPanel(intro.title, [...wrapped, '', `Reward: $${intro.reward}`], 'Press E to start the job', PALETTE.marker);
    } else if (screen === SCREEN_BUSTED) {
      drawPanel('BUSTED!', ['The Neon Bay PD caught you.', `Fine paid: $${state.fine || 0}. Your ride is gone.`, ''], 'Press Space to walk free', '#2f6fd0');
    } else if (screen === SCREEN_WASTED) {
      drawPanel('WASTED', ['Jax went down. The hospital patched him up.', `Bill: $${state.fine || 0}.`, ''], 'Press Space to get back out there', PALETTE.red);
    } else if (screen === SCREEN_COMPLETE) {
      drawPanel('THE BIG SCORE', ['All six jobs done. Neon Bay is yours, Jax.', `Total earned: $${state.money}.`, 'Free roam: keep driving, the city is open.'], 'Press Space to keep playing', PALETTE.gold);
    }
  }

  function wrapText(str, width) {
    const words = String(str || '').split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width && line) {
        lines.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    if (line) lines.push(line);
    return lines;
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, view };
}

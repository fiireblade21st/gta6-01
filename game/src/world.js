// The game's rules and state, with no drawing and no browser in it: the player on foot and in
// cars, traffic, pedestrians, police, wanted stars, six missions, combat, time of day and
// particles. step() advances one fixed step and returns what happened as bit flags, so the
// caller can react (sounds, announcements) without the world knowing about screens or sound.
// The city (roads, buildings, loops) comes from city.js; the world only asks it questions.
import { CAR, CAR_TYPES, DAY, MISSIONS, PED, PLAYER, STEP, TRAFFIC, WANTED } from './config.js';
import { CITY, createCity } from './city.js';
import { ACTION_INTERACT, ACTION_PUNCH } from './input.js';

export const EVENT_NONE = 0;
export const EVENT_PICKUP = 1;
export const EVENT_SHOT = 2;
export const EVENT_PUNCH = 4;
export const EVENT_CRASH = 8;
export const EVENT_WANTED_UP = 16;
export const EVENT_MISSION_DONE = 32;
export const EVENT_BUSTED = 64;
export const EVENT_WASTED = 128;
export const EVENT_MISSION_FAIL = 256;
export const EVENT_STEAL = 512;

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Circle (x,y,r) against an AABB; returns true when they overlap. */
function circleHitsRect(x, y, r, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

export function createWorld(random) {
  const city = createCity(random);
  const state = {
    screen: 'title',
    time: 0,
    clock: 8 * 3600,
    money: 0,
    health: PLAYER.health,
    ammo: 24,
    wanted: 0,
    hiddenTimer: 0,
    heat: 0,
    player: null,
    cars: [],
    peds: [],
    cops: [],
    bullets: [],
    particles: [],
    pickups: [],
    mission: null,
    missionIntro: null,
    missionToast: '',
    missionToastTimer: 0,
    missionsDone: [false, false, false, false, false, false],
    storyDone: false,
    shake: 0,
    stats: { carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0 },
    camX: 0,
    camY: 0,
    goldCarId: -1,
  };

  let nextCarId = 1;

  // ---------------------------------------------------------------- player / cars
  function makePlayer() {
    return {
      x: city.spawns.player.x, y: city.spawns.player.y, angle: -Math.PI / 2,
      onFoot: true, carId: -1, invuln: 0, punchCd: 0, shootCd: 0, moving: false,
    };
  }

  function makeCar(type, x, y, angle, driver) {
    const spec = CAR_TYPES[type];
    return {
      id: nextCarId++, type, x, y, angle, speed: 0, color: spec.color,
      driver, ai: null, hp: 100, crashCd: 0, isTarget: false, brakeLight: false,
    };
  }

  function spawnParkedCars() {
    const types = ['sedan', 'taxi', 'sedan', 'taxi', 'sport', 'sedan'];
    for (let i = 0; i < 10; i += 1) {
      const p = city.nearestRoadPoint(random() * CITY.width, random() * CITY.height);
      const type = types[i % types.length];
      // Parked parallel to the road, at its edge, facing along it — never across it.
      let angle = random() * TAU;
      let x = p.x;
      let y = p.y;
      for (const road of city.roads) {
        if (p.x >= road.x && p.x < road.x + road.w && p.y >= road.y && p.y < road.y + road.h) {
          if (road.horizontal) {
            angle = random() < 0.5 ? 0 : Math.PI;
            y = p.y + (random() < 0.5 ? -22 : 22);
          } else {
            angle = random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
            x = p.x + (random() < 0.5 ? -22 : 22);
          }
          break;
        }
      }
      const car = makeCar(type, x, y, angle, null);
      state.cars.push(car);
    }
    // The gold sports car for mission 3, parked by the park.
    const gold = makeCar('sport', city.spawns.park?.x ?? city.spawns.player.x + 300, city.spawns.park?.y ?? city.spawns.player.y, 0, null);
    gold.color = '#ffd700';
    gold.isTarget = true;
    state.goldCarId = gold.id;
    state.cars.push(gold);
  }

  function spawnTraffic() {
    for (let i = 0; i < TRAFFIC.count; i += 1) {
      const loop = city.loops[i % city.loops.length];
      const wp = Math.floor(random() * loop.length);
      const pt = loop[wp];
      const types = ['sedan', 'taxi', 'sedan', 'sport'];
      const type = types[Math.floor(random() * types.length)];
      const next = loop[(wp + 1) % loop.length];
      const car = makeCar(type, pt.x, pt.y, Math.atan2(next.y - pt.y, next.x - pt.x), 'ped');
      car.ai = { loop: i % city.loops.length, wp };
      car.speed = TRAFFIC.speed * (0.8 + random() * 0.4);
      state.cars.push(car);
    }
  }

  function spawnPeds() {
    for (let i = 0; i < PED.count; i += 1) {
      const p = city.nearestRoadPoint(random() * CITY.width, random() * CITY.height);
      state.peds.push({
        x: p.x + (random() - 0.5) * 120, y: p.y + (random() - 0.5) * 120,
        angle: random() * TAU, speed: PED.walkSpeed * (0.7 + random() * 0.6),
        state: 'walk', tx: p.x, ty: p.y, wait: 0, color: ['#d8b25a', '#7ab8d8', '#c97a8a', '#9ad8a0'][i % 4],
        down: 0, fleeX: 0, fleeY: 0,
      });
    }
  }

  function spawnPickups() {
    const spots = [city.spawns.hotel, city.spawns.docks, city.spawns.strip, city.spawns.park, city.spawns.bank];
    for (const s of spots) {
      if (!s) continue;
      state.pickups.push({ kind: 'money', x: s.x + 40, y: s.y + 40, amount: 50 });
    }
    state.pickups.push({ kind: 'health', x: city.spawns.hospital.x + 30, y: city.spawns.hospital.y, amount: 50 });
    state.pickups.push({ kind: 'ammo', x: city.spawns.policeStation.x - 30, y: city.spawns.policeStation.y, amount: 24 });
  }

  // ---------------------------------------------------------------- missions
  function resolveTarget(step) {
    const key = step.to ?? step.at;
    if (!key) return null;
    const s = city.spawns[key];
    if (!s) return null;
    return { x: s.x, y: s.y, label: step.label };
  }

  function currentStep() {
    const m = state.mission;
    if (!m) return null;
    return MISSIONS[m.index].steps[m.stepIndex] ?? null;
  }

  function startMission(index) {
    const def = MISSIONS[index];
    state.mission = { index, stepIndex: 0, timer: 0, holdProgress: 0, target: null };
    const step = def.steps[0];
    state.mission.target = resolveTarget(step);
    if (step.timed) state.mission.timer = step.timed;
    state.missionIntro = { title: def.title, intro: def.intro, reward: def.reward };
    state.screen = 'mission';
    if (def.id === 'getaway') setWanted(3, true);
    if (def.id === 'bigscore') setWanted(0, true);
  }

  function completeMission() {
    const def = MISSIONS[state.mission.index];
    state.money += def.reward;
    state.missionsDone[state.mission.index] = true;
    state.stats.missionsDone += 1;
    state.missionToast = `Mission complete: ${def.title}  +$${def.reward}`;
    state.missionToastTimer = 4;
    const next = state.mission.index + 1;
    state.mission = null;
    if (next >= MISSIONS.length) {
      state.storyDone = true;
      state.screen = 'complete';
      return EVENT_MISSION_DONE;
    }
    startMission(next);
    return EVENT_MISSION_DONE;
  }

  function failMission(reason) {
    state.missionToast = reason;
    state.missionToastTimer = 4;
    const idx = state.mission.index;
    startMission(idx);
    return EVENT_MISSION_FAIL;
  }

  // ---------------------------------------------------------------- wanted / police
  function setWanted(level, silent) {
    const before = state.wanted;
    state.wanted = clamp(level, 0, 5);
    state.hiddenTimer = 0;
    if (!silent && state.wanted > before) return EVENT_WANTED_UP;
    return EVENT_NONE;
  }

  function addWanted(n) {
    return setWanted(state.wanted + n, false);
  }

  function policeWants() {
    return {
      cars: WANTED.policeCars[state.wanted],
      foot: WANTED.policeFoot[state.wanted],
    };
  }

  function spawnPoliceCar() {
    const p = city.nearestRoadPoint(
      clamp(state.player.x + (random() < 0.5 ? -1 : 1) * (500 + random() * 400), 100, CITY.width - 100),
      clamp(state.player.y + (random() < 0.5 ? -1 : 1) * (500 + random() * 400), 100, CITY.height - 100),
    );
    const car = makeCar('police', p.x, p.y, 0, 'police');
    state.cars.push(car);
    return car;
  }

  function spawnCop() {
    const a = random() * TAU;
    const x = clamp(state.player.x + Math.cos(a) * 420, 40, CITY.width - 40);
    const y = clamp(state.player.y + Math.sin(a) * 420, 40, CITY.height - 40);
    state.cops.push({ x, y, angle: 0, speed: 150, state: 'chase', punchCd: 0, down: 0 });
  }

  function maintainPolice() {
    const want = policeWants();
    let cars = 0;
    let foot = 0;
    for (const car of state.cars) if (car.type === 'police' && car.driver === 'police') cars += 1;
    for (const cop of state.cops) if (cop.down <= 0) foot += 1;
    while (cars < want.cars) { spawnPoliceCar(); cars += 1; }
    while (foot < want.foot) { spawnCop(); foot += 1; }
    // Too many police: the farthest ones give up and drive off (despawn far away).
    if (cars > want.cars) {
      for (let i = state.cars.length - 1; i >= 0 && cars > want.cars; i -= 1) {
        const car = state.cars[i];
        if (car.type === 'police' && car.driver === 'police' && dist(car.x, car.y, state.player.x, state.player.y) > 900) {
          state.cars.splice(i, 1);
          cars -= 1;
        }
      }
    }
    if (foot > want.foot) {
      for (let i = state.cops.length - 1; i >= 0 && foot > want.foot; i -= 1) {
        if (dist(state.cops[i].x, state.cops[i].y, state.player.x, state.player.y) > 900) {
          state.cops.splice(i, 1);
          foot -= 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- combat / effects
  function addParticles(x, y, color, n, speed) {
    for (let i = 0; i < n; i += 1) {
      const a = random() * TAU;
      const v = speed * (0.3 + random() * 0.7);
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + random() * 0.4, maxLife: 0.8, color, size: 2 + random() * 3 });
    }
    if (state.particles.length > 400) state.particles.splice(0, state.particles.length - 400);
  }

  function damagePed(ped, dmg, fromX, fromY) {
    ped.state = 'down';
    ped.down = 3;
    addParticles(ped.x, ped.y, '#e5534b', 8, 120);
    state.stats.pedsHit += 1;
    return addWanted(WANTED.hitPed);
  }

  function damageCop(cop, dmg) {
    cop.down = 4;
    addParticles(cop.x, cop.y, '#e5534b', 10, 140);
    return addWanted(WANTED.killCop);
  }

  function damageCar(car, dmg) {
    car.hp -= dmg;
    addParticles(car.x, car.y, '#f2c94c', 6, 100);
    if (car.hp <= 0 && car.driver === 'ped') {
      // Driver bails out of a wrecked car.
      const d = car.driver;
      car.driver = null;
      car.speed = 0;
      if (d === 'ped') {
        state.peds.push({ x: car.x + 30, y: car.y, angle: 0, speed: PED.fleeSpeed, state: 'flee', tx: car.x, ty: car.y, wait: 0, color: '#d8b25a', down: 0, fleeX: car.x, fleeY: car.y });
      }
    }
    return EVENT_NONE;
  }

  function playerCar() {
    if (state.player.onFoot) return null;
    for (const car of state.cars) if (car.id === state.player.carId) return car;
    return null;
  }

  function nearestCar(x, y, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of state.cars) {
      const d = dist(x, y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function enterCar(car) {
    let events = EVENT_NONE;
    const hadDriver = car.driver === 'ped' || car.driver === 'police';
    const wasPolice = car.type === 'police';
    if (car.driver === 'ped' || car.driver === 'police') {
      // The driver is thrown out and runs away.
      state.peds.push({
        x: car.x + 34, y: car.y, angle: 0, speed: PED.fleeSpeed, state: 'flee',
        tx: car.x, ty: car.y, wait: 0, color: car.driver === 'police' ? '#2f6fd0' : '#d8b25a',
        down: 0, fleeX: car.x, fleeY: car.y,
      });
      events |= EVENT_STEAL;
    }
    car.driver = 'player';
    car.ai = null;
    state.player.onFoot = false;
    state.player.carId = car.id;
    state.player.x = car.x;
    state.player.y = car.y;
    state.player.angle = car.angle;
    state.stats.carsStolen += 1;
    if (hadDriver) events |= addWanted(WANTED.stealCar);
    if (wasPolice) events |= addWanted(WANTED.ramPolice);
    return events;
  }

  function exitCar() {
    const car = playerCar();
    if (!car) return;
    car.driver = null;
    car.speed = 0;
    // Step out beside the car — try both sides, then front/back — and take the first
    // spot that is not inside a building, so the player never ends up stuck in one.
    const offsets = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];
    let placed = false;
    for (const off of offsets) {
      const a = car.angle + off;
      const x = car.x + Math.cos(a) * 48;
      const y = car.y + Math.sin(a) * 48;
      if (!city.isBlocked(x, y, PLAYER.radius)) {
        state.player.x = x;
        state.player.y = y;
        placed = true;
        break;
      }
    }
    if (!placed) {
      state.player.x = car.x;
      state.player.y = car.y;
    }
    state.player.angle = car.angle;
    state.player.onFoot = true;
    state.player.carId = -1;
  }

  // ---------------------------------------------------------------- reset / save
  function reset() {
    state.screen = 'title';
    state.time = 0;
    state.clock = 8 * 3600;
    state.money = 0;
    state.health = PLAYER.health;
    state.ammo = 24;
    state.wanted = 0;
    state.hiddenTimer = 0;
    state.heat = 0;
    state.player = makePlayer();
    state.cars = [];
    state.peds = [];
    state.cops = [];
    state.bullets = [];
    state.particles = [];
    state.pickups = [];
    state.mission = null;
    state.missionIntro = null;
    state.missionToast = '';
    state.missionToastTimer = 0;
    state.missionsDone = [false, false, false, false, false, false];
    state.storyDone = false;
    state.shake = 0;
    state.stats = { carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0 };
    state.camX = state.player.x;
    state.camY = state.player.y;
    nextCarId = 1;
    spawnParkedCars();
    spawnTraffic();
    spawnPeds();
    spawnPickups();
  }

  function serialize() {
    return {
      money: state.money, missionIndex: state.mission ? state.mission.index : (state.storyDone ? MISSIONS.length : 0),
      missionsDone: state.missionsDone, x: state.player.x, y: state.player.y,
      clock: state.clock, health: state.health, ammo: state.ammo,
    };
  }

  function deserialize(save) {
    reset();
    state.money = save.money || 0;
    state.missionsDone = Array.isArray(save.missionsDone) ? save.missionsDone : state.missionsDone;
    state.clock = save.clock || 8 * 3600;
    state.health = save.health || PLAYER.health;
    state.ammo = save.ammo || 24;
    if (save.x !== undefined && save.y !== undefined && !city.isBlocked(save.x, save.y, PLAYER.radius)) {
      state.player.x = save.x;
      state.player.y = save.y;
    }
    const idx = save.missionIndex || 0;
    if (idx < MISSIONS.length) startMission(idx);
    else state.storyDone = true;
  }

  function respawn(atPoliceStation) {
    const spot = atPoliceStation ? city.spawns.policeStation : city.spawns.hospital;
    state.player.x = spot.x;
    state.player.y = spot.y;
    state.player.angle = -Math.PI / 2;
    state.player.onFoot = true;
    state.player.carId = -1;
    state.health = PLAYER.health;
    state.wanted = 0;
    state.hiddenTimer = 0;
    state.cops = [];
    // Police cars give up.
    for (let i = state.cars.length - 1; i >= 0; i -= 1) {
      if (state.cars[i].type === 'police') state.cars.splice(i, 1);
    }
    state.camX = state.player.x;
    state.camY = state.player.y;
  }

  // ---------------------------------------------------------------- per-frame updates
  function moveWithCollision(x, y, dx, dy, r) {
    // Axis-separated so the player/cars slide along walls instead of sticking.
    let nx = x;
    if (!city.isBlocked(x + dx, y, r)) nx = x + dx;
    let ny = y;
    if (!city.isBlocked(nx, y + dy, r)) ny = y + dy;
    return { x: nx, y: ny };
  }

  function carPoints(car) {
    const spec = CAR_TYPES[car.type];
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const half = spec.length / 2 - 6;
    return {
      front: { x: car.x + fx * half, y: car.y + fy * half },
      rear: { x: car.x - fx * half, y: car.y - fy * half },
    };
  }

  function carHitsBuilding(car) {
    const pts = carPoints(car);
    return city.isBlocked(pts.front.x, pts.front.y, 20) || city.isBlocked(pts.rear.x, pts.rear.y, 20);
  }

  function updatePlayerOnFoot(dt, ctl) {
    let events = EVENT_NONE;
    const p = state.player;
    const speed = ctl.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const dx = ctl.move.x * speed * dt;
    const dy = ctl.move.y * speed * dt;
    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) p.angle = Math.atan2(ctl.move.y, ctl.move.x);
    const next = moveWithCollision(p.x, p.y, dx, dy, PLAYER.radius);
    p.x = next.x;
    p.y = next.y;
    // Run over by a moving car — only when the player is in front of it, in its path.
    if (p.invuln <= 0) {
      for (const car of state.cars) {
        if (Math.abs(car.speed) < 60) continue;
        if (dist(p.x, p.y, car.x, car.y) >= 34) continue;
        const fx = Math.cos(car.angle);
        const fy = Math.sin(car.angle);
        const d = dist(p.x, p.y, car.x, car.y) || 1;
        const inFront = ((p.x - car.x) * fx + (p.y - car.y) * fy) / d;
        if (inFront < 0.3) continue; // behind or beside the car: no hit
        state.health -= 12;
        p.invuln = PLAYER.invulnerable;
        const a = Math.atan2(p.y - car.y, p.x - car.x);
        const knock = moveWithCollision(p.x, p.y, Math.cos(a) * 40, Math.sin(a) * 40, PLAYER.radius);
        p.x = knock.x;
        p.y = knock.y;
        state.shake = 0.5;
        addParticles(p.x, p.y, '#e5534b', 10, 140);
        events |= EVENT_CRASH;
        if (state.health <= 0) {
          state.health = 0;
          return events | EVENT_WASTED;
        }
        break;
      }
    }
    return events;
  }

  function updatePlayerCar(dt, ctl) {
    let events = EVENT_NONE;
    const car = playerCar();
    if (!car) {
      state.player.onFoot = true;
      return events;
    }
    const spec = CAR_TYPES[car.type];
    const throttle = -ctl.move.y;
    const steer = ctl.move.x;
    const handbrake = ctl.space;
    if (throttle > 0) car.speed += spec.accel * dt;
    else if (throttle < 0) car.speed -= spec.brake * dt;
    else {
      // Rolling drag.
      const drag = 220 * dt;
      car.speed = Math.abs(car.speed) <= drag ? 0 : car.speed - Math.sign(car.speed) * drag;
    }
    if (handbrake) {
      const hb = 900 * dt;
      car.speed = Math.abs(car.speed) <= hb ? 0 : car.speed - Math.sign(car.speed) * hb;
    }
    car.speed = clamp(car.speed, -spec.topSpeed * 0.45, spec.topSpeed);
    const steerAuthority = clamp(Math.abs(car.speed) / 130, 0, 1) * (car.speed >= 0 ? 1 : -1);
    const steerRate = spec.steer * (handbrake ? 1.6 : 1);
    car.angle += steer * steerRate * steerAuthority * dt;
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const oldX = car.x;
    const oldY = car.y;
    car.x = nx;
    car.y = ny;
    if (carHitsBuilding(car)) {
      car.x = oldX;
      car.y = oldY;
      if (Math.abs(car.speed) > 140 && car.crashCd <= 0) {
        car.crashCd = CAR.crashCooldown;
        state.shake = 0.6;
        addParticles(car.x, car.y, '#f2c94c', 12, 160);
        events |= EVENT_CRASH;
      }
      car.speed *= -0.3;
    }
    if (car.crashCd > 0) car.crashCd -= dt;
    // Car-car collisions (circle approximation).
    for (const other of state.cars) {
      if (other === car || other.hp <= 0) continue;
      const d = dist(car.x, car.y, other.x, other.y);
      if (d < 62 && d > 0.01) {
        const push = (62 - d) / 2;
        const a = Math.atan2(car.y - other.y, car.x - other.x);
        car.x += Math.cos(a) * push;
        car.y += Math.sin(a) * push;
        if (other.driver !== 'player') {
          other.x -= Math.cos(a) * push;
          other.y -= Math.sin(a) * push;
        }
        const impact = Math.abs(car.speed) + Math.abs(other.speed || 0);
        if (impact > 220 && car.crashCd <= 0) {
          car.crashCd = CAR.crashCooldown;
          state.shake = 0.5;
          addParticles(car.x, car.y, '#f2c94c', 10, 140);
          events |= EVENT_CRASH;
          if (other.type === 'police') events |= addWanted(WANTED.ramPolice);
          if (other.driver === 'ped' && other.ai) {
            // Shunt a traffic car off its line a little.
            other.speed = Math.max(0, (other.speed || 0) - 60);
          }
        }
        car.speed *= 0.92;
      }
    }
    // Run over pedestrians.
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (Math.abs(car.speed) > 60 && dist(car.x, car.y, ped.x, ped.y) < 36) {
        events |= damagePed(ped, 100, car.x, car.y);
        state.shake = 0.4;
        addParticles(ped.x, ped.y, '#e5534b', 10, 140);
        events |= EVENT_CRASH;
      }
    }
    // Run over a foot cop.
    for (const cop of state.cops) {
      if (cop.down > 0) continue;
      if (Math.abs(car.speed) > 60 && dist(car.x, car.y, cop.x, cop.y) < 36) {
        events |= damageCop(cop, 100);
        state.shake = 0.5;
        addParticles(cop.x, cop.y, '#e5534b', 10, 140);
        events |= EVENT_CRASH;
      }
    }
    state.player.x = car.x;
    state.player.y = car.y;
    state.player.angle = car.angle;
    return events;
  }

  function doInteract() {
    const p = state.player;
    if (p.onFoot) {
      const car = nearestCar(p.x, p.y, CAR.enterRange);
      if (car) return enterCar(car);
      return EVENT_NONE;
    }
    exitCar();
    return EVENT_NONE;
  }

  function doPunch() {
    const p = state.player;
    if (!p.onFoot || p.punchCd > 0) return EVENT_NONE;
    p.punchCd = PLAYER.punchCooldown;
    let events = EVENT_PUNCH;
    // Nearest ped/cop in front of the player.
    let best = null;
    let bestD = PLAYER.punchRange + 14;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const d = dist(p.x, p.y, ped.x, ped.y);
      if (d < bestD && Math.abs(angleDiff(Math.atan2(ped.y - p.y, ped.x - p.x), p.angle)) < 1.2) {
        bestD = d;
        best = { kind: 'ped', ref: ped };
      }
    }
    for (const cop of state.cops) {
      if (cop.down > 0) continue;
      const d = dist(p.x, p.y, cop.x, cop.y);
      if (d < bestD && Math.abs(angleDiff(Math.atan2(cop.y - p.y, cop.x - p.x), p.angle)) < 1.2) {
        bestD = d;
        best = { kind: 'cop', ref: cop };
      }
    }
    if (best) {
      if (best.kind === 'ped') events |= damagePed(best.ref, PLAYER.punchDamage, p.x, p.y);
      else events |= damageCop(best.ref, PLAYER.punchDamage);
      addParticles(p.x + Math.cos(p.angle) * 26, p.y + Math.sin(p.angle) * 26, '#ffe066', 6, 100);
    }
    return events;
  }

  function doShoot(dt, ctl) {
    const p = state.player;
    if (!p.onFoot || state.ammo <= 0 || p.shootCd > 0 || !ctl.shooting) return EVENT_NONE;
    p.shootCd = PLAYER.shootCooldown;
    state.ammo -= 1;
    state.stats.shotsFired += 1;
    const a = ctl.aimAngle;
    state.bullets.push({
      x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
      vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 0.9, from: 'player',
    });
    addParticles(p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, '#ffe066', 4, 90);
    state.shake = Math.max(state.shake, 0.12);
    return EVENT_SHOT;
  }

  function updateTraffic(dt) {
    for (const car of state.cars) {
      if (car.driver === 'player') continue;
      if (car.driver === 'police') {
        // Chase the player: steer toward them, ram the player's car. When a building
        // blocks the straight line, try nearby angles so the car slides around the
        // corner instead of pushing against the wall forever.
        const target = state.player;
        const want = Math.atan2(target.y - car.y, target.x - car.x);
        const turn = clamp(angleDiff(want, car.angle), -1, 1);
        car.angle += turn * 3.0 * dt;
        const spec = CAR_TYPES.police;
        const d = dist(car.x, car.y, target.x, target.y);
        if (state.player.onFoot && d < 110) {
          // Corner the player on foot: stop and let the foot cops close in.
          car.speed = Math.max(0, car.speed - spec.brake * dt);
        } else {
          car.speed = Math.min(spec.topSpeed * 0.92, car.speed + spec.accel * dt);
        }
        let moved = false;
        for (const offset of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const a = car.angle + offset;
          const nx = car.x + Math.cos(a) * car.speed * dt;
          const ny = car.y + Math.sin(a) * car.speed * dt;
          if (!carHitsBuilding({ ...car, x: nx, y: ny })) {
            car.x = nx;
            car.y = ny;
            if (offset !== 0) car.angle = a;
            moved = true;
            break;
          }
        }
        if (!moved) {
          car.speed *= 0.5;
          car.angle += 0.6 * dt;
        }
        continue;
      }
      if (!car.ai) continue; // parked
      const loop = city.loops[car.ai.loop];
      if (!loop || loop.length === 0) continue;
      const target = loop[car.ai.wp];
      const want = Math.atan2(target.y - car.y, target.x - car.x);
      const turn = clamp(angleDiff(want, car.angle), -1, 1);
      car.angle += turn * 2.4 * dt;
      // Slow for the car ahead on the same loop.
      let desired = TRAFFIC.speed;
      for (const other of state.cars) {
        if (other === car || other.ai?.loop !== car.ai.loop) continue;
        const ahead = Math.cos(car.angle) * (other.x - car.x) + Math.sin(car.angle) * (other.y - car.y);
        const side = Math.abs(-Math.sin(car.angle) * (other.x - car.x) + Math.cos(car.angle) * (other.y - car.y));
        if (ahead > 0 && ahead < TRAFFIC.followGap && side < 50) { desired = 0; break; }
      }
      // And for the player's car ahead.
      const pc = playerCar();
      if (pc) {
        const ahead = Math.cos(car.angle) * (pc.x - car.x) + Math.sin(car.angle) * (pc.y - car.y);
        const side = Math.abs(-Math.sin(car.angle) * (pc.x - car.x) + Math.cos(car.angle) * (pc.y - car.y));
        if (ahead > 0 && ahead < TRAFFIC.followGap && side < 55) desired = 0;
      }
      // And for the player on foot ahead: a driver stops rather than running them over,
      // which is what makes stealing a moving car possible.
      if (state.player.onFoot) {
        const p = state.player;
        const ahead = Math.cos(car.angle) * (p.x - car.x) + Math.sin(car.angle) * (p.y - car.y);
        const side = Math.abs(-Math.sin(car.angle) * (p.x - car.x) + Math.cos(car.angle) * (p.y - car.y));
        if (ahead > 0 && ahead < 95 && side < 42) desired = 0;
      }
      car.speed += clamp(desired - car.speed, -260 * dt, 200 * dt);
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      if (!carHitsBuilding({ ...car, x: nx, y: ny })) {
        car.x = nx;
        car.y = ny;
      }
      if (dist(car.x, car.y, target.x, target.y) < 40) {
        car.ai.wp = (car.ai.wp + 1) % loop.length;
      }
    }
  }

  function updatePeds(dt) {
    for (const ped of state.peds) {
      if (ped.down > 0) {
        ped.down -= dt;
        if (ped.down <= 0) {
          ped.state = 'flee';
          ped.fleeX = ped.x;
          ped.fleeY = ped.y;
        }
        continue;
      }
      if (ped.state === 'flee') {
        const a = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
        const nx = ped.x + Math.cos(a) * PED.fleeSpeed * dt;
        const ny = ped.y + Math.sin(a) * PED.fleeSpeed * dt;
        if (!city.isBlocked(nx, ny, PED.radius)) {
          ped.x = nx;
          ped.y = ny;
          ped.angle = a;
        } else {
          ped.angle += 1.2;
        }
        ped.wait -= dt;
        if (ped.wait <= 0) {
          ped.state = 'walk';
          ped.wait = 0;
        }
        continue;
      }
      // Walk toward the current target; pick a new one on arrival.
      const d = dist(ped.x, ped.y, ped.tx, ped.ty);
      if (d < 24) {
        ped.wait -= dt;
        if (ped.wait <= 0) {
          const p = city.nearestRoadPoint(
            clamp(ped.x + (random() - 0.5) * 700, 60, CITY.width - 60),
            clamp(ped.y + (random() - 0.5) * 700, 60, CITY.height - 60),
          );
          ped.tx = p.x + (random() - 0.5) * 60;
          ped.ty = p.y + (random() - 0.5) * 60;
          ped.wait = 1 + random() * 2;
        }
        continue;
      }
      const a = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
      ped.angle = a;
      const nx = ped.x + Math.cos(a) * ped.speed * dt;
      const ny = ped.y + Math.sin(a) * ped.speed * dt;
      if (!city.isBlocked(nx, ny, PED.radius)) {
        ped.x = nx;
        ped.y = ny;
      }
    }
    // Flee trigger: a nearby gunshot, crash or a car speeding at them.
    // (Checked by the caller through scarePeds(); see below.)
  }

  function scarePeds(x, y, radius) {
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (dist(ped.x, ped.y, x, y) < radius) {
        ped.state = 'flee';
        ped.fleeX = x;
        ped.fleeY = y;
        ped.wait = 2.5 + random() * 1.5;
      }
    }
  }

  function updatePolice(dt) {
    for (const cop of state.cops) {
      if (cop.down > 0) {
        cop.down -= dt;
        continue;
      }
      const p = state.player;
      const d = dist(cop.x, cop.y, p.x, p.y);
      if (state.wanted === 0) {
        // No heat: walk back to the station and clock out.
        const s = city.spawns.policeStation;
        const a = Math.atan2(s.y - cop.y, s.x - cop.x);
        cop.angle = a;
        cop.x += Math.cos(a) * 90 * dt;
        cop.y += Math.sin(a) * 90 * dt;
        if (dist(cop.x, cop.y, s.x, s.y) < 60) cop.down = -1; // mark for removal
        continue;
      }
      const a = Math.atan2(p.y - cop.y, p.x - cop.x);
      cop.angle = a;
      if (p.onFoot && d < 30 && p.invuln <= 0) {
        // Caught.
        return EVENT_BUSTED;
      }
      if (p.onFoot && d < 46 && cop.punchCd <= 0) {
        cop.punchCd = 0.9;
        if (p.invuln <= 0) {
          state.health -= 10;
          p.invuln = PLAYER.invulnerable;
          state.shake = 0.4;
          addParticles(p.x, p.y, '#e5534b', 8, 120);
          if (state.health <= 0) {
            state.health = 0;
            return EVENT_WASTED;
          }
        }
      }
      if (cop.punchCd > 0) cop.punchCd -= dt;
      const speed = p.onFoot ? 165 : 120;
      // Walk toward the player; when a building blocks the way, try nearby angles
      // so the officer walks around the corner instead of pushing against the wall.
      let moved = false;
      for (const offset of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const ma = a + offset;
        const nx = cop.x + Math.cos(ma) * speed * dt;
        const ny = cop.y + Math.sin(ma) * speed * dt;
        if (!city.isBlocked(nx, ny, 12)) {
          cop.x = nx;
          cop.y = ny;
          cop.angle = ma;
          moved = true;
          break;
        }
      }
      if (!moved) cop.angle += 0.8 * dt;
    }
    // Remove cops that clocked out (down === -1).
    for (let i = state.cops.length - 1; i >= 0; i -= 1) {
      if (state.cops[i].down === -1) state.cops.splice(i, 1);
    }
    return EVENT_NONE;
  }

  function updateBullets(dt) {
    let events = EVENT_NONE;
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && city.isBlocked(b.x, b.y, 2)) {
        addParticles(b.x, b.y, '#ffe066', 4, 80);
        dead = true;
      }
      if (!dead) {
        for (const ped of state.peds) {
          if (ped.state !== 'down' && dist(b.x, b.y, ped.x, ped.y) < 15) {
            events |= damagePed(ped, 100, b.x - b.vx * 0.01, b.y - b.vy * 0.01);
            scarePeds(b.x, b.y, 260);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        for (const cop of state.cops) {
          if (cop.down <= 0 && dist(b.x, b.y, cop.x, cop.y) < 15) {
            events |= damageCop(cop, 100);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        for (const car of state.cars) {
          if (car.driver === 'player') continue;
          if (dist(b.x, b.y, car.x, car.y) < 42) {
            events |= damageCar(car, 34);
            scarePeds(b.x, b.y, 200);
            dead = true;
            break;
          }
        }
      }
      if (dead) state.bullets.splice(i, 1);
    }
    return events;
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const pt = state.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.92;
      pt.vy *= 0.92;
      pt.life -= dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    let events = EVENT_NONE;
    const p = state.player;
    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const pk = state.pickups[i];
      if (dist(p.x, p.y, pk.x, pk.y) < 34) {
        if (pk.kind === 'money') state.money += pk.amount;
        else if (pk.kind === 'health') state.health = Math.min(PLAYER.health, state.health + pk.amount);
        else if (pk.kind === 'ammo') state.ammo += pk.amount;
        state.pickups.splice(i, 1);
        events |= EVENT_PICKUP;
        addParticles(pk.x, pk.y, '#f2c94c', 10, 120);
      }
    }
    return events;
  }

  function updateMission(dt) {
    let events = EVENT_NONE;
    const m = state.mission;
    if (!m || state.storyDone) return events;
    const def = MISSIONS[m.index];
    const step = def.steps[m.stepIndex];
    if (!step) return events;
    const p = state.player;
    if (step.type === 'enterCar') {
      if (!p.onFoot) return advanceStep();
    } else if (step.type === 'goto') {
      const t = m.target;
      if (t && dist(p.x, p.y, t.x, t.y) < 80 && (!step.needCar || !p.onFoot)) return advanceStep();
      if (step.timed) {
        m.timer -= dt;
        if (m.timer <= 0) return failMission('Too slow — the client walked away. Mission restarted.');
      }
    } else if (step.type === 'stealSport') {
      const car = playerCar();
      if (car && car.type === 'sport') return advanceStep();
    } else if (step.type === 'evade') {
      if (state.wanted === 0) return advanceStep();
    } else if (step.type === 'hold') {
      const t = m.target;
      if (t && dist(p.x, p.y, t.x, t.y) < 90) {
        m.holdProgress += dt;
        if (state.wanted < 2) setWanted(2, true);
        if (m.holdProgress >= step.seconds) {
          setWanted(4, true);
          return advanceStep();
        }
      } else {
        m.holdProgress = Math.max(0, m.holdProgress - dt * 2);
      }
    }
    return events;

    function advanceStep() {
      m.stepIndex += 1;
      m.holdProgress = 0;
      if (m.stepIndex >= def.steps.length) return completeMission();
      const next = def.steps[m.stepIndex];
      m.target = resolveTarget(next);
      if (next.timed) m.timer = next.timed;
      state.missionToast = next.label;
      state.missionToastTimer = 3;
      return EVENT_NONE;
    }
  }

  function updateWanted(dt) {
    if (state.wanted === 0) return EVENT_NONE;
    // Does any police unit see the player?
    let seen = false;
    for (const car of state.cars) {
      if (car.type === 'police' && car.driver === 'police' && dist(car.x, car.y, state.player.x, state.player.y) < 520) { seen = true; break; }
    }
    if (!seen) {
      for (const cop of state.cops) {
        if (cop.down <= 0 && dist(cop.x, cop.y, state.player.x, state.player.y) < 280) { seen = true; break; }
      }
    }
    if (seen) state.hiddenTimer = 0;
    else {
      state.hiddenTimer += dt;
      if (state.hiddenTimer >= WANTED.decaySeconds) {
        state.wanted -= 1;
        state.hiddenTimer = 0;
      }
    }
    return EVENT_NONE;
  }

  function updateCamera(dt, demo) {
    let tx;
    let ty;
    if (demo) {
      const t = state.time * 0.05;
      tx = CITY.width / 2 + Math.cos(t) * 500;
      ty = CITY.height / 2 + Math.sin(t * 0.7) * 350;
    } else {
      tx = state.player.x;
      ty = state.player.y;
    }
    const k = Math.min(1, dt * 5);
    state.camX += (tx - state.camX) * k;
    state.camY += (ty - state.camY) * k;
    state.camX = clamp(state.camX, 640, CITY.width - 640);
    state.camY = clamp(state.camY, 360, CITY.height - 360);
  }

  /**
   * One fixed step. `ctl` is { move:{x,y}, run, space, actions, aimAngle, shooting }.
   * With `demo` set (the title screen's backdrop) only traffic, pedestrians and time move.
   */
  function step(dt, ctl, demo) {
    let events = EVENT_NONE;
    state.time += dt;
    state.clock = (state.clock + (dt * 3600) / DAY.secondsPerHour) % 86400;
    if (state.missionToastTimer > 0) state.missionToastTimer -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.5);
    const p = state.player;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.punchCd > 0) p.punchCd -= dt;
    if (p.shootCd > 0) p.shootCd -= dt;

    if (demo) {
      updateTraffic(dt);
      updatePeds(dt);
      updateParticles(dt);
      updateCamera(dt, true);
      return EVENT_NONE;
    }

    if (p.onFoot) events |= updatePlayerOnFoot(dt, ctl);
    else events |= updatePlayerCar(dt, ctl);

    if (ctl.actions & ACTION_INTERACT) events |= doInteract();
    if (ctl.actions & ACTION_PUNCH) events |= doPunch();
    if (ctl.shooting) {
      const before = events;
      events |= doShoot(dt, ctl);
      if ((events & EVENT_SHOT) && !(before & EVENT_SHOT)) scarePeds(p.x, p.y, 320);
    }

    updateTraffic(dt);
    updatePeds(dt);
    events |= updatePolice(dt);
    events |= updateBullets(dt);
    updateParticles(dt);
    events |= updatePickups(dt);
    events |= updateMission(dt);
    events |= updateWanted(dt);
    maintainPolice();
    updateCamera(dt, false);
    return events;
  }

  reset();
  return { state, city, reset, serialize, deserialize, respawn, startMission, playerCar, step, scarePeds, _test: { setWanted, addWanted } };
}

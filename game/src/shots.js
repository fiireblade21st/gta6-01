// Screenshot staging: each shot sets up a scene, runs the simulation with an autopilot, and
// returns the screen + ui the renderer needs. ?shot=start|play|end (with ?seed=N for a fixed
// city). Nothing here is part of the game loop; it only exists so the three screenshots are
// real renders of the running game.
import { STEP } from './config.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function idleCtl() {
  return { move: { x: 0, y: 0 }, run: false, space: false, actions: 0, aimAngle: 0, shooting: false };
}

/** Drive straight along the Neon Strip (y = 1200), steering back to the centre line. */
function stripCtl(world) {
  const car = world.playerCar();
  if (!car) return idleCtl();
  const want = Math.atan2(1200 - car.y, 300);
  const diff = angleDiff(want, car.angle);
  return {
    move: { x: clamp(diff * 2, -1, 1), y: -1 },
    run: false, space: false, actions: 0, aimAngle: 0, shooting: false,
  };
}

function runSteps(world, n, ctlFn) {
  for (let i = 0; i < n; i += 1) {
    world.step(STEP, ctlFn(world), false);
    if (world.state.screen !== 'play') break;
  }
}

function putPlayerInCar(world, type, x, y, angle) {
  const st = world.state;
  let car = null;
  for (const c of st.cars) {
    if (c.type === type && !c.driver) { car = c; break; }
  }
  if (!car) car = st.cars.find((c) => !c.driver) || st.cars[0];
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.speed = 0;
  car.driver = 'player';
  car.ai = null;
  st.player.onFoot = false;
  st.player.carId = car.id;
  st.player.x = x;
  st.player.y = y;
  st.player.angle = angle;
  return car;
}

export function stageShot(name, world) {
  const st = world.state;
  if (name === 'start') {
    // Title over a living city: traffic and pedestrians move, the camera pans downtown.
    world.reset();
    for (let i = 0; i < 300; i += 1) {
      world.step(STEP, idleCtl(), true);
    }
    st.screen = 'title';
    return { screen: 'title', ui: { hasSave: false, mouseLogical: { x: 640, y: 360 }, showCrosshair: false } };
  }

  if (name === 'play') {
    // Evening on the Neon Strip: Jax driving, 2 stars, police in pursuit, HUD + minimap live.
    world.reset();
    world.startMission(0);
    st.screen = 'play';
    st.clock = 19 * 3600;
    putPlayerInCar(world, 'sedan', 600, 1200, 0);
    world._test.setWanted(2);
    runSteps(world, 420, stripCtl);
    st.screen = 'play';
    return { screen: 'play', ui: { mouseLogical: { x: 640, y: 360 }, showCrosshair: false } };
  }

  if (name === 'end') {
    // Mission complete: the gold sports car, $1,250 banked, next job on the HUD.
    world.reset();
    st.money = 1250;
    st.missionsDone[0] = true;
    world.startMission(1);
    st.screen = 'play';
    st.clock = 10 * 3600;
    const gold = st.cars.find((c) => c.id === st.goldCarId) || st.cars[0];
    gold.x = 1500;
    gold.y = 1200;
    gold.angle = 0;
    gold.speed = 0;
    gold.driver = 'player';
    gold.ai = null;
    st.player.onFoot = false;
    st.player.carId = gold.id;
    st.player.x = 1500;
    st.player.y = 1200;
    st.player.angle = 0;
    st.missionToast = 'Mission complete: First Fare  +$200';
    st.missionToastTimer = 4;
    runSteps(world, 240, stripCtl);
    st.screen = 'play';
    st.missionToast = 'Mission complete: First Fare  +$200';
    st.missionToastTimer = 4;
    return { screen: 'play', ui: { mouseLogical: { x: 640, y: 360 }, showCrosshair: false } };
  }

  // Unknown shot: the title.
  world.reset();
  st.screen = 'title';
  return { screen: 'title', ui: { hasSave: false, mouseLogical: { x: 640, y: 360 }, showCrosshair: false } };
}

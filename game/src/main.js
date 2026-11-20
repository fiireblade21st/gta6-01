// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps,
// and the renderer paints what is there. Screens live in world.state.screen: title, play,
// paused, mission (job intro), busted, wasted and complete (story done). The world only
// simulates while the screen is play; the loop owns the transitions. One-shot presses are
// taken once per frame and handed to the first fixed step only, so a press never fires twice.
//
// ?seed=N fixes the city. ?shot=start|play|end (with &seed=N) stages that scene instead of
// running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { FIELD, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_BUSTED, EVENT_CRASH, EVENT_MISSION_DONE, EVENT_MISSION_FAIL, EVENT_PICKUP, EVENT_PUNCH, EVENT_SHOT, EVENT_STEAL, EVENT_WANTED_UP, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_COMPLETE, SCREEN_MISSION, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
// Debug hook for automated checks only: ?debug=1 exposes the world for inspection.
if (params.get('debug') === '1') window.__world = world;
const renderer = createRenderer(canvas);
const audio = createAudio();
const input = createInput(canvas);

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save !== 'object' || save === null) return null;
    return save;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, scene.ui);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

/** Mouse position in logical (1280x720) coordinates, using the renderer's view. */
function logicalMouse() {
  const ratio = window.devicePixelRatio || 1;
  const v = renderer.view;
  return {
    x: (input.mouse.x * ratio - v.x) / v.scale,
    y: (input.mouse.y * ratio - v.y) / v.scale,
  };
}

function runGame() {
  let save = readSave();
  let accumulator = 0;
  let last = performance.now();
  let muted = false;
  let continueKey = false;

  function announce(message) {
    status.textContent = message;
  }

  function ui() {
    return {
      hasSave: !!save,
      saveMoney: save ? save.money || 0 : 0,
      saveMission: save ? save.missionIndex || 0 : 0,
      muted,
      mouseLogical: logicalMouse(),
      showCrosshair: world.state.screen === SCREEN_PLAY && world.state.player.onFoot,
    };
  }

  function startNewGame() {
    world.reset();
    save = null;
    try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    world.startMission(0);
    announce('First Fare. Press E to start the job.');
  }

  function continueGame() {
    const s = readSave();
    if (!s) return;
    world.deserialize(s);
    announce('Continuing. Press E to start the job.');
  }

  function applyEvents(events) {
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_SHOT) audio.shot();
    if (events & EVENT_PUNCH) audio.punch();
    if (events & EVENT_CRASH) audio.crash(0.6);
    if (events & EVENT_WANTED_UP) audio.wantedUp();
    if (events & EVENT_STEAL) audio.pickup();
    if (events & EVENT_MISSION_DONE) {
      audio.missionDone();
      writeSave();
    }
    if (events & EVENT_MISSION_FAIL) audio.wantedUp();
    if (events & EVENT_BUSTED) {
      const fine = Math.max(50, Math.floor(world.state.money * 0.2));
      world.state.money = Math.max(0, world.state.money - fine);
      world.state.fine = fine;
      world.state.screen = SCREEN_BUSTED;
      audio.busted();
      writeSave();
      announce(`Busted. Fine $${fine}.`);
    }
    if (events & EVENT_WASTED) {
      const fine = Math.max(50, Math.floor(world.state.money * 0.1));
      world.state.money = Math.max(0, world.state.money - fine);
      world.state.fine = fine;
      world.state.screen = SCREEN_WASTED;
      audio.busted();
      writeSave();
      announce(`Wasted. Hospital bill $${fine}.`);
    }
  }

  function aimAngle() {
    const st = world.state;
    const lm = logicalMouse();
    const wx = lm.x + st.camX - FIELD.width / 2;
    const wy = lm.y + st.camY - FIELD.height / 2;
    return Math.atan2(wy - st.player.y, wx - st.player.x);
  }

  function step(actions) {
    const ctl = {
      move: input.move(),
      run: input.running(),
      space: input.spaceHeld(),
      actions,
      aimAngle: aimAngle(),
      shooting: input.mouse.down,
    };
    const events = world.step(STEP, ctl, false);
    applyEvents(events);
    // Engine + siren follow the world.
    const car = world.playerCar();
    const speed01 = car ? Math.min(1, Math.abs(car.speed) / 560) : 0;
    audio.engine(world.state.player.onFoot ? 0 : speed01);
    audio.siren(world.state.wanted > 0);
  }

  /** Handle screen transitions. Returns the actions the first fixed step may use. */
  function handleActions(actions) {
    const screen = world.state.screen;
    if (actions & ACTION_MUTE) {
      muted = audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE) {
      if (continueKey) {
        continueKey = false;
        continueGame();
      } else if (actions & ACTION_CONFIRM) {
        startNewGame();
      }
      return 0;
    }
    if (screen === SCREEN_MISSION) {
      if (actions & (ACTION_CONFIRM | ACTION_INTERACT)) {
        world.state.screen = SCREEN_PLAY;
        announce('Job started.');
        // The same press must not also enter a car on the first play frame.
        return actions & ~(ACTION_CONFIRM | ACTION_INTERACT);
      }
      return 0;
    }
    if (screen === SCREEN_BUSTED) {
      if (actions & ACTION_CONFIRM) {
        world.respawn(true);
        world.state.screen = SCREEN_PLAY;
        announce('Back on the street. Stay clean.');
      }
      return 0;
    }
    if (screen === SCREEN_WASTED) {
      if (actions & ACTION_CONFIRM) {
        world.respawn(false);
        world.state.screen = SCREEN_PLAY;
        announce('Patched up. Back on the street.');
      }
      return 0;
    }
    if (screen === SCREEN_COMPLETE) {
      if (actions & ACTION_CONFIRM) {
        world.state.screen = SCREEN_PLAY;
        announce('Free roam. Neon Bay is yours.');
      }
      return 0;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        world.state.screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return 0;
    }
    if (screen === SCREEN_PLAY && (actions & ACTION_PAUSE)) {
      world.state.screen = SCREEN_PAUSED;
      announce('Paused.');
      return 0;
    }
    return actions;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    const stepActions = handleActions(actions);
    const screen = world.state.screen;
    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) {
        world.step(STEP, { move: { x: 0, y: 0 }, run: false, space: false, actions: 0, aimAngle: 0, shooting: false }, true);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      let first = true;
      while (accumulator >= STEP && world.state.screen === SCREEN_PLAY) {
        step(first ? stepActions : 0);
        first = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world, world.state.screen, ui());
  }

  // First gesture unlocks audio (browsers block sound until then) and starts the music.
  function unlockAudio() {
    audio.unlock();
    audio.startMusic();
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  // C continues a saved game from the title screen.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC' && world.state.screen === SCREEN_TITLE && readSave()) {
      continueKey = true;
    }
  });
  // Leaving the tab pauses a running game and saves it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (world.state.screen === SCREEN_PLAY) world.state.screen = SCREEN_PAUSED;
      writeSave();
    }
  });

  announce('Neon Bay. Press Space to start, C to continue a save.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();

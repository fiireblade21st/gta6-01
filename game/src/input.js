// Keyboard, mouse and pointer input. Held keys give a 2D movement vector; one-shot presses
// (confirm, pause, interact, punch, mute) are queued as bit flags and taken once by the loop, so
// a press between two frames is never lost and never counted twice. The mouse position is kept in
// canvas CSS pixels and a held left button means "shoot toward the cursor".

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_PUNCH = 8;
export const ACTION_MUTE = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const INTERACT = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);

export function createInput(canvas) {
  const held = { up: false, down: false, left: false, right: false, run: false, space: false };
  const mouse = { x: 0, y: 0, down: false, clicked: false };
  let actions = 0;

  function keyDown(event) {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (RUN.has(event.code)) held.run = true;
    else if (CONFIRM.has(event.code)) {
      held.space = true;
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (INTERACT.has(event.code)) {
      if (!event.repeat) actions |= ACTION_INTERACT;
    } else if (PUNCH.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PUNCH;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  }

  function keyUp(event) {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (RUN.has(event.code)) held.run = false;
    else if (CONFIRM.has(event.code)) held.space = false;
  }

  function pointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }

  function pointerDown(event) {
    pointerMove(event);
    mouse.down = true;
    mouse.clicked = true;
    actions |= ACTION_CONFIRM;
  }

  function pointerUp() {
    mouse.down = false;
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = held.run = false;
    mouse.down = false;
  });
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointerup', pointerUp);

  return {
    /** Normalised {x, y} movement vector from held keys (0,0 when none). */
    move() {
      const x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      const y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    },
    running() {
      return held.run;
    },
    /** True while Space is held (handbrake in a car, confirm on menus). */
    spaceHeld() {
      return held.space;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Mouse in canvas CSS pixels; down = left button held; clicked = pressed since last take. */
    mouse,
    takeClicked() {
      const c = mouse.clicked;
      mouse.clicked = false;
      return c;
    },
  };
}

// Every tuning number, colour and mission in one place. The playfield is a fixed 1280x720
// logical area; the renderer scales it to the window and the camera follows the player through
// the 3840x2880 city, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Where the save lives between visits (this browser only). */
export const SAVE_KEY = 'neon-bay.save.v1';

export const PLAYER = {
  radius: 13,
  walkSpeed: 210,
  runSpeed: 330,
  health: 100,
  punchRange: 34,
  punchDamage: 25,
  punchCooldown: 0.45,
  shootCooldown: 0.22,
  invulnerable: 0.8,
};

/** Car types: top speed (units/s), acceleration, steering, colour. Police is fastest. */
export const CAR_TYPES = {
  sedan: { name: 'Sedan', topSpeed: 420, accel: 300, brake: 520, steer: 2.6, color: '#5b8dd9', width: 46, length: 78 },
  taxi: { name: 'Taxi', topSpeed: 400, accel: 290, brake: 520, steer: 2.6, color: '#f2c94c', width: 46, length: 78 },
  sport: { name: 'Sport', topSpeed: 560, accel: 430, brake: 600, steer: 3.1, color: '#e5534b', width: 44, length: 82 },
  police: { name: 'Police', topSpeed: 500, accel: 380, brake: 620, steer: 3.0, color: '#2f6fd0', width: 46, length: 80 },
};

export const CAR = {
  /** How close the player must be to a car to enter/steal it. */
  enterRange: 62,
  /** Seconds a car stays "fresh" after a crash before it can be damaged again. */
  crashCooldown: 0.4,
};

/** Wanted stars 0-5: what raises them and how police respond. */
export const WANTED = {
  stealCar: 1,
  hitPed: 1,
  shoot: 1,
  ramPolice: 1,
  killCop: 2,
  /** Seconds hidden (no police sees the player) before one star drops. */
  decaySeconds: 14,
  /** Police cars on the map per wanted level (index = stars). */
  policeCars: [0, 1, 2, 3, 4, 5],
  /** Foot officers per wanted level. */
  policeFoot: [0, 1, 1, 2, 3, 4],
};

/** Pedestrian tuning. */
export const PED = {
  count: 26,
  walkSpeed: 55,
  fleeSpeed: 190,
  radius: 11,
};

/** Traffic tuning. */
export const TRAFFIC = {
  count: 14,
  speed: 150,
  /** Minimum gap a traffic car keeps from the car ahead on its loop. */
  followGap: 90,
};

/** Mission rewards and timers. */
export const MISSIONS = [
  {
    id: 'fare',
    title: 'First Fare',
    intro: 'Jax, you need wheels and cash. Grab a car, pick up the fare at the taxi rank, and drop them at the Grand Hotel.',
    reward: 200,
    steps: [
      { type: 'enterCar', label: 'Get a car (walk up to one, press E)' },
      { type: 'goto', to: 'taxiRank', label: 'Drive to the taxi rank', needCar: true },
      { type: 'goto', to: 'hotel', label: 'Drop the fare at the Grand Hotel', needCar: true },
    ],
  },
  {
    id: 'package',
    title: 'Package Run',
    intro: 'A package is waiting at the docks. Pick it up and deliver it to the Neon Strip club — fast. The client hates waiting.',
    reward: 350,
    steps: [
      { type: 'goto', to: 'docks', label: 'Pick up the package at the docks' },
      { type: 'goto', to: 'strip', label: 'Deliver to the Neon Strip club', timed: 100 },
    ],
  },
  {
    id: 'hotwheels',
    title: 'Hot Wheels',
    intro: 'A gold sports car is parked near the park. "Borrow" it — the owner will not miss it — and bring it to the chop shop.',
    reward: 500,
    steps: [
      { type: 'stealSport', label: 'Steal the gold sports car (press E near it)' },
      { type: 'goto', to: 'chopShop', label: 'Deliver it to the chop shop', needCar: true },
    ],
  },
  {
    id: 'getaway',
    title: 'The Getaway',
    intro: 'The job went loud. Three stars and every cop in Neon Bay is on you. Lose them — stay out of sight until the heat dies down.',
    reward: 600,
    steps: [
      { type: 'evade', label: 'Lose the 3-star wanted level' },
    ],
  },
  {
    id: 'courier',
    title: 'Midnight Courier',
    intro: 'Night run. Three drops across the city: the hotel, the docks, the strip. Keep it quiet — the police are out tonight.',
    reward: 800,
    steps: [
      { type: 'goto', to: 'hotel', label: 'Drop 1/3: Grand Hotel' },
      { type: 'goto', to: 'docks', label: 'Drop 2/3: the docks' },
      { type: 'goto', to: 'strip', label: 'Drop 3/3: Neon Strip club' },
    ],
  },
  {
    id: 'bigscore',
    title: 'The Big Score',
    intro: 'The last one. Hit the bank — hold your ground while the alarm screams — then run for the safehouse with four stars on your tail.',
    reward: 1500,
    steps: [
      { type: 'hold', at: 'bank', seconds: 10, label: 'Hold the bank while the alarm rings' },
      { type: 'goto', to: 'safehouse', label: 'Escape to the safehouse' },
    ],
  },
];

/** Colours: night neon city. Day/night is a tint over the same palette. */
export const PALETTE = {
  backdrop: '#0a0d16',
  road: '#232833',
  roadLine: '#c8b25a',
  sidewalk: '#3a4152',
  grass: '#1e4d2b',
  sand: '#8a7a4d',
  water: '#0d3a5c',
  buildingRoof: '#2c3345',
  buildingEdge: '#4a5468',
  park: '#1e4d2b',
  tree: '#2f7a3d',
  player: '#4fc3f7',
  playerCar: '#4fc3f7',
  ped: '#d8b25a',
  police: '#2f6fd0',
  policeLight: '#ff3b30',
  bullet: '#ffe066',
  text: '#eef1f5',
  muted: '#8b93a3',
  panel: '#161b28',
  panelEdge: '#3a4358',
  gold: '#f2c94c',
  red: '#e5534b',
  green: '#58c96b',
  marker: '#ff5fa2',
  minimapBg: '#10141f',
};

/** Day/night: clock runs 1 game-hour per 150 real seconds; 06:00-18:00 is day. */
export const DAY = {
  secondsPerHour: 150,
  dayStart: 6,
  dayEnd: 18,
  /** Night overlay alpha (0 = day, 1 = full night). */
  nightAlpha: 0.42,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

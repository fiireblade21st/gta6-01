// Neon Bay: peta kota open-world 2D top-down, 3840 x 2880 unit.
// Grid jalan teratur (tiap ~480 unit) supaya mobil AI bisa keliling;
// blok di antara jalan diisi gedung sesuai karakter distriknya.
// Semua posisi deterministik dari `random` yang diberikan (mulberry32
// dari pemanggil) — file ini tidak pernah memakai Math.random.

export const CITY = { width: 3840, height: 2880 };

// --- Geometri jalan ---------------------------------------------------------
const ROAD_W = 72; // lebar jalan
const SIDEWALK = 16; // trotoar di tiap sisi jalan
const CLEAR = ROAD_W / 2 + SIDEWALK; // jarak tepi jalan -> tepi blok (52)
const LANE = 18; // offset lajur kanan dari tengah jalan (setengah lajur)
const WATER_Y = 2760; // laut mulai di sini sampai tepi selatan dunia

// Garis tengah jalan vertikal / horizontal.
const XV = [240, 720, 1200, 1680, 2160, 2640, 3120, 3600];
const YH = [240, 720, 1200, 1680, 2160, 2520]; // 2520 = jalan pantai

// Palet warna per distrik (dipilih acak, tetap deterministik).
const PALETTES = {
  downtown: ['#232a3a', '#2b3245', '#1d2230', '#37415c', '#2e3d4f', '#20242e', '#3a2f4d'],
  neon: ['#ff2d78', '#00e5ff', '#ffe600', '#7c4dff', '#ff6b00', '#39ff6a', '#ff2d95'],
  suburbs: ['#e8c39e', '#c9d6a3', '#f2d492', '#a3c6d6', '#d6a3b8', '#e5e5e5', '#cbb593'],
  park: ['#7a9e6e', '#8fae7d', '#6b8f7a'],
  beach: ['#f5e6c8', '#ffd9a0', '#fff3d6', '#e8b4b8', '#a8d8e8'],
};

function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleHitsRect(x, y, r, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

export function createCity(random) {
  // Tanpa random dari pemanggil, pakai seed tetap supaya tetap deterministik.
  const rand = typeof random === 'function' ? random : mulberry32(1337);
  const range = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // --- Distrik (partisi tanpa tumpang tindih; air di luar semua distrik) ---
  const districts = [
    { name: 'Suburbs', x: 0, y: 0, w: 3840, h: 480, label: 'SUBURBS' },
    { name: 'Park', x: 0, y: 480, w: 960, h: 1680, label: 'PARK' },
    { name: 'Downtown', x: 960, y: 480, w: 1920, h: 480, label: 'DOWNTOWN' },
    { name: 'Neon Strip', x: 960, y: 960, w: 1920, h: 480, label: 'NEON STRIP' },
    { name: 'Downtown', x: 960, y: 1440, w: 1920, h: 720, label: 'DOWNTOWN' },
    { name: 'Suburbs', x: 2880, y: 480, w: 960, h: 1680, label: 'SUBURBS' },
    { name: 'Beach', x: 0, y: 2160, w: 3840, h: 600, label: 'BEACH' },
  ];

  function districtAt(x, y) {
    for (const d of districts) {
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.name;
    }
    return '';
  }

  // --- Jalan: 8 vertikal (berhenti di tepi selatan jalan pantai) + 6 horizontal ---
  const roads = [];
  for (const cx of XV) roads.push({ x: cx - ROAD_W / 2, y: 0, w: ROAD_W, h: YH[YH.length - 1] + ROAD_W / 2, horizontal: false });
  for (const cy of YH) roads.push({ x: 0, y: cy - ROAD_W / 2, w: CITY.width, h: ROAD_W, horizontal: true });

  const beach = { x: 0, y: YH[YH.length - 1] + CLEAR, w: CITY.width, h: WATER_Y - (YH[YH.length - 1] + CLEAR) };
  const water = { x: 0, y: WATER_Y, w: CITY.width, h: CITY.height - WATER_Y };

  // --- Taman: 2 blok besar di barat + 1 taman saku di timur ---
  const parks = [
    { x: 292, y: 772, w: 376, h: 376 },
    { x: 292, y: 1252, w: 376, h: 376 },
    { x: 3172, y: 292, w: 376, h: 376 },
  ];

  // --- Blok (sel di antara jalan); tepi blok sudah di luar jalan + trotoar ---
  const colEdges = [0, ...XV, CITY.width];
  const colSpans = [];
  for (let i = 0; i < colEdges.length - 1; i += 1) {
    const a = i === 0 ? 0 : colEdges[i] + CLEAR;
    const b = i === colEdges.length - 2 ? CITY.width : colEdges[i + 1] - CLEAR;
    colSpans.push({ a, b });
  }
  // Baris blok: [0, YH[0]-CLEAR], lalu [YH[j-1]+CLEAR, YH[j]-CLEAR].
  // Baris terakhir berhenti di tepi utara jalan pantai; di bawahnya pantai.
  const rows = [];
  for (let j = 0; j < YH.length; j += 1) {
    if (j === 0) rows.push({ a: 0, b: YH[0] - CLEAR });
    else rows.push({ a: YH[j - 1] + CLEAR, b: YH[j] - CLEAR });
  }

  // --- Gedung: isi tiap blok sesuai distrik; sub-lot berjarak jadi tak overlap ---
  const buildings = [];
  function addBuilding(x, y, w, h, color, height) {
    buildings.push({ x, y, w, h, color, height });
  }
  // Bagi satu blok jadi lot-lot kecil (cols x rows) dengan gap + inset.
  function sublots(cell, cols, rowsCount, gap, inset) {
    const lots = [];
    const w = (cell.w - inset * 2 - gap * (cols - 1)) / cols;
    const h = (cell.h - inset * 2 - gap * (rowsCount - 1)) / rowsCount;
    for (let r = 0; r < rowsCount; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        lots.push({ x: cell.x + inset + c * (w + gap), y: cell.y + inset + r * (h + gap), w, h });
      }
    }
    return lots;
  }

  for (let ci = 0; ci < colSpans.length; ci += 1) {
    for (let ri = 0; ri < rows.length; ri += 1) {
      const cell = { x: colSpans[ci].a, y: rows[ri].a, w: colSpans[ci].b - colSpans[ci].a, h: rows[ri].b - rows[ri].a };
      if (cell.w <= 0 || cell.h <= 0) continue;
      if (parks.some((p) => rectsOverlap(cell, p))) continue; // blok taman: tanpa gedung
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      const district = districtAt(cx, cy);
      const wide = cell.w >= 300;

      if (district === 'Downtown') {
        // Menara kaca padat, 2x2 per blok.
        for (const lot of sublots(cell, wide ? 2 : 1, 2, 14, 12)) {
          if (rand() < 0.06) continue; // sesekali lot kosong
          addBuilding(lot.x, lot.y, lot.w, lot.h, pick(PALETTES.downtown), Math.round(range(55, 140)));
        }
      } else if (district === 'Neon Strip') {
        // Ruko neon menghadap jalan utama y=1200, gedung biasa di belakangnya.
        const streetSouth = cy < 1200; // blok di utara jalan: toko di sisi selatan
        const cols = wide ? 4 : 2;
        const shopH = 58;
        const shopY = streetSouth ? cell.y + cell.h - 12 - shopH : cell.y + 12;
        const shopW = (cell.w - 24 - 10 * (cols - 1)) / cols;
        for (let c = 0; c < cols; c += 1) {
          addBuilding(cell.x + 12 + c * (shopW + 10), shopY, shopW, shopH, pick(PALETTES.neon), Math.round(range(12, 26)));
        }
        const backY = streetSouth ? cell.y + 12 : cell.y + 12 + shopH + 10;
        const backH = cell.h - 24 - shopH - 10;
        if (backH > 40) {
          const bw = (cell.w - 24 - 12) / 2;
          for (let c = 0; c < 2; c += 1) {
            addBuilding(cell.x + 12 + c * (bw + 12), backY, bw, backH, pick(PALETTES.downtown), Math.round(range(30, 60)));
          }
        }
      } else if (district === 'Suburbs') {
        // Rumah kecil 2x2, warna pastel.
        for (const lot of sublots(cell, wide ? 2 : 1, 2, 16, 14)) {
          if (rand() < 0.12) continue;
          addBuilding(lot.x, lot.y, lot.w, lot.h, pick(PALETTES.suburbs), Math.round(range(10, 18)));
        }
      } else if (district === 'Park') {
        // Hampir kosong: sesekali satu kios kecil.
        if (rand() < 0.5) {
          const w = range(60, 90);
          const h = range(50, 70);
          addBuilding(cx - w / 2, cy - h / 2, w, h, pick(PALETTES.park), Math.round(range(8, 14)));
        }
      } else if (district === 'Beach') {
        // Hotel tepi pantai, deret menghadap laut.
        const cols = wide ? 3 : 1;
        for (const lot of sublots(cell, cols, 1, 14, 12)) {
          addBuilding(lot.x, lot.y, lot.w, lot.h, pick(PALETTES.beach), Math.round(range(22, 48)));
        }
      }
    }
  }

  // --- Pohon: di taman, di trotoar, dan di halaman rumah ---
  const trees = [];
  function treeInBuilding(x, y, r) {
    for (const b of buildings) {
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return true;
    }
    return false;
  }
  for (const p of parks) {
    const n = 26 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i += 1) {
      trees.push({ x: p.x + 20 + rand() * (p.w - 40), y: p.y + 20 + rand() * (p.h - 40), r: range(10, 18) });
    }
  }
  // Trotoar: pohon di tengah trotoar (offset 44 dari tengah jalan), tiap ~260 unit.
  for (const cx of XV) {
    for (let y = 120; y < YH[YH.length - 1]; y += 260) {
      const x = cx + (rand() < 0.5 ? -44 : 44);
      const r = range(9, 14);
      if (isOnRoad(x, y)) continue; // dekat persimpangan: trotoar ketemu jalan silang
      if (!treeInBuilding(x, y, r + 4)) trees.push({ x, y, r });
    }
  }
  for (const cy of YH) {
    for (let x = 120; x < CITY.width - 60; x += 260) {
      const y = cy + (rand() < 0.5 ? -44 : 44);
      const r = range(9, 14);
      if (y > WATER_Y) continue;
      if (isOnRoad(x, y)) continue; // dekat persimpangan: trotoar ketemu jalan silang
      if (!treeInBuilding(x, y, r + 4)) trees.push({ x, y, r });
    }
  }
  // Halaman rumah di Suburbs: titik acak yang lolos dari gedung.
  for (let ci = 0; ci < colSpans.length; ci += 1) {
    for (let ri = 0; ri < rows.length; ri += 1) {
      const cell = { x: colSpans[ci].a, y: rows[ri].a, w: colSpans[ci].b - colSpans[ci].a, h: rows[ri].b - rows[ri].a };
      if (districtAt(cell.x + cell.w / 2, cell.y + cell.h / 2) !== 'Suburbs') continue;
      if (parks.some((p) => rectsOverlap(cell, p))) continue;
      for (let t = 0; t < 2; t += 1) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const x = cell.x + 20 + rand() * Math.max(1, cell.w - 40);
          const y = cell.y + 20 + rand() * Math.max(1, cell.h - 40);
          const r = range(9, 15);
          if (!treeInBuilding(x, y, r + 6)) {
            trees.push({ x, y, r });
            break;
          }
        }
      }
    }
  }

  // --- Loop lalu-lintas: searah jarum jam mengelilingi satu blok, lajur kanan ---
  function blockLoop(i, j) {
    const xL = XV[i] + LANE;
    const xR = XV[i + 1] - LANE;
    const yT = YH[j] + LANE;
    const yB = YH[j + 1] - LANE;
    const xM = (xL + xR) / 2;
    const yM = (yT + yB) / 2;
    // Atas ke timur, kanan ke selatan, bawah ke barat, kiri ke utara.
    return [
      { x: xL, y: yT }, { x: xM, y: yT }, { x: xR, y: yT }, { x: xR, y: yM },
      { x: xR, y: yB }, { x: xM, y: yB }, { x: xL, y: yB }, { x: xL, y: yM },
    ];
  }
  // Loop panjang mengelilingi beberapa blok (avenue), titik di tiap persimpangan.
  function avenueLoop(cxL, cxR, cyT, cyB) {
    const pts = [];
    const xs = XV.filter((v) => v > cxL && v < cxR);
    const ys = YH.filter((v) => v > cyT && v < cyB);
    pts.push({ x: cxL + LANE, y: cyT + LANE });
    for (const v of xs) pts.push({ x: v, y: cyT + LANE });
    pts.push({ x: cxR - LANE, y: cyT + LANE });
    for (const v of ys) pts.push({ x: cxR - LANE, y: v });
    pts.push({ x: cxR - LANE, y: cyB - LANE });
    for (let k = xs.length - 1; k >= 0; k -= 1) pts.push({ x: xs[k], y: cyB - LANE });
    pts.push({ x: cxL + LANE, y: cyB - LANE });
    for (let k = ys.length - 1; k >= 0; k -= 1) pts.push({ x: cxL + LANE, y: ys[k] });
    return pts;
  }
  const loops = [
    blockLoop(0, 2), // Park (barat)
    blockLoop(0, 3), // Park (barat)
    blockLoop(2, 0), // Downtown utara
    blockLoop(3, 3), // Downtown selatan
    blockLoop(4, 3), // Downtown selatan
    blockLoop(2, 2), // Neon Strip
    blockLoop(4, 2), // Neon Strip
    blockLoop(5, 0), // Suburbs utara
    blockLoop(6, 2), // Suburbs timur
    blockLoop(1, 4), // Beach barat
    blockLoop(3, 4), // Beach tengah
    avenueLoop(1200, 2640, 720, 1680), // avenue panjang: lingkar Downtown
    avenueLoop(720, 3120, 720, 2160), // avenue panjang: lingkar luar kota
  ];

  // --- Spawn: semua di tepi jalan (offset 24 dari tengah = masih di aspal) ---
  const spawns = {
    player: { x: 1680, y: 1224 },
    policeStation: { x: 1224, y: 720 },
    hospital: { x: 2136, y: 720 },
    taxiRank: { x: 2400, y: 1176 },
    docks: { x: 720, y: 2544 },
    hotel: { x: 3120, y: 2496 },
    chopShop: { x: 3144, y: 1680 },
    bank: { x: 1680, y: 744 },
    safehouse: { x: 2640, y: 264 },
    strip: { x: 1920, y: 1224 },
  };

  // --- Query ---------------------------------------------------------------
  function isInWater(x, y) {
    return x >= water.x && x < water.x + water.w && y >= water.y && y < water.y + water.h;
  }
  function isOnRoad(x, y) {
    for (const r of roads) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }
  function isBlocked(x, y, r) {
    if (x - r < 0 || x + r > CITY.width || y - r < 0 || y + r > CITY.height) return true;
    if (isInWater(x, y)) return true;
    for (const b of buildings) {
      if (circleHitsRect(x, y, r, b)) return true;
    }
    return false;
  }
  function nearestRoadPoint(x, y) {
    let best = null;
    let bestD = Infinity;
    const consider = (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: px, y: py };
      }
    };
    const roadSouth = YH[YH.length - 1] + ROAD_W / 2; // ujung selatan jalan vertikal
    for (const cx of XV) consider(cx, clamp(y, 0, roadSouth));
    for (const cy of YH) consider(clamp(x, 0, CITY.width), cy);
    return best;
  }

  return {
    roads, buildings, trees, parks, beach, water, districts, loops, spawns,
    isBlocked, isOnRoad, isInWater, nearestRoadPoint, districtAt,
  };
}

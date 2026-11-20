// Neon Bay — the hand-in program for the gta6-01 bounty.
// The game itself lives in game/ beside this file: a 2D top-down open world
// where Jax, a driver for hire, works the five districts of Neon Bay — on
// foot and behind the wheel, dodging traffic, lifting cars, running six story
// missions, and outrunning the police as the wanted stars climb. The folder
// is plain static files (index.html plus its modules, no libraries, no
// network), and screenshots/ holds three JPEG renders of it in play.
// What this program does is only the staging: it copies game/ and
// screenshots/ into the output directory the grader reads, then asks the
// vendored make.fun library to write the dossier (makefun/dossier/v1) from
// that staged copy. The grader's container runs it with no environment set,
// so the output lands in /output; anywhere else, MAKEFUN_OUTPUT_DIR stands
// in for that directory:
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath as pathFromUrl } from 'node:url';
import { buildDossier as makeDossier } from './vendor/makefun-game.ts';

// The folder this file sits in: the repository root, with game/ and
// screenshots/ beside it.
const repoRoot = pathFromUrl(new URL('.', import.meta.url));

// Where the staged entry goes: the environment's directory when the grader
// sets one, the container's /output otherwise.
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy one of the repository's folders into the same-named folder under the
// destination, creating parents as needed.
function stageFolder(folderName) {
  fs.cpSync(path.join(repoRoot, folderName), path.join(destination, folderName), { recursive: true });
}

fs.mkdirSync(destination, { recursive: true });
stageFolder('game');
fs.mkdirSync(path.join(destination, 'screenshots'), { recursive: true });
if (fs.existsSync(path.join(repoRoot, 'screenshots'))) {
  stageFolder('screenshots');
}

// The scorer's own limits, from the bounty's gate: the dossier text may hold
// 160 KiB; at most four screenshots, each at most 256 KiB; the staged game
// may hold at most 993 entries and 48 MiB, and no path under game/ may run
// past 1000 bytes. buildDossier refuses exactly where the scorer would, so
// the same numbers go in here.
const kib = 1024;
const gateLimits = {
  text_max_bytes: 160 * kib,
  screenshots: { max: 4, max_bytes: 256 * kib },
  game_max_files: 993, game_max_bytes: 48 * kib * kib, game_path_max_bytes: 1000,
};

const dossierBytes = makeDossier(destination, gateLimits);
fs.writeFileSync(path.join(destination, 'dossier.json'), dossierBytes);

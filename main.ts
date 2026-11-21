// Neon Bay — the hand-in program for the gta6-01 bounty.
//
// The game is the static folder game/ next to this file: a 2D top-down open
// world set in Neon Bay, where Jax the driver-for-hire works five districts
// on foot and by car, dodging traffic, lifting cars, running six story
// missions and shaking the police as the wanted stars climb. No libraries,
// no network — index.html and its modules, plus three JPEG stills under
// screenshots/.
//
// This program only stages the entry for the grader: it copies game/ and
// screenshots/ into the output directory, checks the staged copy against
// the bounty's own limits, and asks the vendored make.fun library to write
// the dossier (makefun/dossier/v1) from that staged copy. With no
// environment set the grader's container reads from /output; anywhere else,
// MAKEFUN_OUTPUT_DIR names the directory instead:
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath as pathFromUrl } from 'node:url';
import { buildDossier as makeDossier } from './vendor/makefun-game.ts';

// The repository root: this file sits beside game/ and screenshots/.
const repoRoot = pathFromUrl(new URL('.', import.meta.url));

// Where the staged entry goes.
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Stop with a clear message instead of a stack trace.
function fail(message) {
  console.error(`neon-bay: ${message}`);
  process.exit(1);
}

// Copy one repository folder into the same-named folder under the
// destination, creating parents as needed.
function stageFolder(folderName) {
  fs.cpSync(path.join(repoRoot, folderName), path.join(destination, folderName), { recursive: true });
}

// Walk a folder and count what it holds: how many files, how many bytes in
// total, and the longest path inside it (measured in bytes, relative to the
// folder itself). Used to check the staged game against the gate before the
// dossier builder sees it.
function census(folder) {
  let files = 0;
  let bytes = 0;
  let longest = 0;
  const stack = [folder];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        stack.push(full);
      } else {
        files += 1;
        bytes += fs.statSync(full).size;
        longest = Math.max(longest, Buffer.byteLength(path.relative(folder, full)));
      }
    }
  }
  return { files, bytes, longest };
}

// The scorer's limits, from the bounty's gate: the dossier text may hold
// 160 KiB; at most four screenshots, each at most 256 KiB; the staged game
// may hold at most 993 entries and 48 MiB, and no path under game/ may run
// past 1000 bytes. buildDossier refuses exactly where the scorer would, so
// the same numbers are checked here first.
const kib = 1024;
const gateLimits = {
  text_max_bytes: 160 * kib,
  screenshots: { max: 4, max_bytes: 256 * kib },
  game_max_files: 993, game_max_bytes: 48 * kib * kib, game_path_max_bytes: 1000,
};

// Fail fast when the game itself is missing its entry point: without
// index.html the staged copy would be a broken game and the dossier build
// would only fail later, cryptically.
if (!fs.existsSync(path.join(repoRoot, 'game', 'index.html'))) {
  fail('game/index.html is missing from the repository');
}

fs.mkdirSync(destination, { recursive: true });
stageFolder('game');
fs.mkdirSync(path.join(destination, 'screenshots'), { recursive: true });
if (fs.existsSync(path.join(repoRoot, 'screenshots'))) {
  stageFolder('screenshots');
}

// The staged copy must hold a playable game: its own index.html has to be
// there, or something went wrong during the copy.
if (!fs.existsSync(path.join(destination, 'game', 'index.html'))) {
  fail('staged game is missing index.html');
}

// Screenshots must fit the gate too: at most four, each at most 256 KiB.
// Checking here gives a plain message naming the offending file instead of
// a refusal from the dossier builder.
const shotDir = path.join(destination, 'screenshots');
const shotFiles = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter((name) => fs.statSync(path.join(shotDir, name)).isFile()) : [];
if (shotFiles.length > gateLimits.screenshots.max) {
  fail(`too many screenshots: ${shotFiles.length} staged, at most ${gateLimits.screenshots.max} allowed`);
}
for (const name of shotFiles) {
  const size = fs.statSync(path.join(shotDir, name)).size;
  if (size > gateLimits.screenshots.max_bytes) {
    fail(`screenshot ${name} is ${size} bytes, over the ${gateLimits.screenshots.max_bytes} byte limit`);
  }
}

// The staged game must fit the gate as well: at most 993 files, at most
// 48 MiB, and no path past 1000 bytes. Same numbers as the dossier builder,
// checked here so a breach names the exact limit it hit.
const gameStats = census(path.join(destination, 'game'));
if (gameStats.files > gateLimits.game_max_files) {
  fail(`staged game has ${gameStats.files} files, over the ${gateLimits.game_max_files} file limit`);
}
if (gameStats.bytes > gateLimits.game_max_bytes) {
  fail(`staged game is ${gameStats.bytes} bytes, over the ${gateLimits.game_max_bytes} byte limit`);
}
if (gameStats.longest > gateLimits.game_path_max_bytes) {
  fail(`a path under game/ is ${gameStats.longest} bytes, over the ${gateLimits.game_path_max_bytes} byte limit`);
}

const dossierBytes = makeDossier(destination, gateLimits);
fs.writeFileSync(path.join(destination, 'dossier.json'), dossierBytes);
console.log(`neon-bay: staged ${gameStats.files} game files (${gameStats.bytes} bytes) and ${shotFiles.length} screenshots into ${destination}; dossier.json written (${dossierBytes.length} bytes)`);

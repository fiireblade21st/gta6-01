// audio.js — Semua suara game disintesis dengan WebAudio (oscillator/noise).
// Tanpa file audio eksternal, tanpa network.
// AudioContext dibuat LAZILY di unlock() — file ini aman di-import dan semua
// method aman dipanggil sebelum user gesture (jadi no-op tanpa error).

export function createAudio() {
  let ctx = null;          // AudioContext, dibuat di unlock()
  let master = null;       // GainNode utama (mute lewat sini)
  let musicBus = null;     // GainNode khusus musik
  let sfxBus = null;       // GainNode khusus SFX
  let noiseBuf = null;     // Buffer noise putih, dibuat sekali
  let muted = false;
  let musicVol = 0.35;

  // --- Engine (dibuat sekali, parameter diubah tiap frame) ---
  let engOsc = null, engOsc2 = null, engFilter = null, engGain = null;

  // --- Sirene (dibuat sekali, LFO mengayun frekuensi) ---
  let sirOsc = null, sirGain = null, sirLfo = null, sirLfoGain = null;
  let sirenOn = false;

  // --- Musik (dijadwalkan ke depan, tanpa setInterval menumpuk) ---
  let musicTimer = null;
  let nextNoteTime = 0;
  let step = 0;            // langkah 16th-note, 0..15 per bar
  const BPM = 112;
  const STEP_DUR = 60 / BPM / 4; // durasi 1/16 note
  // Progresi chord minor (Am – F – C – G), root dalam Hz (A2=110).
  const ROOTS = [110.0, 87.31, 130.81, 98.0]; // A2, F2, C3, G2

  // ------------------------------------------------------------------
  // Util internal (semua guard ctx === null → no-op)
  // ------------------------------------------------------------------

  function ensureNoise() {
    if (noiseBuf || !ctx) return;
    const len = ctx.sampleRate; // 1 detik noise putih
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  // Envelope helper: gain naik cepat lalu decay ke 0.
  function env(gainNode, t, peak, decay) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + 0.005);
    g.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  // Satu oscillator sekali bunyi (tone pendek). type/freq/freqEnd/dur/vol.
  function blip({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, vol = 0.3, when = 0 }) {
    if (!ctx) return;
    const t = now() + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    env(g, t, vol, dur);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Satu noise burst sekali bunyi. filterType/freq/q/dur/vol.
  function noise({ filterType = 'lowpass', freq = 1000, q = 1, dur = 0.2, vol = 0.4, when = 0 }) {
    if (!ctx) return;
    ensureNoise();
    const t = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, vol, dur);
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------
  // Engine & sirene: node dibuat sekali di unlock(), parameter diubah.
  // ------------------------------------------------------------------

  function buildPersistentNodes() {
    // Engine: 2 sawtooth detune + lowpass, gain ikut kecepatan.
    engOsc = ctx.createOscillator();
    engOsc.type = 'sawtooth';
    engOsc.frequency.value = 55;
    engOsc2 = ctx.createOscillator();
    engOsc2.type = 'sawtooth';
    engOsc2.frequency.value = 55 * 1.007; // detune tipis → bunyi mesin
    engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 300;
    engFilter.Q.value = 2;
    engGain = ctx.createGain();
    engGain.gain.value = 0;
    engOsc.connect(engFilter);
    engOsc2.connect(engFilter);
    engFilter.connect(engGain).connect(sfxBus);
    engOsc.start();
    engOsc2.start();

    // Sirene: 1 triangle + LFO square 0.5 Hz mengayun ±125 Hz di sekitar 825 Hz
    // → dua nada bergantian ~700 / ~950 Hz.
    sirOsc = ctx.createOscillator();
    sirOsc.type = 'triangle';
    sirOsc.frequency.value = 825;
    sirLfo = ctx.createOscillator();
    sirLfo.type = 'square';
    sirLfo.frequency.value = 0.5; // 1 siklus penuh = 2 detik (1 dtk per nada)
    sirLfoGain = ctx.createGain();
    sirLfoGain.gain.value = 125;
    sirLfo.connect(sirLfoGain).connect(sirOsc.frequency);
    sirGain = ctx.createGain();
    sirGain.gain.value = 0;
    sirOsc.connect(sirGain).connect(sfxBus);
    sirOsc.start();
    sirLfo.start();
  }

  // ------------------------------------------------------------------
  // Musik: scheduler lookahead (tanpa setInterval menumpuk).
  // ------------------------------------------------------------------

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16) % ROOTS.length;
    const root = ROOTS[bar];
    const beat = s % 16;

    // Bassline: root di beat 0, 3, 6, 8, 11, 14 (groove minor).
    if ([0, 3, 6, 8, 11, 14].includes(beat)) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = root;
      const dur = STEP_DUR * 1.8;
      env(g, t, 0.5, dur);
      o.connect(g).connect(musicBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    // Hat: noise highpass pendek tiap 8th-note (beat genap).
    if (beat % 2 === 0) {
      ensureNoise();
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = ctx.createGain();
      env(g, t, beat % 4 === 0 ? 0.12 : 0.07, 0.05);
      src.connect(f).connect(g).connect(musicBus);
      src.start(t);
      src.stop(t + 0.08);
    }

    // Stab chord minor (root + minor 3rd + 5th) di awal tiap bar, pelan.
    if (beat === 0) {
      const third = root * Math.pow(2, 3 / 12); // minor 3rd
      const fifth = root * Math.pow(2, 7 / 12);
      for (const fq of [root * 2, third * 2, fifth * 2]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = fq;
        env(g, t, 0.06, STEP_DUR * 4);
        o.connect(g).connect(musicBus);
        o.start(t);
        o.stop(t + STEP_DUR * 4 + 0.05);
      }
    }
  }

  function musicTick() {
    if (!ctx) return;
    // Jadwalkan semua step sampai 0.15 detik ke depan.
    while (nextNoteTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += STEP_DUR;
      step = (step + 1) % 64; // 4 bar loop
    }
  }

  // ------------------------------------------------------------------
  // API publik
  // ------------------------------------------------------------------

  return {
    // Buat/resume AudioContext. Idempotent; aman bila AudioContext tak ada.
    unlock() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return; // browser tanpa WebAudio → semua tetap no-op
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        sfxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.gain.value = musicVol * 0.5;
        musicBus.connect(master);
        buildPersistentNodes();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch (e) {
        ctx = null; // gagal → semua method tetap no-op
      }
    },

    setMuted(m) {
      muted = !!m;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 1, now(), 0.02);
    },

    isMuted() { return muted; },

    toggleMute() {
      this.setMuted(!muted);
      return muted;
    },

    // v 0..1 — dipanggil tiap frame; hanya ubah parameter node yang sudah ada.
    engine(v) {
      if (!ctx || !engGain) return;
      const speed = Math.max(0, Math.min(1, v));
      const t = now();
      const freq = 50 + speed * 130;              // 50 → 180 Hz
      engOsc.frequency.setTargetAtTime(freq, t, 0.05);
      engOsc2.frequency.setTargetAtTime(freq * 1.007, t, 0.05);
      engFilter.frequency.setTargetAtTime(250 + speed * 900, t, 0.05);
      engGain.gain.setTargetAtTime(speed <= 0 ? 0 : 0.05 + speed * 0.1, t, 0.08);
    },

    // Sirene polisi: dua nada bergantian ~700/950 Hz (LFO di buildPersistentNodes).
    siren(on) {
      if (!ctx || !sirGain) return;
      sirenOn = !!on;
      sirGain.gain.setTargetAtTime(sirenOn ? 0.12 : 0, now(), 0.1);
    },

    // Tembakan: noise burst + click tajam.
    shot() {
      noise({ filterType: 'bandpass', freq: 1800, q: 0.7, dur: 0.12, vol: 0.5 });
      blip({ type: 'square', freq: 220, freqEnd: 60, dur: 0.06, vol: 0.25 });
    },

    // Pukulan: thump frekuensi rendah.
    punch() {
      blip({ type: 'sine', freq: 140, freqEnd: 45, dur: 0.12, vol: 0.6 });
      noise({ filterType: 'lowpass', freq: 400, dur: 0.08, vol: 0.25 });
    },

    // Tabrakan: noise + low thud, skala dengan k (0..1).
    crash(k) {
      const i = Math.max(0, Math.min(1, k == null ? 0.5 : k));
      noise({ filterType: 'lowpass', freq: 900, dur: 0.25 + i * 0.25, vol: 0.3 + i * 0.5 });
      blip({ type: 'sine', freq: 90, freqEnd: 30, dur: 0.3 + i * 0.2, vol: 0.4 + i * 0.4 });
    },

    // Pickup: blip naik.
    pickup() {
      blip({ type: 'sine', freq: 660, freqEnd: 1320, dur: 0.12, vol: 0.3 });
    },

    // Jingle misi selesai: 4 nada naik (C5 E5 G5 C6).
    missionDone() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => blip({ type: 'triangle', freq: f, dur: 0.18, vol: 0.3, when: i * 0.12 }));
    },

    // Peringatan wanted naik: dua nada tajam.
    wantedUp() {
      blip({ type: 'square', freq: 440, dur: 0.1, vol: 0.2 });
      blip({ type: 'square', freq: 587, dur: 0.14, vol: 0.2, when: 0.1 });
    },

    // Tertangkap: nada turun.
    busted() {
      blip({ type: 'sawtooth', freq: 392, freqEnd: 98, dur: 0.6, vol: 0.3 });
    },

    // Klik UI.
    click() {
      blip({ type: 'sine', freq: 880, dur: 0.05, vol: 0.15 });
    },

    // Musik: scheduler lookahead 25 ms; tidak menumpuk interval/timer.
    startMusic() {
      if (!ctx || musicTimer) return;
      step = 0;
      nextNoteTime = now() + 0.1;
      musicTick();
      musicTimer = setInterval(musicTick, 25);
    },

    stopMusic() {
      if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
    },

    setMusicVolume(v) {
      musicVol = Math.max(0, Math.min(1, v));
      if (musicBus) musicBus.gain.setTargetAtTime(musicVol * 0.5, now(), 0.05);
    },
  };
}

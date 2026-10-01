// Procedural background music: soft reverb piano in the calm, sunny style of
// block-building games. Every track is generated live from a seed, a key and
// a chord loop, so there are no audio files and it never repeats exactly.

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

// prog: scale degrees of the chord per bar (0 = I). feel: calm = rolled
// chords and sparse melody; bright = eighth-note arpeggios and busier tunes.
export const TRACKS = [
  { name: 'Paper Meadow', bpm: 74, root: 60, scale: MAJOR, prog: [0, 4, 5, 3], feel: 'calm', seed: 11 },
  { name: 'Crayon Sunrise', bpm: 96, root: 62, scale: MAJOR, prog: [0, 3, 4, 0], feel: 'bright', seed: 23 },
  { name: 'Pencil Pines', bpm: 68, root: 65, scale: LYDIAN, prog: [0, 1, 0, 4], feel: 'calm', seed: 37 },
  { name: 'Doodle Brook', bpm: 88, root: 67, scale: MAJOR, prog: [0, 5, 3, 4], feel: 'bright', seed: 41 },
  { name: 'Sketchbook Sky', bpm: 62, root: 64, scale: MAJOR, prog: [3, 0, 4, 5], feel: 'calm', seed: 59 },
  { name: 'Squiggle Waltz', bpm: 104, root: 60, scale: MAJOR, prog: [0, 3, 4, 0], feel: 'bright', beats: 3, seed: 73 },
];
const BARS_PER_TRACK = 32;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function createMusic(getCtx) {
  let ac = null, out = null, bus = null, timer = null;
  let playing = false, volume = 0.5, index = 0;
  let r = Math.random, nextBar = 0, bar = 0, motif = null, deg = 9;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(api.state()));

  // Long, soft stereo reverb built from decaying noise.
  function impulse(secs = 3.2) {
    const len = Math.floor(ac.sampleRate * secs);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    return buf;
  }

  function ensureGraph() {
    if (out) return true;
    ac = getCtx();
    if (!ac) return false;
    out = ac.createGain();
    out.gain.value = volume * 0.6;
    const comp = ac.createDynamicsCompressor();
    out.connect(comp).connect(ac.destination);
    return true;
  }

  // Each play session gets its own bus, so notes scheduled before a pause or
  // track change are cut off instead of leaking into the next session.
  function newBus() {
    const dry = ac.createGain(), wet = ac.createGain(), verb = ac.createConvolver();
    verb.buffer = impulse();
    dry.gain.value = 0.75; wet.gain.value = 0.55;
    const input = ac.createGain();
    input.connect(dry).connect(out);
    input.connect(verb).connect(wet).connect(out);
    return input;
  }
  function dropBus(fade = 0.4) {
    if (!bus) return;
    const b = bus, t = ac.currentTime;
    b.gain.setValueAtTime(b.gain.value, t);
    b.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { try { b.disconnect(); } catch {} }, fade * 1000 + 100);
    bus = null;
  }

  // Felt-piano-ish voice: a sine fundamental with soft overtones, a quick
  // attack and a long natural decay, darkened over time by a lowpass.
  function piano(t, midi, vel, dur) {
    const f = hz(midi), g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(5200, f * 6), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.6), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(lp).connect(bus);
    for (const [mult, type, amp, det] of [[1, 'sine', 1, 0], [1, 'triangle', 0.25, 4], [2, 'sine', 0.18, -3], [3, 'sine', 0.05, 0]]) {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = type; o.frequency.value = f * mult; o.detune.value = det; og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  const track = () => TRACKS[index];
  const pitch = (d) => {
    const { root, scale } = track();
    return root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  };
  const chordDegs = (barN) => {
    const c = track().prog[barN % track().prog.length];
    return [c, c + 2, c + 4];
  };

  // A bar of melody: rhythm in eighth-note steps plus scale degrees. Strong
  // beats land on chord tones; the rest walk stepwise.
  function makePhrase(barN) {
    const { feel } = track();
    const beats = track().beats || 4, steps = beats * 2;
    const calm = [[0, 4], [0, 3, 6], [0, 6], [2, 4, 6], [0], [0, 2, 4]];
    const bright = [[0, 2, 4, 6], [0, 3, 4, 6], [0, 1, 2, 4, 6], [0, 2, 3, 4], [0, 4, 5, 6]];
    const pats = (feel === 'calm' ? calm : bright).map((p) => p.filter((s) => s < steps));
    const rhythm = pats[Math.floor(r() * pats.length)];
    const tones = chordDegs(barN).map((d) => d + 7);
    return rhythm.map((step, i) => {
      if (i === 0) {
        deg = tones.reduce((best, d) => (Math.abs(d - deg) < Math.abs(best - deg) ? d : best), tones[0]);
      } else {
        const move = [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
        deg = Math.max(5, Math.min(15, deg + move));
      }
      return { step, deg };
    });
  }

  // Bars come in 8-bar sections shaped A A' B A, so tunes feel composed.
  function melodyFor(barN) {
    const pos = barN % 8;
    if (pos === 0 || !motif) motif = [makePhrase(barN), makePhrase(barN + 1)];
    if (pos < 2) return motif[pos];
    if (pos < 4) {
      const m = motif[pos - 2].map((n) => ({ ...n }));
      if (pos === 3 && m.length) m[m.length - 1].deg += r() < 0.5 ? 1 : -1;
      return m;
    }
    if (pos < 6) return makePhrase(barN);
    const m = motif[pos - 6].map((n) => ({ ...n }));
    if (pos === 7 && m.length) m[m.length - 1].deg = 7;
    return m;
  }

  function scheduleBar(t0) {
    const { bpm, feel } = track();
    const beats = track().beats || 4;
    const eighth = 60 / bpm / 2, barLen = eighth * beats * 2;
    const chord = chordDegs(bar);
    // Bass and chord.
    piano(t0, pitch(chord[0]) - 12, 0.11, barLen * 1.6);
    if (feel === 'calm') {
      [chord[0], chord[2], chord[1] + 7].forEach((d, i) => piano(t0 + i * 0.045 + eighth * (bar % 2 ? 2 : 0), pitch(d), 0.05, barLen * 1.4));
    } else {
      const arp = [chord[0], chord[2], chord[1] + 7, chord[2]];
      for (let s = 1; s < beats * 2; s++) piano(t0 + s * eighth, pitch(arp[s % arp.length]), 0.035, eighth * 3);
    }
    // Melody; every few sections the tune rests and lets the chords breathe.
    const resting = Math.floor(bar / 8) % 4 === 3 && feel === 'calm';
    if (!resting) {
      for (const n of melodyFor(bar)) piano(t0 + n.step * eighth + (r() - 0.5) * 0.012, pitch(n.deg), 0.085 + r() * 0.03, eighth * 5);
    }
    bar++;
    return barLen;
  }

  function pump() {
    if (!playing || !bus) return;
    while (nextBar < ac.currentTime + 0.8) {
      if (bar >= BARS_PER_TRACK) { startTrack((index + 1) % TRACKS.length); return; }
      nextBar += scheduleBar(nextBar);
    }
  }

  function startTrack(i) {
    index = i;
    dropBus(bar ? 1.2 : 0.3);
    bus = newBus();
    r = rng(track().seed * 7919 + Math.floor(Math.random() * 1e6));
    bar = 0; motif = null; deg = 9;
    nextBar = ac.currentTime + 0.15;
    emit();
    pump();
  }

  const api = {
    play() {
      if (!ensureGraph()) return;
      ac.resume?.();
      if (playing) return;
      playing = true;
      clearInterval(timer);
      timer = setInterval(pump, 200);
      startTrack(index);
    },
    pause() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      if (ac) dropBus(0.5);
      emit();
    },
    toggle() { playing ? api.pause() : api.play(); },
    skip(d = 1) {
      index = (index + d + TRACKS.length) % TRACKS.length;
      if (playing) startTrack(index); else emit();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (out) out.gain.setTargetAtTime(volume * 0.6, ac.currentTime, 0.05);
      emit();
    },
    setTrack(i) { index = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length; },
    state: () => ({ playing, volume, index, name: TRACKS[index].name }),
    subscribe(fn) { listeners.add(fn); fn(api.state()); return () => listeners.delete(fn); },
  };
  return api;
}

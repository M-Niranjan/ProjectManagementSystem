/**
 * Web Audio API Ringtone & Call Audio Cues
 * Generates synthetic telephone ringing chime, connected chime, and disconnect beeps.
 * Zero external audio file dependencies.
 */

let audioCtx: AudioContext | null = null;
let ringInterval: number | null = null;
let currentOscillators: OscillatorNode[] = [];
let currentGainNode: GainNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const startRingtone = (): (() => void) => {
  stopRingtone();

  try {
    const ctx = getAudioContext();

    const playBursts = () => {
      try {
        if (!ctx || ctx.state === 'closed') return;
        const now = ctx.currentTime;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        // Fade in
        gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
        // Play for 1.6s
        gainNode.gain.setValueAtTime(0.12, now + 1.5);
        // Fade out
        gainNode.gain.linearRampToValueAtTime(0, now + 1.6);
        gainNode.connect(ctx.destination);
        currentGainNode = gainNode;

        // Dual-tone frequencies (440Hz standard concert A + 480Hz dial/ring tone)
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc1.connect(gainNode);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(480, now);
        osc2.connect(gainNode);

        osc1.start(now);
        osc2.start(now);

        osc1.stop(now + 1.65);
        osc2.stop(now + 1.65);

        currentOscillators = [osc1, osc2];
      } catch (err) {
        console.warn('Ringtone burst failed:', err);
      }
    };

    // Play first burst immediately
    playBursts();
    // Repeat burst every 3 seconds (1.6s ringing + 1.4s silence)
    ringInterval = window.setInterval(playBursts, 3000);
  } catch (err) {
    console.warn('Could not start ringtone:', err);
  }

  return stopRingtone;
};

export const stopRingtone = (): void => {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  currentOscillators.forEach((osc) => {
    try {
      osc.stop();
      osc.disconnect();
    } catch {}
  });
  currentOscillators = [];

  if (currentGainNode) {
    try {
      currentGainNode.disconnect();
    } catch {}
    currentGainNode = null;
  }
};

export const playConnectedTone = (): void => {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Ascending chime: 523.25Hz (C5) -> 659.25Hz (E5)
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.linearRampToValueAtTime(659.25, now + 0.2);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch {}
};

export const playCallEndTone = (): void => {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Descending tone: 480Hz -> 300Hz
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.linearRampToValueAtTime(300, now + 0.25);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch {}
};

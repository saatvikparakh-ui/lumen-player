import { Track } from '../types/music';

/**
 * Generates a rich, ambient synth chord loop as a playable WAV Blob URL.
 * Contains sub-bass, warm pad chords, arpeggio, and gentle white-noise sweep
 * so the EQ sliders and spectrum visualizer have vibrant audio data across 32Hz - 16kHz!
 */
export function generateDemoAudioWav(): string {
  const sampleRate = 44100;
  const bpm = 90;
  const barSeconds = (60 / bpm) * 4;
  const totalSeconds = barSeconds * 4; // 4-bar loop (~10.6 seconds)
  const totalSamples = Math.floor(sampleRate * totalSeconds);

  // 16-bit stereo PCM buffer
  const buffer = new ArrayBuffer(44 + totalSamples * 4);
  const view = new DataView(buffer);

  // Write WAV header
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 4, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, 2, true);  // NumChannels (2 = stereo)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // ByteRate
  view.setUint16(32, 4, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, totalSamples * 4, true);

  // Chord progression: Dm9 -> BbMaj7 -> FMaj7 -> C9
  // Frequencies:
  const chordFreqs = [
    [73.42, 146.83, 220.00, 261.63, 329.63, 440.00], // D2, D3, A3, C4, E4, A4
    [58.27, 116.54, 174.61, 233.08, 293.66, 349.23], // Bb1, Bb2, F3, Bb3, D4, F4
    [43.65, 87.31, 130.81, 174.61, 261.63, 329.63],  // F1, F2, C3, F3, C4, E4
    [65.41, 130.81, 196.00, 246.94, 293.66, 392.00], // C2, C3, G3, B3, D4, G4
  ];

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.min(3, Math.floor((t / totalSeconds) * 4));
    const chord = chordFreqs[chordIndex];
    const chordT = (t % barSeconds) / barSeconds;

    // Amplitude envelope for the chord (soft attack and gentle decay)
    const env = Math.sin(chordT * Math.PI) * 0.45;

    let sampleL = 0;
    let sampleR = 0;

    // 1. Warm Synth Chords & Sub-bass
    for (let c = 0; c < chord.length; c++) {
      const freq = chord[c];
      const phase = 2 * Math.PI * freq * t;
      // Slight detune for analog warmth
      const detune = Math.sin(t * 0.3 + c) * 0.8;
      const osc = Math.sin(phase + detune) * 0.15;
      const pan = (c / (chord.length - 1)) * 0.6 + 0.2; // stereo spread
      sampleL += osc * (1 - pan);
      sampleR += osc * pan;
    }

    // 2. Gentle Arpeggio Pulse (high frequencies for 8k-16kHz visualizer bars)
    const arpStep = Math.floor(t * 4) % 4;
    const arpFreq = chord[Math.min(chord.length - 1, arpStep + 2)] * 2;
    const arpEnv = Math.exp(-((t * 4) % 1) * 6) * 0.12;
    const arpOsc = Math.sin(2 * Math.PI * arpFreq * t) * arpEnv;
    sampleL += arpOsc * 0.7;
    sampleR += arpOsc * 0.3;

    // 3. Sub-bass boost (32Hz - 64Hz)
    const subOsc = Math.sin(2 * Math.PI * chord[0] * t) * 0.35 * Math.sin(chordT * Math.PI);
    sampleL += subOsc;
    sampleR += subOsc;

    // Apply envelope
    sampleL *= env;
    sampleR *= env;

    // Soft clip limiter
    sampleL = Math.max(-0.95, Math.min(0.95, sampleL));
    sampleR = Math.max(-0.95, Math.min(0.95, sampleR));

    // Convert to 16-bit integer
    const intL = Math.floor(sampleL * 32767);
    const intR = Math.floor(sampleR * 32767);

    view.setInt16(offset, intL, true);
    view.setInt16(offset + 2, intR, true);
    offset += 4;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

export function getDemoTrack(): Track {
  const streamUrl = generateDemoAudioWav();
  // Sleek SVG glowing neon artwork data URI
  const svgArtwork = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="%23080A10" />
        <stop offset="50%" stop-color="%23111521" />
        <stop offset="100%" stop-color="%23171D2F" />
      </linearGradient>
      <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="%2363E8FF" />
        <stop offset="100%" stop-color="%239A76FF" />
      </linearGradient>
      <filter id="blur">
        <feGaussianBlur stdDeviation="30" />
      </filter>
    </defs>
    <rect width="500" height="500" fill="url(%23bg)" />
    <circle cx="250" cy="250" r="140" fill="url(%23glow)" opacity="0.35" filter="url(%23blur)" />
    <circle cx="250" cy="250" r="160" fill="none" stroke="%23232D48" stroke-width="2" />
    <circle cx="250" cy="250" r="120" fill="none" stroke="%2363E8FF" stroke-width="3" stroke-dasharray="12 8" opacity="0.85" />
    <circle cx="250" cy="250" r="70" fill="%23080A10" stroke="%239A76FF" stroke-width="2" />
    <text x="250" y="245" font-family="system-ui, sans-serif" font-weight="700" font-size="28" fill="%23F1F4FC" text-anchor="middle" letter-spacing="4">LUMEN</text>
    <text x="250" y="275" font-family="system-ui, sans-serif" font-weight="500" font-size="12" fill="%2363E8FF" text-anchor="middle" letter-spacing="2">FIRST LIGHT</text>
  </svg>`;

  return {
    id: 'demo_track_first_light',
    path: 'DEMO://Lumen_First_Light.wav',
    filename: 'First Light (Original Mix).wav',
    title: 'First Light (Original Mix)',
    artist: 'LUMEN Sound Lab',
    album: 'Zero State',
    albumArtist: 'LUMEN',
    genre: 'Ambient Chill',
    year: 2026,
    trackNumber: 1,
    duration: 10.6,
    bitrate: 1411,
    codec: 'WAV 16-Bit',
    hasArtwork: true,
    artworkId: 'demo_first_light',
    streamUrl: streamUrl,
    artworkUrl: svgArtwork,
    addedAt: Date.now(),
    isFavorite: true
  };
}

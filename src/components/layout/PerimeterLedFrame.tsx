import React, { useState, useEffect, useRef } from 'react';

interface Props {
  palette: [string, string, string, string];
  bassScale: number;
  isPlaying: boolean;
  spectrumBars?: number[];
}

export const PerimeterLedFrame: React.FC<Props> = ({
  palette,
  bassScale,
  isPlaying,
  spectrumBars = [40, 60, 80, 50, 70, 90, 60, 40]
}) => {
  // Double-buffered crossfade state for smooth subtle color transitions
  const [activePalette, setActivePalette] = useState<[string, string, string, string]>(palette);
  const [prevPalette, setPrevPalette] = useState<[string, string, string, string] | null>(null);
  const [crossfade, setCrossfade] = useState(1);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const isSame = 
      activePalette[0] === palette[0] &&
      activePalette[1] === palette[1] &&
      activePalette[2] === palette[2] &&
      activePalette[3] === palette[3];

    if (!isSame) {
      setPrevPalette(activePalette);
      setActivePalette(palette);
      setCrossfade(0);

      const startTime = performance.now();
      const duration = 1200; // 1.2s smooth subtle crossfade

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        setCrossfade(progress);

        if (progress < 1) {
          animRef.current = requestAnimationFrame(step);
        } else {
          setPrevPalette(null);
        }
      };

      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(step);
    }

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [palette, activePalette]);

  const chaseSpeed = isPlaying ? `${Math.max(5, 9 / bassScale)}s` : '16s';

  // Beat Detection Physics Engine (Fast Attack, Smooth Decay)
  const [beatPulse, setBeatPulse] = useState(0);
  const energyHistoryRef = useRef<number[]>([]);
  const beatDecayRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      setBeatPulse(0);
      beatDecayRef.current = 0;
      return;
    }

    // Instantaneous sub-bass & kick drum energy
    const instantBass = (spectrumBars[0] * 1.6 + spectrumBars[1] * 1.3 + spectrumBars[2]) / 3.9;
    const history = energyHistoryRef.current;
    history.push(instantBass);
    if (history.length > 18) history.shift();

    const avgEnergy = history.reduce((a, b) => a + b, 0) / (history.length || 1);
    const threshold = Math.max(26, avgEnergy * 1.16);

    // Beat transient trigger: sharp punch on kick
    if (instantBass > threshold && instantBass > 32) {
      beatDecayRef.current = Math.min(1.0, beatDecayRef.current + 0.68);
    }

    let anim: number;
    const decayLoop = () => {
      beatDecayRef.current *= 0.88; // smooth exponential decay
      setBeatPulse(beatDecayRef.current);
      if (beatDecayRef.current > 0.02) {
        anim = requestAnimationFrame(decayLoop);
      }
    };
    anim = requestAnimationFrame(decayLoop);
    return () => cancelAnimationFrame(anim);
  }, [spectrumBars, isPlaying]);

  // Audio spectrum averages synchronized with kick/bass transient beat physics
  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;
  const leftHeight = Math.min(92, Math.max(22, avgLeftFlow * 0.72 + beatPulse * 38));
  const rightHeight = Math.min(92, Math.max(22, avgRightFlow * 0.72 + beatPulse * 38));

  const renderFrameLayer = (pal: [string, string, string, string], opacity: number) => {
    const mainColor = pal[0];
    const accentColor = pal[1] || pal[0];
    const beamGlow = isPlaying 
      ? `0 0 ${Math.round(45 + beatPulse * 45)}px ${Math.round(14 + beatPulse * 16)}px ${mainColor}, 0 0 ${Math.round(90 + beatPulse * 80)}px ${Math.round(24 + beatPulse * 24)}px ${mainColor}90`
      : `0 0 45px 12px ${mainColor}`;

    return (
      <div 
        className="fixed inset-0 pointer-events-none transition-opacity duration-200 z-30"
        style={{ opacity }}
      >
        {/* 
          1. UNBROKEN 4-SIDED PERIMETER SOLID NEON BORDER (TOP, RIGHT, BOTTOM, LEFT)
          Always present, brightly illuminated, and strictly matched to the album cover
        */}
        <div 
          className="absolute inset-0 pointer-events-none transition-all duration-300"
          style={{
            border: `5px solid ${mainColor}`,
            boxShadow: `inset 0 0 ${Math.round(45 * bassScale)}px ${Math.round(14 * bassScale)}px ${mainColor}, 0 0 ${Math.round(65 * bassScale)}px ${Math.round(18 * bassScale)}px ${mainColor}, 0 0 ${Math.round(130 * bassScale)}px ${accentColor}70`,
            opacity: 0.96 + (bassScale - 1) * 0.4
          }}
        />

        {/* 
          2. PERIMETER UNDULATING SINUSOIDAL WAVE GLOW
          Organic rhythmic wave running all around all 4 edges, swaying to the beat
        */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            padding: '5px',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            maskComposite: 'exclude',
          }}
        >
          <div 
            className="w-full h-full"
            style={{
              background: `linear-gradient(90deg, ${pal[0]}, ${pal[1]}, ${pal[2]}, ${pal[3]}, ${pal[0]})`,
              backgroundSize: '250% 250%',
              animation: `lumenSheen ${chaseSpeed} ease infinite`,
              opacity: 0.85
            }}
          />
        </div>

        {/* 
          3. DUAL-SIDE VERTICAL WAVE LIGHT BEAMS (LEFT & RIGHT)
          Luminous vertical glow columns rhythmically synchronized with kick/bass transients
        */}
        <div 
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 w-4 z-40 rounded-r-full transition-all duration-75 blur-[1.5px]"
          style={{
            height: `${leftHeight}%`,
            backgroundColor: mainColor,
            boxShadow: beamGlow
          }}
        />
        <div 
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-4 z-40 rounded-l-full transition-all duration-75 blur-[1.5px]"
          style={{
            height: `${rightHeight}%`,
            backgroundColor: mainColor,
            boxShadow: beamGlow
          }}
        />

        {/* 4. FOUR INTENSE CORNER GLOW NODES */}
        <div 
          className="absolute -top-10 -left-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-150"
          style={{ backgroundColor: mainColor, transform: `scale(${bassScale})` }}
        />
        <div 
          className="absolute -top-10 -right-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-150"
          style={{ backgroundColor: accentColor, transform: `scale(${bassScale})` }}
        />
        <div 
          className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-150"
          style={{ backgroundColor: pal[2] || mainColor, transform: `scale(${bassScale})` }}
        />
        <div 
          className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-150"
          style={{ backgroundColor: mainColor, transform: `scale(${bassScale})` }}
        />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden select-none">
      {prevPalette && renderFrameLayer(prevPalette, 1 - crossfade)}
      {renderFrameLayer(activePalette, prevPalette ? crossfade : 1)}
    </div>
  );
};

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

  // Audio spectrum averages for dual-side surging vertical soundwaves
  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;

  const renderFrameLayer = (pal: [string, string, string, string], opacity: number) => {
    const mainColor = pal[0];
    const accentColor = pal[1] || pal[0];

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
          className="absolute inset-0 pointer-events-none"
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
          Luminous vertical glow columns that rhythmically surge, sway, and bounce up and down to the audio spectrum
        */}
        <div 
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 w-4 z-40 rounded-r-full transition-all duration-75 blur-[1.5px]"
          style={{
            height: `${Math.max(22, avgLeftFlow * 0.95)}%`,
            backgroundColor: mainColor,
            boxShadow: `0 0 50px 14px ${mainColor}, 0 0 100px 28px ${mainColor}80`
          }}
        />
        <div 
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-4 z-40 rounded-l-full transition-all duration-75 blur-[1.5px]"
          style={{
            height: `${Math.max(22, avgRightFlow * 0.95)}%`,
            backgroundColor: mainColor,
            boxShadow: `0 0 50px 14px ${mainColor}, 0 0 100px 28px ${mainColor}80`
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

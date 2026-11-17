import React, { useState, useEffect, useRef, memo } from 'react';

interface Props {
  palette: [string, string, string, string];
  bassScale: number;
  isPlaying: boolean;
  spectrumBars?: number[];
  isPhone?: boolean;
}

export const PerimeterLedFrame: React.FC<Props> = memo(({
  palette,
  bassScale,
  isPlaying,
  spectrumBars = [40, 60, 80, 50, 70, 90, 60, 40],
  isPhone = false
}) => {
  const chaseSpeed = isPlaying ? `${Math.max(5, 9 / bassScale)}s` : '16s';

  // Hardware-accelerated beat tracking without React state thrashing
  const instantBass = (spectrumBars[0] * 1.5 + spectrumBars[1] * 1.2 + spectrumBars[2]) / 3.7;
  const avgRightFlow = (spectrumBars[3] + spectrumBars[4] + spectrumBars[5]) / 3;
  const leftHeight = isPlaying ? Math.min(94, Math.max(20, instantBass * 0.75 + (bassScale - 1) * 60)) : 22;
  const rightHeight = isPlaying ? Math.min(94, Math.max(20, avgRightFlow * 0.75 + (bassScale - 1) * 60)) : 22;

  const mainColor = palette[0] || '#06B6D4';
  const accentColor = palette[1] || mainColor;
  const beamGlow = isPlaying 
    ? isPhone
      ? `0 0 16px 4px ${mainColor}, 0 0 32px 8px ${mainColor}60`
      : `0 0 ${Math.round(45 + (bassScale - 1) * 80)}px ${Math.round(14 + (bassScale - 1) * 20)}px ${mainColor}, 0 0 90px 24px ${mainColor}90`
    : `0 0 24px 6px ${mainColor}`;

  return (
    <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden select-none">
      {/* 
        1. UNBROKEN 4-SIDED PERIMETER SOLID NEON BORDER (TOP, RIGHT, BOTTOM, LEFT)
        Smooth hardware-accelerated CSS transition syncing instantly to new album covers
      */}
      <div 
        className="absolute inset-0 pointer-events-none transition-all duration-700 ease-out"
        style={{
          border: isPhone ? `3px solid ${mainColor}` : `5px solid ${mainColor}`,
          boxShadow: isPhone
            ? `inset 0 0 16px 2px ${mainColor}, 0 0 20px 4px ${mainColor}`
            : `inset 0 0 ${Math.round(45 * bassScale)}px ${Math.round(14 * bassScale)}px ${mainColor}, 0 0 ${Math.round(65 * bassScale)}px ${Math.round(18 * bassScale)}px ${mainColor}, 0 0 ${Math.round(130 * bassScale)}px ${accentColor}70`,
          opacity: 0.96 + (bassScale - 1) * 0.3
        }}
      />

      {/* 
        2. PERIMETER UNDULATING SINUSOIDAL WAVE GLOW
      */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          padding: isPhone ? '3px' : '5px',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
        }}
      >
        <div 
          className="w-full h-full transition-all duration-700 ease-out"
          style={{
            background: `linear-gradient(90deg, ${palette[0]}, ${palette[1]}, ${palette[2]}, ${palette[3]}, ${palette[0]})`,
            backgroundSize: '250% 250%',
            animation: `lumenSheen ${chaseSpeed} ease infinite`,
            opacity: 0.85
          }}
        />
      </div>

      {/* 
        3. DUAL-SIDE VERTICAL WAVE LIGHT BEAMS (LEFT & RIGHT) - DANCES TO THE BEAT
      */}
      <div 
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 w-3 sm:w-4 z-40 rounded-r-full transition-[height] duration-100 ease-out blur-[1px]"
        style={{
          height: `${leftHeight}%`,
          backgroundColor: mainColor,
          boxShadow: beamGlow
        }}
      />
      <div 
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-3 sm:w-4 z-40 rounded-l-full transition-[height] duration-100 ease-out blur-[1px]"
        style={{
          height: `${rightHeight}%`,
          backgroundColor: mainColor,
          boxShadow: beamGlow
        }}
      />

      {/* 4. FOUR INTENSE CORNER GLOW NODES */}
      {!isPhone && (
        <>
          <div 
            className="absolute -top-10 -left-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-700 ease-out"
            style={{ backgroundColor: mainColor, transform: `scale(${bassScale})` }}
          />
          <div 
            className="absolute -top-10 -right-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-700 ease-out"
            style={{ backgroundColor: accentColor, transform: `scale(${bassScale})` }}
          />
          <div 
            className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-700 ease-out"
            style={{ backgroundColor: palette[2] || mainColor, transform: `scale(${bassScale})` }}
          />
          <div 
            className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full blur-3xl opacity-50 transition-all duration-700 ease-out"
            style={{ backgroundColor: mainColor, transform: `scale(${bassScale})` }}
          />
        </>
      )}
    </div>
  );
});

import React, { useEffect, useRef } from 'react';
import { AudioEngine } from '../../services/audioEngine';
import { VisualizerMode } from '../../types/music';

interface Props {
  mode?: VisualizerMode;
  sensitivity?: number;
  powerSaving?: boolean;
  className?: string;
  glowColor?: string;
}

export const AudioVisualizer: React.FC<Props> = ({
  mode = 'spectrum',
  sensitivity = 1.0,
  powerSaving = false,
  className = 'w-full h-full',
  glowColor = '#63E8FF'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const bufferLength = 128;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    // Peak holds for spectrum bars
    const peaks = new Float32Array(bufferLength);
    const peakDecay = 0.95;

    const render = () => {
      // High-DPI canvas scaling
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      if (powerSaving) {
        // Simple static ambient line
        ctx.strokeStyle = '#232D48';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      AudioEngine.getFrequencyData(freqData);
      AudioEngine.getTimeDomainData(timeData);

      const isAudioPlaying = AudioEngine.isPlaying();

      if (mode === 'spectrum') {
        // Mode 1: LED Bar Spectrum with Cyan -> Violet gradient
        const barCount = Math.min(64, Math.floor(width / 6));
        const barWidth = (width / barCount) * 0.75;
        const barGap = (width / barCount) * 0.25;

        for (let i = 0; i < barCount; i++) {
          // Map to low/mid frequency emphasis
          const freqIdx = Math.floor(Math.pow(i / barCount, 1.4) * (bufferLength / 2));
          let val = (freqData[freqIdx] || 0) * sensitivity;
          if (!isAudioPlaying) val = 0;

          const barHeight = Math.max(3, (val / 255) * height * 0.9);

          // Update peak
          if (barHeight > peaks[i]) {
            peaks[i] = barHeight;
          } else {
            peaks[i] = Math.max(3, peaks[i] * peakDecay);
          }

          const x = i * (barWidth + barGap);
          const y = height - barHeight;

          // Gradient
          const grad = ctx.createLinearGradient(0, height, 0, y);
          grad.addColorStop(0, '#111521');
          grad.addColorStop(0.3, '#9A76FF');
          grad.addColorStop(1, '#63E8FF');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
          ctx.fill();

          // Peak dot
          const peakY = height - peaks[i];
          ctx.fillStyle = '#63E8FF';
          ctx.shadowColor = '#63E8FF';
          ctx.shadowBlur = 6;
          ctx.fillRect(x, Math.max(0, peakY - 3), barWidth, 2);
          ctx.shadowBlur = 0;
        }
      } else if (mode === 'waveform') {
        // Mode 2: Neon Oscilloscope Waveform
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#63E8FF';
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = isAudioPlaying ? (timeData[i] / 128.0) : 1.0;
          const y = ((v - 1.0) * sensitivity + 1.0) * (height / 2);

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === 'oscilloscope') {
        // Mode 3: Circular Lissajous / Radial Visualizer
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(centerX, centerY) * 0.55;

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#9A76FF';
        ctx.shadowColor = '#9A76FF';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        const angleStep = (Math.PI * 2) / bufferLength;

        for (let i = 0; i < bufferLength; i++) {
          const val = isAudioPlaying ? (freqData[i] / 255.0) * sensitivity : 0;
          const r = radius + val * 40;
          const angle = i * angleStep;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.stroke();

        // Inner glowing core
        ctx.strokeStyle = '#63E8FF';
        ctx.shadowColor = '#63E8FF';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [mode, sensitivity, powerSaving, glowColor]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
    />
  );
};

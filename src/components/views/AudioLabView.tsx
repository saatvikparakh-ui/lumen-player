import React, { useState } from 'react';
import { Sliders, Activity, Volume2, RotateCcw, Sparkles, Zap, Radio } from 'lucide-react';
import { AudioEngine, EQ_FREQUENCIES, EQ_PRESETS } from '../../services/audioEngine';
import { EQPresetName, VisualizerMode } from '../../types/music';
import { AudioVisualizer } from '../visualizer/AudioVisualizer';

export const AudioLabView: React.FC = () => {
  const [activePreset, setActivePreset] = useState<EQPresetName>('Flat');
  const [gains, setGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [normalisation, setNormalisation] = useState<boolean>(true);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('spectrum');
  const [sensitivity, setSensitivity] = useState<number>(1.0);

  const presets: EQPresetName[] = ['Flat', 'Bass Boost', 'Rock', 'Jazz', 'Electronic', 'Vocal'];

  const handlePresetSelect = (preset: EQPresetName) => {
    setActivePreset(preset);
    const newGains = AudioEngine.setEQPreset(preset);
    setGains([...newGains]);
  };

  const handleGainChange = (index: number, val: number) => {
    const updated = [...gains];
    updated[index] = val;
    setGains(updated);
    AudioEngine.setEQGains(updated);
  };

  const handleReset = () => {
    handlePresetSelect('Flat');
  };

  const handleToggleNormalisation = () => {
    const next = !normalisation;
    setNormalisation(next);
    AudioEngine.setNormalisation(next);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-lumen-borderSubtle pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-lumen-cyan" />
            <h2 className="text-xl font-bold text-lumen-text">Audio Lab & DSP Rack</h2>
          </div>
          <p className="text-xs text-lumen-textMuted mt-1">
            Studio-grade 10-band equalization, real-time dynamic volume leveling, and high-frequency visualizer calibration.
          </p>
        </div>

        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover text-xs text-lumen-textMuted hover:text-lumen-cyan border border-lumen-border transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset to Flat</span>
        </button>
      </div>

      {/* 1. Large Live Visualizer Canvas & Mode Switcher */}
      <div className="rounded-2xl bg-lumen-panel border border-lumen-border p-6 shadow-panel">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-lumen-cyan" />
            <h3 className="text-sm font-semibold text-lumen-text">Spectrum Monitor</h3>
          </div>

          <div className="flex items-center gap-4">
            {/* Visualizer Mode selector */}
            <div className="flex items-center bg-lumen-surface p-1 rounded-lg border border-lumen-border">
              {(['spectrum', 'waveform', 'oscilloscope'] as VisualizerMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setVisualizerMode(mode)}
                  className={`px-3 py-1 rounded text-xs font-mono capitalize transition-all ${
                    visualizerMode === mode
                      ? 'bg-lumen-cyan text-lumen-bg font-bold shadow-led-cyan'
                      : 'text-lumen-textMuted hover:text-lumen-text'
                  }`}
                >
                  {mode === 'spectrum' ? 'LED Bars' : mode}
                </button>
              ))}
            </div>

            {/* Sensitivity slider */}
            <div className="flex items-center gap-2 text-xs font-mono text-lumen-textDim">
              <span>Gain:</span>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                className="w-16 h-1 bg-lumen-surface rounded-full"
              />
              <span className="w-8 text-lumen-cyan">{sensitivity}x</span>
            </div>
          </div>
        </div>

        <div className="w-full h-44 rounded-xl bg-lumen-bg/80 border border-lumen-borderSubtle p-2 overflow-hidden">
          <AudioVisualizer mode={visualizerMode} sensitivity={sensitivity} />
        </div>
      </div>

      {/* 2. 10-Band Graphic Equalizer */}
      <div className="rounded-2xl bg-lumen-panel border border-lumen-border p-6 shadow-panel">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-lumen-violet" />
            <h3 className="text-sm font-semibold text-lumen-text">10-Band Graphic Equalizer</h3>
          </div>

          {/* Preset Buttons */}
          <div className="flex items-center gap-2">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => handlePresetSelect(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activePreset === p
                    ? 'bg-lumen-surface text-lumen-cyan border border-lumen-cyan/50 shadow-led-cyan font-bold'
                    : 'bg-lumen-surface/60 text-lumen-textMuted hover:text-lumen-text border border-lumen-borderSubtle'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 10 Vertical Sliders Rack */}
        <div className="grid grid-cols-10 gap-3 pt-4 pb-2">
          {EQ_FREQUENCIES.map((freq, idx) => {
            const gain = gains[idx] || 0;
            const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;

            return (
              <div key={freq} className="flex flex-col items-center">
                {/* dB Value readout */}
                <span className={`text-[10px] font-mono mb-3 ${gain > 0 ? 'text-lumen-cyan font-bold' : gain < 0 ? 'text-lumen-violet' : 'text-lumen-textDim'}`}>
                  {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                </span>

                {/* Vertical Slider Track Container */}
                <div className="h-44 flex items-center justify-center relative">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(e) => handleGainChange(idx, parseFloat(e.target.value))}
                    className="w-40 h-2 bg-lumen-surface rounded-full -rotate-90 origin-center cursor-pointer appearance-none"
                  />
                </div>

                {/* Frequency Label */}
                <span className="text-[11px] font-mono text-lumen-textMuted mt-3">
                  {freqLabel}Hz
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. ReplayGain & Volume Normalisation Rack */}
      <div className="p-5 rounded-2xl bg-lumen-panel border border-lumen-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-lumen-surface border border-lumen-border flex items-center justify-center text-lumen-cyan">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-lumen-text">Dynamic Volume Normalisation</h4>
            <p className="text-xs text-lumen-textMuted mt-0.5">
              Smooths out sudden volume spikes across different albums using studio dynamics compression.
            </p>
          </div>
        </div>

        <button
          onClick={handleToggleNormalisation}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${
            normalisation
              ? 'bg-lumen-cyan text-lumen-bg border-lumen-cyan shadow-led-cyan'
              : 'bg-lumen-surface text-lumen-textMuted border-lumen-border'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${normalisation ? 'bg-lumen-bg' : 'bg-lumen-textDim'}`} />
          <span>{normalisation ? 'Active' : 'Disabled'}</span>
        </button>
      </div>
    </div>
  );
};

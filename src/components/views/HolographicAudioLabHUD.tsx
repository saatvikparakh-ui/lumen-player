import React, { useState } from 'react';
import { Sliders, X, RotateCcw, Activity, Volume2, Zap } from 'lucide-react';
import { AudioEngine, EQ_FREQUENCIES, EQ_PRESETS } from '../../services/audioEngine';
import { EQPresetName, VisualizerMode } from '../../types/music';
import { AudioVisualizer } from '../visualizer/AudioVisualizer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dominantColor: string;
}

export const HolographicAudioLabHUD: React.FC<Props> = ({ isOpen, onClose, dominantColor }) => {
  if (!isOpen) return null;

  const [activePreset, setActivePreset] = useState<EQPresetName>('Flat');
  const [gains, setGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [normalisation, setNormalisation] = useState<boolean>(true);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('spectrum');

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
    <div 
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/85 backdrop-blur-2xl flex items-center justify-center p-6 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-black/75 border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col gap-6"
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 35px -10px ${dominantColor}50`
        }}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div 
              className="w-8 h-8 rounded-xl flex items-center justify-center text-black font-bold shadow-md"
              style={{ backgroundColor: dominantColor }}
            >
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-mono">HOLOGRAPHIC AUDIO LAB</h3>
              <p className="text-xs text-white/50">Studio-grade 10-band equalization & visualizer calibration</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-xs text-white/70 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              title="Close Audio Lab (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Spectrum Monitor Bar */}
        <div className="w-full h-28 rounded-2xl bg-black/80 border border-white/10 p-2 overflow-hidden relative">
          <AudioVisualizer mode={visualizerMode} sensitivity={1.1} glowColor={dominantColor} />
          
          {/* Visualizer Mode selector overlay */}
          <div className="absolute top-2 right-2 flex items-center bg-black/60 border border-white/15 rounded-full p-0.5 backdrop-blur-md">
            {(['spectrum', 'waveform', 'oscilloscope'] as VisualizerMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setVisualizerMode(mode)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono capitalize transition-all ${
                  visualizerMode === mode
                    ? 'bg-white text-black font-bold'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {mode === 'spectrum' ? 'Bars' : mode}
              </button>
            ))}
          </div>
        </div>

        {/* 10-Band Graphic Equalizer */}
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono uppercase text-white/60 tracking-wider font-bold flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-lumen-cyan" />
              10-Band Equalizer
            </span>

            {/* Presets */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => handlePresetSelect(p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    activePreset === p
                      ? 'bg-white text-black font-bold shadow-md'
                      : 'bg-white/5 text-white/60 hover:text-white border border-white/10'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 10 Vertical Sliders */}
          <div className="grid grid-cols-10 gap-2 pt-2 pb-1">
            {EQ_FREQUENCIES.map((freq, idx) => {
              const gain = gains[idx] || 0;
              const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;

              return (
                <div key={freq} className="flex flex-col items-center">
                  <span className={`text-[10px] font-mono mb-2 ${gain > 0 ? 'text-lumen-cyan font-bold' : gain < 0 ? 'text-pink-400' : 'text-white/40'}`}>
                    {gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}
                  </span>

                  <div className="h-32 flex items-center justify-center relative">
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={gain}
                      onChange={(e) => handleGainChange(idx, parseFloat(e.target.value))}
                      className="w-28 h-1.5 bg-white/20 rounded-full -rotate-90 origin-center cursor-pointer appearance-none"
                    />
                  </div>

                  <span className="text-[10px] font-mono text-white/50 mt-2">
                    {freqLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dynamic Normalisation Toggle */}
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-3">
            <Volume2 className="w-4 h-4 text-lumen-cyan" />
            <div>
              <p className="text-xs font-semibold text-white">Dynamic Volume Normalisation</p>
              <p className="text-[11px] text-white/50">Reduces abrupt volume differences across songs</p>
            </div>
          </div>

          <button
            onClick={handleToggleNormalisation}
            className={`px-3 py-1 rounded-full text-xs font-mono font-medium border transition-all ${
              normalisation
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-bold'
                : 'bg-white/5 text-white/40 border-white/10'
            }`}
          >
            {normalisation ? 'ACTIVE' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
};

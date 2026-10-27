import React, { useState, useEffect, useRef } from 'react';
import { Disc3, AlignLeft, Sparkles, RefreshCw, Volume2, ShieldCheck, Clock, Music, Moon, Maximize2 } from 'lucide-react';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { fetchOnlineLyrics } from '../../services/lyricsService';
import { extractDominantColor, ColorSample } from '../../services/colorSampler';
import { AudioVisualizer } from '../visualizer/AudioVisualizer';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onOpenMidnightMood?: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const NowPlayingView: React.FC<Props> = ({ currentTrack, isPlaying, onOpenMidnightMood }) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [colorSample, setColorSample] = useState<ColorSample>({
    dominant: '#63E8FF',
    glowRgba: 'rgba(99, 232, 255, 0.45)',
    secondaryGlow: 'rgba(154, 118, 255, 0.3)'
  });

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    AudioEngine.onTimeUpdate((time) => {
      setCurrentTime(time);
    });
  }, []);

  // Extract artwork dominant color & load lyrics on track change
  useEffect(() => {
    if (!currentTrack) return;

    extractDominantColor(currentTrack.artworkUrl).then(setColorSample);

    // Fetch lyrics
    setIsLoadingLyrics(true);
    fetchOnlineLyrics(currentTrack.artist, currentTrack.title, currentTrack.duration).then((res) => {
      setLyrics(res);
      setIsLoadingLyrics(false);
    });
  }, [currentTrack]);

  // Find active lyric line index based on currentTime
  let activeLyricIndex = -1;
  if (lyrics && lyrics.length > 0) {
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        activeLyricIndex = i;
      } else {
        break;
      }
    }
  }

  // Auto-scroll active lyric line into view
  useEffect(() => {
    if (activeLyricIndex >= 0 && lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeLyricIndex]);

  const handleSeekLyric = (time: number) => {
    AudioEngine.seek(time);
  };

  if (!currentTrack) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 select-none">
        <Disc3 className="w-16 h-16 text-lumen-textDim mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-lumen-text">No Track Playing</h3>
        <p className="text-xs text-lumen-textMuted mt-1">Select any song from your library or start the demo.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden p-8 flex gap-10 select-none relative">
      {/* Dynamic Ambient Background Glow */}
      <div 
        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-[140px] pointer-events-none transition-all duration-1000 -z-10"
        style={{ backgroundColor: colorSample.glowRgba }}
      />
      <div 
        className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full blur-[120px] pointer-events-none transition-all duration-1000 -z-10"
        style={{ backgroundColor: colorSample.secondaryGlow }}
      />

      {/* Left Column: Massive Artwork & Track Details */}
      <div className="w-1/2 flex flex-col items-center justify-center">
        {/* Vinyl / Cover container */}
        <div className="relative group">
          <div 
            className="w-80 h-80 rounded-2xl overflow-hidden bg-lumen-panel border-2 border-lumen-border shadow-2xl relative z-10 transition-transform duration-500 hover:scale-105"
            style={{ boxShadow: `0 20px 60px -15px ${colorSample.glowRgba}` }}
          >
            {currentTrack.artworkUrl ? (
              <img src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-lumen-panel text-lumen-textDim p-6">
                <Disc3 className="w-20 h-20 text-lumen-cyan mb-2" />
                <span className="text-xs font-mono">NO ARTWORK</span>
              </div>
            )}
          </div>
        </div>

        {/* Track Title & Artist */}
        <div className="mt-8 text-center max-w-md">
          <h2 className="text-2xl font-bold text-lumen-text tracking-tight truncate" title={currentTrack.title}>
            {currentTrack.title}
          </h2>
          <p className="text-base text-lumen-cyan font-medium mt-1 truncate" title={currentTrack.artist}>
            {currentTrack.artist}
          </p>
          <p className="text-xs text-lumen-textMuted mt-1 truncate">
            {currentTrack.album} {currentTrack.year ? `(${currentTrack.year})` : ''}
          </p>
        </div>

        {/* High-Fi Tech Spec Badges */}
        <div className="mt-6 flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-md bg-lumen-surface border border-lumen-border font-mono text-[11px] text-lumen-cyan">
            {currentTrack.codec || 'LOSSLESS'}
          </span>
          {currentTrack.bitrate && (
            <span className="px-2.5 py-1 rounded-md bg-lumen-surface border border-lumen-border font-mono text-[11px] text-lumen-violet">
              {currentTrack.bitrate} kbps
            </span>
          )}
          <span className="px-2.5 py-1 rounded-md bg-lumen-surface border border-lumen-border font-mono text-[11px] text-lumen-textMuted">
            {formatDuration(currentTrack.duration)}
          </span>
        </div>

        {/* Live Audio Visualizer Banner under Artwork */}
        <div className="w-80 h-14 mt-6 rounded-xl bg-lumen-surface/40 border border-lumen-border p-2">
          <AudioVisualizer mode="waveform" glowColor={colorSample.dominant} />
        </div>
      </div>

      {/* Right Column: Synced Lyrics */}
      <div className="w-1/2 flex flex-col bg-lumen-panel/70 rounded-2xl border border-lumen-border p-6 backdrop-blur-md">
        <div className="flex items-center justify-between pb-4 border-b border-lumen-borderSubtle mb-4">
          <div className="flex items-center gap-2">
            <AlignLeft className="w-4 h-4 text-lumen-cyan" />
            <h3 className="text-sm font-semibold text-lumen-text">Synchronized Lyrics</h3>
          </div>

          <div className="flex items-center gap-3">
            {isLoadingLyrics && (
              <span className="text-xs font-mono text-lumen-cyan flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Searching lyrics...
              </span>
            )}

            {onOpenMidnightMood && (
              <button
                onClick={onOpenMidnightMood}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-mono transition-all hover:scale-105 shadow-[0_0_12px_rgba(255,46,147,0.25)]"
                title="Launch Midnight Mood (M)"
              >
                <Moon className="w-3.5 h-3.5 text-pink-400" />
                <span>Midnight Mood (M)</span>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Lyric Lines */}
        <div 
          ref={lyricsContainerRef}
          className="flex-1 overflow-y-auto space-y-4 pr-3 text-center scroll-smooth"
        >
          {lyrics && lyrics.length > 0 ? (
            lyrics.map((line, idx) => {
              const isActive = idx === activeLyricIndex;
              return (
                <p
                  key={`${line.time}_${idx}`}
                  onClick={() => handleSeekLyric(line.time)}
                  className={`text-lg font-medium transition-all duration-300 cursor-pointer py-1.5 px-3 rounded-lg ${
                    isActive
                      ? 'text-lumen-cyan font-bold scale-105 bg-lumen-surface/80 shadow-led-cyan'
                      : 'text-lumen-textMuted/60 hover:text-lumen-text hover:bg-lumen-surface/30'
                  }`}
                >
                  {line.text}
                </p>
              );
            })
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-lumen-textDim">
              <Music className="w-10 h-10 mb-3 opacity-30 text-lumen-cyan" />
              <p className="text-sm text-lumen-text">No synced lyrics available for this track</p>
              <p className="text-xs text-lumen-textMuted mt-1 max-w-xs">
                Local .lrc files in the same folder or embedded ID3 lyric tags will appear here automatically.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

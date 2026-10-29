import React, { useState, useEffect } from 'react';
import { resolveApiUrl } from '../../services/apiConfig';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat, 
  Repeat1, 
  Volume2, 
  VolumeX, 
  Sliders, 
  ListMusic, 
  Heart, 
  Disc3,
  AlignLeft,
  Moon
} from 'lucide-react';
import { Track, ViewMode } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { LibraryDatabase } from '../../services/libraryDb';
import { AudioVisualizer } from '../visualizer/AudioVisualizer';
import { SongRatingWidget } from '../views/SongRatingWidget';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSelectView: (view: ViewMode) => void;
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  onOpenMidnightMood?: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const PlayerBar: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  onSelectView,
  onToggleQueue,
  isQueueOpen,
  onOpenMidnightMood
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [isFavorite, setIsFavorite] = useState(currentTrack?.isFavorite || false);

  useEffect(() => {
    AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });
  }, []);

  useEffect(() => {
    setIsFavorite(currentTrack?.isFavorite || false);
  }, [currentTrack]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    AudioEngine.seek(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolumeState(val);
    setIsMuted(val === 0);
    AudioEngine.setVolume(val);
  };

  const toggleMute = () => {
    if (isMuted) {
      AudioEngine.setVolume(volume || 0.8);
      setIsMuted(false);
    } else {
      AudioEngine.setVolume(0);
      setIsMuted(true);
    }
  };

  const handleToggleShuffle = () => {
    const newState = AudioEngine.toggleShuffle();
    setIsShuffle(newState);
  };

  const handleToggleRepeat = () => {
    const nextMode = AudioEngine.toggleRepeat();
    setRepeatMode(nextMode);
  };

  const handleToggleFavorite = () => {
    if (!currentTrack) return;
    const newState = LibraryDatabase.toggleFavorite(currentTrack.id);
    setIsFavorite(newState);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <footer className="h-24 bg-lumen-panel border-t border-lumen-borderSubtle px-6 flex items-center justify-between select-none relative z-30 shadow-panel">
      {/* 1. Track Info (Left) */}
      <div className="w-1/4 flex items-center gap-4 min-w-[200px]">
        {currentTrack ? (
          <>
            <div 
              onClick={() => onSelectView('now-playing')}
              className="relative w-14 h-14 rounded-lg overflow-hidden bg-lumen-surface border border-lumen-border flex-shrink-0 cursor-pointer group shadow-sm hover:border-lumen-cyan/60 transition-all"
            >
              {currentTrack.artworkUrl ? (
                <img 
                  src={currentTrack.artworkUrl} 
                  alt={currentTrack.title} 
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.retried) {
                      target.dataset.retried = '1';
                      target.src = resolveApiUrl(`/api/artwork/proxy?url=${encodeURIComponent(currentTrack.artworkUrl || '')}`);
                    } else {
                      target.style.display = 'none';
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-lumen-surface text-lumen-textMuted">
                  <Disc3 className="w-6 h-6 text-lumen-cyan" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Disc3 className="w-5 h-5 text-lumen-cyan" />
              </div>
            </div>

            <div className="truncate">
              <h4 
                onClick={() => onSelectView('now-playing')}
                className="text-sm font-semibold text-lumen-text truncate cursor-pointer hover:text-lumen-cyan transition-colors"
                title={currentTrack.title}
              >
                {currentTrack.title}
              </h4>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-xs text-lumen-textMuted truncate" title={currentTrack.artist}>
                  {currentTrack.artist}
                </p>
                <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-lumen-cyan/20 text-lumen-cyan border border-lumen-cyan/40 font-bold uppercase tracking-wider flex-shrink-0" title="Studio Hi-Fi 160k Opus / 256k AAC Master">
                  Hi-Fi
                </span>
              </div>
            </div>

            <button
              onClick={handleToggleFavorite}
              className={`p-1.5 rounded-full hover:bg-lumen-surface transition-colors ${
                isFavorite ? 'text-lumen-violet fill-lumen-violet' : 'text-lumen-textDim hover:text-lumen-text'
              }`}
              title={isFavorite ? 'Favorited' : 'Add to Favorites'}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
            </button>

            <SongRatingWidget track={currentTrack} compact />
          </>
        ) : (
          <div className="flex items-center gap-3 text-lumen-textDim text-xs">
            <Disc3 className="w-8 h-8 opacity-40 text-lumen-cyan" />
            <span>No track selected</span>
          </div>
        )}
      </div>

      {/* 2. Controls & Scrubber (Center) */}
      <div className="w-2/4 max-w-xl flex flex-col items-center">
        {/* Buttons */}
        <div className="flex items-center gap-5 mb-2">
          <button
            onClick={handleToggleShuffle}
            className={`p-1.5 rounded-full transition-colors relative ${
              isShuffle ? 'text-lumen-cyan' : 'text-lumen-textMuted hover:text-lumen-text'
            }`}
            title="Shuffle"
          >
            <Shuffle className="w-4 h-4" />
            {isShuffle && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-lumen-cyan shadow-led-cyan" />}
          </button>

          <button
            onClick={() => AudioEngine.prev()}
            className="p-1.5 text-lumen-textMuted hover:text-lumen-text transition-colors"
            title="Previous"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={onTogglePlay}
            className="w-11 h-11 rounded-full bg-lumen-cyan text-lumen-bg flex items-center justify-center hover:scale-105 active:scale-95 shadow-led-cyan hover:shadow-led-cyan-lg transition-all"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => AudioEngine.next()}
            className="p-1.5 text-lumen-textMuted hover:text-lumen-text transition-colors"
            title="Next"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={handleToggleRepeat}
            className={`p-1.5 rounded-full transition-colors relative ${
              repeatMode !== 'off' ? 'text-lumen-cyan' : 'text-lumen-textMuted hover:text-lumen-text'
            }`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            {repeatMode !== 'off' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-lumen-cyan shadow-led-cyan" />}
          </button>
        </div>

        {/* Scrubber Bar */}
        <div className="w-full flex items-center gap-3 text-[11px] font-mono text-lumen-textMuted">
          <span className="w-9 text-right">{formatTime(currentTime)}</span>
          <div className="relative flex-1 flex items-center group">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1 bg-lumen-surface rounded-full cursor-pointer appearance-none relative z-10"
            />
            {/* Custom filled track under range input */}
            <div 
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-lumen-violet to-lumen-cyan rounded-full pointer-events-none group-hover:h-1.5 transition-all shadow-led-cyan"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="w-9">{formatTime(duration)}</span>
        </div>
      </div>

      {/* 3. Audio Lab, Mini Visualizer & Volume (Right) */}
      <div className="w-1/4 flex items-center justify-end gap-3 min-w-[200px]">
        {/* Live Mini-Visualizer Canvas */}
        <div 
          onClick={() => onSelectView('audio-lab')}
          className="w-20 h-8 rounded bg-lumen-surface/60 border border-lumen-border overflow-hidden cursor-pointer hover:border-lumen-cyan/50 transition-colors p-0.5" 
          title="Open Audio Lab & Equalizer"
        >
          <AudioVisualizer mode="spectrum" sensitivity={0.9} />
        </div>

        {/* Lyrics Button */}
        <button
          onClick={() => onSelectView('now-playing')}
          className="p-2 text-lumen-textMuted hover:text-lumen-cyan hover:bg-lumen-surface rounded-lg transition-colors"
          title="Synced Lyrics"
        >
          <AlignLeft className="w-4 h-4" />
        </button>

        {/* Audio Lab EQ Button */}
        <button
          onClick={() => onSelectView('audio-lab')}
          className="p-2 text-lumen-textMuted hover:text-lumen-cyan hover:bg-lumen-surface rounded-lg transition-colors"
          title="Audio Lab & Equalizer"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Midnight Mood Button */}
        {onOpenMidnightMood && (
          <button
            onClick={onOpenMidnightMood}
            className="p-2 text-lumen-textMuted hover:text-pink-400 hover:bg-lumen-surface rounded-lg transition-colors group relative"
            title="Midnight Mood (Press M)"
          >
            <Moon className="w-4 h-4 text-pink-400 group-hover:scale-110 transition-transform" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-pink-400 shadow-[0_0_8px_#FF2E93]" />
          </button>
        )}

        {/* Queue Button */}
        <button
          onClick={onToggleQueue}
          className={`p-2 rounded-lg transition-colors ${
            isQueueOpen ? 'text-lumen-cyan bg-lumen-surface' : 'text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface'
          }`}
          title="Queue"
        >
          <ListMusic className="w-4 h-4" />
        </button>

        {/* Volume Slider */}
        <div className="flex items-center gap-2 group ml-1">
          <button onClick={toggleMute} className="text-lumen-textMuted hover:text-lumen-text">
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-lumen-violet" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 bg-lumen-surface rounded-full cursor-pointer appearance-none"
            title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
          />
        </div>
      </div>
    </footer>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Trash2, 
  Play, 
  Disc3, 
  Music, 
  Sparkles, 
  Plus, 
  ArrowLeft,
  Check, 
  ChevronLeft, 
  ChevronRight,
  ListMusic 
} from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { StreamingService } from '../../services/streamingService';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  dominantColor: string;
  onPlayTrack: (track: Track) => void;
  onSaveQueueAsPlaylist: (tracks: Track[]) => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const QueueDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTrack,
  dominantColor,
  onPlayTrack,
  onSaveQueueAsPlaylist
}) => {
  const [priorityQueue, setPriorityQueue] = useState<Track[]>([]);
  const [upcomingContext, setUpcomingContext] = useState<Track[]>([]);
  const [viewMode, setViewMode] = useState<'queue' | 'addSongs'>('queue');
  
  // Carousel state
  const [suggestedPool, setSuggestedPool] = useState<Track[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [addedTracks, setAddedTracks] = useState<Set<string>>(new Set());
  const carouselContainerRef = useRef<HTMLDivElement | null>(null);

  // Refresh queue lists
  const refreshQueues = () => {
    setPriorityQueue(AudioEngine.getPriorityQueue());
    setUpcomingContext(AudioEngine.getUpcomingContextQueue());
  };

  useEffect(() => {
    if (isOpen) {
      refreshQueues();
      // Load suggestions for the carousel
      StreamingService.getRecommendations().then(recs => {
        const pool = [...recs.madeForYou, ...recs.trending, ...recs.genreMixes];
        // Deduplicate
        const unique: Track[] = [];
        const seen = new Set<string>();
        for (const t of pool) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            unique.push(t);
          }
        }
        setSuggestedPool(unique);
      });
    } else {
      setViewMode('queue');
    }
    const unsub = AudioEngine.onQueueChange(() => {
      refreshQueues();
    });
    return unsub;
  }, [isOpen]);

  if (!isOpen) return null;

  const totalUpcoming = priorityQueue.length + upcomingContext.length;

  const handleClearAll = () => {
    AudioEngine.clearUpcomingQueue();
    refreshQueues();
  };

  const handleRemovePriority = (idx: number) => {
    AudioEngine.removeFromPriorityQueue(idx);
    refreshQueues();
  };

  const handleRemoveContext = (idx: number) => {
    AudioEngine.removeFromUpcomingContext(idx);
    refreshQueues();
  };

  const handleSaveAsPlaylist = () => {
    const allQueue = [];
    if (currentTrack) allQueue.push(currentTrack);
    allQueue.push(...priorityQueue);
    allQueue.push(...upcomingContext);
    if (allQueue.length > 0) {
      onSaveQueueAsPlaylist(allQueue);
      onClose();
    }
  };

  const handleAddSongToQueue = (track: Track) => {
    AudioEngine.addToQueue(track);
    WatchSoundService.playTick(1.2);
    setAddedTracks(prev => new Set(prev).add(track.id));
    refreshQueues();
  };

  // Scroll carousel with mechanical watch crown sound effect
  const handleScrollToCard = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= suggestedPool.length) return;
    if (newIndex !== activeCardIndex) {
      WatchSoundService.playTick(1.0);
      setActiveCardIndex(newIndex);
    }
  };

  const handleWheelCarousel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 10 || Math.abs(e.deltaY) > 10) {
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta > 0 && activeCardIndex < suggestedPool.length - 1) {
        handleScrollToCard(activeCardIndex + 1);
      } else if (delta < 0 && activeCardIndex > 0) {
        handleScrollToCard(activeCardIndex - 1);
      }
    }
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex justify-end select-none animate-fadeIn sm:p-4"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[460px] h-full sm:h-[calc(100vh-2rem)] rounded-none sm:rounded-3xl bg-gradient-to-br from-white/[0.14] via-white/[0.05] to-black/90 border-l sm:border border-white/20 backdrop-blur-3xl shadow-2xl flex flex-col overflow-hidden relative"
        style={{
          boxShadow: `0 25px 70px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 30px -5px ${dominantColor}40`
        }}
      >
        {/* Ambient Top Glow */}
        <div 
          className="pointer-events-none absolute w-80 h-80 -top-20 -right-20 rounded-full blur-[100px] opacity-25"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Header Bar */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 relative z-10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {viewMode === 'addSongs' ? (
              <button
                onClick={() => setViewMode('queue')}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center mr-1"
                title="Back to Queue"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <ListMusic className="w-5 h-5 text-lumen-cyan" />
            )}
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                {viewMode === 'addSongs' ? 'Add Songs to Queue' : 'Play Queue'}
              </h3>
              <p className="text-[10px] font-mono text-white/50">
                {viewMode === 'addSongs' 
                  ? 'Swipe through carousel (tactile watch scroll)' 
                  : `${totalUpcoming} tracks upcoming`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'queue' && totalUpcoming > 0 && (
              <button
                onClick={handleClearAll}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 text-[11px] text-white/60 hover:text-red-400 border border-white/10 transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              title="Close Queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* VIEW MODE 1: 3D COVER FLOW CAROUSEL TO ADD SONGS WITH MECHANICAL WATCH TICK SOUND */}
        {viewMode === 'addSongs' ? (
          <div 
            onWheel={handleWheelCarousel}
            className="flex-1 flex flex-col items-center justify-between p-6 relative z-10 overflow-hidden"
          >
            {/* Top Carousel Counter */}
            <div className="flex items-center justify-between w-full text-xs font-mono text-white/50 px-2">
              <span className="flex items-center gap-1.5 text-lumen-cyan">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Recommended Curations</span>
              </span>
              <span>{activeCardIndex + 1} / {suggestedPool.length}</span>
            </div>

            {/* 3D Liquid Glass Cover Flow Reel */}
            <div 
              ref={carouselContainerRef}
              className="w-full flex-1 flex items-center justify-center relative perspective-[1000px] my-4"
            >
              {suggestedPool.length > 0 ? (
                <div className="relative w-64 h-80 flex items-center justify-center">
                  {/* Surrounding ghost cards for 3D depth */}
                  {suggestedPool.map((track, idx) => {
                    const offset = idx - activeCardIndex;
                    if (Math.abs(offset) > 2) return null;

                    const isCurrent = offset === 0;
                    const rotateY = offset * -25;
                    const translateX = offset * 90;
                    const translateZ = -Math.abs(offset) * 110;
                    const scale = isCurrent ? 1 : 0.82;
                    const opacity = isCurrent ? 1 : Math.max(0.2, 0.65 - Math.abs(offset) * 0.25);

                    return (
                      <div
                        key={track.id}
                        onClick={() => handleScrollToCard(idx)}
                        style={{
                          transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                          opacity,
                          zIndex: 20 - Math.abs(offset)
                        }}
                        className={`absolute w-56 sm:w-60 rounded-3xl p-4 bg-gradient-to-br from-white/[0.18] via-white/[0.06] to-black/80 border border-white/30 backdrop-blur-2xl shadow-2xl transition-all duration-300 flex flex-col items-center text-center cursor-pointer ${
                          isCurrent ? 'ring-2 ring-lumen-cyan/50 shadow-cyan-500/20' : ''
                        }`}
                      >
                        {/* Artwork */}
                        <div 
                          className="w-40 h-40 rounded-2xl overflow-hidden shadow-2xl border border-white/20 mb-3 relative flex-shrink-0"
                          style={{ boxShadow: `0 15px 35px -5px ${dominantColor}50` }}
                        >
                          {track.artworkUrl ? (
                            <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-black/60 text-white/30">
                              <Disc3 className="w-12 h-12 animate-spin text-white/40" />
                            </div>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-white tracking-tight truncate w-full px-1" title={track.title}>
                          {track.title}
                        </h4>
                        <p className="text-xs text-white/60 truncate w-full px-1 mt-0.5">
                          {track.artist}
                        </p>
                        <span className="text-[10px] font-mono text-white/40 mt-1">
                          {formatDuration(track.duration)}
                        </span>

                        {/* 1-Tap Add to Queue Button */}
                        {isCurrent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddSongToQueue(track);
                            }}
                            className={`mt-4 w-full py-2 px-4 rounded-full font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-95 ${
                              addedTracks.has(track.id)
                                ? 'bg-emerald-500 text-black'
                                : 'bg-lumen-cyan text-black hover:scale-105'
                            }`}
                          >
                            {addedTracks.has(track.id) ? (
                              <>
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                                <span>In Queue</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                                <span>Add to Queue</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-white/40">
                  <Disc3 className="w-8 h-8 animate-spin text-lumen-cyan mb-2" />
                  <span className="text-xs font-mono">Loading recommendations...</span>
                </div>
              )}
            </div>

            {/* Stepper controls & Tactile Hint */}
            <div className="w-full flex items-center justify-between pt-2 border-t border-white/10">
              <button
                onClick={() => handleScrollToCard(activeCardIndex - 1)}
                disabled={activeCardIndex <= 0}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Prev</span>
              </button>

              <span className="text-[10px] font-mono text-white/40 text-center">
                Scroll wheel / Drag for watch click sound
              </span>

              <button
                onClick={() => handleScrollToCard(activeCardIndex + 1)}
                disabled={activeCardIndex >= suggestedPool.length - 1}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Return to Queue Button */}
            <button
              onClick={() => setViewMode('queue')}
              className="w-full mt-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all text-center"
            >
              Done & Return to Queue
            </button>
          </div>
        ) : (
          /* VIEW MODE 2: STANDARD PLAY QUEUE LIST */
          <>
            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-6 relative z-10">
              {/* NOW PLAYING SECTION */}
              {currentTrack && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan mb-2.5 flex items-center gap-1.5">
                    <Disc3 className="w-3.5 h-3.5 animate-spin" />
                    <span>Now Playing</span>
                  </h4>
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.08] border border-white/15 shadow-lg">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 flex-shrink-0 shadow-md">
                      {currentTrack.artworkUrl ? (
                        <img src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                      ) : (
                        <Disc3 className="w-full h-full p-2 text-white/40" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h5 className="text-xs font-bold text-white truncate">{currentTrack.title}</h5>
                      <p className="text-[11px] text-white/60 truncate">{currentTrack.artist}</p>
                    </div>
                    <span className="text-xs font-mono text-lumen-cyan font-bold">
                      {formatDuration(currentTrack.duration)}
                    </span>
                  </div>
                </div>
              )}

              {/* USER QUEUED (NEXT IN QUEUE) */}
              {priorityQueue.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2.5 flex items-center justify-between">
                    <span>Up Next ({priorityQueue.length})</span>
                    <span className="text-[9px] text-white/30 font-normal">Manually added</span>
                  </h4>
                  <div className="space-y-1.5">
                    {priorityQueue.map((track, idx) => (
                      <div
                        key={`priority-${track.id}-${idx}`}
                        className="group flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all"
                      >
                        <div 
                          onClick={() => onPlayTrack(track)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0">
                            {track.artworkUrl ? (
                              <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                              <Disc3 className="w-full h-full p-1.5 text-white/30" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h5 className="text-xs font-semibold text-white/90 truncate">{track.title}</h5>
                            <p className="text-[10px] text-white/50 truncate">{track.artist}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-[10px] font-mono text-white/40">
                            {formatDuration(track.duration)}
                          </span>
                          <button
                            onClick={() => handleRemovePriority(idx)}
                            className="p-1 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from queue"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTEXT QUEUE (FROM ALBUM OR PLAYLIST) */}
              <div>
                <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2.5 flex items-center justify-between">
                  <span>Next From Source ({upcomingContext.length})</span>
                </h4>
                {upcomingContext.length === 0 && priorityQueue.length === 0 ? (
                  <div className="py-12 text-center text-xs text-white/40">
                    <Music className="w-8 h-8 mx-auto mb-2 opacity-30 text-lumen-cyan" />
                    <p>No more songs in the queue.</p>
                    <p className="text-[10px] mt-1 text-white/30">Tap below to explore and add recommendations.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {upcomingContext.map((track, idx) => (
                      <div
                        key={`context-${track.id}-${idx}`}
                        className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all"
                      >
                        <div 
                          onClick={() => onPlayTrack(track)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0">
                            {track.artworkUrl ? (
                              <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                              <Disc3 className="w-full h-full p-1.5 text-white/30" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h5 className="text-xs font-semibold text-white/90 truncate">{track.title}</h5>
                            <p className="text-[10px] text-white/50 truncate">{track.artist}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-[10px] font-mono text-white/40">
                            {formatDuration(track.duration)}
                          </span>
                          <button
                            onClick={() => handleRemoveContext(idx)}
                            className="p-1 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from upcoming"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer Actions with "+ Add Songs to Queue" option directly above Save Queue as Playlist */}
            <div className="p-4 border-t border-white/10 flex-shrink-0 relative z-10 space-y-2">
              {/* Prominently requested Add Songs Option */}
              <button
                onClick={() => setViewMode('addSongs')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-lumen-cyan/20 hover:bg-lumen-cyan text-lumen-cyan hover:text-black font-bold text-xs transition-all border border-lumen-cyan/30 shadow-md cursor-pointer hover:scale-[1.01] active:scale-98"
              >
                <Sparkles className="w-4 h-4" />
                <span>+ Add Songs to Queue (Cover Flow Carousel)</span>
              </button>

              {totalUpcoming > 0 && (
                <button
                  onClick={handleSaveAsPlaylist}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black font-bold text-xs shadow-lg hover:scale-102 transition-transform cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Save Queue as Playlist</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { X, Sparkles, Check, Plus, Music2, UserCheck } from 'lucide-react';
import { 
  PreferenceService, 
  POPULAR_GENRES, 
  POPULAR_VERIFIED_ARTISTS 
} from '../../services/preferenceService';
import { UserPreferences } from '../../types/music';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPreferencesUpdated: () => void;
  dominantColor: string;
}

export const TuneTasteModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onPreferencesUpdated,
  dominantColor
}) => {
  if (!isOpen) return null;

  const [prefs, setPrefs] = useState<UserPreferences>(() => PreferenceService.getPreferences());
  const [customArtistInput, setCustomArtistInput] = useState('');

  const handleToggleGenre = (genre: string) => {
    const updated = PreferenceService.toggleGenre(genre);
    setPrefs({ ...updated });
  };

  const handleToggleArtist = (artist: string) => {
    const updated = PreferenceService.toggleArtist(artist);
    setPrefs({ ...updated });
  };

  const handleAddCustomArtist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customArtistInput.trim()) return;
    const updated = PreferenceService.addCustomArtist(customArtistInput.trim());
    setPrefs({ ...updated });
    setCustomArtistInput('');
  };

  const handleSaveAndRefresh = () => {
    onPreferencesUpdated();
    onClose();
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-8 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-black/85 border border-white/20 rounded-3xl p-6 sm:p-8 shadow-2xl relative max-h-[88vh] flex flex-col overflow-hidden"
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px ${dominantColor}60`
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ backgroundColor: dominantColor }}
            >
              <Sparkles className="w-5 h-5 text-black" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Tune Your Music Taste</h3>
              <p className="text-xs text-white/50">Personalize recommendations, daily mixes and home shelves</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-5 space-y-6 no-scrollbar">
          {/* 1. Favorite Genres */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-bold flex items-center gap-2">
                <Music2 className="w-3.5 h-3.5 text-lumen-cyan" />
                Select Favorite Genres
              </span>
              <span className="text-[11px] font-mono text-white/40">
                {prefs.favoriteGenres.length} selected
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {POPULAR_GENRES.map((genre) => {
                const isSelected = prefs.favoriteGenres.includes(genre);
                return (
                  <button
                    key={genre}
                    onClick={() => handleToggleGenre(genre)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-white text-black font-bold shadow-md scale-105'
                        : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/15 border border-white/10'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    <span>{genre}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Favorite Verified Artists */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-bold flex items-center gap-2">
                <UserCheck className="w-3.5 h-3.5 text-lumen-cyan" />
                Select Verified Artists
              </span>
              <span className="text-[11px] font-mono text-white/40">
                {prefs.favoriteArtists.length} selected
              </span>
            </div>

            {/* Popular Artist Bubbles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
              {POPULAR_VERIFIED_ARTISTS.map((artist) => {
                const isSelected = prefs.favoriteArtists.includes(artist.name);
                return (
                  <button
                    key={artist.name}
                    onClick={() => handleToggleArtist(artist.name)}
                    className={`flex items-center gap-2.5 p-2 rounded-2xl border transition-all text-left ${
                      isSelected
                        ? 'bg-white/20 border-white/40 text-white shadow-lg'
                        : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <img 
                      src={artist.avatarUrl} 
                      alt={artist.name} 
                      className="w-8 h-8 rounded-full object-cover border border-white/20"
                    />
                    <span className="text-xs font-medium truncate flex-1">{artist.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-lumen-cyan stroke-[3] ml-auto mr-1" />}
                  </button>
                );
              })}
            </div>

            {/* Add Custom Artist Form */}
            <form onSubmit={handleAddCustomArtist} className="flex gap-2">
              <input
                type="text"
                value={customArtistInput}
                onChange={(e) => setCustomArtistInput(e.target.value)}
                placeholder="Add any other artist (e.g. Frank Ocean, Kendrick Lamar, Arijit Singh)..."
                className="flex-1 px-4 py-2 bg-white/5 border border-white/15 rounded-full text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40"
              />
              <button
                type="submit"
                disabled={!customArtistInput.trim()}
                className="px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 text-xs font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveAndRefresh}
            className="px-6 py-2 rounded-full text-xs font-bold text-black shadow-lg transition-transform hover:scale-105"
            style={{ backgroundColor: dominantColor }}
          >
            Apply & Refresh Mixes
          </button>
        </div>
      </div>
    </div>
  );
};

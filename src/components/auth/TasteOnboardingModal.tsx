import React, { useState } from 'react';
import { 
  Sparkles, 
  Check, 
  Search, 
  ChevronRight, 
  Music, 
  Compass, 
  X,
  Disc3,
  Heart
} from 'lucide-react';
import { PreferenceService } from '../../services/preferenceService';
import { FirebaseAuthService } from '../../services/firebaseAuthService';

interface Props {
  isOpen: boolean;
  onComplete: () => void;
  dominantColor?: string;
  userName?: string;
}

const POPULAR_ARTISTS = [
  { name: 'The Weeknd', genre: 'R&B / Synthwave' },
  { name: 'Taylor Swift', genre: 'Pop / Indie' },
  { name: 'Drake', genre: 'Hip Hop / Rap' },
  { name: 'Kendrick Lamar', genre: 'Hip Hop' },
  { name: 'Tame Impala', genre: 'Psychedelic Indie' },
  { name: 'Daft Punk', genre: 'Electronic / House' },
  { name: 'A. R. Rahman', genre: 'Soundtrack / World' },
  { name: 'Billie Eilish', genre: 'Alt Pop' },
  { name: 'Post Malone', genre: 'Pop / Rock' },
  { name: 'Dua Lipa', genre: 'Dance Pop' },
  { name: 'Arctic Monkeys', genre: 'Indie Rock' },
  { name: 'Travis Scott', genre: 'Hip Hop / Trap' },
  { name: 'Coldplay', genre: 'Alt Rock' },
  { name: 'Radiohead', genre: 'Art Rock' },
  { name: 'SZA', genre: 'R&B' },
  { name: 'Lana Del Rey', genre: 'Dream Pop' }
];

const POPULAR_GENRES = [
  'Pop',
  'Hip Hop',
  'R&B',
  'Indie Rock',
  'Electronic',
  'Synthwave',
  'Classical',
  'Jazz',
  'Alternative',
  'Rock',
  'Lo-Fi',
  'Soul',
  'Dance',
  'Acoustic',
  'Ambient'
];

export const TasteOnboardingModal: React.FC<Props> = ({
  isOpen,
  onComplete,
  dominantColor = '#63E8FF',
  userName
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([
    'The Weeknd',
    'Tame Impala'
  ]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([
    'R&B',
    'Indie Rock',
    'Synthwave'
  ]);
  const [customArtistInput, setCustomArtistInput] = useState('');

  if (!isOpen) return null;

  const toggleArtist = (name: string) => {
    setSelectedArtists(prev => 
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    );
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const handleAddCustomArtist = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customArtistInput.trim();
    if (clean && !selectedArtists.includes(clean)) {
      setSelectedArtists(prev => [...prev, clean]);
      setCustomArtistInput('');
    }
  };

  const handleFinish = () => {
    // 1. Save preferences locally
    const currentPrefs = PreferenceService.getPreferences();
    PreferenceService.savePreferences({
      ...currentPrefs,
      favoriteArtists: selectedArtists.length > 0 ? selectedArtists : ['The Weeknd'],
      favoriteGenres: selectedGenres.length > 0 ? selectedGenres : ['Pop', 'Indie Rock']
    });

    // 2. Mark onboarding as complete for this user
    const curUser = FirebaseAuthService.getCurrentUser();
    if (curUser) {
      FirebaseAuthService.setOnboardingComplete(curUser.uid, true);
    }

    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 select-none animate-fadeIn">
      <div 
        className="w-full max-w-xl rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/90 border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl p-6 sm:p-8 flex flex-col relative overflow-hidden"
        style={{
          boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 40px -5px ${dominantColor}50`
        }}
      >
        {/* Ambient Glow */}
        <div 
          className="pointer-events-none absolute w-96 h-96 -top-20 -right-20 rounded-full blur-[100px] opacity-25"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Header */}
        <div className="mb-6 relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full bg-lumen-cyan/15 border border-lumen-cyan/30 text-[10px] font-mono text-lumen-cyan uppercase tracking-widest font-bold">
              Step {step} of 2 • Taste Setup
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {step === 1 ? 'Pick your favorite artists' : 'What genres do you love?'}
          </h2>
          <p className="text-xs text-white/60 mt-1">
            {step === 1 
              ? `Welcome${userName ? `, ${userName}` : ''}! Select at least 2 artists so LUMEN can curate your personal sound.` 
              : 'Choose the styles that match your everyday listening mood.'}
          </p>
        </div>

        {/* STEP 1: ARTIST SELECTION */}
        {step === 1 ? (
          <div className="space-y-4 relative z-10 flex-1 overflow-hidden flex flex-col">
            {/* Custom Artist Search / Add */}
            <form onSubmit={handleAddCustomArtist} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={customArtistInput}
                  onChange={(e) => setCustomArtistInput(e.target.value)}
                  placeholder="Type any artist name and press Enter..."
                  className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                />
              </div>
              <button
                type="submit"
                disabled={!customArtistInput.trim()}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-white transition-all disabled:opacity-40"
              >
                Add
              </button>
            </form>

            {/* Popular Artists Grid */}
            <div className="flex-1 overflow-y-auto no-scrollbar pr-1 max-h-64 sm:max-h-72">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {POPULAR_ARTISTS.map((artist) => {
                  const isSelected = selectedArtists.includes(artist.name);

                  return (
                    <button
                      key={artist.name}
                      type="button"
                      onClick={() => toggleArtist(artist.name)}
                      className={`p-3 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between group cursor-pointer ${
                        isSelected
                          ? 'bg-white/15 border-lumen-cyan/70 shadow-md ring-1 ring-lumen-cyan/40 scale-102'
                          : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <Disc3 className={`w-4 h-4 ${isSelected ? 'text-lumen-cyan animate-spin-slow' : 'text-white/40'}`} />
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-lumen-cyan text-black' : 'border border-white/20'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-white truncate block">
                        {artist.name}
                      </span>
                      <span className="text-[10px] text-white/40 font-mono truncate block mt-0.5">
                        {artist.genre}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Selected Artists Pills */}
            {selectedArtists.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/10">
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest self-center mr-1">
                  Selected ({selectedArtists.length}):
                </span>
                {selectedArtists.map(a => (
                  <span 
                    key={a}
                    onClick={() => toggleArtist(a)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-lumen-cyan/15 border border-lumen-cyan/30 text-[11px] font-medium text-lumen-cyan cursor-pointer hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40 transition-colors"
                    title="Click to remove"
                  >
                    <span>{a}</span>
                    <X className="w-3 h-3" />
                  </span>
                ))}
              </div>
            )}

            {/* Next Button */}
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={selectedArtists.length === 0}
              className="w-full mt-2 py-3 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-xl hover:scale-102 active:scale-95 disabled:opacity-40 cursor-pointer"
              style={{
                backgroundColor: dominantColor,
                boxShadow: `0 0 25px ${dominantColor}60`
              }}
            >
              <span>Continue to Genres</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* STEP 2: GENRE SELECTION */
          <div className="space-y-4 relative z-10 flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto no-scrollbar pr-1 max-h-72">
              <div className="flex flex-wrap gap-2">
                {POPULAR_GENRES.map((genre) => {
                  const isSelected = selectedGenres.includes(genre);

                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleGenre(genre)}
                      className={`px-4 py-2.5 rounded-full border text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-lumen-cyan text-black border-lumen-cyan font-bold shadow-lg scale-105'
                          : 'bg-white/5 text-white/70 hover:text-white border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                      <span>{genre}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all cursor-pointer"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleFinish}
                className="flex-1 py-3 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-xl hover:scale-102 active:scale-95 cursor-pointer"
                style={{
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 25px ${dominantColor}60`
                }}
              >
                <Sparkles className="w-4 h-4" />
                <span>Start Listening</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

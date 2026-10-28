import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  Check, 
  Search, 
  ChevronRight, 
  X,
  Disc3,
  Flame,
  Plus
} from 'lucide-react';
import { PreferenceService } from '../../services/preferenceService';
import { FirebaseAuthService } from '../../services/firebaseAuthService';

interface Props {
  isOpen: boolean;
  onComplete: () => void;
  dominantColor?: string;
  userName?: string;
}

interface ArtistMeta {
  name: string;
  genre: string;
}

const POPULAR_ARTISTS: ArtistMeta[] = [
  { name: 'The Weeknd', genre: 'R&B / Synthwave' },
  { name: 'Nettspend', genre: 'Underground / Trap' },
  { name: 'Taylor Swift', genre: 'Pop / Indie' },
  { name: 'Drake', genre: 'Hip Hop / Rap' },
  { name: 'Kendrick Lamar', genre: 'Hip Hop' },
  { name: 'Tame Impala', genre: 'Psychedelic Indie' },
  { name: 'Playboi Carti', genre: 'Rage / Trap' },
  { name: 'Daft Punk', genre: 'Electronic / House' },
  { name: 'A. R. Rahman', genre: 'Soundtrack / World' },
  { name: 'Billie Eilish', genre: 'Alt Pop' },
  { name: 'Travis Scott', genre: 'Hip Hop / Trap' },
  { name: 'Post Malone', genre: 'Pop / Rock' },
  { name: 'Arctic Monkeys', genre: 'Indie Rock' },
  { name: 'Ken Carson', genre: 'Rage / Hip Hop' },
  { name: 'Osamason', genre: 'Underground / Rage' },
  { name: 'Frank Ocean', genre: 'Neo-Soul / R&B' },
  { name: 'Tyler, The Creator', genre: 'Alt Hip Hop' },
  { name: 'Coldplay', genre: 'Alt Rock' },
  { name: 'Radiohead', genre: 'Art Rock' },
  { name: 'SZA', genre: 'R&B' },
  { name: 'Lana Del Rey', genre: 'Dream Pop' },
  { name: 'Mac DeMarco', genre: 'Indie / Jangle' },
  { name: 'Dua Lipa', genre: 'Dance Pop' },
  { name: 'Destroy Lonely', genre: 'Trap / Synth' }
];

// Curated artist similarity network for dynamic suggestions
const RELATED_ARTIST_MAP: Record<string, ArtistMeta[]> = {
  'Tame Impala': [
    { name: 'Pond', genre: 'Psychedelic Rock' },
    { name: 'MGMT', genre: 'Indie Pop' },
    { name: 'Beach House', genre: 'Dream Pop' },
    { name: 'Mac DeMarco', genre: 'Indie' }
  ],
  'Nettspend': [
    { name: 'Osamason', genre: 'Underground' },
    { name: 'Ken Carson', genre: 'Rage' },
    { name: 'Playboi Carti', genre: 'Trap' },
    { name: 'Destroy Lonely', genre: 'Opium' }
  ],
  'The Weeknd': [
    { name: 'Frank Ocean', genre: 'Neo-Soul' },
    { name: 'Lana Del Rey', genre: 'Dream Pop' },
    { name: 'Travis Scott', genre: 'Trap' },
    { name: 'Future', genre: 'Hip Hop' }
  ],
  'Drake': [
    { name: '21 Savage', genre: 'Hip Hop' },
    { name: 'Future', genre: 'Hip Hop' },
    { name: 'Travis Scott', genre: 'Trap' },
    { name: 'Lil Baby', genre: 'Hip Hop' }
  ],
  'Taylor Swift': [
    { name: 'Gracie Abrams', genre: 'Indie Pop' },
    { name: 'Phoebe Bridgers', genre: 'Indie Folk' },
    { name: 'Olivia Rodrigo', genre: 'Pop Rock' },
    { name: 'Sabrina Carpenter', genre: 'Pop' }
  ],
  'Kendrick Lamar': [
    { name: 'J. Cole', genre: 'Hip Hop' },
    { name: 'Baby Keem', genre: 'Hip Hop' },
    { name: 'ScHoolboy Q', genre: 'Hip Hop' },
    { name: 'Isaiah Rashad', genre: 'Hip Hop' }
  ],
  'Playboi Carti': [
    { name: 'Ken Carson', genre: 'Rage' },
    { name: 'Destroy Lonely', genre: 'Trap' },
    { name: 'Yeat', genre: 'Trap' },
    { name: 'Nettspend', genre: 'Underground' }
  ],
  'Arctic Monkeys': [
    { name: 'The Strokes', genre: 'Indie Rock' },
    { name: 'The Neighbourhood', genre: 'Alt Pop' },
    { name: 'Cage The Elephant', genre: 'Alt Rock' }
  ],
  'Daft Punk': [
    { name: 'Justice', genre: 'Electronic' },
    { name: 'Kavinsky', genre: 'Synthwave' },
    { name: 'Gesaffelstein', genre: 'Dark Techno' }
  ]
};

export const TasteOnboardingModal: React.FC<Props> = ({
  isOpen,
  onComplete,
  dominantColor = '#63E8FF',
  userName
}) => {
  const [selectedArtists, setSelectedArtists] = useState<string[]>([
    'The Weeknd',
    'Tame Impala'
  ]);
  const [searchInput, setSearchInput] = useState('');
  const [liveSearchResults, setLiveSearchResults] = useState<ArtistMeta[]>([]);
  const [isSearchingLive, setIsSearchingLive] = useState(false);

  // Live artist search across local popular & remote verified API
  useEffect(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q || q.length < 2) {
      setLiveSearchResults([]);
      setIsSearchingLive(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingLive(true);
      try {
        const res = await fetch(`/api/search/verified?q=${encodeURIComponent(q)}&limit=6`);
        if (res.ok) {
          const data = await res.json();
          const remoteTracks: any[] = data.tracks || [];
          const remoteArtistsMap = new Map<string, string>();
          for (const t of remoteTracks) {
            if (t.artist && !remoteArtistsMap.has(t.artist.toLowerCase())) {
              remoteArtistsMap.set(t.artist.toLowerCase(), t.artist);
            }
          }

          const discovered: ArtistMeta[] = [];
          for (const [_, originalName] of remoteArtistsMap) {
            discovered.push({
              name: originalName,
              genre: 'Verified Artist'
            });
          }

          // If query itself isn't in popular or discovered, make query an instant custom candidate
          const exactExists = POPULAR_ARTISTS.some(a => a.name.toLowerCase() === q) ||
                              discovered.some(a => a.name.toLowerCase() === q);
          if (!exactExists && q.length >= 2) {
            // Capitalize properly
            const formatted = q.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            discovered.unshift({
              name: formatted,
              genre: 'Custom Artist'
            });
          }

          setLiveSearchResults(discovered);
        }
      } catch (_) {
        // Fallback to local match
      } finally {
        setIsSearchingLive(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Combined artist list: active search results or popular catalog
  const displayedArtists = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (q) {
      // Filter popular artists
      const localFiltered = POPULAR_ARTISTS.filter(a => 
        a.name.toLowerCase().includes(q) || a.genre.toLowerCase().includes(q)
      );
      // Merge unique by name
      const names = new Set(localFiltered.map(a => a.name.toLowerCase()));
      const combined = [...localFiltered];
      for (const r of liveSearchResults) {
        if (!names.has(r.name.toLowerCase())) {
          combined.push(r);
          names.add(r.name.toLowerCase());
        }
      }
      return combined;
    }
    return POPULAR_ARTISTS;
  }, [searchInput, liveSearchResults]);

  // Dynamically computed suggestions based on currently selected artists
  const dynamicSuggestedArtists = useMemo(() => {
    const suggestions: ArtistMeta[] = [];
    const seen = new Set<string>(selectedArtists.map(a => a.toLowerCase()));

    for (const artist of selectedArtists) {
      const related = RELATED_ARTIST_MAP[artist];
      if (related) {
        for (const item of related) {
          if (!seen.has(item.name.toLowerCase())) {
            suggestions.push(item);
            seen.add(item.name.toLowerCase());
          }
        }
      }
    }
    return suggestions.slice(0, 6);
  }, [selectedArtists]);

  if (!isOpen) return null;

  const toggleArtist = (name: string) => {
    setSelectedArtists(prev => 
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    );
  };

  const handleAddCustomArtist = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchInput.trim();
    if (clean) {
      const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (!selectedArtists.includes(formatted)) {
        setSelectedArtists(prev => [...prev, formatted]);
      }
      setSearchInput('');
    }
  };

  const handleFinish = () => {
    // 1. Auto-derive favorite genres from chosen artists
    const genrePool: string[] = [];
    for (const a of selectedArtists) {
      const found = POPULAR_ARTISTS.find(p => p.name.toLowerCase() === a.toLowerCase());
      if (found) {
        found.genre.split('/').map(g => g.trim()).forEach(g => genrePool.push(g));
      }
    }
    const derivedGenres = Array.from(new Set(genrePool)).slice(0, 5);

    // 2. Save preferences locally
    const currentPrefs = PreferenceService.getPreferences();
    PreferenceService.savePreferences({
      ...currentPrefs,
      favoriteArtists: selectedArtists.length > 0 ? selectedArtists : ['The Weeknd', 'Tame Impala'],
      favoriteGenres: derivedGenres.length > 0 ? derivedGenres : ['Indie Rock', 'R&B', 'Synthwave']
    });

    // 3. Mark onboarding as complete for this user
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
        <div className="mb-5 relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full bg-lumen-cyan/15 border border-lumen-cyan/30 text-[10px] font-mono text-lumen-cyan uppercase tracking-widest font-bold">
              Taste Setup • Personalized Sound
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Pick your favorite artists
          </h2>
          <p className="text-xs text-white/60 mt-1">
            {`Welcome${userName ? `, ${userName}` : ''}! Choose the artists you listen to so LUMEN can tailor your sound.`}
          </p>
        </div>

        {/* Live Search & Add Bar */}
        <div className="space-y-4 relative z-10 flex-1 overflow-hidden flex flex-col">
          <form onSubmit={handleAddCustomArtist} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search or type any artist (e.g. Nettspend, Tame Impala)..."
                className="w-full pl-8 pr-3 py-2.5 bg-white/5 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan transition-colors"
                autoFocus
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!searchInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-lumen-cyan hover:bg-lumen-cyan/80 text-black text-xs font-bold transition-all disabled:opacity-40 disabled:hover:bg-lumen-cyan flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {/* Dynamic "Artists You Might Like" Suggestions */}
          {dynamicSuggestedArtists.length > 0 && !searchInput && (
            <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-pink-400 uppercase tracking-widest font-bold">
                <Flame className="w-3.5 h-3.5" />
                <span>Suggested Based On Your Sound</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dynamicSuggestedArtists.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => toggleArtist(s.name)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 hover:border-pink-500/40 text-[11px] font-medium text-white/90 transition-all cursor-pointer group"
                  >
                    <Plus className="w-3 h-3 text-pink-400 group-hover:scale-125 transition-transform" />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Artists Grid */}
          <div className="flex-1 overflow-y-auto no-scrollbar pr-1 max-h-60 sm:max-h-68">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {displayedArtists.map((artist) => {
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

          {/* Selected Artists Pills Bar */}
          {selectedArtists.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10 max-h-20 overflow-y-auto no-scrollbar">
              <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest mr-1">
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

          {/* Finish Button */}
          <button
            type="button"
            onClick={handleFinish}
            disabled={selectedArtists.length === 0}
            className="w-full mt-2 py-3 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-xl hover:scale-102 active:scale-95 disabled:opacity-40 cursor-pointer"
            style={{
              backgroundColor: dominantColor,
              boxShadow: `0 0 25px ${dominantColor}60`
            }}
          >
            <Sparkles className="w-4 h-4" />
            <span>Curate My Sound</span>
          </button>
        </div>
      </div>
    </div>
  );
};

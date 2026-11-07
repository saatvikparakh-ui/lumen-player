import React, { useState, useEffect } from 'react';
import { getArtworkUrl, getInitials, getCoverGradient, fetchItunesCover } from '../../utils/artwork';

interface Props {
  src?: string | null;
  alt?: string;
  className?: string;
  title?: string;
  artist?: string;
  size?: number;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
}

export const CoverImage: React.FC<Props> = ({
  src,
  alt = 'Album Artwork',
  className = 'w-full h-full object-cover',
  title,
  artist,
  size = 600,
  style,
  loading = 'lazy'
}) => {
  // Fallback stages:
  // 0: High-res primary URL
  // 1: Low-res thumbnail (100x100)
  // 2: Client-side iTunes search by title + artist
  // 3: Gradient placeholder with initials (failsafe)
  const [stage, setStage] = useState<number>(0);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => getArtworkUrl(src, size));
  const [hasAttemptedHeal, setHasAttemptedHeal] = useState(false);

  useEffect(() => {
    const formatted = getArtworkUrl(src, size);
    setResolvedUrl(formatted);
    setStage(formatted ? 0 : (title || artist ? 2 : 3));
    setHasAttemptedHeal(false);
  }, [src, size, title, artist]);

  const handleError = async () => {
    if (stage === 0) {
      // Step 1: Try smaller size if iTunes URL
      if (resolvedUrl && resolvedUrl.includes('mzstatic.com')) {
        const smaller = getArtworkUrl(resolvedUrl, 100);
        if (smaller && smaller !== resolvedUrl) {
          setStage(1);
          setResolvedUrl(smaller);
          return;
        }
      }
      setStage(2);
    }

    if (stage === 1 || stage === 0) {
      // Step 2: Try client-side iTunes query if title and artist are present
      if (!hasAttemptedHeal && title && artist && title !== 'Unknown Title') {
        setHasAttemptedHeal(true);
        setStage(2);
        try {
          const healed = await fetchItunesCover(title, artist);
          if (healed) {
            setResolvedUrl(healed);
            return;
          }
        } catch (_) {}
      }
      setStage(3);
      return;
    }

    // Step 3: Permanent fallback to styled gradient
    setStage(3);
  };

  if (stage === 3 || !resolvedUrl) {
    const initials = getInitials(title, artist);
    const [c1, c2] = getCoverGradient(title, artist);
    return (
      <div 
        className={`flex items-center justify-center font-mono font-bold select-none text-white text-xs ${className}`}
        style={{
          background: `linear-gradient(135deg, ${c1}, ${c2})`,
          ...style
        }}
        aria-label={alt}
      >
        <span className="drop-shadow-md tracking-wider opacity-90">{initials}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onError={handleError}
    />
  );
};

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
    let isMounted = true;
    const formatted = getArtworkUrl(src, size);

    if (formatted) {
      setResolvedUrl(formatted);
      setStage(0);
      setHasAttemptedHeal(false);
      return;
    }

    // When src is missing, on-demand resolve authentic studio artwork for this song
    if (title && artist && title !== 'Unknown Title') {
      setResolvedUrl(null);
      setStage(2); // loading / resolving state
      fetchItunesCover(title, artist).then((healed) => {
        if (isMounted && healed) {
          setResolvedUrl(healed);
          setStage(0);
        } else if (isMounted) {
          setStage(3); // fallback to gradient
        }
      }).catch(() => {
        if (isMounted) setStage(3);
      });
      return;
    }

    setResolvedUrl(null);
    setStage(3);
    setHasAttemptedHeal(false);

    return () => {
      isMounted = false;
    };
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
    }

    // Step 2: Try client-side iTunes query if title and artist are present
    if (!hasAttemptedHeal && title && artist && title !== 'Unknown Title') {
      setHasAttemptedHeal(true);
      setStage(2);
      try {
        const healed = await fetchItunesCover(title, artist);
        if (healed && healed !== resolvedUrl) {
          setResolvedUrl(healed);
          setStage(0);
          return;
        }
      } catch (_) {}
    }

    // Step 3: Permanent fallback to styled gradient with initials
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

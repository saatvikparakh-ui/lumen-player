/**
 * Lumen Weekly Album Club Type Definitions
 * Supports 5-stage lifecycle: nominate -> listen -> rate -> reveal -> remember
 */

export interface ClubMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  isCurator: boolean;
  hasListened: boolean;
  hasSubmitted: boolean;
  joinedAt: number;
}

export interface ClubTrack {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  audioUrl?: string;
  artworkUrl?: string | null;
  trackNumber?: number;
}

export interface AlbumNomination {
  albumId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  year?: number | null;
  genre?: string;
  curatorId: string;
  curatorUsername: string;
  curatorDisplayName: string;
  curatorNote: string; // "I chose this album because..."
  tracks: ClubTrack[];
  nominatedAt: number;
}

export interface MemberReview {
  memberId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  albumRating: number; // 1.0 - 10.0 precision scale
  favoriteTrackId: string;
  favoriteTrackTitle: string;
  trackRatings: Record<string, number>; // trackId -> 1.0 - 10.0
  reviewText?: string; // max 280 characters
  submittedAt: number;
}

export type AlbumClubStage = 'nominate' | 'listen' | 'reveal' | 'remember';

export interface ClubCycleVerdict {
  averageRating: number; // 1.0 - 10.0
  totalSubmissions: number;
  favoriteTrack: {
    trackId: string;
    title: string;
    voteCount: number;
  };
  highestRatedTrack: {
    trackId: string;
    title: string;
    averageRating: number;
  };
  mostDivisiveTrack: {
    trackId: string;
    title: string;
    variance: number;
    highestScore: number;
    lowestScore: number;
  };
  aiSummary?: string;
}

export interface WeeklyCycle {
  weekNumber: number;
  stage: AlbumClubStage;
  curatorMemberId: string;
  curatorUsername: string;
  cycleStartTimestamp: number;
  cycleEndTimestamp: number; // exactly 7 days
  nomination?: AlbumNomination | null;
  memberProgress: Record<
    string,
    {
      listenedTrackIds: string[];
      hasSubmitted: boolean;
    }
  >;
  // Secret reviews: kept sealed until cycleEndTimestamp or stage === 'reveal' / 'remember'
  secretReviews: Record<string, MemberReview>;
  verdict?: ClubCycleVerdict | null;
}

export interface ClubArchiveEntry {
  weekNumber: number;
  nomination: AlbumNomination;
  verdict: ClubCycleVerdict;
  reviews: MemberReview[];
  completedAt: number;
}

export interface AlbumClub {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: number;
  curatorRotationIndex: number; // index in members array for next curator
  members: ClubMember[];
  currentCycle: WeeklyCycle;
  archive: ClubArchiveEntry[];
}

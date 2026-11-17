import { Track } from './music';

export type CircleDiscoveryMode = 'common_ground' | 'equal_rotation' | 'discovery_blend';

export type CircleRadioStatus = 'active' | 'paused' | 'ended';

export type CircleFeedbackType = 'like' | 'not_for_me' | 'already_know' | 'save' | 'skip';

export interface CircleRadioParticipant {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  isHost: boolean;
  preferenceContributionEnabled: boolean;
  joinedAt: number;
}

export interface CircleRadioCandidate {
  id: string;
  sessionId: string;
  track: Track;
  rankScore: number;
  explanation: string; // e.g. "Shared love for Electronic & Gorillaz", "Seeds from @saatvik & @friend"
  sourceUsernames: string[];
  status: 'queued' | 'playing' | 'skipped' | 'completed';
  feedback: Record<string, CircleFeedbackType>;
  batchId: string;
  generatedAt: number;
}

export interface CircleTasteSeed {
  id: string;
  label: string; // artist, track title, or genre
  type: 'artist' | 'track' | 'genre' | 'custom';
  sourceUsername?: string;
  sourceUserId?: string;
  sourceType?: 'most_played_artist' | 'most_played_song' | 'liked_artist' | 'recent_listening' | 'custom';
  enabled: boolean;
  weight?: number;
}

export interface CircleRadioSession {
  id: string;
  hostUserId: string;
  hostUsername: string;
  hostDisplayName: string;
  title: string;
  status: CircleRadioStatus;
  discoveryMode: CircleDiscoveryMode;
  participants: CircleRadioParticipant[];
  candidates: CircleRadioCandidate[];
  seeds?: CircleTasteSeed[];
  currentCandidateId: string | null;
  batchCount: number;
  createdAt: number;
  updatedAt: number;
}

import { Track } from './music';

export type BlindDropMode = 'direct' | 'circle';

export type BlindDropStatus = 
  | 'draft' 
  | 'delivered' 
  | 'open_for_submissions' 
  | 'locked' 
  | 'in_guessing' 
  | 'revealed' 
  | 'completed' 
  | 'cancelled' 
  | 'expired';

export interface BlindDropParticipant {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  hasSubmitted?: boolean;
  hasGuessed?: boolean;
  isHost?: boolean;
}

export interface BlindDropGuess {
  guesserUserId: string;
  guesserUsername: string;
  guesserDisplayName?: string;
  // Song guess fields (Guess the Song mode)
  guessedTrackId?: string;
  guessedTrackTitle?: string;
  guessedTrackArtist?: string;
  guessedTrackArtwork?: string | null;
  // Legacy friend-guess compatibility
  guessedUserId?: string;
  guessedUsername?: string;
  guessedDisplayName?: string;
  isCorrect?: boolean;
  guessedAt: number;
}

export interface BlindDropSubmission {
  id: string;
  roundId: string;
  senderUserId?: string;
  senderUsername?: string;
  senderDisplayName?: string;
  senderPhotoURL?: string | null;
  track: Track;
  /** Custom 30-second clip start timestamp chosen by sender (seconds) */
  clipStartSec?: number;
  /** Clip duration capped at 30 seconds */
  clipDurationSec?: number;
  /** Pre-resolved direct audio CDN URL so sample plays cleanly without leaking title/cover */
  resolvedClipUrl?: string;
  /** True in viewer projection while the song identity is still hidden */
  isSongHidden?: boolean;
  clue?: string;
  submittedAt: number;
  revealedAt?: number;
  reactions?: Record<string, string>;
  guesses?: Record<string, BlindDropGuess>;
}

export interface BlindDropRound {
  id: string;
  mode: BlindDropMode;
  gameType?: 'guess_song' | 'blind_drop';
  title: string;
  hostUserId: string;
  hostUsername: string;
  hostDisplayName: string;
  status: BlindDropStatus;
  participants: BlindDropParticipant[];
  recipientUserId?: string;
  recipientUsername?: string;
  submissions: BlindDropSubmission[];
  createdAt: number;
  submissionDeadline?: number;
  revealedAt?: number;
  completedAt?: number;
  isMuted?: boolean;
}

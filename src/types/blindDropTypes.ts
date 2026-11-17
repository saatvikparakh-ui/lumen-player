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
  guessedUserId: string;
  guessedUsername?: string;
  guessedDisplayName?: string;
  isCorrect?: boolean;
  guessedAt: number;
}

export interface BlindDropSubmission {
  id: string; // opaque public ID e.g. "sub_xxxx"
  roundId: string;
  senderUserId?: string; // Server/private: omitted from client projection until revealed
  senderUsername?: string; // omitted until revealed
  senderDisplayName?: string; // omitted until revealed
  senderPhotoURL?: string | null; // omitted until revealed
  track: Track;
  clue?: string; // optional short clue, max 120 chars
  submittedAt: number;
  revealedAt?: number;
  reactions?: Record<string, string>; // userId -> emoji or tag ('love' | 'fire' | 'mindblown' | 'laugh')
  guesses?: Record<string, BlindDropGuess>; // guesserUserId -> BlindDropGuess
}

export interface BlindDropRound {
  id: string;
  mode: BlindDropMode;
  title: string;
  hostUserId: string;
  hostUsername: string;
  hostDisplayName: string;
  status: BlindDropStatus;
  participants: BlindDropParticipant[];
  recipientUserId?: string; // For direct drop
  recipientUsername?: string;
  submissions: BlindDropSubmission[];
  createdAt: number;
  submissionDeadline?: number;
  revealedAt?: number;
  completedAt?: number;
  isMuted?: boolean;
}

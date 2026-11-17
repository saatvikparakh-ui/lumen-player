import { Track } from './music';

export type AuxSessionMode = 'open_queue' | 'free_queue' | 'vote_next' | 'round_robin';

export type AuxSessionStatus = 
  | 'draft' 
  | 'inviting' 
  | 'active' 
  | 'paused' 
  | 'completed' 
  | 'cancelled' 
  | 'expired';

export type AuxParticipantRole = 'host' | 'co_host' | 'participant';

export type AuxInvitationStatus = 'invited' | 'accepted' | 'declined';

export type AuxQueueItemStatus = 'pending' | 'playing' | 'played' | 'unavailable';

export interface AuxSettings {
  canReorder: boolean;
  explicitFiltering: boolean;
  maxTracksPerParticipant: number;
  inactivityTimeoutMinutes: number;
  duplicatePolicy: 'warn_allow' | 'disallow';
}

export interface AuxParticipant {
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  role: AuxParticipantRole;
  invitationStatus: AuxInvitationStatus;
  joinedAt: number;
  lastSeenAt: number;
  leftAt?: number | null;
}

export interface AuxQueueItem {
  id: string;
  sessionId: string;
  track: Track;
  addedByUserId: string;
  addedByUsername: string;
  addedByDisplayName: string;
  addedByPhotoURL?: string | null;
  position: number;
  status: AuxQueueItemStatus;
  votes: Record<string, number>; // userId -> 1
  voteCount: number;
  addedAt: number;
  removedAt?: number | null;
}

export type AuxEventType = 
  | 'session_created'
  | 'invite_sent'
  | 'invite_accepted'
  | 'participant_joined'
  | 'track_added'
  | 'track_removed'
  | 'queue_reordered'
  | 'vote_added'
  | 'current_item_changed'
  | 'host_transferred'
  | 'participant_left'
  | 'session_paused'
  | 'session_resumed'
  | 'session_ended';

export interface AuxEvent {
  id: string;
  sessionId: string;
  actorUserId: string;
  actorUsername: string;
  eventType: AuxEventType;
  payload?: any;
  createdAt: number;
  sequence: number;
}

export interface AuxSession {
  id: string;
  hostUserId: string;
  hostUsername: string;
  hostDisplayName: string;
  title: string;
  description?: string;
  status: AuxSessionStatus;
  mode: AuxSessionMode;
  settings: AuxSettings;
  participants: AuxParticipant[];
  queue: AuxQueueItem[];
  currentQueueItemId: string | null;
  events: AuxEvent[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  version: number;
}

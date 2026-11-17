import { Track } from './music';

export type MixtapeCoverStyle = 'mosaic' | 'gradient' | 'typography';

export interface MiniMixtape {
  id: string;
  creatorUserId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  title: string;
  message?: string;
  coverStyle: MixtapeCoverStyle;
  coverPalette: [string, string, string, string];
  tracks: Track[]; // Strictly 3-7 tracks
  visibility: 'private' | 'friends';
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type MixtapeShareStatus = 'sent' | 'opened' | 'saved' | 'dismissed';

export interface MiniMixtapeShare {
  id: string;
  mixtapeId: string;
  version: number;
  senderUserId: string;
  senderUsername: string;
  senderDisplayName: string;
  recipientUserId: string;
  recipientUsername: string;
  message?: string;
  status: MixtapeShareStatus;
  mixtape: MiniMixtape;
  sentAt: number;
  openedAt?: number | null;
  dismissedAt?: number | null;
}

export interface MiniMixtapeSavedCopy {
  id: string;
  recipientUserId: string;
  sourceMixtapeId: string;
  sourceVersion: number;
  title: string;
  tracks: Track[];
  coverStyle: MixtapeCoverStyle;
  coverColor: string;
  savedAt: number;
}

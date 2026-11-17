import { Track, CustomPlaylist } from '../../../types/music';

export interface FriendProfileData {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  ratingVisibility?: 'public' | 'friends' | 'private';
  tasteSimilarity?: number;
  sharedArtists?: string[];
  currentTrack?: Track | null;
  isPlaying?: boolean;
  updatedAt?: number;
  isOnline?: boolean;
}

export interface SharedMediaItem {
  id: string;
  senderUid: string;
  senderUsername: string;
  senderDisplayName?: string;
  senderPhotoURL?: string | null;
  recipientUid: string;
  song?: Track | null;
  playlist?: CustomPlaylist | null;
  clubId?: string;
  clubName?: string;
  club?: any;
  type: 'song' | 'playlist' | 'mini_mixtape' | 'aux_invite' | 'aux_room' | 'circle_room' | 'album_club_invite' | string;
  message?: string;
  senderRating?: string | number | null;
  read: boolean;
  createdAt: number;
}

export interface FriendActivityEvent {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  type: 'liked' | 'shared_song' | 'shared_playlist' | 'ranked_tier' | 'listening';
  track?: Track;
  playlistName?: string;
  tierName?: string;
  timestamp: number;
}

export interface FriendTierListPreview {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  title: string;
  rankedCount: number;
  topCovers: string[];
  tiers: {
    s: Track[];
    a: Track[];
    b: Track[];
    c: Track[];
  };
  updatedAt: number;
}

export type FriendsSubView = 
  | 'dashboard' 
  | 'add-friends' 
  | 'friend-profile' 
  | 'tier-list-stage' 
  | 'pass-the-aux' 
  | 'circle-radio'
  | 'album-club';

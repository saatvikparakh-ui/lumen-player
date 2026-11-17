-- =========================================================================
-- LUMEN Supabase Database Setup & Realtime Configuration
-- Run this in: https://supabase.com/dashboard/project/dyhoiurkonczinwvfhdp/sql/new
-- =========================================================================

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  photo_url TEXT,
  is_online BOOLEAN DEFAULT false,
  current_track JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tier Lists Table
CREATE TABLE IF NOT EXISTS public.tier_lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_username TEXT,
  is_collaborative BOOLEAN DEFAULT false,
  tiers JSONB DEFAULT '{}'::jsonb,
  collaborator_uids TEXT[] DEFAULT '{}',
  collaborator_usernames TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Album Clubs Table
CREATE TABLE IF NOT EXISTS public.album_clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at BIGINT,
  members JSONB DEFAULT '[]'::jsonb,
  current_cycle JSONB DEFAULT '{}'::jsonb,
  archive JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Song & Playlist Shares Table
CREATE TABLE IF NOT EXISTS public.song_shares (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  sender_username TEXT,
  sender_display_name TEXT,
  recipient_id TEXT NOT NULL,
  song JSONB,
  playlist JSONB,
  type TEXT DEFAULT 'song',
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Album Club Invites Table
CREATE TABLE IF NOT EXISTS public.album_club_invites (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  club_name TEXT NOT NULL,
  inviter_id TEXT NOT NULL,
  inviter_name TEXT,
  invitee_id TEXT NOT NULL,
  invitee_name TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Track Ratings Table
CREATE TABLE IF NOT EXISTS public.track_ratings (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  track_id TEXT NOT NULL,
  score NUMERIC(3, 1),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Friend Requests Table
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id TEXT PRIMARY KEY,
  from_uid TEXT NOT NULL,
  from_username TEXT,
  from_display_name TEXT,
  from_photo_url TEXT,
  to_uid TEXT NOT NULL,
  to_username TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security (RLS) so LUMEN anon key can freely read/write in real time
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_lists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_clubs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_shares DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_club_invites DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_ratings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests DISABLE ROW LEVEL SECURITY;

-- Enable Realtime WebSockets for all tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tier_lists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tier_lists;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'album_clubs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.album_clubs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'song_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.song_shares;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'album_club_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.album_club_invites;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'track_ratings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.track_ratings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'friend_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
  END IF;
END $$;

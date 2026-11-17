-- =========================================================================
-- STEP 2: ENABLE REALTIME WEBSOCKETS FOR ALL 7 TABLES
-- Run this AFTER Step 1 tables are created!
-- =========================================================================

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

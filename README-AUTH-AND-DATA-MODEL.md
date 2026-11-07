# Lumen Authentication & Cross-Device Cloud Sync Architecture

This document describes the rebuilt, hardened authentication system and item-level Firestore data model in Lumen.

---

## 1. Core Security Invariant: Single Identity

- **The Sole User Identifier**: `auth.currentUser.uid` issued by Firebase Auth is the **only** identifier in the client and database.
- **Zero Client Hashing**: All legacy identity generators (`getDeterministicUserId`, `hashPassword`, `_lumen_salt_2026`, `usr_<hash>`, `lumen_uid_for_`, and `'local_user'`) have been permanently removed.
- **No Client Password Hashing**: Passwords are sent exclusively and directly to Firebase Auth over TLS via the official SDK (`createUserWithEmailAndPassword`, `signInWithEmailAndPassword`, `linkWithCredential`). No plaintext or hashed password touches Firestore or client `localStorage`.
- **Session Persistence**: Multi-tab and offline persistence is configured via `indexedDBLocalPersistence` with fallback to `browserLocalPersistence`. User sessions persist seamlessly across tab reloads, browser restarts, Electron app launches, and Android app restarts.

---

## 2. Guest Accounts & Seamless Upgrade

1. **Anonymous Authentication**:
   - Guests are signed in using Firebase Anonymous Auth (`signInAnonymously`).
   - The user gets a genuine Firebase UID immediately.
   - Likes, ratings, and playlists are created directly under that UID with full offline Firestore caching.
2. **Account Upgrade**:
   - When a guest signs up via email/password or Google, `linkWithCredential` links the credentials to their existing anonymous account.
   - The user's UID **does not change**. All liked songs, playlists, and ratings created while in guest mode automatically persist without requiring manual data migration.

---

## 3. Item-Level Firestore Data Model

The database has been migrated from monolithic array documents to an item-level subcollection schema:

| Document / Subcollection Path | Purpose | Security |
|---|---|---|
| `/users/{uid}` | Public profile (`username`, `displayName`, `photoURL`, `createdAt`) | Readable by authenticated users; Writable only by owner (`request.auth.uid == uid`). Explicitly rejects any writes containing `email` or `passwordHash`. |
| `/users/{uid}/private/account` | Owner-only account metadata (`email`, `privacySettings`, `createdAt`) | Readable & Writable only by owner (`request.auth.uid == uid`). |
| `/usernames/{lowercaseHandle}` | Global unique handle claim (`uid`, `createdAt`) | Readable by authenticated users; Created atomically via transaction where `!exists(/databases/$(database)/documents/usernames/$(handle))`. |
| `/users/{uid}/likes/{trackId}` | Item-level document per liked track (`id`, `title`, `artist`, `album`, `duration`, `artworkUrl`, `likedAt`) | Owner-only (`request.auth.uid == uid`). Fast $O(1)$ toggles, real-time sync across devices. |
| `/users/{uid}/playlists/{playlistId}` | Playlist metadata document (`id`, `name`, `description`, `coverUrl`, `coverColor`, `createdAt`, `updatedAt`) | Owner-only (`request.auth.uid == uid`). |
| `/users/{uid}/playlists/{playlistId}/tracks/{trackId}` | Item-level document per track in playlist (`id`, `title`, `artist`, `duration`, `position`, `addedAt`) | Owner-only (`request.auth.uid == uid`). Uses fractional `position` values to allow $O(1)$ reordering and eliminates 1MB document limit. |
| `/users/{uid}/ratings/{trackId}` | Item-level document per song rating (`songId`, `tenths`, `formatted`, `updatedAt`) | Owner-only (`request.auth.uid == uid`). Offloads ratings completely from the Render backend to Firebase. |
| `/users/{uid}/settings/prefs` | User preferences (`audioQuality`, `theme`, `equalizer`) | Owner-only (`request.auth.uid == uid`). |

---

## 4. Firestore Security Rules

Deploy the rules in `firestore.rules` to your Firebase project:

```bash
firebase deploy --only firestore:rules
```

Key security enforcements in `firestore.rules`:
1. **Default Deny**: All unauthenticated access is rejected by default.
2. **No Data Leakage**: Users cannot read `/users/{uid}/private/*` unless `request.auth.uid == uid`.
3. **No Field Injection**: `/users/{uid}` rejects writes containing sensitive keys (`email`, `passwordHash`, `token`).
4. **Anonymous Account Restrictions**: Anonymous accounts can read and write their own data (`likes`, `playlists`, `ratings`), but are prevented from modifying public social features until upgraded to full accounts.

---

## 5. Firebase Console Setup (Owner Checklist)

To ensure full cross-device and guest capabilities, configure the following in the [Firebase Console](https://console.firebase.google.com/):

1. **Authentication Providers** (`Build > Authentication > Sign-in method`):
   - **Email/Password**: Enable. (Passwordless Email Link is optional).
   - **Anonymous**: Enable. (Required for zero-barrier guest access).
   - **Google**: Enable. Configure the Web client ID and support email.
2. **Authorized Domains** (`Build > Authentication > Settings > Authorized domains`):
   - Add your web domain (e.g., `localhost`, your custom hosting domain, or Cloudflare/Vercel URL).
   - Capacitor Android and Electron use local origins and standard Firebase Auth redirects/popups.
3. **Firestore Database** (`Build > Firestore Database`):
   - Create the database in production mode if not already active.
   - Deploy `firestore.rules` from this repository.
   - Deploy `firestore.indexes.json` if composite index warnings appear in development.
4. **Zero Budget Guarantee**:
   - The entire authentication and real-time sync stack runs within Firebase Spark's free tier limits (50,000 reads/day, 20,000 writes/day, 1 GiB storage, 50,000 monthly active users).

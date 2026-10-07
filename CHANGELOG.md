# Changelog

## 0.5.1

- Fixed: the chat box grabbed the keyboard focus every second, interrupting typing elsewhere in VS Code (for example the commit message).

## 0.5.0

- Whoever creates a room owns it and can lock the queue (nobody else adds, removes or reorders) and lock playback (nobody else plays, pauses, seeks or skips), separately, from the queue header. Locks pause while the owner is away and come back when they return.

## 0.4.1

- Fixed: the chat icon was missing from the package, so the chat view did not appear.

## 0.4.0

- The chat has its own icon in the activity bar, with a badge for unread messages. It no longer sits under the queue.

## 0.3.0

- Reorder the queue: drag tracks, or use "Play next" to put one right after the current track.
- Change your name from the sidebar (click it) or with "SyncRoom: Change Name…".
- Chat with the people in the room. Messages are not stored: you see what arrives while you are in the room.

## 0.2.0

- Fixed: joining or starting a video could freeze VS Code (a command/status loop between the extension and the player).
- Links of the form `watch?v=…&list=…` and `youtu.be/…?list=…` now add the whole playlist and start at the pasted video.
- YouTube Mixes (`list=RD…`) add the first batch YouTube generates, about 25 videos.
- Extension icon.

## 0.1.0

- Rooms with an 8-character code: shared queue, play, pause, seek and skip for everyone.
- YouTube videos and playlists (first 15 videos) by pasting a link.
- Peer-to-peer connection with an encrypted relay fallback. No account, no server.
- Hidden audio engine with an optional player window.
- English and Spanish.

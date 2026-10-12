# Changelog

## 0.9.0

- Error messages have a **Report bug** button, and there is a new command **SyncRoom: Report a Bug…**. It opens a new GitHub issue already filled in with the SyncRoom, VS Code and system versions and the end of the log, so there is no need to copy the log by hand. Your user name is removed from paths and room codes are hidden; you see the issue before sending it (a GitHub account is needed).

## 0.8.2

- Fixed: on some computers joining a room still failed with "giving up after 3 restarts" (engine exited with code 0). The browser relaunches itself in a new process and the one SyncRoom started exits at once; SyncRoom took that for a crash. It now waits for the relaunched browser's page and stops that browser when you leave.
- The log now says whether VS Code runs as administrator and, when the browser relaunches itself, which program started it.

## 0.8.1

- Fixed: with VS Code running as administrator, joining a room failed every time ("giving up after 3 restarts", engine exited with code 0). Edge relaunched itself without administrator rights, outside SyncRoom's control, and the engine was taken for dead; the relaunched browsers were left behind. The engine browser now stays in SyncRoom's control.

## 0.8.0

- Search YouTube from the SyncRoom view: type anything that is not a link in the box under the player and press Enter. Up to 10 videos show with thumbnail, channel and length (live streams are marked LIVE); add one to the queue or play it next. Pasting a link works as before.
- Search uses the same internal YouTube endpoint as the YouTube website (no account, no API key). If YouTube changes it, the view says search is not available and links keep working.

## 0.7.1

- Fixed: joining a room could fail every time ("The audio engine keeps failing") until VS Code restarted its extensions. A hidden browser left over from an earlier session kept the engine's profile, and the new engine exited at once. Every engine launch now gets a fresh profile, and leftover engine browsers and profiles from this extension are cleaned up when a room opens (your own browser and SyncRoom in other VS Code windows are not touched).
- Fixed: the engine browser is stopped when the extension shuts down, even if killing its child processes fails.
- The log now says why the engine exited (for example `code 21: profile in use`) and no longer shows "restart 4/3" when it gives up.
- Fixed: if the open-rooms network could not start, saved group words were not loaded, and adding a group then replaced the saved list.

## 0.7.0

- The SyncRoom view now shows the video of the current track (captured from the hidden player on your computer; nothing is sent to the room). Turn it off with the button on the picture or the `syncroom.videoPreview` setting. Ads that play in the hidden player are visible in the preview.

## 0.6.0

- Open rooms: the owner can list a room as **Public** (anyone using SyncRoom sees it) or for a **Group** (only people who added the same group word see it). The lobby shows the open rooms; click one to join.
- Making a room public turns both locks on; the owner can turn them off.
- Hide a room or every room from a creator from the ⋯ menu; "Show hidden" brings them back.
- Group words are stored in VS Code's secret storage and never leave your computer; group announcements are encrypted with a key derived from the word, and without the word the room code cannot be recovered from them.
- Rooms joined from Open rooms connect through relays only, so strangers never see your IP address. The owner of a listed room still reveals their IP address to people who join with direct connections on; turn off `syncroom.directConnections` to avoid it.

## 0.5.2

- Fixed: most videos showed "This video is unavailable" (embed error 150). YouTube refuses to embed them in a player page served from an IP address; the player page now loads from localhost.

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

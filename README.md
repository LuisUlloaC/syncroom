# SyncRoom

Listen to YouTube together without leaving VS Code. One person creates a room, shares an
8-character code, and everyone in the room hears the same queue at the same moment.

## How it works

1. Open the **SyncRoom** view in the activity bar and choose **Create room**.
2. Send the room code to your friends. They choose **Join** and type it.
3. Paste a YouTube video or playlist link. Anyone in the room can add, reorder, skip, pause or seek, and chat in the sidebar.

There is no account and no SyncRoom server. Rooms exist only while someone is in them.

## Requirements

- A Chromium-based browser installed: Microsoft Edge, Google Chrome, Brave or Chromium.
  VS Code cannot play YouTube audio by itself, so SyncRoom runs the official YouTube
  player in that browser, hidden in the background. Use **SyncRoom: Show or Hide Player
  Window** to see it, for example to skip an ad.
- An internet connection that can reach YouTube.

## Commands

| Command | What it does |
|---|---|
| SyncRoom: Create Room | Start a new room |
| SyncRoom: Join Room… | Enter a room with its code |
| SyncRoom: Add YouTube Link… | Add a video or playlist to the queue |
| SyncRoom: Play / Pause | Also available by clicking the status bar |
| SyncRoom: Next Track | Skip for everyone |
| SyncRoom: Show or Hide Player Window | Toggle the small YouTube window |
| SyncRoom: Copy Room Code | Copy the code to share it |
| SyncRoom: Change Name… | Change the name the others see |
| SyncRoom: Leave Room | Stop listening |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `syncroom.displayName` | *(asked once)* | Your name in the room |
| `syncroom.browserPath` | *(auto)* | Browser used to play audio |
| `syncroom.directConnections` | `true` | Connect peer to peer. Turn off to hide your IP from the room |
| `syncroom.relays` | 4 public relays | Nostr relays used as a fallback path |

## Privacy

- Anyone who has the room code can join and control playback. Share it only with people you trust.
- With direct connections on, the other people in the room can see your IP address (this is how
  peer-to-peer works). Turn `syncroom.directConnections` off to send everything through relays.
- Messages that travel through public relays are encrypted with a key derived from the room code.
  The relays see that someone is using a room, not what is playing.
- YouTube sees your playback the same way it does in a browser tab.

## Known limits

- Playlists add their first 15 videos. YouTube Mixes (`list=RD…`) add the first batch YouTube generates, about 25 videos.
- Some videos cannot be played outside youtube.com, or are blocked in your region. They are marked
  as not available for you and the rest of the room keeps listening.
- In hidden mode an ad cannot be skipped; show the player window to skip it.
- Each VS Code window runs its own audio engine: joining the same room from two windows on one computer plays the audio twice.
- Tested on Windows. macOS and Linux should work but are not verified yet.
- Your computer clock must be roughly right, or relays may reject your messages.

## License

MIT

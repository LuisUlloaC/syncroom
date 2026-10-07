import * as vscode from 'vscode'

const t = vscode.l10n.t

/** Textos de la vista lateral. Se inyectan en el HTML; la vista los busca por clave. */
export function webviewStrings(): Record<string, string> {
  return {
    'lobby.title': t('Listen together'),
    'lobby.body': t('Create a room and share its code. Everyone in the room hears the same YouTube queue at the same time.'),
    'lobby.create': t('Create room'),
    'lobby.joinLabel': t('Have a code?'),
    'lobby.join': t('Join'),
    'room.code': t('Room code'),
    'room.copy': t('Copy room code'),
    'room.leave': t('Leave room'),
    'room.you': t('you'),
    'room.rename': t('Change your name'),
    'room.unnamed': t('Someone'),
    'room.direct': t('Connected directly'),
    'room.relayed': t('Connected through relays'),
    'room.alone': t('Waiting for others to join'),
    'room.starting': t('Starting the audio engine…'),
    'room.fault': t('YouTube could not be loaded in the audio engine. Check your connection.'),
    'player.nothing': t('Nothing playing'),
    'player.hint': t('Paste a YouTube link below to start.'),
    'player.play': t('Play'),
    'player.pause': t('Pause'),
    'player.next': t('Next'),
    'player.seek': t('Position'),
    'player.volume': t('Volume'),
    'player.show': t('Show player window'),
    'player.hide': t('Hide player window'),
    'player.unplayable': t('This video is not available for you.'),
    'add.placeholder': t('YouTube video or playlist link'),
    'add.button': t('Add'),
    'queue.title': t('Queue'),
    'queue.empty': t('The queue is empty.'),
    'queue.playNow': t('Play now'),
    'queue.remove': t('Remove from queue'),
    'queue.addedBy': t('added by {0}', '{0}'),
    'queue.unplayable': t('not available for you'),
    'queue.playNext': t('Play next'),
    'queue.drag': t('Drag to reorder'),
    'chat.join': t('Join or create a room in the SyncRoom view to chat.'),
    'chat.empty': t('No messages yet.'),
    'chat.placeholder': t('Message the room'),
    'chat.send': t('Send'),
    'chat.present': t('In the room: {0}', '{0}'),
    'chat.joined': t('{0} joined', '{0}'),
    'chat.left': t('{0} left', '{0}')
  }
}

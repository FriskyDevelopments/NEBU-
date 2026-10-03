const MEETING_COMMANDS = new Set([
    'zoomlogin', 'startsession', 'roominfo', 'scanroom', 'createroom',
    'monitor', 'chatwatch', 'startbot', 'stopbot', 'botstatus', 'promote',
    'commandchat', 'status', 'logout', 'shutdown',
]);

function registerMeetingCommandAudit(bot, write = (line) => console.log(line)) {
    bot.on('message', (msg) => {
        if (typeof msg.text !== 'string') return;
        const match = /^\/([a-z]+)(?:@[a-zA-Z0-9_]+)?(?=\s|$)/.exec(msg.text);
        if (!match || !MEETING_COMMANDS.has(match[1])) return;

        // Record receipt once, before authorization or overlapping command handlers.
        write(JSON.stringify({
            event: 'meeting_command.issued',
            timestamp: new Date().toISOString(),
            command: `/${match[1]}`,
            userId: msg.from?.id ?? null,
            senderChatId: msg.sender_chat?.id ?? null,
            chatId: msg.chat.id,
            messageId: msg.message_id,
        }));
    });
}

module.exports = { registerMeetingCommandAudit };

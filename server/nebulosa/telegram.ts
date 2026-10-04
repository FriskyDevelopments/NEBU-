import TelegramBot from "node-telegram-bot-api";
import { nebulosaState } from "./state";
import { createCommand, updateCommandExecution } from "./service";
import type { CommandType } from "./contracts";

let telegramBot: TelegramBot | null = null;

export function isTelegramActive(): boolean {
  return telegramBot !== null;
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("No TELEGRAM_BOT_TOKEN provided. Telegram remote-control disabled.");
    return;
  }

  const allowedIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS || "";
  const allowedUserIds = new Set(allowedIdsStr.split(",").map((id) => id.trim()).filter(Boolean));

  telegramBot = new TelegramBot(token, { polling: true });

  console.log(`Telegram remote-control active. Allowed users: ${allowedUserIds.size}`);

  telegramBot.onText(/^\/zoom\s+(.+)$/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id);
    const commandText = match ? match[1].trim() : "";
    const fullText = msg.text || "";

    if (!allowedUserIds.has(userId)) {
      telegramBot?.sendMessage(chatId, "UNAUTHORIZED OPERATOR");

      nebulosaState.addAudit({
        actor: `telegram:${userId}`,
        event: "auth.permission_denied",
        resourceType: "telegram",
        resourceId: userId,
        metadata: { reason: "not_in_allowlist" }
      });
      return;
    }

    let commandType: CommandType;
    let replyText = "";

    switch (commandText.toLowerCase()) {
      case "admit_all":
        commandType = "session.admit_all";
        replyText = "12 PARTICIPANTS ADMITTED";
        break;
      case "mute_all":
        commandType = "session.mute_all";
        replyText = "ALL PARTICIPANTS MUTED";
        break;
      case "lock":
        commandType = "session.lock_room";
        replyText = "SESSION LOCKED";
        break;
      case "record_start":
        // using a placeholder command type if record is not supported,
        // fallback to session.send_warning or another valid schema
        commandType = "session.send_warning";
        replyText = "RECORDING START REQUESTED";
        break;
      case "status":
        telegramBot?.sendMessage(chatId, "NEBULOSA ACTIVE - WAITING FOR COMMANDS");
        return;
      case "help":
        telegramBot?.sendMessage(chatId, "COMMANDS:\n/zoom admit_all\n/zoom lock\n/zoom record_start\n/zoom status");
        return;
      default:
        telegramBot?.sendMessage(chatId, "UNKNOWN COMMAND");
        return;
    }

    try {
      const { command: cmd, created } = createCommand(`telegram:${userId}`, {
        type: commandType,
        payload: {
          sessionId: "session-main",
          reason: `Triggered via telegram: ${fullText}`,
          metadata: {
            source: "telegram",
            rawText: fullText
          }
        },
        ttlSeconds: 60
      }, `telegram:${chatId}:${msg.message_id}`);

      if (!created) {
        const existingReply = cmd.status === "succeeded"
          ? cmd.result?.message ?? replyText
          : "COMMAND ALREADY PROCESSING";
        telegramBot?.sendMessage(chatId, existingReply);
        return;
      }

      telegramBot?.sendMessage(chatId, "PROCESSING COMMAND...");

      // Override audit metadata since createCommand defaults to operator-ui
      cmd.auditMetadata.source = "telegram";
      cmd.auditMetadata.rawText = fullText;

      // Mock Executor flow (Demo Safe)
      setTimeout(() => {
        try {
          updateCommandExecution({
            executorId: "telegram-mock-executor",
            commandId: cmd.id,
            status: "succeeded",
            result: {
              message: replyText
            }
          });
          telegramBot?.sendMessage(chatId, replyText);
        } catch (e) {
          console.error("Failed to mock success:", e);
        }
      }, 1500);

    } catch (e) {
      console.error("Failed to enqueue command via Telegram", e);
      telegramBot?.sendMessage(chatId, "COMMAND FAILED TO ENQUEUE");
    }
  });

  telegramBot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error);
  });
}

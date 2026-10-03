export type SessionSummary = {
  environment: "dev" | "staging" | "prod";
  operator: { id: string; username: string; role: string };
  activeExecutors: number;
  pendingCommands: number;
  alerts: number;
};

export type Command = {
  id: string;
  type: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  attempt?: number;
  maxAttempts?: number;
  error?: string | null;
  failures?: Array<{ attempt: number; error: string; failedAt: string; executorId?: string }>;
};

export type Alert = {
  id: string;
  severity: string;
  message: string;
    createdAt: string;
};

export interface EmojiPack {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  category: string;
  visibility: string;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

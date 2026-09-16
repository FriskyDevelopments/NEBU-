import {
  telegramUsers, zoomTokens, botLogs, botMetrics, meetingInsights,
  emojiPacks, emojiAssets, emojiFonts, emojiFontGlyphs,
  type TelegramUser, type InsertTelegramUser,
  type ZoomToken, type InsertZoomToken,
  type BotLog, type InsertBotLog,
  type BotMetrics, type InsertBotMetrics,
  type MeetingInsights, type InsertMeetingInsights,
  type EmojiPack, type InsertEmojiPack,
  type EmojiAsset, type InsertEmojiAsset,
  type EmojiFont, type InsertEmojiFont,
  type EmojiFontGlyph, type InsertEmojiFontGlyph,
} from "@shared/schema";

export interface IStorage {
  // Telegram Users
  getTelegramUser(telegramId: string): Promise<TelegramUser | undefined>;
  createTelegramUser(user: InsertTelegramUser): Promise<TelegramUser>;
  updateTelegramUser(telegramId: string, updates: Partial<TelegramUser>): Promise<TelegramUser | undefined>;
  getActiveTelegramUsersCount(): Promise<number>;

  // Zoom Tokens
  getZoomToken(telegramUserId: string): Promise<ZoomToken | undefined>;
  createZoomToken(token: InsertZoomToken): Promise<ZoomToken>;
  updateZoomToken(telegramUserId: string, updates: Partial<ZoomToken>): Promise<ZoomToken | undefined>;
  deleteZoomToken(telegramUserId: string): Promise<boolean>;

  // Bot Logs
  createBotLog(log: InsertBotLog): Promise<BotLog>;
  getBotLogs(limit?: number): Promise<BotLog[]>;

  // Bot Metrics
  getBotMetrics(): Promise<BotMetrics | undefined>;
  updateBotMetrics(metrics: Partial<BotMetrics>): Promise<BotMetrics>;

  // Meeting Insights
  createMeetingInsight(insight: InsertMeetingInsights): Promise<MeetingInsights>;
  getMeetingInsights(limit?: number): Promise<MeetingInsights[]>;
  getActiveMeetingInsights(): Promise<MeetingInsights[]>;
  updateMeetingInsight(meetingId: string, updates: Partial<MeetingInsights>): Promise<MeetingInsights | undefined>;
  endMeeting(meetingId: string): Promise<MeetingInsights | undefined>;

  // Emoji Packs
  getEmojiPacks(filters?: { category?: string; visibility?: string; status?: string }): Promise<EmojiPack[]>;
  getEmojiPack(id: number): Promise<EmojiPack | undefined>;
  createEmojiPack(pack: InsertEmojiPack): Promise<EmojiPack>;

  // Emoji Assets
  getEmojiAssets(packId: number): Promise<EmojiAsset[]>;
  createEmojiAsset(asset: InsertEmojiAsset): Promise<EmojiAsset>;

  // Emoji Fonts
  getEmojiFonts(filters?: { visibility?: string; status?: string }): Promise<EmojiFont[]>;
  getEmojiFont(id: number): Promise<EmojiFont | undefined>;
  createEmojiFont(font: InsertEmojiFont): Promise<EmojiFont>;

  // Emoji Font Glyphs
  getEmojiFontGlyphs(fontId: number): Promise<EmojiFontGlyph[]>;
  createEmojiFontGlyph(glyph: InsertEmojiFontGlyph): Promise<EmojiFontGlyph>;
}

export class MemStorage implements IStorage {
  private telegramUsers: Map<string, TelegramUser>;
  private zoomTokens: Map<string, ZoomToken>;
  private botLogs: BotLog[];
  private botMetrics: BotMetrics | undefined;
  private meetingInsights: Map<string, MeetingInsights>;
  private emojiPacks: Map<number, EmojiPack>;
  private emojiAssets: Map<number, EmojiAsset[]>;
  private emojiFonts: Map<number, EmojiFont>;
  private emojiFontGlyphs: Map<number, EmojiFontGlyph[]>;
  private currentId: number;

  constructor() {
    this.telegramUsers = new Map();
    this.zoomTokens = new Map();
    this.botLogs = [];
    this.botMetrics = undefined;
    this.meetingInsights = new Map();
    this.emojiPacks = new Map();
    this.emojiAssets = new Map();
    this.emojiFonts = new Map();
    this.emojiFontGlyphs = new Map();
    this.currentId = 1;
    
    // Add sample meeting data for testing
    this.initializeSampleData();
    this.initializeEmojiSampleData();
  }

  private initializeSampleData() {
    // Active meeting
    const activeMeeting: MeetingInsights = {
      id: this.currentId++,
      meetingId: '12345678901',
      hostUserId: '0000000000',
      topic: 'LA NUBE BOT Test Session',
      status: 'active',
      currentParticipants: 8,
      maxParticipants: 12,
      cameraOnCount: 6,
      micOffCount: 2,
      violations: 1,
      multipinUsersCount: 4,
      startedAt: new Date(Date.now() - 45 * 60000), // 45 minutes ago
      endedAt: null,
      duration: null
    };
    this.meetingInsights.set(activeMeeting.meetingId, activeMeeting);

    // Recent ended meeting
    const endedMeeting: MeetingInsights = {
      id: this.currentId++,
      meetingId: '98765432109',
      hostUserId: '0000000000',
      topic: 'Weekly Team Sync',
      status: 'ended',
      currentParticipants: 0,
      maxParticipants: 15,
      cameraOnCount: 0,
      micOffCount: 0,
      violations: 3,
      multipinUsersCount: 8,
      startedAt: new Date(Date.now() - 2 * 60 * 60000), // 2 hours ago
      endedAt: new Date(Date.now() - 90 * 60000), // 1.5 hours ago
      duration: 30
    };
    this.meetingInsights.set(endedMeeting.meetingId, endedMeeting);

    // Another recent meeting
    const recentMeeting: MeetingInsights = {
      id: this.currentId++,
      meetingId: '11223344556',
      hostUserId: '0000000000',
      topic: 'Client Presentation',
      status: 'ended',
      currentParticipants: 0,
      maxParticipants: 6,
      cameraOnCount: 0,
      micOffCount: 0,
      violations: 0,
      multipinUsersCount: 6,
      startedAt: new Date(Date.now() - 24 * 60 * 60000), // 1 day ago
      endedAt: new Date(Date.now() - 23 * 60 * 60000), // 23 hours ago
      duration: 60
    };
    this.meetingInsights.set(recentMeeting.meetingId, recentMeeting);
  }

  async getTelegramUser(telegramId: string): Promise<TelegramUser | undefined> {
    return this.telegramUsers.get(telegramId);
  }

  async createTelegramUser(insertUser: InsertTelegramUser): Promise<TelegramUser> {
    const id = this.currentId++;
    const user: TelegramUser = {
      ...insertUser,
      id,
      joinedAt: new Date(),
    };
    this.telegramUsers.set(insertUser.telegramId, user);
    return user;
  }

  async updateTelegramUser(telegramId: string, updates: Partial<TelegramUser>): Promise<TelegramUser | undefined> {
    const user = this.telegramUsers.get(telegramId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.telegramUsers.set(telegramId, updatedUser);
    return updatedUser;
  }

  async getActiveTelegramUsersCount(): Promise<number> {
    return Array.from(this.telegramUsers.values()).filter(user => user.isActive).length;
  }

  async getZoomToken(telegramUserId: string): Promise<ZoomToken | undefined> {
    return this.zoomTokens.get(telegramUserId);
  }

  async createZoomToken(insertToken: InsertZoomToken): Promise<ZoomToken> {
    const id = this.currentId++;
    const token: ZoomToken = {
      ...insertToken,
      id,
      createdAt: new Date(),
    };
    this.zoomTokens.set(insertToken.telegramUserId, token);
    return token;
  }

  async updateZoomToken(telegramUserId: string, updates: Partial<ZoomToken>): Promise<ZoomToken | undefined> {
    const token = this.zoomTokens.get(telegramUserId);
    if (!token) return undefined;
    
    const updatedToken = { ...token, ...updates };
    this.zoomTokens.set(telegramUserId, updatedToken);
    return updatedToken;
  }

  async deleteZoomToken(telegramUserId: string): Promise<boolean> {
    return this.zoomTokens.delete(telegramUserId);
  }

  async createBotLog(insertLog: InsertBotLog): Promise<BotLog> {
    const id = this.currentId++;
    const log: BotLog = {
      ...insertLog,
      id,
      timestamp: new Date(),
    };
    this.botLogs.push(log);
    return log;
  }

  async getBotLogs(limit = 50): Promise<BotLog[]> {
    return this.botLogs
      .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime())
      .slice(0, limit);
  }

  async getBotMetrics(): Promise<BotMetrics | undefined> {
    return this.botMetrics;
  }

  async updateBotMetrics(updates: Partial<BotMetrics>): Promise<BotMetrics> {
    const id = this.currentId++;
    this.botMetrics = {
      id,
      activeUsers: 0,
      commandsToday: 0,
      totalCommands: 0,
      uptime: "0d 0h 0m",
      ...this.botMetrics,
      ...updates,
      lastUpdated: new Date(),
    };
    return this.botMetrics;
  }

  async createMeetingInsight(insertInsight: InsertMeetingInsights): Promise<MeetingInsights> {
    const id = this.currentId++;
    const insight: MeetingInsights = {
      ...insertInsight,
      id,
      startedAt: new Date(),
    };
    this.meetingInsights.set(insertInsight.meetingId, insight);
    return insight;
  }

  async getMeetingInsights(limit = 10): Promise<MeetingInsights[]> {
    const insights = Array.from(this.meetingInsights.values());
    return insights
      .sort((a, b) => new Date(b.startedAt!).getTime() - new Date(a.startedAt!).getTime())
      .slice(0, limit);
  }

  async getActiveMeetingInsights(): Promise<MeetingInsights[]> {
    return Array.from(this.meetingInsights.values()).filter(insight => insight.status === 'active');
  }

  async updateMeetingInsight(meetingId: string, updates: Partial<MeetingInsights>): Promise<MeetingInsights | undefined> {
    const insight = this.meetingInsights.get(meetingId);
    if (!insight) return undefined;
    
    const updatedInsight = { ...insight, ...updates };
    this.meetingInsights.set(meetingId, updatedInsight);
    return updatedInsight;
  }

  async endMeeting(meetingId: string): Promise<MeetingInsights | undefined> {
    const insight = this.meetingInsights.get(meetingId);
    if (!insight) return undefined;
    
    const duration = insight.startedAt ? Math.floor((Date.now() - new Date(insight.startedAt).getTime()) / 60000) : 0;
    const updatedInsight = { 
      ...insight, 
      status: 'ended' as const,
      endedAt: new Date(),
      duration
    };
    this.meetingInsights.set(meetingId, updatedInsight);
    return updatedInsight;
  }

  // ─── Emoji Sample Data ───────────────────────────────────────────────────

  private initializeEmojiSampleData() {
    // Sample Emoji Packs
    const basicPack: EmojiPack = {
      id: this.currentId++,
      name: "Basic Emoji Pack",
      slug: "basic",
      description: "Essential emoji for everyday use",
      coverImageUrl: null,
      category: "basic",
      visibility: "public",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.emojiPacks.set(basicPack.id, basicPack);
    this.emojiAssets.set(basicPack.id, [
      { id: this.currentId++, packId: basicPack.id, name: "Heart", assetType: "unicode", fileUrl: null, unicodeValue: "❤️", tags: ["love", "heart"], isAnimated: false, visibility: "public", createdAt: new Date() },
      { id: this.currentId++, packId: basicPack.id, name: "Star", assetType: "unicode", fileUrl: null, unicodeValue: "⭐", tags: ["star", "favorite"], isAnimated: false, visibility: "public", createdAt: new Date() },
      { id: this.currentId++, packId: basicPack.id, name: "Fire", assetType: "unicode", fileUrl: null, unicodeValue: "🔥", tags: ["fire", "hot"], isAnimated: false, visibility: "public", createdAt: new Date() },
    ]);

    const magicPack: EmojiPack = {
      id: this.currentId++,
      name: "Magic Symbols Pack",
      slug: "magic-symbols",
      description: "Mystical and magical overlay elements",
      coverImageUrl: null,
      category: "magic",
      visibility: "public",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.emojiPacks.set(magicPack.id, magicPack);
    this.emojiAssets.set(magicPack.id, [
      { id: this.currentId++, packId: magicPack.id, name: "Sparkle", assetType: "unicode", fileUrl: null, unicodeValue: "✨", tags: ["sparkle", "magic", "shine"], isAnimated: false, visibility: "public", createdAt: new Date() },
      { id: this.currentId++, packId: magicPack.id, name: "Crystal Ball", assetType: "unicode", fileUrl: null, unicodeValue: "🔮", tags: ["crystal", "magic", "portal"], isAnimated: false, visibility: "public", createdAt: new Date() },
      { id: this.currentId++, packId: magicPack.id, name: "Wand", assetType: "unicode", fileUrl: null, unicodeValue: "🪄", tags: ["wand", "magic"], isAnimated: false, visibility: "public", createdAt: new Date() },
    ]);

    const neonPack: EmojiPack = {
      id: this.currentId++,
      name: "Neon Reactions Pack",
      slug: "neon-reactions",
      description: "Vibrant neon-style reaction overlays",
      coverImageUrl: null,
      category: "reactions",
      visibility: "premium",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.emojiPacks.set(neonPack.id, neonPack);
    this.emojiAssets.set(neonPack.id, [
      { id: this.currentId++, packId: neonPack.id, name: "Neon Heart", assetType: "svg", fileUrl: "/assets/neon-heart.svg", unicodeValue: null, tags: ["neon", "heart", "love"], isAnimated: false, visibility: "premium", createdAt: new Date() },
      { id: this.currentId++, packId: neonPack.id, name: "Neon Star", assetType: "svg", fileUrl: "/assets/neon-star.svg", unicodeValue: null, tags: ["neon", "star"], isAnimated: false, visibility: "premium", createdAt: new Date() },
    ]);

    // Sample Emoji Fonts
    const defaultFont: EmojiFont = {
      id: this.currentId++,
      name: "Default Caption Font",
      slug: "default-caption",
      description: "Standard caption font for stickers",
      fontType: "ttf",
      fontFileUrl: null,
      previewImageUrl: null,
      visibility: "public",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
    };
    this.emojiFonts.set(defaultFont.id, defaultFont);
    this.emojiFontGlyphs.set(defaultFont.id, [
      { id: this.currentId++, fontId: defaultFont.id, glyphName: "sparkle", unicodeMap: "*", assetUrl: "/assets/glyphs/sparkle.svg", sortOrder: 1, createdAt: new Date() },
      { id: this.currentId++, fontId: defaultFont.id, glyphName: "heart", unicodeMap: "<3", assetUrl: "/assets/glyphs/heart.svg", sortOrder: 2, createdAt: new Date() },
      { id: this.currentId++, fontId: defaultFont.id, glyphName: "star", unicodeMap: "**", assetUrl: "/assets/glyphs/star.svg", sortOrder: 3, createdAt: new Date() },
    ]);

    const neonFont: EmojiFont = {
      id: this.currentId++,
      name: "Neon Emoji Font",
      slug: "neon-emoji",
      description: "Glowing neon-style emoji font for premium stickers",
      fontType: "svg",
      fontFileUrl: "/assets/fonts/neon-emoji.svg",
      previewImageUrl: "/assets/fonts/neon-emoji-preview.png",
      visibility: "premium",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
    };
    this.emojiFonts.set(neonFont.id, neonFont);
    this.emojiFontGlyphs.set(neonFont.id, [
      { id: this.currentId++, fontId: neonFont.id, glyphName: "glow-circle", unicodeMap: "O", assetUrl: "/assets/fonts/neon/glow-circle.svg", sortOrder: 1, createdAt: new Date() },
      { id: this.currentId++, fontId: neonFont.id, glyphName: "neon-star", unicodeMap: "*", assetUrl: "/assets/fonts/neon/neon-star.svg", sortOrder: 2, createdAt: new Date() },
    ]);

    const magicRuneFont: EmojiFont = {
      id: this.currentId++,
      name: "Magic Rune Font",
      slug: "magic-rune",
      description: "Ancient rune-style symbols for magical stickers",
      fontType: "glyph_set",
      fontFileUrl: null,
      previewImageUrl: "/assets/fonts/magic-rune-preview.png",
      visibility: "pro",
      status: "active",
      createdBy: null,
      createdAt: new Date(),
    };
    this.emojiFonts.set(magicRuneFont.id, magicRuneFont);
    this.emojiFontGlyphs.set(magicRuneFont.id, [
      { id: this.currentId++, fontId: magicRuneFont.id, glyphName: "rune-fire", unicodeMap: "F", assetUrl: "/assets/fonts/rune/fire.svg", sortOrder: 1, createdAt: new Date() },
      { id: this.currentId++, fontId: magicRuneFont.id, glyphName: "rune-water", unicodeMap: "W", assetUrl: "/assets/fonts/rune/water.svg", sortOrder: 2, createdAt: new Date() },
    ]);
  }

  // ─── Emoji Packs ────────────────────────────────────────────────────────

  async getEmojiPacks(filters?: { category?: string; visibility?: string; status?: string }): Promise<EmojiPack[]> {
    let packs = Array.from(this.emojiPacks.values());
    if (filters?.category) packs = packs.filter(p => p.category === filters.category);
    if (filters?.visibility) packs = packs.filter(p => p.visibility === filters.visibility);
    if (filters?.status) packs = packs.filter(p => p.status === filters.status);
    return packs;
  }

  async getEmojiPack(id: number): Promise<EmojiPack | undefined> {
    return this.emojiPacks.get(id);
  }

  async createEmojiPack(insertPack: InsertEmojiPack): Promise<EmojiPack> {
    const id = this.currentId++;
    const pack: EmojiPack = {
      ...insertPack,
      id,
      description: insertPack.description ?? null,
      coverImageUrl: insertPack.coverImageUrl ?? null,
      createdBy: insertPack.createdBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.emojiPacks.set(id, pack);
    this.emojiAssets.set(id, []);
    return pack;
  }

  // ─── Emoji Assets ───────────────────────────────────────────────────────

  async getEmojiAssets(packId: number): Promise<EmojiAsset[]> {
    return this.emojiAssets.get(packId) ?? [];
  }

  async createEmojiAsset(insertAsset: InsertEmojiAsset): Promise<EmojiAsset> {
    const id = this.currentId++;
    const asset: EmojiAsset = {
      ...insertAsset,
      id,
      fileUrl: insertAsset.fileUrl ?? null,
      unicodeValue: insertAsset.unicodeValue ?? null,
      tags: insertAsset.tags ?? [],
      isAnimated: insertAsset.isAnimated ?? false,
      createdAt: new Date(),
    };
    const existing = this.emojiAssets.get(insertAsset.packId) ?? [];
    this.emojiAssets.set(insertAsset.packId, [...existing, asset]);
    return asset;
  }

  // ─── Emoji Fonts ────────────────────────────────────────────────────────

  async getEmojiFonts(filters?: { visibility?: string; status?: string }): Promise<EmojiFont[]> {
    let fonts = Array.from(this.emojiFonts.values());
    if (filters?.visibility) fonts = fonts.filter(f => f.visibility === filters.visibility);
    if (filters?.status) fonts = fonts.filter(f => f.status === filters.status);
    return fonts;
  }

  async getEmojiFont(id: number): Promise<EmojiFont | undefined> {
    return this.emojiFonts.get(id);
  }

  async createEmojiFont(insertFont: InsertEmojiFont): Promise<EmojiFont> {
    const id = this.currentId++;
    const font: EmojiFont = {
      ...insertFont,
      id,
      description: insertFont.description ?? null,
      fontFileUrl: insertFont.fontFileUrl ?? null,
      previewImageUrl: insertFont.previewImageUrl ?? null,
      createdBy: insertFont.createdBy ?? null,
      createdAt: new Date(),
    };
    this.emojiFonts.set(id, font);
    this.emojiFontGlyphs.set(id, []);
    return font;
  }

  // ─── Emoji Font Glyphs ──────────────────────────────────────────────────

  async getEmojiFontGlyphs(fontId: number): Promise<EmojiFontGlyph[]> {
    const glyphs = this.emojiFontGlyphs.get(fontId) ?? [];
    return glyphs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  async createEmojiFontGlyph(insertGlyph: InsertEmojiFontGlyph): Promise<EmojiFontGlyph> {
    const id = this.currentId++;
    const glyph: EmojiFontGlyph = {
      ...insertGlyph,
      id,
      unicodeMap: insertGlyph.unicodeMap ?? null,
      assetUrl: insertGlyph.assetUrl ?? null,
      sortOrder: insertGlyph.sortOrder ?? 0,
      createdAt: new Date(),
    };
    const existing = this.emojiFontGlyphs.get(insertGlyph.fontId) ?? [];
    this.emojiFontGlyphs.set(insertGlyph.fontId, [...existing, glyph]);
    return glyph;
  }
}

export const storage = new MemStorage();

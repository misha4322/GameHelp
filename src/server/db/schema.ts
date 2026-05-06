import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* =========================
   USERS
========================= */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 32 }).notNull().unique(),
    email: varchar("email", { length: 255 }).unique(),
    passwordHash: varchar("password_hash", { length: 255 }),
    provider: varchar("provider", { length: 20 }).notNull().default("local"),
    providerId: varchar("provider_id", { length: 255 }),
    role: varchar("role", { length: 20 }).notNull().default("user"),
    avatarUrl: text("avatar_url"),

    // расширенный профиль
    profileBannerUrl: text("profile_banner_url"),
    statusText: varchar("status_text", { length: 120 }),
    bio: text("bio"),
    location: varchar("location", { length: 120 }),
    websiteUrl: varchar("website_url", { length: 255 }),
    telegram: varchar("telegram", { length: 64 }),
    discord: varchar("discord", { length: 64 }),
    steamProfileUrl: varchar("steam_profile_url", { length: 255 }),
    favoriteGames: text("favorite_games"),

    // настройки видимости
    showEmail: boolean("show_email").notNull().default(false),
    showFriendCode: boolean("show_friend_code").notNull().default(true),

    // дружба / приватность
    friendCode: varchar("friend_code", { length: 9 }).unique(),
    isProfilePrivate: boolean("is_profile_private").notNull().default(false),

    isBanned: boolean("is_banned").notNull().default(false),
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerProviderIdUnique: uniqueIndex("users_provider_providerid_unique").on(
      t.provider,
      t.providerId
    ),
  })
);

/* =========================
   FRIENDSHIPS
========================= */

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    requesterId: uuid("requester_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    addresseeId: uuid("addressee_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    status: varchar("status", { length: 12 })
      .$type<"pending" | "accepted">()
      .notNull()
      .default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requesterAddresseeUnique: uniqueIndex("friendships_requester_addressee_unique").on(
      t.requesterId,
      t.addresseeId
    ),
  })
);

/* =========================
   CATEGORIES
========================= */

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/* =========================
   POSTS
========================= */

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 220 }).notNull().unique(),
  content: text("content").notNull(),
  coverImage: text("cover_image"),
  views: integer("views").default(0),
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  /** Модератор попросил автора переработать пост после жалоб */
  staffRevisionRequestedAt: timestamp("staff_revision_requested_at", { withTimezone: true }),
  staffRevisionNote: text("staff_revision_note"),
});

/* =========================
   COMMENTS
========================= */

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  authorId: uuid("author_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  parentId: uuid("parent_id").references((): any => comments.id, {
    onDelete: "set null",
  }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedById: uuid("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editedByStaffId: uuid("edited_by_staff_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

/** Предупреждения модерации: пользователь видит плашку до подтверждения */
export const userWarnings = pgTable("user_warnings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  commentId: uuid("comment_id").references(() => comments.id, { onDelete: "set null" }),
  commentSnapshot: text("comment_snapshot"),
  reason: text("reason").notNull(),
  createdByStaffId: uuid("created_by_staff_id")
    .references(() => users.id, { onDelete: "set null" })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
});

/* =========================
   POST LIKES
========================= */

export const postLikes = pgTable(
  "post_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<"like" | "dislike">().notNull().default("like"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    postUserUnique: uniqueIndex("post_likes_post_user_unique").on(t.postId, t.userId),
  })
);

/* =========================
   COMMENT LIKES
========================= */

export const commentLikes = pgTable(
  "comment_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .references(() => comments.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<"like" | "dislike">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    commentUserUnique: uniqueIndex("comment_likes_comment_user_unique").on(
      t.commentId,
      t.userId
    ),
  })
);

/* =========================
   TAGS + POST_TAGS
========================= */

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
});

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.postId, t.tagId] }),
  })
);

/* =========================
   DIRECT CONVERSATIONS
========================= */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    type: varchar("type", { length: 16 })
      .$type<"direct">()
      .notNull()
      .default("direct"),

    directKey: varchar("direct_key", { length: 80 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (t) => ({
    directKeyUnique: uniqueIndex("conversations_direct_key_unique").on(t.directKey),
  })
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.userId] }),
  })
);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),

  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),

  senderId: uuid("sender_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  /** Ответ на сообщение в том же чате */
  replyToId: uuid("reply_to_id").references((): any => messages.id, {
    onDelete: "set null",
  }),

  type: varchar("type", { length: 20 })
    .$type<"text" | "post_share" | "image">()
    .notNull()
    .default("text"),

  content: text("content"),
  sharedPostId: uuid("shared_post_id").references(() => posts.id, {
    onDelete: "set null",
  }),
  imageUrl: text("image_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

export const conversationPins = pgTable(
  "conversation_pins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    pinnedBy: uuid("pinned_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convMessageUnique: uniqueIndex("conversation_pins_conv_msg_unique").on(
      t.conversationId,
      t.messageId
    ),
  })
);

export type ContentReportTarget = "post" | "message" | "comment";
export type CommentReportReasonCategory = "insult" | "hate" | "spam" | "custom";

/** Жалобы на посты, сообщения и комментарии (для модерации).
 * Категория жалобы на комментарий хранится префиксом в `reason`: `[report_cat:insult]\n…`
 * — работает без отдельной колонки в БД.
 */
export const contentReports = pgTable("content_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  targetType: varchar("target_type", { length: 16 }).$type<ContentReportTarget>().notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* =========================
   MODERATION WORDS + EVENTS
========================= */

export type ModerationAction = "censor" | "block";
export type ModerationScope = "all" | "posts" | "comments" | "messages" | "profile";
export type ModerationSeverity = "low" | "medium" | "high";

export const moderationWords = pgTable("moderation_words", {
  id: uuid("id").defaultRandom().primaryKey(),
  phrase: text("phrase").notNull(),
  normalizedPhrase: text("normalized_phrase").notNull(),
  action: varchar("action", { length: 12 })
    .$type<ModerationAction>()
    .notNull()
    .default("censor"),
  scope: varchar("scope", { length: 16 }).$type<ModerationScope>().notNull().default("all"),
  severity: varchar("severity", { length: 12 })
    .$type<ModerationSeverity>()
    .notNull()
    .default("medium"),
  replacement: varchar("replacement", { length: 64 }).notNull().default("***"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ModerationEventTargetType = "post" | "comment" | "message" | "profile";
export type ModerationEventAction = "censor" | "block";

export const moderationEvents = pgTable("moderation_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  targetType: varchar("target_type", { length: 16 })
    .$type<ModerationEventTargetType>()
    .notNull(),
  targetId: uuid("target_id"),
  action: varchar("action", { length: 12 }).$type<ModerationEventAction>().notNull(),
  scope: varchar("scope", { length: 16 }).notNull(),
  matchedCount: integer("matched_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* =========================
   RELATIONS
========================= */

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
  moderationWarnings: many(userWarnings),
  moderationWordsCreated: many(moderationWords, {
    relationName: "moderation_words_created_by",
  }),
  moderationWordsUpdated: many(moderationWords, {
    relationName: "moderation_words_updated_by",
  }),
  moderationEvents: many(moderationEvents, { relationName: "moderation_events_user" }),

  friendRequestsSent: many(friendships, { relationName: "friend_requester" }),
  friendRequestsReceived: many(friendships, { relationName: "friend_addressee" }),

  conversationMembers: many(conversationMembers),
  sentMessages: many(messages),
}));

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  requester: one(users, {
    fields: [friendships.requesterId],
    references: [users.id],
    relationName: "friend_requester",
  }),
  addressee: one(users, {
    fields: [friendships.addresseeId],
    references: [users.id],
    relationName: "friend_addressee",
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  category: one(categories, { fields: [posts.categoryId], references: [categories.id] }),
  comments: many(comments),
  likes: many(postLikes),
  postTags: many(postTags),
  sharedInMessages: many(messages),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  deletedBy: one(users, {
    fields: [comments.deletedById],
    references: [users.id],
    relationName: "comment_deleted_by",
  }),
  editedByStaff: one(users, {
    fields: [comments.editedByStaffId],
    references: [users.id],
    relationName: "comment_edited_by_staff",
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: "replies",
  }),
  replies: many(comments, { relationName: "replies" }),
  likes: many(commentLikes),
}));

export const userWarningsRelations = relations(userWarnings, ({ one }) => ({
  user: one(users, { fields: [userWarnings.userId], references: [users.id] }),
  comment: one(comments, { fields: [userWarnings.commentId], references: [comments.id] }),
  createdByStaff: one(users, {
    fields: [userWarnings.createdByStaffId],
    references: [users.id],
    relationName: "warning_created_by",
  }),
}));

export const postLikesRelations = relations(postLikes, ({ one }) => ({
  post: one(posts, { fields: [postLikes.postId], references: [posts.id] }),
  user: one(users, { fields: [postLikes.userId], references: [users.id] }),
}));

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
  comment: one(comments, { fields: [commentLikes.commentId], references: [comments.id] }),
  user: one(users, { fields: [commentLikes.userId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
  pins: many(conversationPins),
}));

export const conversationMembersRelations = relations(
  conversationMembers,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationMembers.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationMembers.userId],
      references: [users.id],
    }),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  sharedPost: one(posts, {
    fields: [messages.sharedPostId],
    references: [posts.id],
  }),
  replyTo: one(messages, {
    fields: [messages.replyToId],
    references: [messages.id],
    relationName: "message_reply",
  }),
}));

export const conversationPinsRelations = relations(conversationPins, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationPins.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [conversationPins.messageId],
    references: [messages.id],
  }),
  pinnedByUser: one(users, {
    fields: [conversationPins.pinnedBy],
    references: [users.id],
  }),
}));

export const moderationWordsRelations = relations(moderationWords, ({ one }) => ({
  createdBy: one(users, {
    fields: [moderationWords.createdById],
    references: [users.id],
    relationName: "moderation_words_created_by",
  }),
  updatedBy: one(users, {
    fields: [moderationWords.updatedById],
    references: [users.id],
    relationName: "moderation_words_updated_by",
  }),
}));

export const moderationEventsRelations = relations(moderationEvents, ({ one }) => ({
  user: one(users, {
    fields: [moderationEvents.userId],
    references: [users.id],
    relationName: "moderation_events_user",
  }),
}));
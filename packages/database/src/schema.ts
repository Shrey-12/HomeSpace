import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  bigint,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "editor", "viewer"]);
export const assetStatus = pgEnum("asset_status", ["pending_upload", "processing", "available", "failed"]);
export const jobStatus = pgEnum("job_status", ["queued", "processing", "completed", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("external_identities_issuer_subject_idx").on(table.issuer, table.subject),
    index("external_identities_user_id_idx").on(table.userId),
  ],
);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectMemberships = pgTable(
  "project_memberships",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_memberships_user_id_idx").on(table.userId),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    expectedSizeBytes: bigint("expected_size_bytes", { mode: "number" }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull().unique(),
    status: assetStatus("status").default("pending_upload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("assets_project_id_idx").on(table.projectId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: jobStatus("status").default("queued").notNull(),
    progress: integer("progress").default(0).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("jobs_project_id_created_at_idx").on(table.projectId, table.createdAt),
    index("jobs_outbox_idx").on(table.status, table.publishedAt),
  ],
);

export type Project = typeof projects.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Job = typeof jobs.$inferSelect;

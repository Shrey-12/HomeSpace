CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TYPE "asset_status" ADD VALUE IF NOT EXISTS 'processing';--> statement-breakpoint
DO $$
BEGIN
	CREATE TYPE "job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade,
	CONSTRAINT "jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_project_id_created_at_idx" ON "jobs" USING btree ("project_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_outbox_idx" ON "jobs" USING btree ("status", "published_at");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM (
			SELECT "owner_id" AS principal FROM "projects"
			UNION ALL SELECT "principal_id" FROM "project_memberships"
			UNION ALL SELECT "uploaded_by" FROM "assets"
		) AS principals
		WHERE strpos(principal, '|') = 0
	) THEN
		RAISE EXCEPTION 'Cannot map legacy identities without issuer and subject separated by a pipe.';
	END IF;
END $$;--> statement-breakpoint
CREATE TEMP TABLE "identity_migration_map" (
	"legacy_principal" text PRIMARY KEY,
	"user_id" uuid NOT NULL DEFAULT gen_random_uuid(),
	"issuer" text NOT NULL,
	"subject" text NOT NULL
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "identity_migration_map" ("legacy_principal", "issuer", "subject")
SELECT DISTINCT
	principal,
	substring(principal FROM 1 FOR strpos(principal, '|') - 1),
	substring(principal FROM strpos(principal, '|') + 1)
FROM (
	SELECT "owner_id" AS principal FROM "projects"
	UNION SELECT "principal_id" FROM "project_memberships"
	UNION SELECT "uploaded_by" FROM "assets"
) AS principals;--> statement-breakpoint
INSERT INTO "users" ("id") SELECT "user_id" FROM "identity_migration_map";--> statement-breakpoint
INSERT INTO "external_identities" ("user_id", "issuer", "subject")
SELECT "user_id", "issuer", "subject" FROM "identity_migration_map";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
UPDATE "projects" AS project SET "owner_user_id" = identity."user_id"
FROM "identity_migration_map" AS identity WHERE project."owner_id" = identity."legacy_principal";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "owner_user_id" TO "owner_id";--> statement-breakpoint
ALTER TABLE "project_memberships" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "project_memberships" AS membership SET "user_id" = identity."user_id"
FROM "identity_migration_map" AS identity WHERE membership."principal_id" = identity."legacy_principal";--> statement-breakpoint
ALTER TABLE "project_memberships" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_memberships" DROP CONSTRAINT "project_memberships_project_id_principal_id_pk";--> statement-breakpoint
DROP INDEX "project_memberships_principal_id_idx";--> statement-breakpoint
ALTER TABLE "project_memberships" DROP COLUMN "principal_id";--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_user_id_pk" PRIMARY KEY("project_id", "user_id");--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "uploaded_by_user_id" uuid;--> statement-breakpoint
UPDATE "assets" AS asset SET "uploaded_by_user_id" = identity."user_id"
FROM "identity_migration_map" AS identity WHERE asset."uploaded_by" = identity."legacy_principal";--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "uploaded_by_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "uploaded_by";--> statement-breakpoint
ALTER TABLE "assets" RENAME COLUMN "uploaded_by_user_id" TO "uploaded_by";--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_issuer_subject_idx" ON "external_identities" USING btree ("issuer", "subject");--> statement-breakpoint
CREATE INDEX "external_identities_user_id_idx" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_memberships_user_id_idx" ON "project_memberships" USING btree ("user_id");--> statement-breakpoint
DROP TABLE "identity_migration_map";

CREATE TYPE "membership_role" AS ENUM ('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "asset_status" AS ENUM ('pending_upload', 'processing', 'available', 'failed');--> statement-breakpoint
CREATE TYPE "job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"project_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_memberships_project_id_principal_id_pk" PRIMARY KEY("project_id","principal_id")
);--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"size_bytes" bigint,
	"storage_key" text NOT NULL,
	"status" "asset_status" DEFAULT 'pending_upload' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key")
);--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_memberships_principal_id_idx" ON "project_memberships" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "assets_project_id_idx" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE TABLE "jobs" (
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
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_project_id_created_at_idx" ON "jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_outbox_idx" ON "jobs" USING btree ("status","published_at");

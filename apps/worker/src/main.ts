import {
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assets, connectDatabase, jobs } from "@homespace/database";
import { and, eq, isNull } from "drizzle-orm";
import dotenv from "dotenv";
import PgBoss from "pg-boss";
import { z } from "zod";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? "../../.env" });

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");
const workerConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanFromString.default("false"),
});
const parsed = workerConfigSchema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid worker environment: ${parsed.error.message}`);

const workerConfig = parsed.data;
const { db, pool } = connectDatabase(workerConfig.DATABASE_URL);
const s3Credentials = workerConfig.S3_ACCESS_KEY_ID && workerConfig.S3_SECRET_ACCESS_KEY
  ? { accessKeyId: workerConfig.S3_ACCESS_KEY_ID, secretAccessKey: workerConfig.S3_SECRET_ACCESS_KEY }
  : undefined;
const storage = new S3Client({
  region: workerConfig.S3_REGION,
  endpoint: workerConfig.S3_ENDPOINT,
  forcePathStyle: workerConfig.S3_FORCE_PATH_STYLE,
  credentials: s3Credentials,
});

const uploadQueue = "homespace.asset.verify-upload";
const boss = new PgBoss({ connectionString: workerConfig.DATABASE_URL });
let publishInProgress = false;
let stopping = false;

interface VerifyUploadPayload {
  jobId: string;
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

async function failJob(jobId: string, assetId: string | null, code: string, message: string) {
  await db.transaction(async (tx) => {
    if (assetId) {
      await tx.update(assets).set({ status: "failed", updatedAt: new Date() }).where(eq(assets.id, assetId));
    }
    await tx.update(jobs).set({
      status: "failed",
      progress: 100,
      errorCode: code,
      errorMessage: message,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(jobs.id, jobId));
  });
}

async function processUploadVerification(queueJob: { data: VerifyUploadPayload; retryCount?: number; retryLimit?: number }) {
  const { jobId } = queueJob.data;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || job.status === "completed" || job.status === "failed") return;

  const [asset] = await db.select().from(assets).where(eq(assets.id, job.assetId)).limit(1);
  if (!asset) {
    await failJob(job.id, null, "asset_missing", "The uploaded asset record no longer exists.");
    return;
  }

  const now = new Date();
  await db.update(jobs).set({
    status: "processing",
    startedAt: job.startedAt ?? now,
    updatedAt: now,
  }).where(eq(jobs.id, job.id));

  let storedObject;
  try {
    storedObject = await storage.send(new HeadObjectCommand({ Bucket: workerConfig.S3_BUCKET, Key: asset.storageKey }));
  } catch (error) {
    if (isNotFound(error)) {
      await failJob(job.id, asset.id, "upload_missing", "The uploaded file was not found in storage.");
      return;
    }

    const retryCount = queueJob.retryCount ?? 0;
    const retryLimit = queueJob.retryLimit ?? 0;
    if (retryCount >= retryLimit) {
      await failJob(job.id, asset.id, "storage_unavailable", "The uploaded file could not be verified after retrying.");
      return;
    }
    await db.update(jobs).set({ status: "queued", updatedAt: new Date() }).where(eq(jobs.id, job.id));
    throw error;
  }

  if (storedObject.ContentLength !== asset.expectedSizeBytes || storedObject.ContentType !== asset.contentType) {
    await failJob(job.id, asset.id, "upload_mismatch", "Uploaded content does not match the declared size and type.");
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(assets).set({
      status: "available",
      sizeBytes: storedObject.ContentLength,
      updatedAt: new Date(),
    }).where(eq(assets.id, asset.id));
    await tx.update(jobs).set({
      status: "completed",
      progress: 100,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(jobs.id, job.id));
  });
}

async function publishQueuedJobs() {
  if (publishInProgress || stopping) return;
  publishInProgress = true;
  try {
    const pending = await db.select().from(jobs)
      .where(and(eq(jobs.status, "queued"), isNull(jobs.publishedAt)))
      .limit(50);
    for (const job of pending) {
      try {
        await boss.send(uploadQueue, { jobId: job.id }, {
          singletonKey: job.id,
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
        });
        await db.update(jobs).set({ publishedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(jobs.id, job.id), isNull(jobs.publishedAt)));
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ level: "error", event: "job_publish_failed", jobId: job.id, error: String(error) })}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "outbox_poll_failed", error: String(error) })}\n`);
  } finally {
    publishInProgress = false;
  }
}

async function start() {
  boss.on("error", (error) => {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "pgboss_error", error: String(error) })}\n`);
  });
  await boss.start();
  await boss.work<VerifyUploadPayload>(uploadQueue, async (queueJobs) => {
    const receivedJobs: unknown[] = Array.isArray(queueJobs) ? queueJobs : [queueJobs];
    for (const queueJob of receivedJobs) {
      await processUploadVerification(queueJob as { data: VerifyUploadPayload; retryCount?: number; retryLimit?: number });
    }
  });
  await publishQueuedJobs();
  const publishTimer = setInterval(() => void publishQueuedJobs(), 2000);
  publishTimer.unref();
  process.stdout.write(`${JSON.stringify({ level: "info", event: "worker_started", queue: uploadQueue })}\n`);

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(publishTimer);
    await boss.stop();
    storage.destroy();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

start().catch(async (error) => {
  process.stderr.write(`${JSON.stringify({ level: "fatal", event: "worker_start_failed", error: String(error) })}\n`);
  await boss.stop().catch(() => undefined);
  storage.destroy();
  await pool.end();
  process.exitCode = 1;
});

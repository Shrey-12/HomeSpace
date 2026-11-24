import cors from "@fastify/cors";
import { assets, externalIdentities, jobs, projectMemberships, projects, users, type HomeSpaceDatabase } from "@homespace/database";
import { createProjectSchema, createUploadUrlSchema, paginationQuerySchema } from "@homespace/contracts";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { createAuthenticator, type Principal } from "./auth.js";
import { HttpError } from "./errors.js";
import type { ObjectStorage } from "./storage.js";

interface AppDependencies {
  config: AppConfig;
  db: HomeSpaceDatabase;
  storage: ObjectStorage;
}

function principalFor(request: { principal: Principal | null }) {
  if (!request.principal) throw new HttpError(401, "unauthorized", "Authentication is required.");
  return request.principal;
}

async function requireProjectMembership(
  db: HomeSpaceDatabase,
  projectId: string,
  userId: string,
) {
  const [membership] = await db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
    .limit(1);
  if (!membership) throw new HttpError(404, "not_found", "Project not found.");
  return membership;
}

async function requireProjectEditor(db: HomeSpaceDatabase, projectId: string, userId: string) {
  const membership = await requireProjectMembership(db, projectId, userId);
  if (membership.role === "viewer") {
    throw new HttpError(403, "forbidden", "An editor or owner role is required for this operation.");
  }
  return membership;
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255) || "upload";
}

function parseUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "validation_error", `${label} must be a UUID.`);
  }
  return value;
}

function presentAsset(asset: typeof assets.$inferSelect) {
  return {
    id: asset.id,
    projectId: asset.projectId,
    fileName: asset.fileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    createdAt: asset.createdAt,
  };
}

function presentJob(job: typeof jobs.$inferSelect) {
  return {
    id: job.id,
    projectId: job.projectId,
    assetId: job.assetId,
    type: job.type,
    status: job.status,
    progress: job.progress,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

interface PageCursor {
  createdAt: Date;
  id: string;
}

function decodeCursor(cursor: string | undefined): PageCursor | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") throw new Error("Invalid cursor shape.");
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid cursor timestamp.");
    parseUuid(decoded.id, "cursor id");
    return { createdAt, id: decoded.id };
  } catch {
    throw new HttpError(400, "validation_error", "The pagination cursor is invalid.");
  }
}

function encodeCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

async function resolveInternalUserId(db: HomeSpaceDatabase, issuer: string, subject: string) {
  const [existing] = await db.select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(and(eq(externalIdentities.issuer, issuer), eq(externalIdentities.subject, subject)))
    .limit(1);
  if (existing) return existing.userId;

  return db.transaction(async (tx) => {
    const [candidateUser] = await tx.insert(users).values({}).returning({ id: users.id });
    if (!candidateUser) throw new Error("User insert returned no row.");
    const [identity] = await tx.insert(externalIdentities)
      .values({ userId: candidateUser.id, issuer, subject })
      .onConflictDoNothing({ target: [externalIdentities.issuer, externalIdentities.subject] })
      .returning({ userId: externalIdentities.userId });
    if (identity) return identity.userId;

    const [winner] = await tx.select({ userId: externalIdentities.userId })
      .from(externalIdentities)
      .where(and(eq(externalIdentities.issuer, issuer), eq(externalIdentities.subject, subject)))
      .limit(1);
    await tx.delete(users).where(eq(users.id, candidateUser.id));
    if (!winner) throw new Error("Could not resolve the authenticated external identity.");
    return winner.userId;
  });
}

export function createApp({ config, db, storage }: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: { redact: { paths: ["req.headers.authorization", "req.headers.cookie"], censor: "[REDACTED]" } },
    bodyLimit: 64 * 1024,
  });
  const authenticate = createAuthenticator(config, (issuer, subject) => resolveInternalUserId(db, issuer, subject));

  app.decorateRequest("principal", null);
  app.register(cors, {
    origin: config.webOrigin ?? false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "validation_error", message: "Request validation failed.", details: error.flatten() },
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: { code: error.code ?? "request_error", message: error.message },
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: "internal_error", message: "An unexpected error occurred." } });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: "not_found", message: "Route not found." },
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Querystring: { limit?: string; cursor?: string } }>("/projects", { preHandler: authenticate }, async (request) => {
    const principal = principalFor(request);
    const { limit, cursor: cursorToken } = paginationQuerySchema.parse(request.query);
    const cursor = decodeCursor(cursorToken);
    const rows = await db
      .select({ project: projects, role: projectMemberships.role })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .where(and(
        eq(projectMemberships.userId, principal.userId),
        cursor ? or(lt(projects.createdAt, cursor.createdAt), and(eq(projects.createdAt, cursor.createdAt), lt(projects.id, cursor.id))) : undefined,
      ))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      projects: page.map(({ project, role }) => ({ ...project, role })),
      nextCursor: hasMore && page.length ? encodeCursor({ createdAt: page[page.length - 1]!.project.createdAt, id: page[page.length - 1]!.project.id }) : null,
    };
  });

  app.post("/projects", { preHandler: authenticate }, async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const principal = principalFor(request);
    const project = await db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({ name: input.name, ownerId: principal.userId }).returning();
      if (!created) throw new Error("Project insert returned no row.");
      await tx.insert(projectMemberships).values({
        projectId: created.id,
        userId: principal.userId,
        role: "owner",
      });
      return created;
    });
    return reply.code(201).send({ project });
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId", { preHandler: authenticate }, async (request) => {
    const principal = principalFor(request);
    const projectId = parseUuid(request.params.projectId, "projectId");
    await requireProjectMembership(db, projectId, principal.userId);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new HttpError(404, "not_found", "Project not found.");
    return { project };
  });

  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; cursor?: string } }>("/projects/:projectId/assets", { preHandler: authenticate }, async (request) => {
    const principal = principalFor(request);
    const projectId = parseUuid(request.params.projectId, "projectId");
    await requireProjectMembership(db, projectId, principal.userId);
    const { limit, cursor: cursorToken } = paginationQuerySchema.parse(request.query);
    const cursor = decodeCursor(cursorToken);
    const projectAssets = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.projectId, projectId),
        cursor ? or(lt(assets.createdAt, cursor.createdAt), and(eq(assets.createdAt, cursor.createdAt), lt(assets.id, cursor.id))) : undefined,
      ))
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit + 1);
    const hasMore = projectAssets.length > limit;
    const page = projectAssets.slice(0, limit);
    return {
      assets: page.map(presentAsset),
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!) : null,
    };
  });

  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/assets/upload-url",
    { preHandler: authenticate },
    async (request, reply) => {
      const input = createUploadUrlSchema.parse(request.body);
      if (input.sizeBytes > config.maxUploadBytes) {
        throw new HttpError(413, "upload_too_large", `Uploads are limited to ${config.maxUploadBytes} bytes.`);
      }
      const principal = principalFor(request);
      const projectId = parseUuid(request.params.projectId, "projectId");
      await requireProjectEditor(db, projectId, principal.userId);

      const [asset] = await db.insert(assets).values({
        projectId,
        uploadedBy: principal.userId,
        fileName: input.fileName,
        contentType: input.contentType,
        expectedSizeBytes: input.sizeBytes,
        storageKey: `projects/${projectId}/assets/${randomUUID()}-${safeFileName(input.fileName)}`,
        status: "pending_upload",
      }).returning();
      if (!asset) throw new Error("Asset insert returned no row.");

      try {
        const signed = await storage.createUploadUrl(asset.storageKey, asset.contentType, asset.expectedSizeBytes);
        return reply.code(201).send({
          asset: presentAsset(asset),
          upload: {
            method: "POST",
            url: signed.url,
            expiresInSeconds: config.uploadUrlTtlSeconds,
            fields: signed.fields,
          },
        });
      } catch (error) {
        await db.update(assets).set({ status: "failed", updatedAt: new Date() }).where(eq(assets.id, asset.id));
        throw error;
      }
    },
  );

  app.post<{ Params: { assetId: string } }>("/assets/:assetId/complete", { preHandler: authenticate }, async (request, reply) => {
    const principal = principalFor(request);
    const assetId = parseUuid(request.params.assetId, "assetId");
    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) throw new HttpError(404, "not_found", "Asset not found.");
    await requireProjectEditor(db, asset.projectId, principal.userId);
    if (asset.status === "available") return { asset: presentAsset(asset), job: null };
    if (asset.status === "processing") {
      const [existingJob] = await db.select().from(jobs)
        .where(eq(jobs.assetId, asset.id))
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      return reply.code(202).send({ asset: presentAsset(asset), job: existingJob ? presentJob(existingJob) : null });
    }
    if (asset.status !== "pending_upload") {
      throw new HttpError(409, "upload_not_pending", "This asset is not waiting for an upload.");
    }

    const accepted = await db.transaction(async (tx) => {
      const [processingAsset] = await tx.update(assets)
        .set({ status: "processing", updatedAt: new Date() })
        .where(and(eq(assets.id, asset.id), eq(assets.status, "pending_upload")))
        .returning();
      if (!processingAsset) return null;
      const [job] = await tx.insert(jobs).values({
        projectId: asset.projectId,
        assetId: asset.id,
        type: "asset.verify_upload",
        status: "queued",
      }).returning();
      if (!job) throw new Error("Job insert returned no row.");
      return { asset: processingAsset, job };
    });
    if (!accepted) throw new HttpError(409, "upload_state_changed", "The upload state changed. Refresh and retry.");
    return reply.code(202).send({ asset: presentAsset(accepted.asset), job: presentJob(accepted.job) });
  });

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", { preHandler: authenticate }, async (request) => {
    const principal = principalFor(request);
    const jobId = parseUuid(request.params.jobId, "jobId");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new HttpError(404, "not_found", "Job not found.");
    await requireProjectMembership(db, job.projectId, principal.userId);
    return { job: presentJob(job) };
  });

  app.get<{ Params: { assetId: string } }>("/assets/:assetId/download-url", { preHandler: authenticate }, async (request) => {
    const principal = principalFor(request);
    const assetId = parseUuid(request.params.assetId, "assetId");
    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) throw new HttpError(404, "not_found", "Asset not found.");
    await requireProjectMembership(db, asset.projectId, principal.userId);
    if (asset.status !== "available") throw new HttpError(409, "asset_unavailable", "This asset is not available yet.");
    const url = await storage.createDownloadUrl(asset.storageKey);
    return { url, expiresInSeconds: 300 };
  });

  return app;
}

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";

export interface Principal {
  userId: string;
  issuer: string;
  subject: string;
}

export type UserResolver = (issuer: string, subject: string) => Promise<string>;

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export function createAuthenticator(config: AppConfig, resolveUser: UserResolver) {
  const jwks = createRemoteJWKSet(new URL(config.auth0JwksUrl));

  return async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new HttpError(401, "unauthorized", "A valid bearer token is required.");
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(match[1]!, jwks, {
        issuer: config.auth0IssuerUrl,
        audience: config.auth0Audience,
        algorithms: ["RS256"],
      }));
    } catch (error) {
      throw new HttpError(401, "unauthorized", "The bearer token is invalid or expired.");
    }
    if (!payload.sub) throw new HttpError(401, "unauthorized", "The access token has no subject.");
    if (payload.azp !== config.auth0ClientId) {
      throw new HttpError(401, "unauthorized", "The access token was issued to an unrecognized application.");
    }

    request.principal = {
      userId: await resolveUser(config.auth0IssuerUrl, payload.sub),
      issuer: config.auth0IssuerUrl,
      subject: payload.sub,
    };
  };
}

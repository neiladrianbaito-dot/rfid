// server/lib/request-context.ts
//
// Remembers the Express request that is currently being handled, using
// AsyncLocalStorage. Anything running inside that request (including code
// after several `await`s) can call getCurrentRequest() without the request
// being passed down to it.
//
// Used by audit-logger so EVERY logAudit() call records the client IP, even
// in route files that never pass `req`.

import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

const storage = new AsyncLocalStorage<{ req: Request }>();

/** Express middleware: register once in app.ts, before the routes. */
export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ req }, () => next());
}

/** The request being handled right now, or undefined outside a request. */
export function getCurrentRequest(): Request | undefined {
  return storage.getStore()?.req;
}
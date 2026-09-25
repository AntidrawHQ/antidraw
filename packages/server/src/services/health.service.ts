import { ok, type Result } from "neverthrow";
import type { ApiError } from "../lib/errors";

export type HealthStatus = {
  status: "ok";
  service: "antidraw-server";
};

// Liveness only — deliberately does not touch D1, so it stays a pure
// "is the Worker up" probe. Returns a Result to model the controller ->
// service -> respond() convention every other endpoint will follow.
export const checkHealth = (): Result<HealthStatus, ApiError> =>
  ok({ status: "ok", service: "antidraw-server" });

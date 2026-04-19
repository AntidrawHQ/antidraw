import { globalPreferences, uiPreferences } from "@/main/api/models/preference.model";
import { db } from "@/main/db";
import { and, eq } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const getGlobalPreference = async (key: string) => {
  try {
    const result = await db
      .select({ value: globalPreferences.value })
      .from(globalPreferences)
      .where(eq(globalPreferences.key, key))
      .limit(1);

    return ok(result[0]?.value ?? null);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to get global preference",
    });
  }
};

export const setGlobalPreference = async (key: string, value: string) => {
  try {
    await db
      .insert(globalPreferences)
      .values({ key, value })
      .onConflictDoUpdate({
        target: globalPreferences.key,
        set: { value },
      });

    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to set global preference",
    });
  }
};

export const getPreference = async (key: string, workspaceId: string) => {
  try {
    const result = await db
      .select({ value: uiPreferences.value })
      .from(uiPreferences)
      .where(
        and(
          eq(uiPreferences.workspaceId, workspaceId),
          eq(uiPreferences.key, key),
        ),
      )
      .limit(1);

    return ok(result[0]?.value ?? null);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to get preference",
    });
  }
};

export const setPreference = async (
  key: string,
  value: string,
  workspaceId: string,
) => {
  try {
    await db
      .insert(uiPreferences)
      .values({ workspaceId, key, value })
      .onConflictDoUpdate({
        target: [uiPreferences.workspaceId, uiPreferences.key],
        set: { value },
      });

    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to set preference",
    });
  }
};

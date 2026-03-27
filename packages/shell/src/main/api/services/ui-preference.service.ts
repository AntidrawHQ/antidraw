import { uiPreferences } from "@/main/api/models/ui-preference.model";
import { db } from "@/main/db";
import { and, eq, isNull } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const getPreference = async (
  key: string,
  workspaceId?: string | null,
) => {
  try {
    const result = await db
      .select({ value: uiPreferences.value })
      .from(uiPreferences)
      .where(
        and(
          workspaceId
            ? eq(uiPreferences.workspaceId, workspaceId)
            : isNull(uiPreferences.workspaceId),
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
  workspaceId?: string | null,
) => {
  try {
    await db
      .insert(uiPreferences)
      .values({ workspaceId: workspaceId ?? null, key, value })
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

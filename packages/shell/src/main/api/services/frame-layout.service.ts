import { frameLayouts, type NewFrameLayout } from "@/main/api/models/frame-layout.model";
import { db } from "@/main/db";
import { eq } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const getFrameLayouts = async (workspaceId: string) => {
  try {
    const result = await db
      .select()
      .from(frameLayouts)
      .where(eq(frameLayouts.workspaceId, workspaceId));

    return ok(result);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to get frame layouts",
    });
  }
};

type FrameLayoutInput = Omit<NewFrameLayout, "workspaceId">;

export const saveFrameLayouts = async (
  workspaceId: string,
  layouts: FrameLayoutInput[],
) => {
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(frameLayouts)
        .where(eq(frameLayouts.workspaceId, workspaceId));

      if (layouts.length > 0) {
        await tx
          .insert(frameLayouts)
          .values(layouts.map((l) => ({ workspaceId, ...l })));
      }
    });

    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to save frame layouts",
    });
  }
};

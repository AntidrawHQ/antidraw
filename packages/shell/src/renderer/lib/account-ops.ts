import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account,
  PublishErrorDetails,
  PublishEvent,
  PublishResult,
  SiteStatus,
} from "@/main/api";
import { queryKeys } from "./query-keys";
import {
  cancelSignIn,
  getAccount,
  getPublishStatus,
  publishWorkspace,
  setPublishAllowRemix,
  signIn,
  signOut,
} from "./api";

// Keeps the server's error code (SIGNED_OUT, CANCELLED, …) so callers can
// branch on it; a plain Error would only carry the message. Publish errors
// also carry their details (largest files, build log, …).
export class AccountRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: PublishErrorDetails,
  ) {
    super(message);
  }
}

// The signed-in cloud account, or null when signed out.
export const useAccount = () => {
  return useQuery({
    queryKey: queryKeys.account,
    queryFn: async () => {
      const result = await getAccount();
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    staleTime: Infinity,
  });
};

// Pending for as long as the user is in the browser.
export const useSignIn = () => {
  const queryClient = useQueryClient();

  return useMutation<Account, AccountRequestError>({
    mutationFn: async () => {
      const result = await signIn();
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    onSuccess: (account) => {
      queryClient.setQueryData(queryKeys.account, account);
    },
  });
};

export const useCancelSignIn = () => {
  return useMutation({ mutationFn: cancelSignIn });
};

export const useSignOut = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.account, null);
    },
  });
};

// Runs a publish to its end. `onProgress` sees every event as it arrives
// (steps, build log, upload progress); the mutation settles with the result
// or an AccountRequestError carrying the PublishError's code and details.
export const usePublishWorkspace = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PublishResult,
    AccountRequestError,
    {
      workspaceId: string;
      allowRemix?: boolean;
      onProgress?: (event: PublishEvent) => void;
    }
  >({
    mutationFn: async ({ workspaceId, allowRemix, onProgress }) => {
      try {
        for await (const event of publishWorkspace(workspaceId, { allowRemix })) {
          onProgress?.(event);
          if (event.type === "done") return event.result;
          if (event.type === "error") {
            const { code, message, details } = event.error;
            throw new AccountRequestError(code, message, details);
          }
        }
      } catch (e) {
        if (e instanceof AccountRequestError) throw e;
        throw new AccountRequestError(
          "INTERNAL_ERROR",
          "Lost contact with the publish. Check its status in a moment.",
        );
      }
      throw new AccountRequestError(
        "INTERNAL_ERROR",
        "The publish stopped before it finished.",
      );
    },
    onSuccess: (result, { workspaceId }) => {
      queryClient.setQueryData(queryKeys.publish.status(workspaceId), result.status);
    },
    onError: (error, { workspaceId }) => {
      // The stored token died; main already dropped it.
      if (error.code === "SIGNED_OUT") {
        queryClient.setQueryData(queryKeys.account, null);
        return;
      }
      // A failed publish may still have changed the site (a complete whose
      // answer was lost), so the cached status is not to be trusted.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.publish.status(workspaceId),
      });
    },
  });
};

// The published site for a workspace, or null. Only asked while signed in.
export const usePublishStatus = (workspaceId: string) => {
  const { data: account } = useAccount();

  return useQuery<SiteStatus | null, AccountRequestError>({
    queryKey: queryKeys.publish.status(workspaceId),
    queryFn: async () => {
      const result = await getPublishStatus(workspaceId);
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    enabled: !!account,
  });
};

// Changes the live site's remix setting at once (the server owns it).
export const useSetAllowRemix = () => {
  const queryClient = useQueryClient();

  return useMutation<
    SiteStatus,
    AccountRequestError,
    { workspaceId: string; allowRemix: boolean }
  >({
    mutationFn: async ({ workspaceId, allowRemix }) => {
      const result = await setPublishAllowRemix(workspaceId, allowRemix);
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    onSuccess: (site, { workspaceId }) => {
      queryClient.setQueryData(queryKeys.publish.status(workspaceId), site);
    },
    onError: (error) => {
      if (error.code === "SIGNED_OUT") {
        queryClient.setQueryData(queryKeys.account, null);
      }
    },
  });
};

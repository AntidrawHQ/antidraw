import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, PublishedSite } from "@/main/api";
import { queryKeys } from "./query-keys";
import {
  cancelSignIn,
  getAccount,
  getFeatures,
  getPublishedSites,
  publishWorkspace,
  signIn,
  signOut,
} from "./api";

// Keeps the server's error code (SIGNED_OUT, CANCELLED, …) so callers can
// branch on it; a plain Error would only carry the message.
export class AccountRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
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
    // PublishButton asks again on every click, so a failure isn't retried
    // here in the background, where no one waits for it.
    retry: false,
  });
};

// Which cloud features to show. Hidden until this answers (loading, or an
// error, reads as off). Asked again after a minute, and whenever signing in or
// out, or a publish the server refused, may have changed the answer.
export const useFeatures = () => {
  return useQuery({
    queryKey: queryKeys.features,
    queryFn: async () => {
      const result = await getFeatures();
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    staleTime: 60_000,
    retry: false,
  });
};

// What the account has published, for the dashboard's Published tab. Asked
// each time the tab is shown; what it had stays up meanwhile. An error's code
// says why there's no list: SIGNED_OUT, PUBLISH_DISABLED, or the server's.
export const usePublishedSites = (enabled = true) => {
  const queryClient = useQueryClient();

  return useQuery<PublishedSite[], AccountRequestError>({
    queryKey: queryKeys.published.sites,
    queryFn: async () => {
      const result = await getPublishedSites();
      if (result.isErr()) {
        // The stored token died; main already dropped it.
        if (result.error.code === "SIGNED_OUT") queryClient.setQueryData(queryKeys.account, null);
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    enabled,
    retry: false,
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.features });
      // This account's, not the last one's or a signed-out error.
      void queryClient.resetQueries({ queryKey: queryKeys.published.sites });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.features });
      void queryClient.resetQueries({ queryKey: queryKeys.published.sites });
    },
  });
};

export const usePublishWorkspace = () => {
  const queryClient = useQueryClient();

  return useMutation<{ url: string }, AccountRequestError, string>({
    mutationFn: async (workspaceId) => {
      const result = await publishWorkspace(workspaceId);
      if (result.isErr()) {
        throw new AccountRequestError(result.error.code, result.error.message);
      }
      return result.value;
    },
    // A new version of one of the account's sites, or a new site.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.published.sites }),
    onError: (error) => {
      // The stored token died; main already dropped it.
      if (error.code === "SIGNED_OUT") {
        queryClient.setQueryData(queryKeys.account, null);
      }
      // Turned off for this user, or signed out of the account it was on for.
      if (error.code === "PUBLISH_DISABLED" || error.code === "SIGNED_OUT") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.features });
      }
    },
  });
};

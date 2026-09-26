import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account } from "@/main/api";
import { queryKeys } from "./query-keys";
import {
  cancelSignIn,
  getAccount,
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
    onError: (error) => {
      // The stored token died; main already dropped it.
      if (error.code === "SIGNED_OUT") {
        queryClient.setQueryData(queryKeys.account, null);
      }
    },
  });
};

import { createFileRoute } from "@tanstack/react-router";

const LoginPage = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-400">Login</p>
    </div>
  );
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

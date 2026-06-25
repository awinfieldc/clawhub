/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const denyMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
    useSearch: () => ({ code: "device-code" }),
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cliDeviceAuth: {
      approve: "approve",
      deny: "deny",
    },
  },
}));

vi.mock("../../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isLoading: false,
    me: { _id: "user_123" },
  }),
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/SignInButton", () => ({
  SignInButton: () => null,
}));

vi.mock("../../components/skeletons/ProtectedPageSkeletons", () => ({
  AuthFlowSkeleton: () => null,
}));

vi.mock("../../components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../../components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("../../components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("../../components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

const { CliDeviceAuth } = await import("./device");

describe("CliDeviceAuth", () => {
  it("allows only one device decision while the mutation is pending", async () => {
    let resolveApprove!: () => void;
    approveMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApprove = resolve;
        }),
    );
    denyMock.mockResolvedValue(undefined);
    useMutationMock.mockImplementation((mutation: string) =>
      mutation === "approve" ? approveMock : denyMock,
    );

    render(<CliDeviceAuth />);

    const authorize = screen.getByRole("button", { name: "Authorize" });
    const deny = screen.getByRole("button", { name: "Deny" });
    await act(async () => {
      fireEvent.click(authorize);
      fireEvent.click(authorize);
      fireEvent.click(deny);
    });

    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(denyMock).not.toHaveBeenCalled();
    expect(authorize).toHaveProperty("disabled", true);
    expect(deny).toHaveProperty("disabled", true);

    await act(async () => {
      resolveApprove();
    });

    expect(screen.getByText("Authorized. You can return to your terminal.")).toBeTruthy();
    expect(authorize).toHaveProperty("disabled", true);
    expect(deny).toHaveProperty("disabled", true);
  });
});

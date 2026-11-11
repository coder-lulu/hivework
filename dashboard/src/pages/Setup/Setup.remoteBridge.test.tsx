import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../../api/modules/auth";
import {
  localDesktopBridge,
  remoteServerConnections,
} from "../../test/desktopBridge";
import { wizardApi } from "./wizardClient";
import SetupPage from ".";

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));
vi.mock("../../api/modules/auth", () => ({
  authApi: { getAuthStatus: vi.fn() },
}));
vi.mock("../../i18n", () => ({
  ensureLocaleBundle: () => Promise.resolve(),
}));
vi.mock("./wizardClient", async (original) => {
  const actual = await original<typeof import("./wizardClient")>();
  return {
    ...actual,
    wizardApi: {
      ...actual.wizardApi,
      begin: vi.fn(),
      validateToken: vi.fn(),
    },
  };
});
vi.mock("./steps/PasswordStep", () => ({
  default: ({ onVerified }: { onVerified: () => void }) => (
    <button onClick={onVerified}>Remote password gate</button>
  ),
}));
vi.mock("./steps/DatabaseStep", () => ({
  default: ({ onContinue }: { onContinue: () => void }) => (
    <button onClick={onContinue}>Continue database</button>
  ),
}));
vi.mock("./steps/AdminStep", () => ({
  default: ({
    passwordRequired,
    lockUsername,
  }: {
    passwordRequired: boolean;
    lockUsername: boolean;
  }) => (
    <div
      data-testid="admin-step"
      data-password-required={String(passwordRequired)}
      data-local-username={String(lockUsername)}
    />
  ),
}));
vi.mock("./steps/ModelStep", () => ({ default: () => null }));
vi.mock("./steps/FinishStep", () => ({ default: () => null }));

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={["/setup?localAccount=1"]}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<main>Remote login</main>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("setup with a minimal remote server bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    delete window.octopDesktop;
    window.hiveworkServerConnections = remoteServerConnections();
    vi.mocked(wizardApi.begin).mockResolvedValue({
      wizard_token: "remote-wizard-token",
      expires_in: 300,
    });
    vi.mocked(wizardApi.validateToken).mockResolvedValue({ valid: true });
  });
  afterEach(() => {
    delete window.octopDesktop;
    delete window.hiveworkServerConnections;
  });

  it("ignores localAccount=1 when remote setup has already completed", async () => {
    vi.mocked(authApi.getAuthStatus).mockResolvedValue({
      setup_required: false,
      wizard_password_required: true,
      database_bound: true,
    } as Awaited<ReturnType<typeof authApi.getAuthStatus>>);
    renderSetup();

    expect(await screen.findByText("Remote login")).toBeInTheDocument();
    expect(wizardApi.begin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("admin-step")).not.toBeInTheDocument();
  });

  it("keeps the remote password gate and an unlocked admin username", async () => {
    vi.mocked(authApi.getAuthStatus).mockResolvedValue({
      setup_required: true,
      wizard_password_required: true,
      database_bound: false,
    } as Awaited<ReturnType<typeof authApi.getAuthStatus>>);
    renderSetup();

    expect(
      await screen.findByText(`Remote server - ${window.location.origin}`),
    ).toBeInTheDocument();
    expect(wizardApi.begin).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Remote password gate"));
    fireEvent.click(await screen.findByText("Continue database"));

    const admin = await screen.findByTestId("admin-step");
    expect(admin).toHaveAttribute("data-password-required", "true");
    expect(admin).toHaveAttribute("data-local-username", "false");
  });

  it("retains the local account wizard for the local session bridge", async () => {
    window.octopDesktop = localDesktopBridge();
    vi.mocked(authApi.getAuthStatus).mockResolvedValue({
      setup_required: false,
      wizard_password_required: true,
      database_bound: true,
    } as Awaited<ReturnType<typeof authApi.getAuthStatus>>);
    renderSetup();

    fireEvent.click(await screen.findByText("Continue database"));
    const admin = await screen.findByTestId("admin-step");
    expect(admin).toHaveAttribute("data-password-required", "false");
    expect(admin).toHaveAttribute("data-local-username", "true");
  });
});

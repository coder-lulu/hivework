import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FinishStep from "./FinishStep";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  finish: vi.fn(),
  probeToken: vi.fn(),
  loadSetupJwt: vi.fn(),
  clearAll: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../../api/modules/auth", () => ({
  authApi: { login: mocks.login, me: mocks.me },
  isMfaChallenge: () => false,
}));
vi.mock("../../../api/request", () => ({ setAuthToken: vi.fn() }));
vi.mock("../../../i18n", () => ({ refreshServerLabels: vi.fn() }));
vi.mock("../../../utils/locale", () => ({ applyUserLocale: vi.fn() }));
vi.mock("../wizardClient", () => ({
  wizardApi: { finish: mocks.finish },
  wizardSession: {
    loadSetupJwt: mocks.loadSetupJwt,
    clearAll: mocks.clearAll,
  },
  resolveSetupProbeToken: mocks.probeToken,
}));

describe("setup completion credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probeToken.mockResolvedValue("wizard-token");
    mocks.loadSetupJwt.mockReturnValue("setup-jwt");
    mocks.finish.mockResolvedValue({ ok: true });
    mocks.me.mockResolvedValue({ locale: "zh" });
    mocks.login.mockResolvedValue({
      access_token: "jwt",
      user: { locale: "zh" },
    });
  });

  it("keeps generated credentials visible until acknowledged, including in StrictMode", async () => {
    const creds = {
      username: "local",
      password: null,
      generatedPassword: "GeneratedLocalPass123!",
    };
    const view = render(
      <StrictMode>
        <FinishStep adminCreds={creds} providerDraft={null} />
      </StrictMode>,
    );
    expect(
      await screen.findByText(creds.generatedPassword),
    ).toBeInTheDocument();
    expect(mocks.me).toHaveBeenCalledOnce();
    expect(mocks.login).not.toHaveBeenCalled();
    view.rerender(
      <StrictMode>
        <FinishStep adminCreds={creds} providerDraft={null} />
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mocks.finish).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "wizard.finish.savedAndContinue" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/chat", { replace: true });
  });

  it("retains automatic navigation for existing password-based setup", async () => {
    render(
      <FinishStep
        adminCreds={{ username: "admin", password: "ProvidedPass123!" }}
        providerDraft={null}
      />,
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/chat", { replace: true }),
    );
    expect(mocks.login).toHaveBeenCalledWith("admin", "ProvidedPass123!");
    expect(
      screen.queryByText("wizard.finish.credentialsTitle"),
    ).not.toBeInTheDocument();
  });

  it("still auto-enters with the setup JWT when an older server returns no password", async () => {
    render(
      <FinishStep
        adminCreds={{ username: "local", password: null }}
        providerDraft={null}
      />,
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/chat", { replace: true }),
    );
    expect(mocks.me).toHaveBeenCalledOnce();
  });

  it("keeps the generated password available when automatic login fails", async () => {
    mocks.me.mockRejectedValue(new Error("login unavailable"));
    render(
      <FinishStep
        adminCreds={{
          username: "local",
          password: null,
          generatedPassword: "GeneratedLocalPass123!",
        }}
        providerDraft={null}
      />,
    );
    expect(
      await screen.findByText("wizard.finish.loginFailed"),
    ).toBeInTheDocument();
    expect(screen.getByText("GeneratedLocalPass123!")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "wizard.finish.fallbackToLogin" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("shows provider errors without hiding the generated password", async () => {
    mocks.finish.mockRejectedValue(new Error("provider unavailable"));
    render(
      <FinishStep
        adminCreds={{
          username: "local",
          password: null,
          generatedPassword: "GeneratedLocalPass123!",
        }}
        providerDraft={null}
      />,
    );
    expect(
      await screen.findByText("wizard.finish.savedAndContinue"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("wizard.finish.providerFailed"),
    ).toBeInTheDocument();
    expect(screen.getByText("GeneratedLocalPass123!")).toBeInTheDocument();
  });
});

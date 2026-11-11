import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../../api/modules/auth";
import {
  localDesktopBridge,
  remoteServerConnections,
} from "../../test/desktopBridge";
import { isDesktopShell } from "../../utils/desktopBridge";

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock("../../api/modules/auth", () => ({
  isMfaChallenge: () => false,
  authApi: {
    getAuthStatus: () => Promise.resolve({ setup_required: false }),
    getOauthStatus: () => Promise.resolve({ providers: [] }),
    getCaptcha: () => Promise.resolve({ provider: "none" }),
    getLdapStatus: () => Promise.resolve({ enabled: false, display_name: "" }),
    getPasskeyLoginStatus: () => Promise.resolve({ passwordless_login: false }),
    login: vi.fn().mockResolvedValue({
      access_token: "remote-account-token",
      user: { locale: "en" },
    }),
  },
}));

vi.mock("../../utils/locale", () => ({
  applyGuestLocale: () => Promise.resolve(),
  applyUserLocale: () => Promise.resolve(),
}));

vi.mock("./CaptchaField", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(function CaptchaStub(
      { onReadyChange }: { onReadyChange: (ready: boolean) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ getToken: async () => undefined }));
      useEffect(() => onReadyChange(true), [onReadyChange]);
      return null;
    }),
  };
});

vi.mock("../../i18n", () => ({
  default: { language: "en" },
  refreshServerLabels: vi.fn(),
}));

import LoginPage from "./index";

describe("Login remember-me checkbox", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    delete window.octopDesktop;
    delete window.hiveworkServerConnections;
  });
  afterEach(() => {
    delete window.octopDesktop;
    delete window.hiveworkServerConnections;
  });
  it("renders checked by default", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /login\.remember|记住登录状态|Remember me/,
    });
    expect(checkbox).toBeChecked();
    expect(
      screen.getByPlaceholderText(
        /login\.username|用户名或邮箱|username or email/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /login\.usernameHint|可用安装时设置|set during setup/i,
      ),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "login.submit" }),
      ).toBeDisabled(),
    );
  });

  it("signs into a remote account and keeps server settings without local account actions", async () => {
    const connections = remoteServerConnections();
    window.hiveworkServerConnections = connections;
    expect(isDesktopShell()).toBe(false);
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<main>Remote chat</main>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(`Remote server - ${window.location.origin}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("login-create-local")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "login.serverSettings.manage" }),
    );
    expect(connections.openManager).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByPlaceholderText("login.username"), {
      target: { value: "remote-user" },
    });
    fireEvent.change(screen.getByPlaceholderText("login.password"), {
      target: { value: "remote-password" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "login.submit" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "login.submit" }));

    expect(await screen.findByText("Remote chat")).toBeInTheDocument();
    expect(authApi.login).toHaveBeenCalledWith(
      "remote-user",
      "remote-password",
      undefined,
    );
    expect(localStorage.getItem("auth_token")).toBe("remote-account-token");
    expect(window.octopDesktop).toBeUndefined();
    expect(connections).not.toHaveProperty("session");
    expect(connections).not.toHaveProperty("wsEndpoint");
  });

  it("retains local account actions for a local session bridge", async () => {
    window.octopDesktop = localDesktopBridge();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("login-create-local")).toBeInTheDocument();
  });
});

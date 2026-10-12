import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpdateConfig from "./UpdateConfig";
import { updateApi } from "../../../api/modules/update";
vi.mock("../../../api/modules/update", () => ({
  updateApi: {
    getUpdateStatus: vi.fn(),
    checkForUpdates: vi.fn(),
    triggerUpgrade: vi.fn(),
  },
}));
const requestRestart = vi.hoisted(() => vi.fn());
vi.mock("../../../context/ServiceRestartContext", () => ({
  useServiceRestartContext: () => ({
    restartPhase: "idle",
    isRestarting: false,
    requestRestart,
  }),
}));
describe("HiveWork update channel", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows the own release guide and current version without calling the official updater", async () => {
    vi.mocked(updateApi.getUpdateStatus).mockResolvedValue({
      current_version: "1.2.3",
      service_mode: "systemd",
      has_update: true,
      latest_version: "9.9.9",
    } as Awaited<ReturnType<typeof updateApi.getUpdateStatus>>);
    render(<UpdateConfig />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeInTheDocument());
    expect(screen.getByText("brand.updateDescription")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "brand.updateGuide" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/coder-lulu/hivework/blob/develop/docs/hivework-install.md",
    );
    expect(
      screen.getByRole("link", { name: "brand.releases" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/coder-lulu/hivework/releases",
    );
    expect(screen.queryByText("9.9.9")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "advancedSettings.update.upgradeButton",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "advancedSettings.update.restartServiceBtn",
      }),
    );
    expect(requestRestart).toHaveBeenCalledOnce();
    expect(updateApi.checkForUpdates).not.toHaveBeenCalled();
    expect(updateApi.triggerUpgrade).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("pip install -U octop");
  });
  it("shows a failed status request and retries only status loading", async () => {
    vi.mocked(updateApi.getUpdateStatus)
      .mockRejectedValueOnce(new Error("Status unavailable"))
      .mockResolvedValueOnce({
        current_version: "1.2.4",
        service_mode: "systemd",
        has_update: false,
      } as Awaited<ReturnType<typeof updateApi.getUpdateStatus>>);
    render(<UpdateConfig />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Status unavailable",
    );
    expect(
      screen.queryByRole("button", {
        name: "advancedSettings.update.restartServiceBtn",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(await screen.findByText("1.2.4")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "advancedSettings.update.restartServiceBtn",
      }),
    ).toBeEnabled();
    expect(updateApi.getUpdateStatus).toHaveBeenCalledTimes(2);
    expect(updateApi.checkForUpdates).not.toHaveBeenCalled();
    expect(updateApi.triggerUpgrade).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import AdminStep from "./AdminStep";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  saveSetupJwt: vi.fn(),
}));
vi.mock("../wizardClient", () => ({
  wizardApi: { createAdmin: mocks.createAdmin },
  wizardSession: {
    loadToken: () => "wizard-token",
    saveSetupJwt: mocks.saveSetupJwt,
  },
}));
vi.mock("../../../api/request", () => ({ setAuthToken: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

it("passes the generated password to the completion flow without persisting plaintext", async () => {
  const generatedPassword = ["Generated", "Local", "Pass", "123!"].join("");
  mocks.createAdmin.mockResolvedValue({
    username: "local",
    access_token: "setup-jwt",
    generated_password: generatedPassword,
  });
  const onCreated = vi.fn();
  render(<AdminStep passwordRequired={false} onCreated={onCreated} />);
  fireEvent.click(screen.getByRole("button", { name: "wizard.admin.submit" }));

  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({
      username: "local",
      password: null,
      generatedPassword,
    }),
  );
  expect(mocks.saveSetupJwt).toHaveBeenCalledWith("setup-jwt");
  expect(JSON.stringify(sessionStorage)).not.toContain(generatedPassword);
  expect(JSON.stringify(localStorage)).not.toContain(generatedPassword);
});

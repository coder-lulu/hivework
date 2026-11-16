import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import ForgotPasswordModal from "./ForgotPasswordModal";

it("shows the HiveWork CLI and the actual desktop-install layout on Windows", async () => {
  render(<ForgotPasswordModal open onClose={vi.fn()} />);
  expect(
    await screen.findByText("hivework user passwd <username>"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Windows"));
  expect(
    screen.getByText(
      '& "<install-directory>\\bin\\hivework.cmd" user passwd "<username>"',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      '"<install-directory>\\bin\\hivework.cmd" user passwd "<username>"',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/reopen PowerShell or Command Prompt/),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("USERPROFILE");
});

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../../context/ThemeContext";
import { brandName } from "../../branding";
import BrandLoading from ".";

vi.mock("../../context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({ mode: "light" })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "brand.name" ? brandName("zh") : key),
  }),
}));

describe("branded Electron and browser loading surface", () => {
  beforeEach(() => {
    vi.mocked(useTheme).mockReturnValue({
      mode: "light",
    } as ReturnType<typeof useTheme>);
  });

  it("announces loading with the HiveWork name and light wordmark", () => {
    render(<BrandLoading viewport />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("common.loading");
    expect(screen.getByRole("img", { name: "蜂巢智工" })).toHaveAttribute(
      "src",
      "/logo_horizontal_dark.png",
    );
  });

  it("uses the dark wordmark and a caller's status label", () => {
    vi.mocked(useTheme).mockReturnValue({
      mode: "dark",
    } as ReturnType<typeof useTheme>);
    render(<BrandLoading label="Connecting to server" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Connecting to server",
    );
    expect(screen.getByRole("img", { name: "蜂巢智工" })).toHaveAttribute(
      "src",
      "/logo_horizontal_white.png",
    );
  });
});

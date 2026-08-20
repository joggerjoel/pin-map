import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the Pin Map heading", () => {
    render(<App />);
    expect(screen.getByText("Pin Map")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassReunionApp } from "./ClassReunionApp";
import * as classLoginsRepositoryModule from "../lib/classLoginsRepository";
import * as classUserAccessRepositoryModule from "../lib/classUserAccessRepository";
import type { AccessStatus } from "../lib/classUserAccessRepository";

vi.mock("./ClassMeetupBoard", () => ({
  ClassMeetupBoard: () => <div>meetup board</div>,
}));

vi.mock("./ClassRosterEditor", () => ({
  ClassRosterEditor: () => <div>roster editor</div>,
}));

vi.mock("./ClassAdminPanel", () => ({
  ClassAdminPanel: () => <div>admin panel</div>,
}));

vi.mock("../lib/classLoginsRepository", () => ({
  recordClassLogin: vi.fn(),
}));

vi.mock("../lib/classUserAccessRepository", () => ({
  fetchOwnAccessStatus: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(classLoginsRepositoryModule.recordClassLogin).mockResolvedValue(
    undefined,
  );
  vi.mocked(
    classUserAccessRepositoryModule.fetchOwnAccessStatus,
  ).mockResolvedValue("active");
});

function renderApp(
  overrides: Partial<{
    userEmail: string;
    status: AccessStatus;
  }> = {},
) {
  if (overrides.status !== undefined) {
    vi.mocked(
      classUserAccessRepositoryModule.fetchOwnAccessStatus,
    ).mockResolvedValue(overrides.status);
  }
  return render(
    <ClassReunionApp
      classSlug="belding1989"
      token="pk.test"
      userId="user-1"
      userEmail={overrides.userEmail ?? "jane@example.com"}
    />,
  );
}

describe("ClassReunionApp", () => {
  it("records a login on mount", () => {
    renderApp();

    expect(classLoginsRepositoryModule.recordClassLogin).toHaveBeenCalledWith(
      "belding1989",
      "user-1",
      "jane@example.com",
    );
  });

  it("shows the meetup map by default", async () => {
    renderApp();

    expect(await screen.findByText("meetup board")).toBeInTheDocument();
    expect(screen.queryByText("roster editor")).not.toBeInTheDocument();
  });

  it("switches to the roster editor when its tab is clicked", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(
      await screen.findByRole("button", { name: "Edit Roster" }),
    );

    expect(screen.getByText("roster editor")).toBeInTheDocument();
    expect(screen.queryByText("meetup board")).not.toBeInTheDocument();
  });

  it("prompts for a Mapbox token instead of the meetup board when none is available", async () => {
    render(
      <ClassReunionApp
        classSlug="belding1989"
        token={null}
        userId="user-1"
        userEmail="jane@example.com"
      />,
    );

    expect(
      await screen.findByText("Connect a Mapbox token to use the meetup map."),
    ).toBeInTheDocument();
  });

  it("blocks the whole app for a disabled user", async () => {
    renderApp({ status: "disabled" });

    expect(
      await screen.findByText("Your access to this page has been disabled."),
    ).toBeInTheDocument();
    expect(screen.queryByText("meetup board")).not.toBeInTheDocument();
  });

  it("shows a read-only banner for a read-only user", async () => {
    renderApp({ status: "read_only" });

    expect(
      await screen.findByText(
        "You have read-only access — changes won't be saved.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no Admin tab for a non-admin user", async () => {
    renderApp({ userEmail: "jane@example.com" });

    await screen.findByText("meetup board");
    expect(
      screen.queryByRole("button", { name: "Admin" }),
    ).not.toBeInTheDocument();
  });

  it("shows the Admin tab and panel for the admin email", async () => {
    const user = userEvent.setup();
    renderApp({ userEmail: "joel.labelle@gmail.com" });

    await user.click(await screen.findByRole("button", { name: "Admin" }));

    expect(screen.getByText("admin panel")).toBeInTheDocument();
  });
});

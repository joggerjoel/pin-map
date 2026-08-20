import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClassReunionApp } from "./ClassReunionApp";

vi.mock("./ClassMeetupBoard", () => ({
  ClassMeetupBoard: () => <div>meetup board</div>,
}));

vi.mock("./ClassRosterEditor", () => ({
  ClassRosterEditor: () => <div>roster editor</div>,
}));

describe("ClassReunionApp", () => {
  it("shows the meetup map by default", () => {
    render(
      <ClassReunionApp
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );

    expect(screen.getByText("meetup board")).toBeInTheDocument();
    expect(screen.queryByText("roster editor")).not.toBeInTheDocument();
  });

  it("switches to the roster editor when its tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ClassReunionApp
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Roster" }));

    expect(screen.getByText("roster editor")).toBeInTheDocument();
    expect(screen.queryByText("meetup board")).not.toBeInTheDocument();
  });

  it("prompts for a Mapbox token instead of the meetup board when none is available", () => {
    render(
      <ClassReunionApp
        classSlug="belding1989"
        token={null}
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );

    expect(
      screen.getByText("Connect a Mapbox token to use the meetup map."),
    ).toBeInTheDocument();
  });
});

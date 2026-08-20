import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassMeetupBoard } from "./ClassMeetupBoard";
import * as classRosterRepositoryModule from "../lib/classRosterRepository";
import * as classMeetupsRepositoryModule from "../lib/classMeetupsRepository";
import * as geocoderModule from "../lib/geocoder";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { ClassMeetup } from "../lib/classMeetupsRepository";

vi.mock("../lib/classRosterRepository", () => ({
  fetchRoster: vi.fn(),
}));

vi.mock("../lib/classMeetupsRepository", () => ({
  fetchMeetups: vi.fn(),
  addMeetup: vi.fn(),
}));

vi.mock("../lib/geocoder", () => ({
  geocodeLine: vi.fn(),
}));

vi.mock("./ClassMeetupMapView", () => ({
  ClassMeetupMapView: () => null,
}));

const jane: RosterPerson = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  highSchoolName: "Jane Smith",
  currentName: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  currentLocation: "",
};

const savedMeetup: ClassMeetup = {
  id: "meetup-1",
  submittedByEmail: "joel@example.com",
  metPersonId: 1,
  metPersonName: "Jane Smith Johnson",
  query: "Chicago",
  name: "Chicago, Illinois, USA",
  lat: 41.88,
  lng: -87.63,
  metDate: "06/1995",
};

beforeEach(() => {
  vi.mocked(classRosterRepositoryModule.fetchRoster).mockResolvedValue([jane]);
  vi.mocked(classMeetupsRepositoryModule.fetchMeetups).mockResolvedValue([]);
});

describe("ClassMeetupBoard", () => {
  it("requires a selected person before submitting", async () => {
    const user = userEvent.setup();
    render(
      <ClassMeetupBoard
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );
    await screen.findByRole("button", { name: "Select Jane Smith Johnson" });

    await user.type(screen.getByLabelText("City"), "Chicago");
    await user.click(screen.getByRole("button", { name: "Log meetup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pick who you met first.",
    );
    expect(classMeetupsRepositoryModule.addMeetup).not.toHaveBeenCalled();
  });

  it("requires a city before submitting", async () => {
    const user = userEvent.setup();
    render(
      <ClassMeetupBoard
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.click(screen.getByRole("button", { name: "Log meetup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a city.");
  });

  it("geocodes the city and logs the meetup with the selected person and date", async () => {
    vi.mocked(geocoderModule.geocodeLine).mockResolvedValue({
      query: "Chicago",
      name: "Chicago, Illinois, USA",
      lat: 41.88,
      lng: -87.63,
    });
    vi.mocked(classMeetupsRepositoryModule.addMeetup).mockResolvedValue(
      savedMeetup,
    );
    const user = userEvent.setup();
    render(
      <ClassMeetupBoard
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(screen.getByLabelText("City"), "Chicago");
    await user.type(screen.getByLabelText("Date (MM/YYYY)"), "06/1995");
    await user.click(screen.getByRole("button", { name: "Log meetup" }));

    await waitFor(() => {
      expect(classMeetupsRepositoryModule.addMeetup).toHaveBeenCalledWith(
        "belding1989",
        {
          submittedBy: "user-1",
          submittedByEmail: "joel@example.com",
          metPersonId: 1,
          metPersonName: "Jane Smith Johnson",
          query: "Chicago",
          name: "Chicago, Illinois, USA",
          lat: 41.88,
          lng: -87.63,
          metDate: "06/1995",
        },
      );
    });
    expect(screen.getByLabelText("City")).toHaveValue("");
    expect(screen.getByLabelText("Date (MM/YYYY)")).toHaveValue("");
  });

  it("shows an error when the city can't be geocoded", async () => {
    vi.mocked(geocoderModule.geocodeLine).mockResolvedValue(null);
    const user = userEvent.setup();
    render(
      <ClassMeetupBoard
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );
    await user.type(screen.getByLabelText("City"), "Nowhereville");
    await user.click(screen.getByRole("button", { name: "Log meetup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Couldn\'t find "Nowhereville"',
    );
  });

  it("shows who you're currently logging a meetup for", async () => {
    const user = userEvent.setup();
    render(
      <ClassMeetupBoard
        classSlug="belding1989"
        token="pk.test"
        userId="user-1"
        userEmail="joel@example.com"
      />,
    );

    expect(screen.getByText("Pick who you met above")).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: "Select Jane Smith Johnson" }),
    );

    expect(screen.getByText("Met Jane Smith Johnson")).toBeInTheDocument();
  });
});

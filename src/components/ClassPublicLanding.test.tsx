import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassPublicLanding } from "./ClassPublicLanding";
import * as classPublicRosterRepositoryModule from "../lib/classPublicRosterRepository";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";

vi.mock("../lib/classPublicRosterRepository", () => ({
  fetchPublicRosterLocations: vi.fn(),
}));

const { mapViewProps } = vi.hoisted(() => ({
  mapViewProps: { current: null as unknown },
}));

vi.mock("./ClassPublicMapView", () => ({
  ClassPublicMapView: (props: unknown) => {
    mapViewProps.current = props;
    return <div>public map</div>;
  },
}));

const jane: PublicRosterLocation = {
  id: 1,
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  livingLat: 42.96,
  livingLng: -85.67,
};

beforeEach(() => {
  mapViewProps.current = null;
  vi.mocked(
    classPublicRosterRepositoryModule.fetchPublicRosterLocations,
  ).mockResolvedValue([jane]);
});

describe("ClassPublicLanding", () => {
  it("shows the map with public roster locations and the login form together", async () => {
    render(
      <ClassPublicLanding
        classSlug="belding1989"
        token="pk.test"
        onSendOtp={vi.fn()}
        onVerifyOtp={vi.fn()}
      />,
    );

    expect(await screen.findByText("public map")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      classPublicRosterRepositoryModule.fetchPublicRosterLocations,
    ).toHaveBeenCalledWith("belding1989");
  });

  it("passes the fetched locations through to the map", async () => {
    render(
      <ClassPublicLanding
        classSlug="belding1989"
        token="pk.test"
        onSendOtp={vi.fn()}
        onVerifyOtp={vi.fn()}
      />,
    );

    await screen.findByText("public map");
    expect(
      (mapViewProps.current as { people: PublicRosterLocation[] }).people,
    ).toEqual([jane]);
  });

  it("does not render the map when there is no Mapbox token, but still shows login", () => {
    render(
      <ClassPublicLanding
        classSlug="belding1989"
        token={null}
        onSendOtp={vi.fn()}
        onVerifyOtp={vi.fn()}
      />,
    );

    expect(screen.queryByText("public map")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

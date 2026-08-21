import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassAdminPanel } from "./ClassAdminPanel";
import * as classLoginsRepositoryModule from "../lib/classLoginsRepository";
import * as classUserAccessRepositoryModule from "../lib/classUserAccessRepository";
import type { ClassLogin } from "../lib/classLoginsRepository";
import type { ClassUserAccess } from "../lib/classUserAccessRepository";

vi.mock("../lib/classLoginsRepository", () => ({
  fetchClassLogins: vi.fn(),
}));

vi.mock("../lib/classUserAccessRepository", () => ({
  fetchAllAccessStatuses: vi.fn(),
  setUserAccessStatus: vi.fn(),
}));

const janeLogins: ClassLogin[] = [
  {
    userId: "user-1",
    email: "jane@example.com",
    loggedInAt: "2026-08-19T10:00:00.000Z",
  },
  {
    userId: "user-1",
    email: "jane@example.com",
    loggedInAt: "2026-08-20T15:00:00.000Z",
  },
];

beforeEach(() => {
  vi.mocked(classLoginsRepositoryModule.fetchClassLogins).mockResolvedValue(
    janeLogins,
  );
  vi.mocked(
    classUserAccessRepositoryModule.fetchAllAccessStatuses,
  ).mockResolvedValue([]);
});

describe("ClassAdminPanel", () => {
  it("shows a placeholder when nobody has signed in", async () => {
    vi.mocked(classLoginsRepositoryModule.fetchClassLogins).mockResolvedValue(
      [],
    );
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    expect(
      await screen.findByText("Nobody has signed in yet."),
    ).toBeInTheDocument();
  });

  it("groups logins per person into first/last seen and a login count", async () => {
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    expect(await screen.findByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(
      screen.getByText(new Date(janeLogins[0].loggedInAt).toLocaleString()),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new Date(janeLogins[1].loggedInAt).toLocaleString()),
    ).toBeInTheDocument();
  });

  it("defaults an unlisted person's access to active", async () => {
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    expect(
      await screen.findByLabelText("Access for jane@example.com"),
    ).toHaveValue("active");
  });

  it("reflects a stored access status", async () => {
    const statuses: ClassUserAccess[] = [
      { userId: "user-1", email: "jane@example.com", status: "read_only" },
    ];
    vi.mocked(
      classUserAccessRepositoryModule.fetchAllAccessStatuses,
    ).mockResolvedValue(statuses);
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    expect(
      await screen.findByLabelText("Access for jane@example.com"),
    ).toHaveValue("read_only");
  });

  it("saves a new access status when changed", async () => {
    vi.mocked(
      classUserAccessRepositoryModule.setUserAccessStatus,
    ).mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    const select = await screen.findByLabelText("Access for jane@example.com");
    await user.selectOptions(select, "disabled");

    await waitFor(() => {
      expect(
        classUserAccessRepositoryModule.setUserAccessStatus,
      ).toHaveBeenCalledWith(
        "belding1989",
        "user-1",
        "jane@example.com",
        "disabled",
        "joel.labelle@gmail.com",
      );
    });
    expect(select).toHaveValue("disabled");
  });

  it("shows 'Admin' instead of a status control for the admin's own row", async () => {
    vi.mocked(classLoginsRepositoryModule.fetchClassLogins).mockResolvedValue([
      {
        userId: "admin-1",
        email: "joel.labelle@gmail.com",
        loggedInAt: "2026-08-20T10:00:00.000Z",
      },
    ]);
    render(
      <ClassAdminPanel
        classSlug="belding1989"
        adminEmail="joel.labelle@gmail.com"
      />,
    );

    expect(await screen.findByText("Admin")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Access for joel.labelle@gmail.com"),
    ).not.toBeInTheDocument();
  });
});

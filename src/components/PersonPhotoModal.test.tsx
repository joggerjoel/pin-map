import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PersonPhotoModal } from "./PersonPhotoModal";
import type { RosterPerson } from "../lib/classRosterRepository";
import type { RosterPersonPhoto } from "../lib/classRosterPhotosRepository";

const jane: RosterPerson = {
  id: 1,
  filename: "class1989-001_sheet1_row1_col1.png",
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  highSchoolName: "Jane Smith",
  currentName: "Jane Smith Johnson",
  hometown: "Belding, Michigan",
  living: "",
  currentLocation: "",
};

const photo: RosterPersonPhoto = {
  id: "photo-1",
  personId: 1,
  storagePath: "user-1/class-roster/belding1989/1/a.jpg",
  year: 1995,
  url: "https://cdn.example.com/user-1/class-roster/belding1989/1/a.jpg",
};

describe("PersonPhotoModal", () => {
  it("shows the person's name, main portrait, and any extra photos with their year", () => {
    render(
      <PersonPhotoModal
        person={jane}
        photos={[photo]}
        onAddPhoto={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Photos of Jane Smith Johnson" }),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Jane Smith Johnson")).toHaveAttribute(
      "src",
      jane.imageUrl,
    );
    expect(screen.getByAltText("Jane Smith Johnson, 1995")).toHaveAttribute(
      "src",
      photo.url,
    );
    expect(screen.getByText("1995")).toBeInTheDocument();
  });

  it("calls onAddPhoto with a null year for a recent-photo upload", async () => {
    const onAddPhoto = vi.fn();
    const user = userEvent.setup();
    render(
      <PersonPhotoModal
        person={jane}
        photos={[]}
        onAddPhoto={onAddPhoto}
        onClose={vi.fn()}
      />,
    );

    const file = new File(["fake"], "recent.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add a recent photo"), file);

    expect(onAddPhoto).toHaveBeenCalledWith(file, null);
  });

  it("calls onAddPhoto with the entered year for a dated-photo upload", async () => {
    const onAddPhoto = vi.fn();
    const user = userEvent.setup();
    render(
      <PersonPhotoModal
        person={jane}
        photos={[]}
        onAddPhoto={onAddPhoto}
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Year"), "1995");
    const file = new File(["fake"], "old.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add a dated photo"), file);

    expect(onAddPhoto).toHaveBeenCalledWith(file, 1995);
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PersonPhotoModal
        person={jane}
        photos={[]}
        onAddPhoto={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked, but not when the modal content is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PersonPhotoModal
        person={jane}
        photos={[]}
        onAddPhoto={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText("Jane Smith Johnson"));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PersonPhotoModal
        person={jane}
        photos={[]}
        onAddPhoto={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportsPanel } from "./ImportsPanel";
import * as useImportCandidatesModule from "../hooks/useImportCandidates";
import type { UseImportCandidatesResult } from "../hooks/useImportCandidates";
import type { ImportCandidate } from "../lib/importCandidatesRepository";

vi.mock("../hooks/useImportCandidates", () => ({
  useImportCandidates: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const candidate: ImportCandidate = {
  id: "c1",
  externalKey: "key1",
  placeName: "Singapore, Singapore",
  suggestedLat: 1.35,
  suggestedLng: 103.82,
  geocodeConfidence: "high",
  visitTime: "2011-03-28T08:22:52.000Z",
  note: null,
  status: "pending",
};

function baseResult(
  overrides: Partial<UseImportCandidatesResult> = {},
): UseImportCandidatesResult {
  return {
    candidates: [],
    isLoadingCandidates: false,
    uploadState: "idle",
    uploadProgress: null,
    uploadStatusMessage: null,
    uploadError: null,
    startUpload: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    defer: vi.fn(),
    updateCandidate: vi.fn(),
    refresh: vi.fn(),
    order: "newest",
    setOrder: vi.fn(),
    progress: { total: 0, reviewed: 0 },
    split: vi.fn(),
    merge: vi.fn(),
    bulkApproveHighConfidence: vi.fn(),
    geocodeRemaining: vi.fn(),
    isGeocodingRemaining: false,
    ...overrides,
  };
}

describe("ImportsPanel", () => {
  it("shows an empty-state message with no candidates", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult(),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/No candidates to review yet/)).toBeInTheDocument();
  });

  it("renders one card per candidate", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ candidates: [candidate] }),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByDisplayValue("Singapore, Singapore"),
    ).toBeInTheDocument();
  });

  it("calls onClose when 'Back to map' is clicked", async () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult(),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Back to map/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls startUpload with the selected file", async () => {
    const startUpload = vi.fn();
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ startUpload }),
    );
    const user = userEvent.setup();
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    const file = new File(["zip"], "export.zip", {
      type: "application/zip",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    expect(startUpload).toHaveBeenCalledWith(file);
  });

  it("shows the upload status message and progress bar while uploading", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({
        uploadState: "uploading",
        uploadProgress: 0.5,
        uploadStatusMessage: "Uploading export.zip…",
      }),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Uploading export.zip…")).toBeInTheDocument();
    const progress = document.querySelector("progress") as HTMLProgressElement;
    expect(progress.value).toBe(0.5);
  });

  it("disables the file input while busy", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ uploadState: "parsing" }),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it("shows an error banner when uploadError is set", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ uploadError: "upload failed" }),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("upload failed");
  });

  it("shows the reviewed/total progress count once there are candidates", () => {
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({
        candidates: [candidate],
        progress: { total: 157, reviewed: 54 },
      }),
    );
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("54 of 157 reviewed")).toBeInTheDocument();
  });

  it("defaults to the List (grid) view, and Swipe switches to the swipe queue", async () => {
    const needsReview: ImportCandidate = {
      ...candidate,
      id: "c2",
      placeName: "Busselton, Western Australia",
      geocodeConfidence: "low",
    };
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ candidates: [needsReview] }),
    );
    const user = userEvent.setup();
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Grid view shows the editable name input.
    expect(screen.getByLabelText("Place name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Swipe" }));

    expect(screen.getByRole("button", { name: "Swipe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Swipe view has no editable name field, just the read-only card.
    expect(screen.queryByLabelText("Place name")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /Review Busselton/ }),
    ).toBeInTheDocument();
  });

  it("passes the order picker's selection through to setOrder", async () => {
    const setOrder = vi.fn();
    vi.mocked(useImportCandidatesModule.useImportCandidates).mockReturnValue(
      baseResult({ candidates: [candidate], setOrder }),
    );
    const user = userEvent.setup();
    render(
      <ImportsPanel
        mapboxToken="pk.test"
        userId="user-1"
        accessToken="token"
        onClose={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox"), "oldest");

    expect(setOrder).toHaveBeenCalledWith("oldest");
  });
});

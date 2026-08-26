import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MassActionToolbar } from "./MassActionToolbar";
import type { MassActionToolbarProps } from "./MassActionToolbar";

function baseProps(
  overrides: Partial<MassActionToolbarProps> = {},
): MassActionToolbarProps {
  return {
    selectedRows: [],
    onClearSelection: vi.fn(),
    totalMatchingCount: null,
    onSelectAllRequest: vi.fn(),
    isSelectingAll: false,
    groups: [],
    showRemoveFromGroup: false,
    onAddToGroup: vi.fn(),
    onCreateGroupAndAdd: vi.fn(),
    onRemoveFromGroup: vi.fn(),
    pinnedPlaces: [],
    canCreatePin: true,
    onCreatePin: vi.fn(),
    onMassAssign: vi.fn(),
    onMassSkip: vi.fn(),
    onMassUnskip: vi.fn(),
    onMassUnassign: vi.fn(),
    isRunning: false,
    summary: null,
    failedCount: 0,
    onRetryFailed: vi.fn(),
    onDismissSummary: vi.fn(),
    ...overrides,
  };
}

describe("MassActionToolbar", () => {
  it("shows Assign/Skip for an all-unassigned selection", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [
            { id: "1", placeQuery: null, skippedAt: null },
            { id: "2", placeQuery: null, skippedAt: null },
          ],
        })}
      />,
    );
    expect(screen.getByText("Assign")).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
    expect(screen.queryByText("Unskip")).not.toBeInTheDocument();
    expect(screen.queryByText("Unassign")).not.toBeInTheDocument();
  });

  it("shows no triage-status action at all for a mixed-status selection", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [
            { id: "1", placeQuery: null, skippedAt: null },
            { id: "2", placeQuery: "Paris", skippedAt: null },
          ],
        })}
      />,
    );
    expect(screen.queryByText("Assign")).not.toBeInTheDocument();
    expect(screen.queryByText("Skip")).not.toBeInTheDocument();
    expect(screen.queryByText("Unskip")).not.toBeInTheDocument();
    expect(screen.queryByText("Unassign")).not.toBeInTheDocument();
  });

  it("shows Unskip only for an all-skipped selection", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [
            { id: "1", placeQuery: null, skippedAt: "2026-01-01T00:00:00Z" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Unskip")).toBeInTheDocument();
    expect(screen.queryByText("Assign")).not.toBeInTheDocument();
  });

  it("shows Unassign only for an all-assigned selection", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [{ id: "1", placeQuery: "Paris", skippedAt: null }],
        })}
      />,
    );
    expect(screen.getByText("Unassign")).toBeInTheDocument();
  });

  it("calls onSelectAllRequest when the badge count exceeds the current selection", () => {
    const onSelectAllRequest = vi.fn();
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [{ id: "1", placeQuery: null, skippedAt: null }],
          totalMatchingCount: 40,
          onSelectAllRequest,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Select all 40"));
    expect(onSelectAllRequest).toHaveBeenCalled();
  });

  it("does not show 'Select all' when the badge count equals the current selection", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [{ id: "1", placeQuery: null, skippedAt: null }],
          totalMatchingCount: 1,
        })}
      />,
    );
    expect(screen.queryByText(/Select all/)).not.toBeInTheDocument();
  });

  it("Remove from group only shows when showRemoveFromGroup is true", () => {
    const { rerender } = render(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [{ id: "1", placeQuery: null, skippedAt: null }],
          showRemoveFromGroup: false,
        })}
      />,
    );
    expect(screen.queryByText("Remove from group")).not.toBeInTheDocument();

    rerender(
      <MassActionToolbar
        {...baseProps({
          selectedRows: [{ id: "1", placeQuery: null, skippedAt: null }],
          showRemoveFromGroup: true,
        })}
      />,
    );
    expect(screen.getByText("Remove from group")).toBeInTheDocument();
  });

  it("Retry N failed only appears for a looped summary with error > 0, not for conflict-only", () => {
    const { rerender } = render(
      <MassActionToolbar
        {...baseProps({
          summary: { kind: "looped", ok: 5, conflict: 2, error: 0 },
          failedCount: 0,
        })}
      />,
    );
    expect(screen.queryByText(/Retry/)).not.toBeInTheDocument();

    rerender(
      <MassActionToolbar
        {...baseProps({
          summary: { kind: "looped", ok: 5, conflict: 2, error: 3 },
          failedCount: 3,
        })}
      />,
    );
    expect(screen.getByText("Retry 3 failed")).toBeInTheDocument();
  });

  it("a bulk-add summary shows the added count with no retry option", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          summary: { kind: "bulk-add", added: 4 },
        })}
      />,
    );
    expect(screen.getByText("4 added")).toBeInTheDocument();
    expect(screen.queryByText(/Retry/)).not.toBeInTheDocument();
  });

  it("a group-not-found summary shows the 'no longer exists' notice", () => {
    render(
      <MassActionToolbar
        {...baseProps({
          summary: { kind: "group-not-found" },
        })}
      />,
    );
    expect(
      screen.getByText("This group no longer exists."),
    ).toBeInTheDocument();
  });
});

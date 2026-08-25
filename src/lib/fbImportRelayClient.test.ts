import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimUpload,
  geocodeCandidates,
  parseExport,
  QuotaExceededError,
  uploadExportFile,
} from "./fbImportRelayClient";

const mockUploadInstances: Array<{
  options: Record<string, unknown>;
  url: string | null;
  start: ReturnType<typeof vi.fn>;
  findPreviousUploads: ReturnType<typeof vi.fn>;
  resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("tus-js-client", () => ({
  Upload: vi
    .fn()
    .mockImplementation((_file: File, options: Record<string, unknown>) => {
      const instance = {
        options,
        url: null as string | null,
        start: vi.fn(),
        findPreviousUploads: vi.fn().mockResolvedValue([]),
        resumeFromPreviousUpload: vi.fn(),
      };
      mockUploadInstances.push(instance);
      return instance;
    }),
}));

afterEach(() => {
  vi.clearAllMocks();
  mockUploadInstances.length = 0;
  vi.unstubAllGlobals();
});

describe("uploadExportFile", () => {
  it("resolves with the tus upload ID parsed from the upload URL on success", async () => {
    const file = new File(["zip bytes"], "export.zip");
    const promise = uploadExportFile(file, "token-123", vi.fn());

    // Let findPreviousUploads' resolved promise flush.
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    instance.url = "http://upload.test/files/abc123";
    const onSuccess = instance.options.onSuccess as () => void;
    onSuccess();

    await expect(promise).resolves.toBe("abc123");
    expect(instance.start).toHaveBeenCalled();
  });

  it("passes the access token as a Bearer Authorization header", async () => {
    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    expect(instance.options.headers).toEqual({
      Authorization: "Bearer token-123",
    });
  });

  it("reports progress via the callback", async () => {
    const onProgress = vi.fn();
    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", onProgress);
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    const handler = instance.options.onProgress as (
      uploaded: number,
      total: number,
    ) => void;
    handler(512, 1024);

    expect(onProgress).toHaveBeenCalledWith({
      bytesUploaded: 512,
      bytesTotal: 1024,
    });
  });

  it("rejects when tus-js-client reports an error", async () => {
    const file = new File(["zip bytes"], "export.zip");
    const promise = uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    const onError = instance.options.onError as (err: Error) => void;
    onError(new Error("network dropped"));

    await expect(promise).rejects.toThrow("network dropped");
  });

  it("resumes from a previous upload when one is found", async () => {
    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    instance.findPreviousUploads.mockResolvedValue([{ uploadUrl: "prior" }]);
  });

  it("claims the upload via onAfterResponse as soon as tusd assigns the id, before any bytes are sent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    const onAfterResponse = instance.options.onAfterResponse as (
      req: { getMethod(): string },
      res: { getHeader(name: string): string | undefined },
    ) => Promise<void>;

    await onAfterResponse(
      { getMethod: () => "POST" },
      {
        getHeader: (name) =>
          name === "Location"
            ? "http://upload.test/files/new-id-789"
            : undefined,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/claim-upload");
    expect(JSON.parse(init.body)).toEqual({ tusUploadId: "new-id-789" });
  });

  it("only claims once even if onAfterResponse fires again for a later PATCH", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    const onAfterResponse = instance.options.onAfterResponse as (
      req: { getMethod(): string },
      res: { getHeader(name: string): string | undefined },
    ) => Promise<void>;

    await onAfterResponse(
      { getMethod: () => "POST" },
      { getHeader: () => "http://upload.test/files/new-id-789" },
    );
    await onAfterResponse(
      { getMethod: () => "PATCH" },
      { getHeader: () => undefined },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a claim rejection out of onAfterResponse (aborts the upload via tus-js-client's own error path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "already_claimed" }), {
          status: 403,
        }),
      ),
    );

    const file = new File(["zip bytes"], "export.zip");
    void uploadExportFile(file, "token-123", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    const instance = mockUploadInstances[0];
    const onAfterResponse = instance.options.onAfterResponse as (
      req: { getMethod(): string },
      res: { getHeader(name: string): string | undefined },
    ) => Promise<void>;

    await expect(
      onAfterResponse(
        { getMethod: () => "POST" },
        { getHeader: () => "http://upload.test/files/hijacked-id" },
      ),
    ).rejects.toThrow("already_claimed");
  });
});

describe("claimUpload", () => {
  it("posts tusUploadId with the bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await claimUpload("upload-1", "token-123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/claim-upload");
    expect(init.headers.Authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body)).toEqual({ tusUploadId: "upload-1" });
  });

  it("throws with the error code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "not_found" }), { status: 400 }),
        ),
    );

    await expect(claimUpload("upload-1", "token-123")).rejects.toThrow(
      "not_found",
    );
  });
});

describe("parseExport / geocodeCandidates", () => {
  it("parseExport posts tusUploadId and returns candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ externalKey: "k1" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseExport("upload-1", "token-123");

    expect(result).toEqual([{ externalKey: "k1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/parse");
    expect(init.headers.Authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body)).toEqual({ tusUploadId: "upload-1" });
  });

  it("parseExport throws with the response body on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })),
    );

    await expect(parseExport("upload-1", "bad-token")).rejects.toThrow(
      "/parse failed (403)",
    );
  });

  it("geocodeCandidates returns {results:{},truncated:false} without calling fetch for an empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeCandidates([], "token-123");

    expect(result).toEqual({ results: {}, truncated: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("geocodeCandidates posts inputs and returns the batch result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: { k1: { lat: 1, lng: 2, confidence: "high" } },
          truncated: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeCandidates(
      [{ externalKey: "k1", placeName: "Somewhere" }],
      "token-123",
    );

    expect(result.results.k1).toEqual({ lat: 1, lng: 2, confidence: "high" });
  });

  it("geocodeCandidates throws QuotaExceededError on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("quota exceeded", { status: 429 })),
    );

    await expect(
      geocodeCandidates(
        [{ externalKey: "k1", placeName: "Somewhere" }],
        "token-123",
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

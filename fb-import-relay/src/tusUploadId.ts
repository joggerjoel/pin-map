// tusd's filestore generates upload IDs as 32 lowercase hex characters --
// confirmed live against the real deployment (aorus4:/data, e.g.
// "6978e95d42c08815618d3bd8a9688e19"), not just tusd's documented default.
// Used to reject a malformed/crafted tusUploadId before it's ever
// interpolated into a filesystem path.

const TUS_UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;

export function isValidTusUploadId(id: string): boolean {
  return TUS_UPLOAD_ID_PATTERN.test(id);
}

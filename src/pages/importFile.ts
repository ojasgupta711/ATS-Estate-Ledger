// Hands a file picked on the dashboard over to the import wizard page.
let pending: File | null = null;

export function setPendingFile(f: File) {
  pending = f;
}

export function takePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}

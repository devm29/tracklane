export async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function must<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`Expected ${what} to be defined`);
  return value;
}

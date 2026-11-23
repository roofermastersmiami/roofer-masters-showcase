/** Catch transport failures at the caller, outside the server function boundary. */
export async function optionalContent<T>(load: () => Promise<T>, defaults: T): Promise<T> {
  try {
    return await load();
  } catch {
    return defaults;
  }
}

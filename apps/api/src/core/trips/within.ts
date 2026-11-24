// What a promise gives within a time budget, or undefined when it takes longer or fails: for the parts of a Trip
// that are suggestions on top of it (a detour, a drive to near B), which must never hold the Trip up for long.
export function within<T>(ms: number, promise: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}

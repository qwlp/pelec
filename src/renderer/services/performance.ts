const toMeasureName = (name: string): string => `pelec:${name}`;

export const beginMeasure = (name: string): (() => number) => {
  const startMark = `${toMeasureName(name)}:start:${Date.now()}:${Math.random()}`;
  const endMark = `${toMeasureName(name)}:end:${Date.now()}:${Math.random()}`;
  performance.mark(startMark);

  return () => {
    performance.mark(endMark);
    performance.measure(toMeasureName(name), startMark, endMark);
    const entries = performance.getEntriesByName(toMeasureName(name), 'measure');
    const duration = entries[entries.length - 1]?.duration ?? 0;
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    return duration;
  };
};

export const measureSync = <T>(name: string, run: () => T): { duration: number; result: T } => {
  const end = beginMeasure(name);
  const result = run();
  return {
    duration: end(),
    result,
  };
};

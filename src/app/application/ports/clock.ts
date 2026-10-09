// Driven port for the current time, so rules that depend on "today" stay deterministic.
export interface Clock {
  now(): Date;
}

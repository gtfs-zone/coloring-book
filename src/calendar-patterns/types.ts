export interface HolidayPattern {
  id: string;
  name: string;
  region: string;
  /** Returns YYYYMMDD strings for observed holidays in the given year */
  getDates(year: number): string[];
}

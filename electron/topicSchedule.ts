// NSDA topic release schedule — hardcoded known drop dates at 9:00am CT (15:00 UTC)

const PF_RELEASE_DATES = [
  // 2025-2026 season
  '2025-08-01', '2025-10-01', '2025-12-01',
  '2026-01-01', '2026-02-01', '2026-03-01', '2026-05-01',
  // 2026-2027 season
  '2026-08-01', '2026-10-01', '2026-12-01',
  '2027-01-01', '2027-02-01', '2027-03-01', '2027-05-01',
];

const LD_RELEASE_DATES = [
  // 2025-2026 season
  '2025-08-01', '2025-10-01', '2025-12-01', '2026-02-01', '2026-05-01',
  // 2026-2027 season
  '2026-08-01', '2026-10-01', '2026-12-01', '2027-02-01', '2027-05-01',
];

export function shouldCheckToday(): { checkPF: boolean; checkLD: boolean } {
  const today = new Date().toISOString().split('T')[0];
  return {
    checkPF: PF_RELEASE_DATES.includes(today),
    checkLD: LD_RELEASE_DATES.includes(today),
  };
}

export function getNextReleaseDates(): { pf: string | null; ld: string | null } {
  const today = new Date().toISOString().split('T')[0];
  return {
    pf: PF_RELEASE_DATES.find((d) => d > today) ?? null,
    ld: LD_RELEASE_DATES.find((d) => d > today) ?? null,
  };
}

// Returns how many minutes to wait before the next NSDA fetch, given the soonest upcoming release.
// Returns null when no check is warranted.
export function getCheckFrequencyMinutes(nextReleaseIso: string | null): number | null {
  if (!nextReleaseIso) return null;

  const now = new Date();
  // CT is UTC-6 (CST) or UTC-5 (CDT) — use UTC-6 as conservative baseline = 15:00 UTC
  const releaseDate = new Date(`${nextReleaseIso}T15:00:00.000Z`);
  const minutesUntil = (releaseDate.getTime() - now.getTime()) / 60000;

  if (minutesUntil > 24 * 60) return null;   // more than 24 hours away — don't poll
  if (minutesUntil > 60) return 30;           // within 24 hours — check every 30 min
  if (minutesUntil > 0) return 5;             // within 1 hour — check every 5 min
  if (minutesUntil > -30) return 2;           // past release, within 30 min — check every 2 min
  return null;                                 // more than 30 min after release — stop
}

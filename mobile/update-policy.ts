export const checkInterval = 15 * 60 * 1000;

export function checkDue(now: number, lastCheck: number) {
  return !Number.isFinite(lastCheck) || now < lastCheck || now - lastCheck >= checkInterval;
}

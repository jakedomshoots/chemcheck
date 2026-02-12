const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_WORKING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function normalizeWorkingDays(days) {
  if (!Array.isArray(days)) {
    return [];
  }

  const validDays = days
    .map((day) => (typeof day === "string" ? day.trim() : ""))
    .filter((day) => DAY_ORDER.includes(day));

  return [...new Set(validDays)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function getWorkingDaysFromSettings(settings) {
  if (!settings || typeof settings !== "object") {
    return [];
  }

  return normalizeWorkingDays(settings.working_days || settings.workingDays);
}

function getLocalBusinessSettings() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem("chemcheck_current_business");
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed?.settings || null;
  } catch {
    return null;
  }
}

export function getEffectiveWorkingDays(convexBusiness) {
  const convexDays = getWorkingDaysFromSettings(convexBusiness?.settings);
  if (convexDays.length > 0) {
    return convexDays;
  }

  const localDays = getWorkingDaysFromSettings(getLocalBusinessSettings());
  if (localDays.length > 0) {
    return localDays;
  }

  return DEFAULT_WORKING_DAYS;
}

export { DAY_ORDER, DEFAULT_WORKING_DAYS };

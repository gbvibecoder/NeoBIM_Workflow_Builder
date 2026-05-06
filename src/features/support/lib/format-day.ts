export function formatDayDivider(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, today)) {
    return `${date.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} · Today`;
  }
  if (isSameDay(date, yesterday)) {
    return `${date.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} · Yesterday`;
  }
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

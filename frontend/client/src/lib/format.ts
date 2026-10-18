export const aspectLabel = (aspect: string) => {
  const s = aspect.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const formatDate = (
  iso: string | undefined,
  opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
) => (iso ? new Date(iso).toLocaleDateString(undefined, opts) : "—");

export const formatScore = (score: number) =>
  score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);

export const sourceLabel: Record<string, string> = {
  google_maps: "Google Maps",
  sample: "Sample",
  import: "Imported",
};

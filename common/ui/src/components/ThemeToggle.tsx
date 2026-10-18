import { useTheme, type ThemePreference } from "../theme/ThemeProvider.tsx";

const order: ThemePreference[] = ["system", "light", "dark"];
const labels: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const next = order[(order.indexOf(preference) + 1) % order.length]!;
  return (
    <button
      className="ui-button ui-button--ghost ui-button--sm"
      onClick={() => setPreference(next)}
      aria-label={`Theme: ${labels[preference]}. Switch to ${labels[next]}`}
    >
      {labels[preference]}
    </button>
  );
}

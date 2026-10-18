import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

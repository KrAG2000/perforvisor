import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={["ui-input", "ui-textarea", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

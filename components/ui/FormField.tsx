"use client";

import FieldHelp from "@/components/help/FieldHelp";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  /** Hindi field tip — shown only when Learning Mode is ON */
  helpText?: string;
  className?: string;
  children: React.ReactNode;
}

export default function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  helpText,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-center gap-1">
          <Label
            htmlFor={htmlFor}
            className="text-sm font-medium text-foreground"
          >
            {label}

            {required && (
              <span className="text-destructive">*</span>
            )}
          </Label>
          {helpText ? <FieldHelp text={helpText} label={label} /> : null}
        </div>
      )}

      {children}

      {error ? (
        <p className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

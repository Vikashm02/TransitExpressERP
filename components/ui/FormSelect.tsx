"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FormField from "@/components/ui/FormField";
import { cn } from "@/lib/utils";

export interface FormSelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface FormSelectProps {
  label?: string;
  id?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  triggerClassName?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: FormSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export default function FormSelect({
  label,
  id,
  required,
  error,
  hint,
  className,
  triggerClassName,
  value,
  onValueChange,
  options,
  placeholder = "Select an option",
  disabled,
}: FormSelectProps) {
  return (
    <FormField
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      className={className}
    >
      <Select
        value={value === "" ? undefined : value}
        onValueChange={(next) => onValueChange((next as string) ?? "")}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={cn("w-full", triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

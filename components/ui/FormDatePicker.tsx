"use client";

import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import FormField from "@/components/ui/FormField";

interface FormDatePickerProps {
  label?: string;
  id?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  /** ISO date string, e.g. "2026-08-07" — same format used by native <input type="date"> */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  displayFormat?: string;
}

export default function FormDatePicker({
  label,
  id,
  required,
  error,
  hint,
  className,
  value,
  onChange,
  placeholder = "Select date",
  disabled,
  displayFormat = "dd MMM yyyy",
}: FormDatePickerProps) {
  const [open, setOpen] = useState(false);

  const parsedDate = value ? parseISO(value) : undefined;
  const selectedDate = parsedDate && isValid(parsedDate) ? parsedDate : undefined;

  return (
    <FormField
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      className={className}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          id={id}
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-8 w-full justify-start gap-2 font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            />
          }
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />

          {selectedDate ? (
            format(selectedDate, displayFormat)
          ) : (
            <span>{placeholder}</span>
          )}
        </PopoverTrigger>

        <PopoverContent
          className="w-auto p-0"
          align="start"
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) {
                onChange(format(date, "yyyy-MM-dd"));
                setOpen(false);
              }
            }}
            disabled={disabled}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </FormField>
  );
}

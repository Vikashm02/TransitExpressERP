interface FormLabelProps {
  children: React.ReactNode;
  required?: boolean;
}

export default function FormLabel({ children, required }: FormLabelProps) {
  return (
    <label className="mb-2 block text-sm font-medium text-foreground">
      {children}
      {required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

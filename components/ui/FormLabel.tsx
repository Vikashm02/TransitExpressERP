interface FormLabelProps {
  children: React.ReactNode;
  required?: boolean;
}

export default function FormLabel({
  children,
  required,
}: FormLabelProps) {
  return (
    <label className="block mb-2 text-sm font-semibold text-slate-700">

      {children}

      {required && (
        <span className="text-red-500 ml-1">
          *
        </span>
      )}

    </label>
  );
}
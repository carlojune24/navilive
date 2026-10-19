import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="light"
    position="bottom-right"
    toastOptions={{
      classNames: {
        toast: "!rounded-none !border-2 !border-ink !bg-sheet !text-ink !shadow-none !font-sans !text-[15px]",
      },
    }}
    {...props}
  />
);

export { Toaster };

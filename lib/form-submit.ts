import { startTransition, type FormEvent } from "react";

/**
 * onSubmit handler that runs a useActionState action without React's automatic
 * form reset, so a validation error doesn't wipe what the user typed.
 */
export function submitWithoutReset(action: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
}

/** A text field from a form submission; a file upload or a missing field becomes "". */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

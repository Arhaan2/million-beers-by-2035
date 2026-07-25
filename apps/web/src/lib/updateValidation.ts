export function validateUpdate(amount: number, correction: boolean, note: string): string | null {
  if (!Number.isInteger(amount) || amount < 1 || amount > 250)
    return 'Choose a whole amount from 1 to 250.';
  if (correction && note.trim().length < 4)
    return 'Corrections require a reason of at least 4 characters.';
  if (note.trim().length > 140) return 'Keep the note to 140 characters or fewer.';
  return null;
}

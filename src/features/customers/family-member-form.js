export function normalizeFamilyMemberIdentity(values={}) {
  const customerId=values.customerId || undefined;
  const guestName=customerId ? undefined : String(values.guestName || '').trim() || undefined;
  return {customerId,guestName};
}

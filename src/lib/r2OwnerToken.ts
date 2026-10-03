const STORAGE_KEY = 'baimiao_r2_owner_token';

/** Tab-local credential: never embedded in a build or copied into settings exports. */
export function getR2OwnerToken(): string {
  return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem(STORAGE_KEY) || '';
}

export function setR2OwnerToken(token: string): void {
  if (token.trim()) sessionStorage.setItem(STORAGE_KEY, token.trim());
  else sessionStorage.removeItem(STORAGE_KEY);
}

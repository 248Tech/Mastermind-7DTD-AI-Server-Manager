'use client';

export function saveAuth(token: string, userId: string, orgId: string) {
  localStorage.setItem('mm_token', token);
  localStorage.setItem('mm_user_id', userId);
  localStorage.setItem('mm_org_id', orgId);
}

export function clearAuth() {
  localStorage.removeItem('mm_token');
  localStorage.removeItem('mm_user_id');
  localStorage.removeItem('mm_org_id');
}

export function getStoredOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mm_org_id');
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mm_token');
}

export function isLoggedIn(): boolean {
  return !!getStoredToken();
}

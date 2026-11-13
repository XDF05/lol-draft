'use client';

import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';

/**
 * Access to the global auth state (user, status, login, logout).
 * Must be used inside <AuthProvider> (mounted in the root layout).
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}

export default useAuth;

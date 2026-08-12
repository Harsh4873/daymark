import { describe, expect, it } from 'vitest';
import { syncAccountProblem } from './sync-account';

const verifiedGoogle = {
  email: 'owner@example.test',
  emailVerified: true,
  signInProvider: 'google.com',
};

describe('Daymark sync account eligibility', () => {
  it('accepts only the exact verified Google token required by the rules', () => {
    expect(syncAccountProblem(verifiedGoogle)).toBeNull();
    expect(syncAccountProblem({ ...verifiedGoogle, signInProvider: 'password' }))
      .toBe('unverified-provider');
  });

  it('fails closed when the token provider cannot be inspected', () => {
    expect(syncAccountProblem({ ...verifiedGoogle, signInProvider: undefined }))
      .toBe('unverified-provider');
    expect(syncAccountProblem({ ...verifiedGoogle, signInProvider: null }))
      .toBe('unverified-provider');
  });

  it('rejects missing and unverified email claims', () => {
    expect(syncAccountProblem({ ...verifiedGoogle, email: null })).toBe('missing-email');
    expect(syncAccountProblem({ ...verifiedGoogle, emailVerified: false })).toBe('unverified-email');
  });
});

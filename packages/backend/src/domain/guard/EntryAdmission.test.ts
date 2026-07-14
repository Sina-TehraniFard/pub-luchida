import { describe, it, expect } from 'vitest';
import { EntryAdmission } from './EntryAdmission.js';
import { AuthAttemptOutcome } from './AuthAttemptOutcome.js';

describe('EntryAdmission', () => {
  it('permitted() は抑止しない・理由ラベルは空', () => {
    const a = EntryAdmission.permitted();
    expect(a.isBlocked()).toBe(false);
    expect(a.reasonLabel()).toBe('');
  });

  it('blocked(reason) は抑止し、理由ラベルを運ぶ', () => {
    const a = EntryAdmission.blocked('連続認証失敗');
    expect(a.isBlocked()).toBe(true);
    expect(a.reasonLabel()).toBe('連続認証失敗');
  });
});

describe('AuthAttemptOutcome', () => {
  it('succeeded() は失敗ではない', () => {
    expect(AuthAttemptOutcome.succeeded().isFailure()).toBe(false);
  });

  it('failed() は失敗', () => {
    expect(AuthAttemptOutcome.failed().isFailure()).toBe(true);
  });
});

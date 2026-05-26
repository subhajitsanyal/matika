import {
  resolveRecipient,
  isDisambiguationOf,
  buildAmbiguousDirective,
} from '../src/care_notes_recorder';
import type { CareTeamMember } from '../src/context/types';

function caregiver(userId: string, name: string): CareTeamMember {
  return { userId, name, relationship: 'caregiver' };
}

describe('resolveRecipient (Spec §6.10 #3)', () => {
  const johnCG = caregiver('u-johncg', 'John CG');
  const johnSmith = caregiver('u-johnsmith', 'John Smith');
  const priya = caregiver('u-priya', 'Priya Sharma');

  describe('no name spoken', () => {
    it('defaults to the primary (first) caregiver', () => {
      const out = resolveRecipient(null, [priya, johnCG]);
      expect(out.status).toBe('resolved_default');
      expect(out.recipientUserId).toBe('u-priya');
      expect(out.candidateUserIds).toEqual([]);
      expect(out.mentionedName).toBeNull();
    });

    it('treats empty string the same as null', () => {
      const out = resolveRecipient('   ', [priya]);
      expect(out.status).toBe('resolved_default');
      expect(out.recipientUserId).toBe('u-priya');
    });

    it('no_match when there is no care team at all', () => {
      const out = resolveRecipient(null, []);
      expect(out.status).toBe('no_match');
      expect(out.recipientUserId).toBeNull();
    });
  });

  describe('exact name resolution', () => {
    it('exact match → resolved', () => {
      const out = resolveRecipient('Priya Sharma', [priya, johnCG]);
      expect(out.status).toBe('resolved');
      expect(out.recipientUserId).toBe('u-priya');
      expect(out.mentionedName).toBe('Priya Sharma');
    });

    it('case-insensitive match', () => {
      const out = resolveRecipient('PRIYA SHARMA', [priya]);
      expect(out.status).toBe('resolved');
      expect(out.recipientUserId).toBe('u-priya');
    });

    it('first-token match resolves when single first-token candidate', () => {
      const out = resolveRecipient('Priya', [priya, johnCG]);
      expect(out.status).toBe('resolved');
      expect(out.recipientUserId).toBe('u-priya');
    });
  });

  describe('ambiguous resolution', () => {
    it('two same-first-name caregivers → ambiguous with both candidates', () => {
      const out = resolveRecipient('John', [johnCG, johnSmith, priya]);
      expect(out.status).toBe('ambiguous');
      expect(out.recipientUserId).toBeNull();
      expect(out.candidateUserIds).toEqual(['u-johncg', 'u-johnsmith']);
      // Raw spoken referent preserved so the disambig directive can quote it
      expect(out.mentionedName).toBe('John');
    });
  });

  describe('generic caregiver word', () => {
    it('"caregiver" → resolved_default against first caregiver', () => {
      const out = resolveRecipient('caregiver', [johnCG, priya]);
      expect(out.status).toBe('resolved_default');
      expect(out.recipientUserId).toBe('u-johncg');
      expect(out.mentionedName).toBeNull();
    });

    it('"my caregiver" → resolved_default', () => {
      const out = resolveRecipient('my caregiver', [priya]);
      expect(out.status).toBe('resolved_default');
      expect(out.recipientUserId).toBe('u-priya');
    });

    it('still no_match when care team is empty even for the generic word', () => {
      const out = resolveRecipient('caregiver', []);
      expect(out.status).toBe('no_match');
    });
  });

  describe('no_match', () => {
    it('name not in care team → no_match with raw referent preserved', () => {
      const out = resolveRecipient('Padma', [priya, johnCG]);
      expect(out.status).toBe('no_match');
      expect(out.recipientUserId).toBeNull();
      expect(out.candidateUserIds).toEqual([]);
      expect(out.mentionedName).toBe('Padma');
    });
  });
});

describe('isDisambiguationOf (sentinel-update §6.10 #4c)', () => {
  it('true when the just-resolved user was a prior ambiguous candidate', () => {
    const decision = isDisambiguationOf(
      {
        status: 'resolved',
        recipientUserId: 'u-johncg',
        candidateUserIds: [],
        mentionedName: 'John CG',
      },
      { id: 'note-prev', mentionedName: 'John', candidateUserIds: ['u-johncg', 'u-johnsmith'] },
    );
    expect(decision).toBe(true);
  });

  it('false when the newly-resolved user was NOT in the prior candidate list', () => {
    const decision = isDisambiguationOf(
      {
        status: 'resolved',
        recipientUserId: 'u-priya',
        candidateUserIds: [],
        mentionedName: 'Priya',
      },
      { id: 'note-prev', mentionedName: 'John', candidateUserIds: ['u-johncg', 'u-johnsmith'] },
    );
    expect(decision).toBe(false);
  });

  it('false for non-resolved statuses (no clobbering)', () => {
    const decision = isDisambiguationOf(
      {
        status: 'no_match',
        recipientUserId: null,
        candidateUserIds: [],
        mentionedName: 'Padma',
      },
      { id: 'note-prev', mentionedName: 'John', candidateUserIds: ['u-johncg'] },
    );
    expect(decision).toBe(false);
  });
});

describe('buildAmbiguousDirective', () => {
  it('quotes the spoken name and the candidate names into a single sentence', () => {
    const directive = buildAmbiguousDirective('John', ['John CG', 'John Smith']);
    expect(directive).toContain('"John"');
    expect(directive).toContain('John CG, John Smith');
    expect(directive).toMatch(/politely ask the patient which one/);
  });

  it('handles null spoken name with a placeholder', () => {
    const directive = buildAmbiguousDirective(null, ['John CG']);
    expect(directive).toContain('(no name spoken)');
  });
});

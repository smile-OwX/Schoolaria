import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAuthIdentifierForDisplay,
  formatPhoneDisplayFromAuthEmail,
  isPhoneAuthEmail,
  isUserAccountVerified,
  normalizePhoneDigits,
  phoneToAuthEmail,
  resolveIdentifierToAuthEmail,
} from './phoneAuth.ts';
import { formatFirebaseAuthErrorDetails } from './authErrors.ts';
import { filterChildrenForParent } from './parentHelpers.ts';
import type { Student } from '../types/school.ts';

test('normalizePhoneDigits normalizes Togo local, +228, and 00228 formats', () => {
  assert.equal(normalizePhoneDigits('90 12 34 56', '228'), '22890123456');
  assert.equal(normalizePhoneDigits('+228 90-12-34-56', '228'), '22890123456');
  assert.equal(normalizePhoneDigits('0022890123456', '228'), '22890123456');
  assert.equal(normalizePhoneDigits('+33 6 12 34 56 78', '228'), '33612345678');
  assert.equal(normalizePhoneDigits('06 12 34 56 78', '33'), '33612345678');
  assert.equal(normalizePhoneDigits('12345', '228'), '');
  assert.equal(normalizePhoneDigits('abc90123456', '228'), '');
});

test('phoneToAuthEmail and display formatting round-trip cleanly', () => {
  const internal = phoneToAuthEmail('90 12 34 56', '228');
  assert.equal(internal, 'tel.22890123456@tel.schoolaria.app');
  assert.equal(isPhoneAuthEmail(internal), true);
  assert.equal(isPhoneAuthEmail('parent@yahoo.fr'), false);
  assert.equal(formatPhoneDisplayFromAuthEmail(internal), '+228 90 12 34 56');
  assert.equal(formatAuthIdentifierForDisplay(internal), '+228 90 12 34 56');
  assert.equal(formatAuthIdentifierForDisplay('prof@gmail.com'), 'prof@gmail.com');
});

test('resolveIdentifierToAuthEmail supports both phone numbers and legacy emails', () => {
  const byPhone = resolveIdentifierToAuthEmail('91 44 55 66', '228');
  assert.equal(byPhone.isPhone, true);
  assert.equal(byPhone.authEmail, 'tel.22891445566@tel.schoolaria.app');
  assert.equal(byPhone.displayLabel, '+228 91 44 55 66');

  const byEmail = resolveIdentifierToAuthEmail('  Parent@Yahoo.fr ', '228');
  assert.equal(byEmail.isPhone, false);
  assert.equal(byEmail.authEmail, 'parent@yahoo.fr');
  assert.equal(byEmail.displayLabel, 'parent@yahoo.fr');
});

test('isUserAccountVerified treats phone accounts as verified without email confirmation link', () => {
  assert.equal(
    isUserAccountVerified({
      email: 'tel.22890123456@tel.schoolaria.app',
      emailVerified: false,
    }),
    true
  );
  assert.equal(
    isUserAccountVerified({
      email: 'director@gmail.com',
      emailVerified: true,
    }),
    true
  );
  assert.equal(
    isUserAccountVerified({
      email: 'unverified@yahoo.fr',
      emailVerified: false,
    }),
    false
  );
  assert.equal(isUserAccountVerified(null), false);
});

test('formatFirebaseAuthErrorDetails returns phone-specific guidance in phone context', () => {
  const dupPhone = formatFirebaseAuthErrorDetails('auth/email-already-in-use', '', '', 'phone');
  assert.match(dupPhone, /numéro de téléphone/i);

  const badCred = formatFirebaseAuthErrorDetails('auth/invalid-credential', '', '', 'phone');
  assert.match(badCred, /numéro de téléphone/i);
});

test('filterChildrenForParent matches children linked by phone number', () => {
  const students: Student[] = [
    {
      id: 'stu1',
      ownerId: 'u1',
      schoolId: 's1',
      matricule: 'M1',
      nom: 'MENSAH',
      prenoms: 'Kossi',
      sexe: 'M',
      age: 13,
      cycle: 'Collège',
      classe: '6ème A',
      parentEmail: '90 12 34 56',
      status: 'actif',
    },
  ];
  const matched = filterChildrenForParent({
    students,
    parentEmail: 'tel.22890123456@tel.schoolaria.app',
    isPreview: false,
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'stu1');
});

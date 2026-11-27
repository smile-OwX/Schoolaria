import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessTab,
  canBatchPrintBulletinsForRole,
  canChangeSchoolThemeForRole,
  canEditBulletinsForRole,
  canEditGradesForRole,
  canManageClassesForRole,
  canManageCenseurForRole,
  canManageLeadershipForRole,
  canManageSecretaireForRole,
  canManageStudentsForRole,
  canManageSubjectsForRole,
  canManageTargetMembershipRole,
  canManageTeamForRole,
  canManageTitulaireForRole,
  canManageYearLifecycleForRole,
  canNotifyParentsForRole,
  canSendMessageToRole,
  canSendNotificationToRole,
  filterContactsForSender,
  getAllowedMessageRecipientRoles,
  getAllowedNotificationModes,
  getAllowedNotificationRecipientRoles,
  getAllowedTabsForRole,
  getAssignableRolesForRole,
  type NavTabId,
  type RoleId,
} from './rolePermissions.ts';
import {
  DEFAULT_SCHOOL_THEME,
  SCHOOL_THEMES,
  VALID_SCHOOL_THEME_IDS,
  getSchoolThemeDefinition,
  normalizeSchoolTheme,
} from './schoolTheme.ts';

const ALL_ROLES: RoleId[] = ['admin', 'censeur', 'secretaire', 'teacher', 'parent'];

test('Directeur (admin) manages classes while staying isolated from Censeur grades and Secretaire enrollments', () => {
  const adminTabs = getAllowedTabsForRole('admin');
  assert.deepEqual(adminTabs, [
    'hub',
    'makelist',
    'roles',
    'stats',
    'archives',
    'audit',
    'messages',
    'notifications',
    'settings',
  ]);
  const forbiddenForAdmin: NavTabId[] = [
    'inscription',
    'classdetail',
    'bulletins',
    'assistant',
  ];
  for (const tab of forbiddenForAdmin) {
    assert.equal(canAccessTab('admin', tab), false, `admin must not access ${tab}`);
  }
  assert.equal(canManageLeadershipForRole('admin'), true);
  assert.equal(canManageYearLifecycleForRole('admin'), true);
  assert.equal(canChangeSchoolThemeForRole('admin'), true);
  assert.equal(canEditGradesForRole('admin'), false);
  assert.equal(canEditBulletinsForRole('admin'), false);
  assert.equal(canManageStudentsForRole('admin'), false);
  assert.equal(canManageClassesForRole('admin'), true);
  assert.equal(canManageSubjectsForRole('admin'), false);
});

test('Censeur has no access to Secretaire enrollment panel or Directeur governance', () => {
  assert.equal(canAccessTab('censeur', 'inscription'), false);
  assert.equal(canAccessTab('censeur', 'archives'), false);
  assert.equal(canAccessTab('censeur', 'audit'), false);
  assert.equal(canAccessTab('censeur', 'settings'), false);

  assert.equal(canAccessTab('censeur', 'makelist'), true);
  assert.equal(canAccessTab('censeur', 'classdetail'), true);
  assert.equal(canAccessTab('censeur', 'bulletins'), true);
  assert.equal(canAccessTab('censeur', 'assistant'), true);

  assert.equal(canManageStudentsForRole('censeur'), false);
  assert.equal(canManageClassesForRole('censeur'), true);
  assert.equal(canEditGradesForRole('censeur'), true);
  assert.equal(canManageSubjectsForRole('censeur'), true);
  assert.equal(canEditBulletinsForRole('censeur'), true);
  assert.equal(canManageTitulaireForRole('censeur'), true);
  assert.equal(canBatchPrintBulletinsForRole('censeur'), true);
  assert.equal(canManageLeadershipForRole('censeur'), false);
  assert.equal(canChangeSchoolThemeForRole('censeur'), false);
});

test('Secretaire owns inscriptions and class creation without grade editing or admin governance', () => {
  assert.equal(canAccessTab('secretaire', 'inscription'), true);
  assert.equal(canAccessTab('secretaire', 'makelist'), true);
  assert.equal(canAccessTab('secretaire', 'classdetail'), true);
  assert.equal(canAccessTab('secretaire', 'bulletins'), true);
  assert.equal(canAccessTab('secretaire', 'roles'), false);
  assert.equal(canAccessTab('secretaire', 'assistant'), false);
  assert.equal(canAccessTab('secretaire', 'audit'), false);
  assert.equal(canAccessTab('secretaire', 'settings'), false);

  assert.equal(canManageStudentsForRole('secretaire'), true);
  assert.equal(canManageClassesForRole('secretaire'), true);
  assert.equal(canEditGradesForRole('secretaire'), false);
  assert.equal(canEditBulletinsForRole('secretaire'), false);
  assert.equal(canBatchPrintBulletinsForRole('secretaire'), true);
});

test('Teacher and Parent remain strictly isolated to their dedicated panels', () => {
  assert.deepEqual(getAllowedTabsForRole('teacher'), [
    'hub',
    'makelist',
    'classdetail',
    'bulletins',
    'assistant',
    'messages',
    'notifications',
  ]);
  assert.deepEqual(getAllowedTabsForRole('parent'), [
    'hub',
    'bulletins',
    'messages',
    'notifications',
  ]);
  assert.equal(canEditGradesForRole('teacher'), true);
  assert.equal(canEditGradesForRole('parent'), false);
  assert.equal(canManageStudentsForRole('teacher'), false);
  assert.equal(canManageStudentsForRole('parent'), false);
});

test('Strict 5x5 notification & messaging recipient matrix is enforced', () => {
  // Directeur & Censeur can contact everyone
  for (const adminRole of ['admin', 'censeur'] as const) {
    assert.equal(canNotifyParentsForRole(adminRole), true);
    for (const target of ALL_ROLES) {
      assert.equal(canSendMessageToRole(adminRole, target), true);
      assert.equal(canSendNotificationToRole(adminRole, target), true);
    }
    const modes = getAllowedNotificationModes(adminRole).map((m) => m.id);
    assert.deepEqual(modes, ['all', 'staff_no_parents', 'class', 'student']);
  }

  // Professeur -> ONLY Censeur & Directeur (NEVER parents or secretaire)
  assert.equal(canNotifyParentsForRole('teacher'), false);
  assert.deepEqual(getAllowedMessageRecipientRoles('teacher'), ['admin', 'censeur']);
  assert.deepEqual(getAllowedNotificationRecipientRoles('teacher'), ['admin', 'censeur']);
  assert.equal(canSendMessageToRole('teacher', 'parent'), false);
  assert.equal(canSendNotificationToRole('teacher', 'parent'), false);
  assert.equal(canSendMessageToRole('teacher', 'secretaire'), false);
  assert.equal(canSendMessageToRole('teacher', 'censeur'), true);
  assert.equal(canSendMessageToRole('teacher', 'admin'), true);
  assert.deepEqual(
    getAllowedNotificationModes('teacher').map((m) => m.id),
    ['director_censeur']
  );

  // Secretaire -> ONLY Directeur, Censeur, Professeurs (NEVER parents)
  assert.equal(canNotifyParentsForRole('secretaire'), false);
  assert.deepEqual(getAllowedMessageRecipientRoles('secretaire'), ['admin', 'censeur', 'teacher']);
  assert.deepEqual(getAllowedNotificationRecipientRoles('secretaire'), ['admin', 'censeur', 'teacher']);
  assert.equal(canSendMessageToRole('secretaire', 'parent'), false);
  assert.equal(canSendNotificationToRole('secretaire', 'parent'), false);
  assert.equal(canSendMessageToRole('secretaire', 'teacher'), true);
  assert.deepEqual(
    getAllowedNotificationModes('secretaire').map((m) => m.id),
    ['staff_no_parents']
  );

  // Parent -> ONLY Censeur
  assert.equal(canNotifyParentsForRole('parent'), false);
  assert.deepEqual(getAllowedMessageRecipientRoles('parent'), ['censeur']);
  assert.deepEqual(getAllowedNotificationRecipientRoles('parent'), ['censeur']);
  assert.equal(canSendMessageToRole('parent', 'censeur'), true);
  assert.equal(canSendNotificationToRole('parent', 'censeur'), true);
  assert.equal(canSendMessageToRole('parent', 'admin'), false);
  assert.equal(canSendMessageToRole('parent', 'teacher'), false);
  assert.equal(canSendMessageToRole('parent', 'secretaire'), false);
  assert.equal(canSendMessageToRole('parent', 'parent'), false);
  assert.deepEqual(
    getAllowedNotificationModes('parent').map((m) => m.id),
    ['censeur']
  );
});

test('filterContactsForSender filters out disallowed contacts accurately', () => {
  const sampleContacts: Array<{ id: string; role: RoleId }> = [
    { id: 'dir', role: 'admin' },
    { id: 'cen', role: 'censeur' },
    { id: 'sec', role: 'secretaire' },
    { id: 'prof', role: 'teacher' },
    { id: 'par', role: 'parent' },
  ];

  assert.deepEqual(
    filterContactsForSender('parent', sampleContacts).map((c) => c.id),
    ['cen']
  );
  assert.deepEqual(
    filterContactsForSender('teacher', sampleContacts).map((c) => c.id),
    ['dir', 'cen']
  );
  assert.deepEqual(
    filterContactsForSender('secretaire', sampleContacts).map((c) => c.id),
    ['dir', 'cen', 'prof']
  );
  assert.deepEqual(
    filterContactsForSender('censeur', sampleContacts).map((c) => c.id),
    ['dir', 'cen', 'sec', 'prof', 'par']
  );
});

test('School uniform themes expose all 8 colors with violet default and normalize aliases cleanly', () => {
  assert.equal(DEFAULT_SCHOOL_THEME, 'violet');
  assert.deepEqual(VALID_SCHOOL_THEME_IDS, [
    'violet',
    'bleu',
    'blanc',
    'rouge',
    'verte',
    'orange',
    'marron',
    'gris',
  ]);
  assert.equal(SCHOOL_THEMES.length, 8);
  assert.equal(getSchoolThemeDefinition('violet').headerIsLight, false);
  assert.equal(getSchoolThemeDefinition('blanc').headerIsLight, true);
  assert.equal(getSchoolThemeDefinition('bleu').headerIsLight, false);
  assert.equal(getSchoolThemeDefinition('gris').headerIsLight, false);

  assert.equal(normalizeSchoolTheme('purple'), 'violet');
  assert.equal(normalizeSchoolTheme('violets'), 'violet');
  assert.equal(normalizeSchoolTheme('vert'), 'verte');
  assert.equal(normalizeSchoolTheme('marrow'), 'marron');
  assert.equal(normalizeSchoolTheme('KAKI'), 'marron');
  assert.equal(normalizeSchoolTheme('gray'), 'gris');
  assert.equal(normalizeSchoolTheme('GREY'), 'gris');
  assert.equal(normalizeSchoolTheme('grise'), 'gris');
  assert.equal(normalizeSchoolTheme('  ROUGE '), 'rouge');
  assert.equal(normalizeSchoolTheme('inconnu'), DEFAULT_SCHOOL_THEME);
  assert.equal(normalizeSchoolTheme(null), DEFAULT_SCHOOL_THEME);
});

test('Only Proviseur (admin) role can access school settings and lifecycle actions', () => {
  for (const nonOwnerRole of ['censeur', 'secretaire', 'teacher', 'parent'] as const) {
    assert.equal(canAccessTab(nonOwnerRole, 'settings'), false);
    assert.equal(canManageYearLifecycleForRole(nonOwnerRole), false);
    assert.equal(canChangeSchoolThemeForRole(nonOwnerRole), false);
  }
  assert.equal(canAccessTab('admin', 'settings'), true);
  assert.equal(canManageYearLifecycleForRole('admin'), true);
  assert.equal(canChangeSchoolThemeForRole('admin'), true);
});

test('Role hierarchy delegation: Directeur -> Censeur -> Secretaire, Profs & Parents', () => {
  assert.equal(canManageCenseurForRole('admin'), true);
  assert.equal(canManageSecretaireForRole('admin'), true);
  assert.equal(canManageTeamForRole('admin'), true);
  assert.deepEqual(getAssignableRolesForRole('admin'), ['censeur', 'secretaire', 'teacher', 'parent']);

  assert.equal(canManageCenseurForRole('censeur'), false);
  assert.equal(canManageSecretaireForRole('censeur'), true);
  assert.equal(canManageTeamForRole('censeur'), true);
  assert.deepEqual(getAssignableRolesForRole('censeur'), ['secretaire', 'teacher', 'parent']);
  assert.equal(canManageTargetMembershipRole('censeur', 'censeur'), false);
  assert.equal(canManageTargetMembershipRole('censeur', 'secretaire'), true);
  assert.equal(canManageTargetMembershipRole('censeur', 'teacher'), true);
  assert.equal(canManageTargetMembershipRole('censeur', 'parent'), true);

  for (const r of ['secretaire', 'teacher', 'parent'] as const) {
    assert.equal(canManageCenseurForRole(r), false);
    assert.equal(canManageSecretaireForRole(r), false);
    assert.equal(canManageTeamForRole(r), false);
    assert.deepEqual(getAssignableRolesForRole(r), []);
  }
});

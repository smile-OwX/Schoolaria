export type RoleId = 'admin' | 'censeur' | 'secretaire' | 'teacher' | 'parent';

export type NavTabId =
  | 'hub'
  | 'inscription'
  | 'makelist'
  | 'classdetail'
  | 'bulletins'
  | 'stats'
  | 'roles'
  | 'archives'
  | 'audit'
  | 'assistant'
  | 'messages'
  | 'notifications'
  | 'settings';

export type NotificationTargetMode =
  | 'all'
  | 'class'
  | 'student'
  | 'staff_no_parents'
  | 'director_censeur'
  | 'censeur';

export interface NotificationModeOption {
  id: NotificationTargetMode;
  label: string;
  description: string;
}

const ROLE_ALLOWED_TABS: Record<RoleId, readonly NavTabId[]> = {
  // Directeur : gouvernance, nominations, gestion des classes (création/suppression), stats, archives, sécurité, Yasmine IA, réglages & communication
  admin: ['hub', 'makelist', 'roles', 'stats', 'archives', 'audit', 'assistant', 'messages', 'notifications', 'settings'],
  // Censeur : pédagogie, classes/notes, bulletins, stats, profs/parents, Yasmine IA, communication (pas d'accès au panel Secrétaire)
  censeur: ['hub', 'makelist', 'classdetail', 'bulletins', 'stats', 'roles', 'assistant', 'messages', 'notifications'],
  // Secrétaire : inscriptions élèves, listes de classes, impression PDF bulletins, archives, stats, Yasmine IA, communication staff
  secretaire: ['hub', 'inscription', 'makelist', 'classdetail', 'bulletins', 'archives', 'stats', 'assistant', 'messages', 'notifications'],
  // Professeur : classes assignées, saisie notes, appréciations bulletins, communication vers Censeur/Directeur (sans accès IA)
  teacher: ['hub', 'makelist', 'classdetail', 'bulletins', 'messages', 'notifications'],
  // Parent : tableau de bord enfants, bulletins lecture seule, messages & notifications vers Censeur (sans accès IA)
  parent: ['hub', 'bulletins', 'messages', 'notifications'],
};

const MESSAGE_RECIPIENT_MATRIX: Record<RoleId, readonly RoleId[]> = {
  admin: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
  censeur: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
  secretaire: ['admin', 'censeur', 'teacher'],
  teacher: ['admin', 'censeur'],
  parent: ['censeur'],
};

const NOTIFICATION_RECIPIENT_MATRIX: Record<RoleId, readonly RoleId[]> = {
  admin: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
  censeur: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
  secretaire: ['admin', 'censeur', 'teacher'],
  teacher: ['admin', 'censeur'],
  parent: ['censeur'],
};

export function getAllowedTabsForRole(role: RoleId): readonly NavTabId[] {
  return ROLE_ALLOWED_TABS[role] ?? ROLE_ALLOWED_TABS.parent;
}

export function canAccessTab(role: RoleId, tab: NavTabId): boolean {
  return getAllowedTabsForRole(role).includes(tab);
}

export function canEditGradesForRole(role: RoleId): boolean {
  return role === 'censeur' || role === 'teacher';
}

export function canManageSubjectsForRole(role: RoleId): boolean {
  return role === 'censeur';
}

export function canManageStudentsForRole(role: RoleId): boolean {
  return role === 'secretaire';
}

export function canManageClassesForRole(role: RoleId): boolean {
  return role === 'admin' || role === 'censeur' || role === 'secretaire';
}

export function canManageTitulaireForRole(role: RoleId): boolean {
  return role === 'censeur' || role === 'secretaire';
}

export function canEditBulletinsForRole(role: RoleId): boolean {
  return role === 'censeur' || role === 'teacher';
}

export function canBatchPrintBulletinsForRole(role: RoleId): boolean {
  return role === 'censeur' || role === 'secretaire';
}

export type MembershipAssignableRole = 'censeur' | 'secretaire' | 'teacher' | 'parent';

export function canManageLeadershipForRole(role: RoleId): boolean {
  return role === 'admin';
}

export function canManageCenseurForRole(role: RoleId): boolean {
  return role === 'admin';
}

export function canManageSecretaireForRole(role: RoleId): boolean {
  return role === 'admin' || role === 'censeur';
}

export function canManageTeamForRole(role: RoleId): boolean {
  return role === 'admin' || role === 'censeur';
}

export function getAssignableRolesForRole(role: RoleId): readonly MembershipAssignableRole[] {
  if (role === 'admin') return ['censeur', 'secretaire', 'teacher', 'parent'];
  if (role === 'censeur') return ['secretaire', 'teacher', 'parent'];
  return [];
}

export function canManageTargetMembershipRole(
  actorRole: RoleId,
  targetRole: MembershipAssignableRole
): boolean {
  return getAssignableRolesForRole(actorRole).includes(targetRole);
}

export function canManageYearLifecycleForRole(role: RoleId): boolean {
  return role === 'admin';
}

export function canChangeSchoolThemeForRole(role: RoleId): boolean {
  return role === 'admin';
}

export function canNotifyParentsForRole(role: RoleId): boolean {
  return role === 'admin' || role === 'censeur';
}

export function canDeleteBroadcastForRole(role: RoleId): boolean {
  return role === 'admin' || role === 'censeur';
}

export function getAllowedMessageRecipientRoles(senderRole: RoleId): readonly RoleId[] {
  return MESSAGE_RECIPIENT_MATRIX[senderRole] ?? [];
}

export function getAllowedNotificationRecipientRoles(senderRole: RoleId): readonly RoleId[] {
  return NOTIFICATION_RECIPIENT_MATRIX[senderRole] ?? [];
}

export function canSendMessageToRole(senderRole: RoleId, targetRole: RoleId): boolean {
  return getAllowedMessageRecipientRoles(senderRole).includes(targetRole);
}

export function canSendNotificationToRole(senderRole: RoleId, targetRole: RoleId): boolean {
  return getAllowedNotificationRecipientRoles(senderRole).includes(targetRole);
}

export function filterContactsForSender<T extends { role: RoleId }>(
  senderRole: RoleId,
  contacts: T[]
): T[] {
  return contacts.filter((c) => canSendMessageToRole(senderRole, c.role));
}

export function getAllowedNotificationModes(role: RoleId): NotificationModeOption[] {
  if (role === 'admin' || role === 'censeur') {
    return [
      {
        id: 'all',
        label: 'Tout l’établissement',
        description: 'Direction, secrétariat, professeurs et tous les parents',
      },
      {
        id: 'staff_no_parents',
        label: 'Personnel uniquement',
        description: 'Directeur, Censeur, Secrétaire et Professeurs (sans les parents)',
      },
      {
        id: 'class',
        label: 'Une classe précise',
        description: 'Parents et enseignants de la classe choisie',
      },
      {
        id: 'student',
        label: 'Un élève ciblé',
        description: 'Parent de l’élève et enseignants concernés',
      },
    ];
  }

  if (role === 'secretaire') {
    return [
      {
        id: 'staff_no_parents',
        label: 'Directeur, Censeur & Professeurs',
        description: 'Envoi réservé à la direction et aux enseignants (aucun parent)',
      },
    ];
  }

  if (role === 'teacher') {
    return [
      {
        id: 'director_censeur',
        label: 'Censeur & Directeur uniquement',
        description: 'Aucun envoi vers les parents depuis l’espace enseignant',
      },
    ];
  }

  // parent
  return [
    {
      id: 'censeur',
      label: 'Censeur uniquement',
      description: 'Transmettez votre signalement ou message directement au Censeur',
    },
  ];
}

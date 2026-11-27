import React, { useEffect, useMemo, useState } from 'react';
import {
  Send,
  Mail,
  MailOpen,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  Check,
  User,
  ShieldCheck,
  Trash2,
  Clock,
} from 'lucide-react';
import {
  Classroom,
  Membership,
  MessageItem,
  NOTIFICATION_DURATION_OPTIONS,
  NotificationDurationPreset,
  NotificationItem,
  ROLE_SHORT_LABELS,
  SchoolProfile,
  Student,
  UserRole,
  compareClassNames,
  computeNotificationExpiresAt,
  getTimestampMs,
  isNotificationVisibleForUser,
  sortClassrooms,
} from '../types/school.ts';
import {
  cleanupNotificationsBulk,
  createNotification,
  deleteMessageById,
  dismissOrDeleteNotification,
  markAllNotificationsRead,
  markMessageRead,
  markNotificationRead,
  normalizeEmail,
  sendMessage,
} from '../lib/schoolService.ts';
import {
  NotificationTargetMode,
  canNotifyParentsForRole,
  canSendMessageToRole,
  filterContactsForSender,
  getAllowedNotificationModes,
} from '../lib/rolePermissions.ts';
import { formatAuthIdentifierForDisplay } from '../lib/phoneAuth.ts';
import { ConfirmModal } from './ConfirmModal.tsx';

function getCreatedAtMs(ts: unknown): number {
  if (!ts) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object' && ts !== null) {
    const maybe = ts as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof maybe.toMillis === 'function') return maybe.toMillis();
    if (typeof maybe.toDate === 'function') return maybe.toDate().getTime();
    if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  }
  return 0;
}

interface ScopedContact {
  label: string;
  email: string;
  name: string;
  role: UserRole;
  studentId?: string;
  classe?: string;
}

function buildCenseurContacts(school: SchoolProfile, memberships: Membership[]): ScopedContact[] {
  const map = new Map<string, ScopedContact>();
  memberships
    .filter((m) => m.role === 'censeur')
    .forEach((m) => {
      const em = normalizeEmail(m.memberEmail);
      if (em) {
        map.set(em, {
          label: `Censeur · ${m.memberName}`,
          email: em,
          name: m.memberName,
          role: 'censeur',
        });
      }
    });
  (school.censeurEmails ?? []).forEach((rawEmail, idx) => {
    const em = normalizeEmail(rawEmail);
    if (em && !map.has(em)) {
      const cName = school.censeurNames?.[idx]?.trim() || 'Censeur';
      map.set(em, {
        label: `Censeur · ${cName}`,
        email: em,
        name: cName,
        role: 'censeur',
      });
    }
  });
  return Array.from(map.values());
}

function buildDirectorContact(school: SchoolProfile): ScopedContact | null {
  const dirEmail = normalizeEmail(school.ownerEmail || school.email || '');
  if (!dirEmail) return null;
  return {
    label: `Directeur · ${school.adminName || 'Direction'}`,
    email: dirEmail,
    name: school.adminName || 'Directeur',
    role: 'admin',
  };
}

interface MessagingViewProps {
  ownerUid: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actualRole?: UserRole;
  effectiveRole: UserRole;
  school: SchoolProfile;
  students: Student[];
  memberships: Membership[];
  messages: MessageItem[];
}

export function MessagingView({
  ownerUid,
  actorUid,
  actorEmail,
  actorName,
  actualRole,
  effectiveRole,
  school,
  students,
  memberships,
  messages,
}: MessagingViewProps) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [filterBox, setFilterBox] = useState<'all' | 'unread'>('all');
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);

  const senderRoleToWrite: UserRole = actualRole ?? effectiveRole;
  const cleanActorEmail = normalizeEmail(actorEmail);
  const canTypeAnyRecipient = canNotifyParentsForRole(senderRoleToWrite);

  const canDeleteMessage = (msg: MessageItem): boolean => {
    if (senderRoleToWrite === 'admin' || senderRoleToWrite === 'censeur') return true;
    return (
      normalizeEmail(msg.senderEmail) === cleanActorEmail ||
      normalizeEmail(msg.recipientEmail) === cleanActorEmail
    );
  };

  const handleDeleteMessage = async (msgId: string) => {
    setDeletingMsgId(msgId);
    setErrorNotice(null);
    setSentNotice(null);
    try {
      await deleteMessageById(msgId);
      setSentNotice('Message supprimé.');
    } catch (err: unknown) {
      setErrorNotice(
        err instanceof Error ? err.message : 'Erreur lors de la suppression du message.'
      );
    } finally {
      setDeletingMsgId(null);
    }
  };

  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
      ),
    [students]
  );

  const quickContacts = useMemo(() => {
    const rawList: ScopedContact[] = [];
    const seenEmails = new Set<string>();
    const addUnique = (item: ScopedContact | null) => {
      if (!item || !item.email || item.email === cleanActorEmail) return;
      if (seenEmails.has(item.email)) return;
      seenEmails.add(item.email);
      rawList.push(item);
    };

    // 1. Directeur
    addUnique(buildDirectorContact(school));

    // 2. Censeur(s)
    buildCenseurContacts(school, memberships).forEach((c) => addUnique(c));

    // 3. Secrétaire & Enseignants depuis memberships
    memberships
      .filter((m) => m.role === 'secretaire' || m.role === 'teacher')
      .forEach((m) => {
        const em = normalizeEmail(m.memberEmail);
        const prefix =
          m.role === 'secretaire'
            ? 'Secrétaire'
            : `Professeur (${m.assignedSubject || 'Enseignant'})`;
        addUnique({
          label: `${prefix} · ${m.memberName}`,
          email: em,
          name: m.memberName,
          role: m.role,
        });
      });

    // 4. Parents (uniquement si l'expéditeur a le droit de contacter les parents)
    if (canSendMessageToRole(senderRoleToWrite, 'parent')) {
      sortedStudents
        .filter((s) => s.parentEmail)
        .forEach((s) => {
          const pEm = normalizeEmail(s.parentEmail);
          if (!pEm || seenEmails.has(pEm)) return;
          seenEmails.add(pEm);
          rawList.push({
            label: `Parent de ${s.nom} ${s.prenoms} (${s.classe})`,
            email: pEm,
            name: s.guardianName || `Parent ${s.nom}`,
            role: 'parent',
            studentId: s.id,
            classe: s.classe,
          });
        });

      memberships
        .filter((m) => m.role === 'parent')
        .forEach((m) => {
          addUnique({
            label: `Parent · ${m.memberName}`,
            email: normalizeEmail(m.memberEmail),
            name: m.memberName,
            role: 'parent',
          });
        });
    }

    return filterContactsForSender(senderRoleToWrite, rawList);
  }, [senderRoleToWrite, school, memberships, sortedStudents, cleanActorEmail]);

  useEffect(() => {
    if (!canTypeAnyRecipient && quickContacts.length === 1 && !recipientEmail) {
      setRecipientEmail(quickContacts[0].email);
      setRecipientName(quickContacts[0].name);
    }
  }, [canTypeAnyRecipient, quickContacts, recipientEmail]);

  const handleSelectQuickContact = (email: string) => {
    const found = quickContacts.find((c) => c.email === email);
    setRecipientEmail(email);
    if (found) {
      setRecipientName(found.name);
      if (found.studentId) setSelectedStudentId(found.studentId);
    }
  };

  const messagingPolicySubtitle = useMemo(() => {
    if (senderRoleToWrite === 'parent') {
      return 'Canal direct et sécurisé avec le Censeur de l’établissement.';
    }
    if (senderRoleToWrite === 'teacher') {
      return 'Échanges directs réservés au Censeur et au Directeur (aucun envoi aux parents).';
    }
    if (senderRoleToWrite === 'secretaire') {
      return 'Communication interne avec le Directeur, le Censeur et les Professeurs.';
    }
    return 'Messagerie globale : direction, secrétariat, professeurs et parents d’élèves.';
  }, [senderRoleToWrite]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setSentNotice(null);
    setErrorNotice(null);
    try {
      const linkedStudent = students.find((s) => s.id === selectedStudentId);
      const resolvedRecipient = normalizeEmail(recipientEmail);

      if (!canTypeAnyRecipient) {
        const matchedContact = quickContacts.find((c) => c.email === resolvedRecipient);
        if (!matchedContact || !canSendMessageToRole(senderRoleToWrite, matchedContact.role)) {
          setErrorNotice(
            senderRoleToWrite === 'parent'
              ? 'Les parents peuvent uniquement écrire au Censeur.'
              : senderRoleToWrite === 'teacher'
              ? 'Les professeurs peuvent uniquement écrire au Censeur et au Directeur.'
              : 'La secrétaire peut uniquement écrire au Directeur, au Censeur et aux Professeurs.'
          );
          return;
        }
      }

      await sendMessage(ownerUid, school.id, {
        senderUid: actorUid,
        senderEmail: actorEmail,
        senderName: actorName,
        senderRole: senderRoleToWrite,
        recipientEmail: resolvedRecipient,
        recipientName:
          recipientName || formatAuthIdentifierForDisplay(resolvedRecipient).split('@')[0],
        studentId: linkedStudent?.id ?? '',
        studentName: linkedStudent ? `${linkedStudent.nom} ${linkedStudent.prenoms}` : '',
        classe: linkedStudent?.classe ?? '',
        subject,
        body,
      });
      setSentNotice(
        `Message envoyé à ${recipientName || formatAuthIdentifierForDisplay(resolvedRecipient)}.`
      );
      setSubject('');
      setBody('');
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : "Erreur lors de l'envoi du message.");
    } finally {
      setSending(false);
    }
  };

  const unreadIncomingCount = useMemo(
    () =>
      messages.filter(
        (m) => !m.read && m.senderEmail.trim().toLowerCase() !== cleanActorEmail
      ).length,
    [messages, cleanActorEmail]
  );

  const displayedMessages = useMemo(() => {
    const list =
      filterBox === 'unread'
        ? messages.filter(
            (m) => !m.read && m.senderEmail.trim().toLowerCase() !== cleanActorEmail
          )
        : messages;
    return [...list].sort((a, b) => {
      const dt = getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt);
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
    });
  }, [messages, filterBox, cleanActorEmail]);

  return (
    <div className="space-y-6">
      <div className="theme-surface-header rounded-2xl p-6 shadow-md border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold">Messagerie de l’établissement</h1>
          <p className="text-xs theme-header-subtext mt-0.5">{messagingPolicySubtitle}</p>
        </div>

        <div className="theme-header-chip inline-flex p-1 rounded-xl border self-start gap-1">
          <button
            type="button"
            onClick={() => setFilterBox('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterBox === 'all' ? 'theme-nav-active shadow-xs' : 'theme-nav-inactive'
            }`}
          >
            Tous ({messages.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterBox('unread')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterBox === 'unread' ? 'theme-nav-active shadow-xs' : 'theme-nav-inactive'
            }`}
          >
            Non lus ({unreadIncomingCount})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Compose Form */}
        <form
          onSubmit={handleSend}
          className="lg:col-span-5 bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl p-6 space-y-4 h-fit shadow-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold theme-text-ink flex items-center gap-2">
              <Send className="w-4 h-4 theme-text-accent" />
              Nouveau message
            </h2>
            <span className="theme-pill-soft px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold">
              {ROLE_SHORT_LABELS[senderRoleToWrite]}
            </span>
          </div>

          {sentNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {sentNotice}
            </div>
          )}
          {errorNotice && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorNotice}
            </div>
          )}

          {quickContacts.length === 0 && !canTypeAnyRecipient && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              {senderRoleToWrite === 'parent'
                ? 'Aucun Censeur n’a encore été nommé par le Directeur pour cet établissement.'
                : 'Aucun destinataire autorisé n’est encore configuré dans cet établissement.'}
            </div>
          )}

          {quickContacts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                {canTypeAnyRecipient ? 'Choisir un contact rapide' : 'Destinataire autorisé *'}
              </label>
              <select
                required={!canTypeAnyRecipient}
                value={recipientEmail}
                onChange={(e) => handleSelectQuickContact(e.target.value)}
                className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
              >
                <option value="">— Sélectionner un destinataire —</option>
                {quickContacts.map((c, idx) => (
                  <option key={idx} value={c.email}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canTypeAnyRecipient && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  N° de téléphone ou E-mail destinataire *
                </label>
                <input
                  type="text"
                  required
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="90 12 34 56 ou email@exemple.com"
                  className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Nom destinataire</label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Nom du destinataire"
                  className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none"
                />
              </div>
            </div>
          )}

          {sortedStudents.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Élève concerné (optionnel)</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
              >
                <option value="">— Aucun élève spécifique —</option>
                {sortedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    [{s.classe}] {s.nom} {s.prenoms}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Objet *</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex : Suivi scolaire / Demande d’information"
              className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Message *</label>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Rédigez votre message..."
              className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending || (!canTypeAnyRecipient && quickContacts.length === 0)}
            className="theme-btn-primary w-full py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {sending ? 'Envoi sécurisé...' : 'Envoyer le message'}
          </button>
        </form>

        {/* Thread List */}
        <div className="lg:col-span-7 bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xs">
          <div className="p-5 border-b theme-border-soft theme-pill-soft">
            <h2 className="text-sm font-bold theme-text-ink">Boîte de réception & messages envoyés</h2>
          </div>

          {displayedMessages.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              Aucun message dans cette vue. Utilisez le formulaire à gauche pour démarrer une discussion.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {displayedMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-5 transition-colors ${!msg.read ? 'bg-slate-50/70' : 'hover:bg-zinc-50/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg theme-pill-soft border flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-900">
                          {msg.senderName}{' '}
                          <span className="font-normal text-zinc-500">→ {msg.recipientName}</span>
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {msg.studentName
                            ? `Élève : ${msg.studentName} (${msg.classe})`
                            : formatAuthIdentifierForDisplay(msg.recipientEmail)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!msg.read &&
                      (senderRoleToWrite === 'admin' ||
                        normalizeEmail(msg.recipientEmail) === cleanActorEmail) ? (
                        <button
                          type="button"
                          onClick={() =>
                            void markMessageRead(msg.id).catch((err) =>
                              setErrorNotice(err instanceof Error ? err.message : 'Action refusée.')
                            )
                          }
                          className="theme-btn-primary inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0"
                        >
                          <Mail className="w-3 h-3" />
                          Marquer lu
                        </button>
                      ) : !msg.read ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-semibold shrink-0">
                          <Mail className="w-3 h-3" />
                          Envoyé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 shrink-0">
                          <MailOpen className="w-3 h-3" />
                          Lu
                        </span>
                      )}

                      {canDeleteMessage(msg) && (
                        <button
                          type="button"
                          disabled={deletingMsgId === msg.id}
                          onClick={() => void handleDeleteMessage(msg.id)}
                          title="Supprimer ce message"
                          aria-label="Supprimer ce message"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs font-bold text-zinc-800 mt-3">{msg.subject}</p>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface NotificationsViewProps {
  ownerUid: string;
  actorEmail: string;
  actorName: string;
  actualRole?: UserRole;
  effectiveRole: UserRole;
  school: SchoolProfile;
  classrooms: Classroom[];
  students: Student[];
  memberships: Membership[];
  notifications: NotificationItem[];
}

export function NotificationsCenterView({
  ownerUid,
  actorEmail,
  actorName,
  actualRole,
  effectiveRole,
  school,
  classrooms,
  students,
  memberships,
  notifications,
}: NotificationsViewProps) {
  const creatorRoleToWrite: UserRole = actualRole ?? effectiveRole;
  const allowedModes = useMemo(
    () => getAllowedNotificationModes(effectiveRole),
    [effectiveRole]
  );

  const [filterType, setFilterType] = useState<'all' | 'grade' | 'absence' | 'announcement'>('all');
  const [notifType, setNotifType] = useState<'announcement' | 'absence'>('announcement');
  const [targetMode, setTargetMode] = useState<NotificationTargetMode>(
    () => allowedModes[0]?.id ?? 'censeur'
  );
  const [targetClasse, setTargetClasse] = useState('');
  const [studentId, setStudentId] = useState('');
  const [leadershipScope, setLeadershipScope] = useState<'both' | 'censeur' | 'admin'>('both');
  const [secretaryScope, setSecretaryScope] = useState<'all_staff' | 'admin' | 'censeur' | 'teachers'>('all_staff');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [durationPreset, setDurationPreset] = useState<NotificationDurationPreset>('permanent');
  const [sending, setSending] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [cleaningMode, setCleaningMode] = useState<'read' | 'all' | null>(null);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [showComposerMobile, setShowComposerMobile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!allowedModes.some((m) => m.id === targetMode)) {
      setTargetMode(allowedModes[0]?.id ?? 'censeur');
    }
  }, [allowedModes, targetMode]);

  const canPublish = allowedModes.length > 0;
  const isAdminBroadcaster = effectiveRole === 'admin' || effectiveRole === 'censeur';
  const cleanActorEmail = normalizeEmail(actorEmail);

  const sortedClassrooms = useMemo(() => sortClassrooms(classrooms), [classrooms]);
  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
      ),
    [students]
  );

  const directorContact = useMemo(() => buildDirectorContact(school), [school]);
  const censeurContacts = useMemo(
    () => buildCenseurContacts(school, memberships),
    [school, memberships]
  );
  const teacherEmailsList = useMemo(() => {
    const fromMembers = memberships
      .filter((m) => m.role === 'teacher')
      .map((m) => normalizeEmail(m.memberEmail));
    const fromSchool = (school.teacherEmails ?? []).map((e) => normalizeEmail(e));
    return Array.from(new Set([...fromMembers, ...fromSchool].filter(Boolean)));
  }, [memberships, school.teacherEmails]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim() || !canPublish) return;
    setSending(true);
    setNotice(null);
    setPublishError(null);

    try {
      let audience: string[] = [];
      let resolvedTargetClasse = '';
      let resolvedStudentId = '';

      if (effectiveRole === 'parent') {
        // Parent : UNIQUEMENT vers le Censeur
        audience = censeurContacts.map((c) => c.email);
        if (audience.length === 0) {
          setPublishError(
            "Aucun Censeur n'est encore nommé dans cet établissement pour recevoir votre notification."
          );
          return;
        }
        if (notifType === 'absence' && studentId) {
          resolvedStudentId = studentId;
          const stu = students.find((s) => s.id === studentId);
          resolvedTargetClasse = stu?.classe ?? '';
        }
      } else if (effectiveRole === 'teacher') {
        // Professeur : UNIQUEMENT vers Censeur et/ou Directeur (jamais vers les parents)
        const censeurs = censeurContacts.map((c) => c.email);
        const dir = directorContact?.email ? [directorContact.email] : [];
        if (leadershipScope === 'censeur') audience = censeurs;
        else if (leadershipScope === 'admin') audience = dir;
        else audience = [...censeurs, ...dir];

        if (audience.length === 0) {
          setPublishError(
            "Aucun compte Censeur ou Directeur n'est encore enregistré pour recevoir cette notification."
          );
          return;
        }
        if (notifType === 'absence' && studentId) {
          resolvedStudentId = studentId;
          const stu = students.find((s) => s.id === studentId);
          resolvedTargetClasse = stu?.classe ?? '';
        }
      } else if (effectiveRole === 'secretaire') {
        // Secrétaire : UNIQUEMENT vers Directeur, Censeur et Professeurs (jamais vers les parents)
        const dir = directorContact?.email ? [directorContact.email] : [];
        const censeurs = censeurContacts.map((c) => c.email);
        if (secretaryScope === 'admin') audience = dir;
        else if (secretaryScope === 'censeur') audience = censeurs;
        else if (secretaryScope === 'teachers') audience = teacherEmailsList;
        else audience = [...dir, ...censeurs, ...teacherEmailsList];

        if (audience.length === 0) {
          setPublishError(
            'Aucun destinataire (Directeur, Censeur ou Professeur) disponible pour cet envoi.'
          );
          return;
        }
      } else {
        // Directeur (admin) & Censeur (censeur) : accès complet à tout le monde
        if (targetMode === 'student' || (notifType === 'absence' && studentId)) {
          const stu = students.find((s) => s.id === studentId);
          if (!stu) {
            setPublishError('Veuillez sélectionner un élève concerné.');
            return;
          }
          resolvedStudentId = stu.id;
          resolvedTargetClasse = stu.classe;
          if (stu.parentEmail) audience.push(stu.parentEmail);
          (stu.teacherEmails ?? []).forEach((te) => audience.push(te));
        } else if (targetMode === 'class') {
          if (!targetClasse) {
            setPublishError('Veuillez sélectionner une classe cible.');
            return;
          }
          resolvedTargetClasse = targetClasse;
          students
            .filter((s) => s.classe === targetClasse && s.parentEmail)
            .forEach((s) => audience.push(s.parentEmail!));
          memberships
            .filter((m) => m.role === 'teacher' && (m.assignedClasses ?? []).includes(targetClasse))
            .forEach((m) => audience.push(m.memberEmail));
        } else if (targetMode === 'staff_no_parents') {
          if (directorContact?.email) audience.push(directorContact.email);
          audience.push(
            ...(school.staffEmails ?? []),
            ...memberships
              .filter((m) => m.role === 'censeur' || m.role === 'secretaire' || m.role === 'teacher')
              .map((m) => m.memberEmail)
          );
        } else {
          // Tout l'établissement (direction + secrétariat + professeurs + parents)
          if (directorContact?.email) audience.push(directorContact.email);
          audience.push(
            ...(school.memberEmails ?? []),
            ...memberships.map((m) => m.memberEmail),
            ...students.map((s) => s.parentEmail ?? '')
          );
        }
      }

      // Inclure l'expéditeur uniquement pour les admins (Directeur/Censeur) qui lisent déjà ou suivent leurs diffusions,
      // mais jamais comme unique destinataire si un rôle restreint n'avait pas d'autre cible.
      const uniqueAudience = Array.from(
        new Set(audience.map((e) => normalizeEmail(e)).filter(Boolean))
      );
      if (isAdminBroadcaster && cleanActorEmail && !uniqueAudience.includes(cleanActorEmail)) {
        uniqueAudience.push(cleanActorEmail);
      }

      if (uniqueAudience.length === 0) {
        setPublishError('Aucun destinataire valide trouvé pour cette diffusion.');
        return;
      }

      const computedExpiresAt = computeNotificationExpiresAt(durationPreset);

      await createNotification(ownerUid, school.id, {
        type: notifType,
        title,
        message,
        targetClasse: resolvedTargetClasse,
        studentId: resolvedStudentId,
        audienceEmails: uniqueAudience,
        createdByEmail: actorEmail,
        createdByName: actorName,
        createdByRole: creatorRoleToWrite,
        expiresAt: computedExpiresAt,
      });

      setNotice(
        effectiveRole === 'parent'
          ? 'Notification envoyée au Censeur avec succès.'
          : effectiveRole === 'teacher'
          ? 'Notification envoyée à la Direction (Censeur / Directeur).'
          : effectiveRole === 'secretaire'
          ? 'Notification envoyée au personnel autorisé.'
          : 'Notification diffusée avec succès.'
      );
      setTitle('');
      setMessage('');
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Erreur lors de l'envoi de la notification.");
    } finally {
      setSending(false);
    }
  };

  const activeNotifs = useMemo(
    () => notifications.filter((n) => isNotificationVisibleForUser(n, cleanActorEmail, nowTick)),
    [notifications, cleanActorEmail, nowTick]
  );

  const filteredNotifs = useMemo(() => {
    const list =
      filterType === 'all' ? activeNotifs : activeNotifs.filter((n) => n.type === filterType);
    return [...list].sort((a, b) => {
      const dt = getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt);
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
    });
  }, [activeNotifs, filterType]);

  const canMarkNotifRead = (n: NotificationItem) => {
    if (n.read) return false;
    if (isAdminBroadcaster) return true;
    return (n.audienceEmails ?? []).some((e) => normalizeEmail(e) === cleanActorEmail);
  };

  const canDeleteNotif = (n: NotificationItem) => {
    if (isAdminBroadcaster) return true;
    if (normalizeEmail(n.createdByEmail) === cleanActorEmail) return true;
    return (n.audienceEmails ?? []).some((e) => normalizeEmail(e) === cleanActorEmail);
  };

  const unreadNotifs = useMemo(
    () =>
      activeNotifs.filter(
        (n) =>
          !n.read &&
          (isAdminBroadcaster ||
            (n.audienceEmails ?? []).some((e) => normalizeEmail(e) === cleanActorEmail))
      ),
    [activeNotifs, isAdminBroadcaster, cleanActorEmail]
  );

  const readNotifs = useMemo(
    () => filteredNotifs.filter((n) => n.read && canDeleteNotif(n)),
    [filteredNotifs, isAdminBroadcaster, cleanActorEmail]
  );

  const deletableFilteredNotifs = useMemo(
    () => filteredNotifs.filter((n) => canDeleteNotif(n)),
    [filteredNotifs, isAdminBroadcaster, cleanActorEmail]
  );

  const handleMarkAllRead = async () => {
    if (unreadNotifs.length === 0) return;
    setMarkingAll(true);
    setPublishError(null);
    try {
      await markAllNotificationsRead(unreadNotifs.map((n) => n.id));
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Erreur lors du marquage des notifications.');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleDeleteOneNotif = async (n: NotificationItem) => {
    setDeletingNotifId(n.id);
    setPublishError(null);
    setNotice(null);
    try {
      await dismissOrDeleteNotification(n, actorEmail, effectiveRole);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    } finally {
      setDeletingNotifId(null);
    }
  };

  const handleCleanupRead = async () => {
    if (readNotifs.length === 0) return;
    setCleaningMode('read');
    setPublishError(null);
    setNotice(null);
    try {
      await cleanupNotificationsBulk(readNotifs, actorEmail, effectiveRole);
      setNotice(`${readNotifs.length} notification(s) lue(s) nettoyée(s).`);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Erreur lors du nettoyage.');
    } finally {
      setCleaningMode(null);
    }
  };

  const handleConfirmDeleteAll = async () => {
    if (deletableFilteredNotifs.length === 0) {
      setConfirmDeleteAllOpen(false);
      return;
    }
    setCleaningMode('all');
    setPublishError(null);
    setNotice(null);
    try {
      await cleanupNotificationsBulk(deletableFilteredNotifs, actorEmail, effectiveRole);
      setNotice(`${deletableFilteredNotifs.length} notification(s) supprimée(s).`);
      setConfirmDeleteAllOpen(false);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Erreur lors de la suppression groupée.');
    } finally {
      setCleaningMode(null);
    }
  };

  const headerSubtitle = useMemo(() => {
    if (effectiveRole === 'parent') {
      return 'Consultez vos alertes et adressez directement une notification au Censeur.';
    }
    if (effectiveRole === 'teacher') {
      return 'Recevez les annonces et notifiez uniquement le Censeur ou le Directeur.';
    }
    if (effectiveRole === 'secretaire') {
      return 'Diffusion interne ciblée vers le Directeur, le Censeur et les Professeurs.';
    }
    return 'Administration globale : diffusez vos notes, absences et annonces à tout l’établissement.';
  }, [effectiveRole]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="theme-surface-header rounded-2xl p-5 sm:p-6 shadow-md border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold">Centre de Notifications & Annonces</h1>
          <p className="text-xs theme-header-subtext mt-0.5">{headerSubtitle}</p>
        </div>

        <div className="theme-header-chip inline-flex flex-wrap p-1 rounded-xl border self-start gap-1">
          {(
            [
              { id: 'all', label: 'Toutes' },
              { id: 'grade', label: 'Notes' },
              { id: 'absence', label: 'Absences' },
              { id: 'announcement', label: 'Annonces' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterType(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === f.id ? 'theme-nav-active shadow-xs' : 'theme-nav-inactive'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {canPublish && (
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setShowComposerMobile((v) => !v)}
            className="theme-btn-primary w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-bold shadow-xs"
          >
            <Bell className="w-4 h-4" />
            <span>
              {showComposerMobile
                ? 'Masquer le formulaire'
                : effectiveRole === 'parent'
                ? 'Notifier le Censeur'
                : 'Nouvelle notification'}
            </span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {canPublish && (
          <form
            onSubmit={handlePublish}
            className={`${
              showComposerMobile ? 'block' : 'hidden lg:block'
            } order-2 lg:order-1 lg:col-span-5 bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl p-5 sm:p-6 space-y-4 h-fit shadow-xs`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold theme-text-ink flex items-center gap-2">
                <Bell className="w-4 h-4 theme-text-accent" />
                {effectiveRole === 'parent'
                  ? 'Envoyer une notification au Censeur'
                  : effectiveRole === 'teacher'
                  ? 'Notifier le Censeur ou le Directeur'
                  : effectiveRole === 'secretaire'
                  ? 'Notifier Direction & Professeurs'
                  : 'Diffuser une alerte ou annonce'}
              </h2>
              <span className="theme-pill-soft px-2 py-0.5 rounded-lg border text-[11px] font-semibold">
                {ROLE_SHORT_LABELS[effectiveRole]}
              </span>
            </div>

            {notice && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {notice}
              </div>
            )}
            {publishError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {publishError}
              </div>
            )}

            {/* Scope explanation pill */}
            <div className="p-3 rounded-xl theme-pill-soft border text-[11px] flex items-start gap-2 leading-relaxed">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{allowedModes[0]?.description}</span>
            </div>

            {/* Type selector */}
            <div className={effectiveRole === 'secretaire' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2'}>
              <button
                type="button"
                onClick={() => setNotifType('announcement')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border ${
                  notifType === 'announcement'
                    ? 'theme-btn-primary border-transparent'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                {effectiveRole === 'parent' ? 'Message / Requête' : 'Annonce / Note info'}
              </button>
              {effectiveRole !== 'secretaire' && (
                <button
                  type="button"
                  onClick={() => setNotifType('absence')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border ${
                    notifType === 'absence'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-zinc-700 border-zinc-200'
                  }`}
                >
                  {effectiveRole === 'parent' ? 'Justifier une absence' : 'Signalement absence'}
                </button>
              )}
            </div>

            {/* Recipient selector strictly bounded by role */}
            {isAdminBroadcaster && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Destinataires *
                  </label>
                  <select
                    value={targetMode}
                    onChange={(e) => setTargetMode(e.target.value as NotificationTargetMode)}
                    className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                  >
                    {allowedModes.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </div>

                {targetMode === 'class' && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Classe cible *
                    </label>
                    <select
                      required
                      value={targetClasse}
                      onChange={(e) => setTargetClasse(e.target.value)}
                      className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                    >
                      <option value="">— Sélectionner une classe —</option>
                      {sortedClassrooms.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.cycle})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(targetMode === 'student' || notifType === 'absence') && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Élève concerné {targetMode === 'student' || notifType === 'absence' ? '*' : ''}
                    </label>
                    <select
                      required={targetMode === 'student' || notifType === 'absence'}
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                    >
                      <option value="">— Sélectionner un élève —</option>
                      {sortedStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.classe}] {s.nom} {s.prenoms}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {effectiveRole === 'teacher' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Destinataire (Direction pédagogique) *
                  </label>
                  <select
                    value={leadershipScope}
                    onChange={(e) =>
                      setLeadershipScope(e.target.value as 'both' | 'censeur' | 'admin')
                    }
                    className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                  >
                    <option value="both">Censeur et Directeur</option>
                    <option value="censeur">Censeur uniquement</option>
                    <option value="admin">Directeur uniquement</option>
                  </select>
                </div>

                {notifType === 'absence' && sortedStudents.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Élève concerné (transmis au Censeur/Directeur)
                    </label>
                    <select
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                    >
                      <option value="">— Optionnel —</option>
                      {sortedStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.classe}] {s.nom} {s.prenoms}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {effectiveRole === 'secretaire' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Destinataires autorisés (sans les parents) *
                </label>
                <select
                  value={secretaryScope}
                  onChange={(e) =>
                    setSecretaryScope(
                      e.target.value as 'all_staff' | 'admin' | 'censeur' | 'teachers'
                    )
                  }
                  className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                >
                  <option value="all_staff">Directeur, Censeur et Professeurs</option>
                  <option value="admin">Directeur uniquement</option>
                  <option value="censeur">Censeur uniquement</option>
                  <option value="teachers">Professeurs uniquement ({teacherEmailsList.length})</option>
                </select>
              </div>
            )}

            {effectiveRole === 'parent' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
                  <span className="font-semibold text-zinc-900">Destinataire : </span>
                  {censeurContacts.length > 0
                    ? censeurContacts.map((c) => c.name).join(', ') + ' (Censeur)'
                    : 'Aucun Censeur nommé pour le moment'}
                </div>

                {notifType === 'absence' && sortedStudents.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Enfant concerné
                    </label>
                    <select
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
                    >
                      <option value="">— Sélectionner votre enfant —</option>
                      {sortedStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.classe}] {s.nom} {s.prenoms}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Titre *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  effectiveRole === 'parent'
                    ? 'Ex : Justification d’absence ou rendez-vous'
                    : notifType === 'announcement'
                    ? 'Ex : Note de service ou information'
                    : 'Ex : Absence signalée ce matin'
                }
                className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Détails *</label>
              <textarea
                required
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Précisez la date, l’heure ou les informations utiles..."
                className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 theme-text-accent" />
                Durée / Délai d’affichage (optionnel)
              </label>
              <select
                value={durationPreset}
                onChange={(e) => setDurationPreset(e.target.value as NotificationDurationPreset)}
                className="theme-input w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none"
              >
                {NOTIFICATION_DURATION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-500 mt-1">
                Passé ce délai, l’annonce ou notification disparaît automatiquement du fil.
              </p>
            </div>

            <button
              type="submit"
              disabled={sending || (effectiveRole === 'parent' && censeurContacts.length === 0)}
              className="theme-btn-primary w-full py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {sending ? 'Envoi...' : 'Envoyer la notification'}
            </button>
          </form>
        )}

        <div
          className={`order-1 lg:order-2 ${
            canPublish ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xs`}
        >
          <div className="p-4 sm:p-5 border-b theme-border-soft theme-pill-soft flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold theme-text-ink">
              Fil des notifications ({filteredNotifs.length})
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {unreadNotifs.length > 0 && (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={() => void handleMarkAllRead()}
                  className="theme-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" />
                  {markingAll ? 'Mise à jour...' : `Tout marquer lu (${unreadNotifs.length})`}
                </button>
              )}
              {readNotifs.length > 0 && (
                <button
                  type="button"
                  disabled={cleaningMode !== null}
                  onClick={() => void handleCleanupRead()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-[11px] font-bold transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5 text-zinc-500" />
                  {cleaningMode === 'read' ? 'Nettoyage...' : `Nettoyer les lues (${readNotifs.length})`}
                </button>
              )}
              {deletableFilteredNotifs.length > 0 && (
                <button
                  type="button"
                  disabled={cleaningMode !== null}
                  onClick={() => setConfirmDeleteAllOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Tout supprimer
                </button>
              )}
            </div>
          </div>

          {filteredNotifs.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">Aucune notification pour ce filtre.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {filteredNotifs.map((n) => {
                const expMs = getTimestampMs(n.expiresAt);
                const expLabel =
                  expMs !== null
                    ? new Date(expMs).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : null;
                return (
                  <div key={n.id} className={`p-4 sm:p-5 flex items-start gap-3 ${!n.read ? 'bg-slate-50/75' : ''}`}>
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        n.type === 'grade'
                          ? 'bg-emerald-100 text-emerald-700'
                          : n.type === 'absence'
                          ? 'bg-amber-100 text-amber-700'
                          : 'theme-pill-soft border'
                      }`}
                    >
                      {n.type === 'grade' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : n.type === 'absence' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <Megaphone className="w-4 h-4" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-bold text-zinc-900 break-words">{n.title}</p>
                            {expLabel && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold">
                                <Clock className="w-2.5 h-2.5" />
                                Expire le {expLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            Par {n.createdByName}
                            {n.createdByRole ? ` (${ROLE_SHORT_LABELS[n.createdByRole]})` : ''}
                            {n.targetClasse ? ` · Classe : ${n.targetClasse}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 self-start shrink-0">
                          {canMarkNotifRead(n) && (
                            <button
                              type="button"
                              onClick={() => void markNotificationRead(n.id)}
                              className="theme-btn-primary inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                            >
                              <Check className="w-3 h-3" />
                              Vu
                            </button>
                          )}
                          {canDeleteNotif(n) && (
                            <button
                              type="button"
                              disabled={deletingNotifId === n.id}
                              onClick={() => void handleDeleteOneNotif(n)}
                              title="Supprimer cette notification"
                              aria-label="Supprimer cette notification"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-zinc-500 hover:text-rose-600 text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span className="hidden sm:inline">Supprimer</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-zinc-700 mt-2 leading-relaxed break-words">{n.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteAllOpen}
        title="Supprimer toutes les notifications affichées ?"
        description={`Voulez-vous nettoyer ${deletableFilteredNotifs.length} notification(s) de ce fil ? Les annonces que vous avez publiées ou qui relèvent de votre administration seront définitivement supprimées.`}
        confirmLabel="Tout supprimer"
        tone="danger"
        loading={cleaningMode === 'all'}
        onCancel={() => cleaningMode !== 'all' && setConfirmDeleteAllOpen(false)}
        onConfirm={handleConfirmDeleteAll}
      />
    </div>
  );
}

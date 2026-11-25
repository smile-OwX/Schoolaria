import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  Classroom,
  Membership,
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  UserRole,
  compareClassNames,
  sortClassrooms,
} from '../types/school.ts';
import {
  createNotification,
  markAllNotificationsRead,
  markMessageRead,
  markNotificationRead,
  sendMessage,
} from '../lib/schoolService.ts';

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

  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
      ),
    [students]
  );

  const quickContacts = useMemo(() => {
    const list: Array<{ label: string; email: string; name: string; studentId?: string; classe?: string }> = [];
    if (effectiveRole === 'parent') {
      if (school.email) {
        list.push({ label: `Direction · ${school.adminName}`, email: school.email, name: school.adminName });
      }
      memberships
        .filter((m) => m.role === 'teacher' || m.role === 'censeur' || m.role === 'secretaire')
        .forEach((m) => {
          const prefix =
            m.role === 'censeur'
              ? 'Censeur'
              : m.role === 'secretaire'
              ? 'Secrétaire'
              : `Prof. (${m.assignedSubject || 'Enseignant'})`;
          list.push({
            label: `${prefix} · ${m.memberName}`,
            email: m.memberEmail,
            name: m.memberName,
          });
        });
    } else {
      sortedStudents
        .filter((s) => s.parentEmail)
        .forEach((s) => {
          list.push({
            label: `Parent de ${s.nom} ${s.prenoms} (${s.classe})`,
            email: s.parentEmail!,
            name: s.guardianName || `Parent ${s.nom}`,
            studentId: s.id,
            classe: s.classe,
          });
        });
      memberships
        .filter((m) => m.memberEmail !== actorEmail)
        .forEach((m) => {
          if (!list.some((x) => x.email === m.memberEmail)) {
            const rLbl =
              m.role === 'censeur'
                ? 'Censeur'
                : m.role === 'secretaire'
                ? 'Secrétaire'
                : m.role === 'teacher'
                ? 'Enseignant'
                : 'Parent';
            list.push({
              label: `${rLbl} · ${m.memberName}`,
              email: m.memberEmail,
              name: m.memberName,
            });
          }
        });
    }
    return list;
  }, [effectiveRole, school, memberships, sortedStudents, actorEmail]);

  const handleSelectQuickContact = (email: string) => {
    const found = quickContacts.find((c) => c.email === email);
    setRecipientEmail(email);
    if (found) {
      setRecipientName(found.name);
      if (found.studentId) setSelectedStudentId(found.studentId);
    }
  };

  const cleanActorEmail = actorEmail.trim().toLowerCase();
  const senderRoleToWrite: UserRole = actualRole ?? effectiveRole;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setSentNotice(null);
    setErrorNotice(null);
    try {
      const linkedStudent = students.find((s) => s.id === selectedStudentId);
      await sendMessage(ownerUid, school.id, {
        senderUid: actorUid,
        senderEmail: actorEmail,
        senderName: actorName,
        senderRole: senderRoleToWrite,
        recipientEmail,
        recipientName: recipientName || recipientEmail.split('@')[0],
        studentId: linkedStudent?.id ?? '',
        studentName: linkedStudent ? `${linkedStudent.nom} ${linkedStudent.prenoms}` : '',
        classe: linkedStudent?.classe ?? '',
        subject,
        body,
      });
      setSentNotice(`Message envoyé à ${recipientName || recipientEmail}.`);
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
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-white">Messagerie sécurisée Enseignants ↔ Parents</h1>
          <p className="text-xs text-violet-100/90">
            Échanges directs, confidentiels et rattachés aux dossiers des élèves.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-white/15 border border-white/25 self-start">
          <button
            type="button"
            onClick={() => setFilterBox('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterBox === 'all' ? 'bg-white text-violet-950 shadow-xs' : 'text-violet-100'
            }`}
          >
            Tous ({messages.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterBox('unread')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterBox === 'unread' ? 'bg-white text-violet-950 shadow-xs' : 'text-violet-100'
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
          className="lg:col-span-5 bg-violet-50/90 backdrop-blur-xs border border-violet-300/80 rounded-2xl p-6 space-y-4 h-fit shadow-xs"
        >
          <h2 className="text-sm font-bold text-violet-950 flex items-center gap-2">
            <Send className="w-4 h-4 text-violet-700" />
            Nouveau message
          </h2>

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

          {quickContacts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Choisir un contact rapide
              </label>
              <select
                value={recipientEmail}
                onChange={(e) => handleSelectQuickContact(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none focus:border-violet-600"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Email destinataire *</label>
              <input
                type="email"
                required
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="email@exemple.com"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Nom destinataire</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Nom du parent / prof"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Élève concerné (optionnel)</label>
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none focus:border-violet-600"
            >
              <option value="">— Aucun élève spécifique —</option>
              {sortedStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  [{s.classe}] {s.nom} {s.prenoms}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Objet *</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex : Suivi de notes / Convocation"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
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
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {sending ? 'Envoi sécurisé...' : 'Envoyer le message'}
          </button>
        </form>

        {/* Thread List */}
        <div className="lg:col-span-7 bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-violet-200 bg-violet-100/75">
            <h2 className="text-sm font-bold text-violet-950">Boîte de réception & messages envoyés</h2>
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
                  className={`p-5 transition-colors ${!msg.read ? 'bg-violet-50/40' : 'hover:bg-zinc-50/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-900">
                          {msg.senderName}{' '}
                          <span className="font-normal text-zinc-500">→ {msg.recipientName}</span>
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {msg.studentName ? `Élève : ${msg.studentName} (${msg.classe})` : msg.recipientEmail}
                        </p>
                      </div>
                    </div>

                    {!msg.read &&
                    (senderRoleToWrite === 'admin' ||
                      msg.recipientEmail.trim().toLowerCase() === cleanActorEmail) ? (
                      <button
                        type="button"
                        onClick={() => void markMessageRead(msg.id).catch((err) => setErrorNotice(err instanceof Error ? err.message : 'Action refusée.'))}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-700 text-white text-[11px] font-semibold shrink-0"
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
  effectiveRole,
  school,
  classrooms,
  students,
  memberships,
  notifications,
}: NotificationsViewProps) {
  const [filterType, setFilterType] = useState<'all' | 'grade' | 'absence' | 'announcement'>('all');
  const [notifType, setNotifType] = useState<'announcement' | 'absence'>('announcement');
  const [targetClasse, setTargetClasse] = useState('');
  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [showComposerMobile, setShowComposerMobile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const canPublish =
    effectiveRole === 'admin' ||
    effectiveRole === 'censeur' ||
    effectiveRole === 'secretaire' ||
    effectiveRole === 'teacher';

  const sortedClassrooms = useMemo(() => sortClassrooms(classrooms), [classrooms]);
  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
      ),
    [students]
  );

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim() || !canPublish) return;
    setSending(true);
    setNotice(null);
    setPublishError(null);
    try {
      let audience: string[] = [];
      if (notifType === 'absence' && studentId) {
        const stu = students.find((s) => s.id === studentId);
        if (stu?.parentEmail) audience.push(stu.parentEmail);
      } else if (targetClasse) {
        students
          .filter((s) => s.classe === targetClasse && s.parentEmail)
          .forEach((s) => audience.push(s.parentEmail!));
      } else {
        audience = [
          ...(school.memberEmails ?? []),
          ...memberships.map((m) => m.memberEmail),
          ...students.map((s) => s.parentEmail ?? ''),
        ];
      }
      audience.push(actorEmail);

      await createNotification(ownerUid, school.id, {
        type: notifType,
        title,
        message,
        targetClasse,
        studentId,
        audienceEmails: Array.from(new Set(audience.filter(Boolean))),
        createdByEmail: actorEmail,
        createdByName: actorName,
      });

      setNotice('Notification diffusée avec succès.');
      setTitle('');
      setMessage('');
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Erreur lors de l'envoi de la notification.");
    } finally {
      setSending(false);
    }
  };

  const filteredNotifs = useMemo(() => {
    const list =
      filterType === 'all' ? notifications : notifications.filter((n) => n.type === filterType);
    return [...list].sort((a, b) => {
      const dt = getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt);
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
    });
  }, [notifications, filterType]);

  const unreadNotifs = useMemo(
    () => notifications.filter((n) => !n.read),
    [notifications]
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

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-5 sm:p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-white">Centre de Notifications & Annonces</h1>
          <p className="text-xs text-violet-100/90 mt-0.5">
            Alertes en temps réel sur les notes publiées, les absences et les annonces de la direction.
          </p>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-xl bg-white/15 border border-white/25 self-start gap-1">
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
                filterType === f.id ? 'bg-white text-violet-950 shadow-xs' : 'text-violet-100'
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
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-bold shadow-xs"
          >
            <Bell className="w-4 h-4" />
            <span>
              {showComposerMobile
                ? 'Masquer le formulaire de diffusion'
                : 'Nouvelle alerte ou annonce'}
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
            } order-2 lg:order-1 lg:col-span-5 bg-violet-50/90 backdrop-blur-xs border border-violet-300/80 rounded-2xl p-5 sm:p-6 space-y-4 h-fit shadow-xs`}
          >
            <h2 className="text-sm font-bold text-violet-950 flex items-center gap-2">
              <Bell className="w-4 h-4 text-violet-700" />
              Diffuser une alerte ou annonce
            </h2>

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

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNotifType('announcement')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border ${
                  notifType === 'announcement'
                    ? 'bg-violet-700 text-white border-violet-700'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                Annonce importante
              </button>
              <button
                type="button"
                onClick={() => setNotifType('absence')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border ${
                  notifType === 'absence'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                Signalement absence
              </button>
            </div>

            {notifType === 'announcement' ? (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Classe cible (laisser vide = toute l’école)
                </label>
                <select
                  value={targetClasse}
                  onChange={(e) => setTargetClasse(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none focus:border-violet-600"
                >
                  <option value="">Toute l’établissement</option>
                  {sortedClassrooms.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({c.cycle})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Élève absent *</label>
                <select
                  required
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none focus:border-violet-600"
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

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Titre *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  notifType === 'announcement'
                    ? 'Ex : Réunion parents-professeurs samedi'
                    : 'Ex : Absence signalée ce matin'
                }
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
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
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {sending ? 'Publication...' : 'Envoyer la notification'}
            </button>
          </form>
        )}

        <div
          className={`order-1 lg:order-2 ${
            canPublish ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs`}
        >
          <div className="p-4 sm:p-5 border-b border-violet-200 bg-violet-100/75 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-violet-950">
              Fil des notifications ({filteredNotifs.length})
            </h2>
            {unreadNotifs.length > 0 && (
              <button
                type="button"
                disabled={markingAll}
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-bold transition-colors disabled:opacity-60"
              >
                <Check className="w-3.5 h-3.5" />
                {markingAll ? 'Mise à jour...' : `Tout marquer lu (${unreadNotifs.length})`}
              </button>
            )}
          </div>

          {filteredNotifs.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">Aucune notification pour ce filtre.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {filteredNotifs.map((n) => (
                <div key={n.id} className={`p-4 sm:p-5 flex items-start gap-3 ${!n.read ? 'bg-violet-50/45' : ''}`}>
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      n.type === 'grade'
                        ? 'bg-emerald-100 text-emerald-700'
                        : n.type === 'absence'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-violet-100 text-violet-700'
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
                        <p className="text-xs font-bold text-zinc-900 break-words">{n.title}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Par {n.createdByName}
                          {n.targetClasse ? ` · Classe : ${n.targetClasse}` : ''}
                        </p>
                      </div>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => void markNotificationRead(n.id)}
                          className="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-violet-800 text-white text-[11px] font-semibold shrink-0 transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Vu
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-zinc-700 mt-2 leading-relaxed break-words">{n.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

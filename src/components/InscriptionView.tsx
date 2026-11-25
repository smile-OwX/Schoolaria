import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Pencil, Trash2, Search, UserPlus } from 'lucide-react';
import {
  CYCLES,
  Classroom,
  CycleType,
  Student,
  compareClassNames,
} from '../types/school.ts';
import { createStudent, deleteStudentById, updateStudent } from '../lib/schoolService.ts';
import { ConfirmModal } from './ConfirmModal.tsx';

interface InscriptionViewProps {
  uid: string;
  schoolId: string;
  classrooms: Classroom[];
  students: Student[];
  onBack: () => void;
  onSelectClass: (classe: string) => void;
}

function getNextMatricule(students: Student[], offset = 0): string {
  let maxNum = students.length;
  for (const s of students) {
    const m = s.matricule.match(/(\d+)$/);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  return `SCH-26-${String(maxNum + 1 + offset).padStart(3, '0')}`;
}

export function InscriptionView({
  uid,
  schoolId,
  classrooms,
  students,
  onBack,
  onSelectClass,
}: InscriptionViewProps) {
  const classesByCycle = useMemo(() => {
    const map: Record<CycleType, Array<{ name: string; label: string }>> = {
      Collège: [],
      Lycée: [],
    };
    if (classrooms.length > 0) {
      for (const c of classrooms) {
        if (c.cycle === 'Collège' || c.cycle === 'Lycée') {
          map[c.cycle].push({
            name: c.name,
            label: c.series || c.level || c.cycle,
          });
        }
      }
      (Object.keys(map) as CycleType[]).forEach((cyc) => {
        map[cyc].sort((a, b) => compareClassNames(a.name, b.name));
        if (map[cyc].length === 0) {
          map[cyc] = CYCLES[cyc].map((x) => ({ name: x.name, label: x.label }));
        }
      });
    } else {
      (Object.keys(CYCLES) as CycleType[]).forEach((cyc) => {
        map[cyc] = CYCLES[cyc].map((x) => ({ name: x.name, label: x.label }));
      });
    }
    return map;
  }, [classrooms]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [prenoms, setPrenoms] = useState('');
  const [age, setAge] = useState<number>(12);
  const [sexe, setSexe] = useState<'M' | 'F'>('M');
  const [cycle, setCycle] = useState<CycleType>('Collège');
  const [classe, setClasse] = useState<string>(() => classesByCycle.Collège[0]?.name ?? '6ème A');
  const [matricule, setMatricule] = useState<string>(() => getNextMatricule(students));
  const [matriculeTouched, setMatriculeTouched] = useState(false);

  useEffect(() => {
    if (!editingId && !matriculeTouched) {
      setMatricule(getNextMatricule(students));
    }
  }, [students, editingId, matriculeTouched]);
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [previousStudentEmail, setPreviousStudentEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const handleCycleChange = (newCycle: CycleType) => {
    setCycle(newCycle);
    const first = classesByCycle[newCycle][0]?.name ?? CYCLES[newCycle][0].name;
    setClasse(first);
  };

  const resetForm = (nextStudentsOffset = 0) => {
    setEditingId(null);
    setNom('');
    setPrenoms('');
    setAge(cycle === 'Collège' ? 12 : 16);
    setSexe('M');
    setMatriculeTouched(false);
    setMatricule(getNextMatricule(students, nextStudentsOffset));
    setGuardianName('');
    setGuardianPhone('');
    setParentEmail('');
    setStudentEmail('');
    setPreviousStudentEmail('');
  };

  const handleEdit = (student: Student) => {
    setEditingId(student.id);
    setNom(student.nom);
    setPrenoms(student.prenoms);
    setAge(student.age);
    setSexe(student.sexe);
    setCycle(student.cycle === 'Lycée' ? 'Lycée' : 'Collège');
    setClasse(student.classe);
    setMatricule(student.matricule);
    setGuardianName(student.guardianName ?? '');
    setGuardianPhone(student.guardianPhone ?? '');
    setParentEmail(student.parentEmail ?? '');
    setStudentEmail(student.studentEmail ?? '');
    setPreviousStudentEmail(student.studentEmail ?? '');
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [pendingDeleteStudent, setPendingDeleteStudent] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDeleteStudent = async () => {
    if (!pendingDeleteStudent) return;
    setDeletingStudent(true);
    setDeleteError(null);
    setFeedback(null);
    try {
      await deleteStudentById(pendingDeleteStudent.id, {
        ownerUid: uid,
        schoolId,
        studentEmail: pendingDeleteStudent.studentEmail,
      });
      setFeedback({
        type: 'success',
        text: `Élève ${pendingDeleteStudent.nom} ${pendingDeleteStudent.prenoms} supprimé.`,
      });
      setPendingDeleteStudent(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Erreur lors de la suppression.'
      );
    } finally {
      setDeletingStudent(false);
    }
  };

  const getTeacherEmailsForClass = (clsName: string): string[] => {
    return classrooms.find((c) => c.name === clsName)?.teacherEmails ?? [];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nom.trim() || !prenoms.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez saisir le nom et les prénoms de l’élève.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const teacherEmails = getTeacherEmailsForClass(classe);
      if (editingId) {
        await updateStudent(editingId, {
          ownerUid: uid,
          schoolId,
          matricule: matricule || getNextMatricule(students),
          nom,
          prenoms,
          sexe,
          age,
          cycle,
          classe,
          guardianName,
          guardianPhone,
          parentEmail,
          studentEmail,
          previousStudentEmail,
          teacherEmails,
          status: 'actif',
        });
        setFeedback({ type: 'success', text: `Dossier de ${nom.toUpperCase()} ${prenoms} mis à jour.` });
        resetForm(0);
      } else {
        await createStudent(uid, schoolId, {
          matricule: matricule || getNextMatricule(students),
          nom,
          prenoms,
          sexe,
          age,
          cycle,
          classe,
          guardianName,
          guardianPhone,
          parentEmail,
          studentEmail,
          teacherEmails,
        });
        setFeedback({
          type: 'success',
          text: `${nom.toUpperCase()} ${prenoms} inscrit(e) en ${classe} et ajouté(e) à la liste.`,
        });
        resetForm(1);
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : "Erreur lors de l'inscription.",
      });
    } finally {
      setSaving(false);
    }
  };

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return [...students]
      .sort((a, b) => a.nom.localeCompare(b.nom))
      .filter((s) => {
        if (!term) return true;
        return (
          s.nom.toLowerCase().includes(term) ||
          s.prenoms.toLowerCase().includes(term) ||
          s.classe.toLowerCase().includes(term) ||
          s.matricule.toLowerCase().includes(term)
        );
      });
  }, [students, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 border border-zinc-200 hover:border-violet-300 text-sm font-semibold text-zinc-700 hover:text-violet-700 transition-colors whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <h1 className="text-lg sm:text-xl font-bold text-zinc-900 hidden sm:block">
          {editingId ? 'Modifier une inscription' : 'Nouvelle inscription'}
        </h1>

        <button
          type="submit"
          form="inscription-form"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <Check className="w-4 h-4" />
          <span>{saving ? 'Enregistrement...' : editingId ? 'Mettre à jour' : 'Entrer'}</span>
        </button>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3.5 rounded-xl border text-sm font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.text}
        </motion.div>
      )}

      <motion.form
        id="inscription-form"
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="bg-violet-50/90 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs"
      >
        <div className="bg-gradient-to-r from-violet-900 via-violet-800 to-indigo-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white text-violet-800 flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Fiche d'identification de l'élève</h2>
              <p className="text-xs text-violet-200">
                Choisissez la division (ex: 6ème A, 6ème B) et liez l’email parent pour les notifications.
              </p>
            </div>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={() => resetForm(0)}
              className="text-xs font-semibold text-white bg-white/15 px-3 py-1.5 rounded-lg hover:bg-white/25"
            >
              Annuler la modification
            </button>
          )}
        </div>

        <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Nom *</label>
            <input
              type="text"
              required
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ex : ADJAHO"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm uppercase transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Prénoms *</label>
            <input
              type="text"
              required
              value={prenoms}
              onChange={(e) => setPrenoms(e.target.value)}
              placeholder="Ex : Koffi Emmanuel"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
            />
          </div>

          <div className="bg-[#FAF9FE] border border-violet-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-700">Âge (Slidebar) *</label>
              <span className="text-sm font-bold text-violet-700 font-mono-nums">
                {age} ans
              </span>
            </div>
            <input
              type="range"
              min={4}
              max={25}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
              className="w-full violet-slider cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-zinc-400 font-mono-nums mt-1.5">
              <span>4 ans</span>
              <span>12 ans</span>
              <span>18 ans</span>
              <span>25 ans</span>
            </div>
          </div>

          <div className="bg-[#FAF9FE] border border-violet-100 rounded-xl p-4 flex flex-col justify-between">
            <label className="block text-xs font-semibold text-zinc-700 mb-2">Sexe *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSexe('M')}
                className={`py-2.5 px-4 rounded-xl text-sm font-semibold border transition-all ${
                  sexe === 'M'
                    ? 'bg-violet-700 text-white border-violet-700'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                }`}
              >
                Masculin (M)
              </button>
              <button
                type="button"
                onClick={() => setSexe('F')}
                className={`py-2.5 px-4 rounded-xl text-sm font-semibold border transition-all ${
                  sexe === 'F'
                    ? 'bg-violet-700 text-white border-violet-700'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                }`}
              >
                Féminin (F)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Cycle scolaire *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['Collège', 'Lycée'] as CycleType[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCycleChange(c)}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${
                    cycle === c
                      ? 'bg-violet-700 text-white border-violet-700'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Classe / Division *</label>
            <select
              value={classe}
              onChange={(e) => setClasse(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 bg-white focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-medium transition-all"
            >
              {classesByCycle[cycle].map((cl) => (
                <option key={cl.name} value={cl.name}>
                  {cl.name} — {cl.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Matricule *</label>
            <input
              type="text"
              required
              value={matricule}
              onChange={(e) => {
                setMatriculeTouched(true);
                setMatricule(e.target.value);
              }}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-mono-nums transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Nom du tuteur</label>
              <input
                type="text"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Parent / Tuteur"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Téléphone</label>
              <input
                type="text"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
                placeholder="+228 ..."
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-mono-nums transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              E-mail du parent (Gmail, Yahoo, Outlook, iCloud… · Espace Parent & notifications)
            </label>
            <input
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="parent@exemple.com"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              E-mail de l'élève (optionnel · bloque son accès Enseignant ici)
            </label>
            <input
              type="email"
              value={studentEmail}
              onChange={(e) => setStudentEmail(e.target.value)}
              placeholder="eleve@exemple.com"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
            />
          </div>
        </div>
      </motion.form>

      <div className="bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-violet-200 bg-violet-100/75 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-violet-950">
              Registre général des élèves ({filteredStudents.length})
            </h3>
            <p className="text-xs text-violet-700">
              Trié automatiquement par ordre alphabétique
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher nom, classe, matricule..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 text-xs focus:border-violet-600 outline-none"
            />
          </div>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            Aucun élève enregistré pour le moment. Utilisez le formulaire ci-dessus pour inscrire un élève.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Matricule</th>
                  <th className="py-3 px-4">Nom</th>
                  <th className="py-3 px-4">Prénoms</th>
                  <th className="py-3 px-4">Sexe</th>
                  <th className="py-3 px-4 text-right">Âge</th>
                  <th className="py-3 px-4">Classe</th>
                  <th className="py-3 px-4">Tuteur & Email</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm">
                {filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-violet-50/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono-nums text-xs text-zinc-500">{s.matricule}</td>
                    <td className="py-2.5 px-4 font-semibold text-zinc-900">{s.nom}</td>
                    <td className="py-2.5 px-4 text-zinc-700">{s.prenoms}</td>
                    <td className="py-2.5 px-4 text-zinc-600 font-mono-nums">{s.sexe}</td>
                    <td className="py-2.5 px-4 text-right font-mono-nums text-zinc-600">{s.age}</td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => onSelectClass(s.classe)}
                        className="text-xs font-semibold text-violet-700 hover:underline"
                      >
                        {s.classe}
                      </button>
                      <span className="text-xs text-zinc-400"> · {s.cycle}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-zinc-500">
                      <div>
                        {s.guardianName || '—'}
                        {s.guardianPhone ? ` · ${s.guardianPhone}` : ''}
                      </div>
                      {s.parentEmail && (
                        <div className="text-[11px] text-violet-700">Parent : {s.parentEmail}</div>
                      )}
                      {s.studentEmail && (
                        <div className="text-[11px] text-amber-700">Élève (verrouillé Prof) : {s.studentEmail}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(s)}
                          title="Modifier"
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDeleteStudent(s);
                          }}
                          title="Supprimer cet élève"
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(pendingDeleteStudent)}
        title="Confirmer la suppression de l’élève ?"
        description={
          pendingDeleteStudent
            ? `Voulez-vous vraiment supprimer la fiche de ${pendingDeleteStudent.nom} ${pendingDeleteStudent.prenoms} (${pendingDeleteStudent.classe} · ${pendingDeleteStudent.matricule}) ? Ses notes et remarques associées seront également nettoyées.`
            : ''
        }
        confirmLabel="Supprimer l’élève"
        tone="danger"
        loading={deletingStudent}
        error={deleteError}
        onCancel={() => !deletingStudent && setPendingDeleteStudent(null)}
        onConfirm={handleConfirmDeleteStudent}
      />
    </div>
  );
}

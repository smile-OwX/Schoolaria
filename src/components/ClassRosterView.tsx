import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  MoreHorizontal,
  Printer,
  Download,
  ArrowUpDown,
  Camera,
  BookOpen,
  FileText,
  Save,
  Plus,
  Trash2,
  X,
  Search,
  CheckCircle2,
  BellRing,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import {
  Classroom,
  GradeRecord,
  SchoolProfile,
  Student,
  Subject,
  computeMoyClasse,
  computeMoyMatiere,
  getAutoAppreciation,
  getClassroomTheme,
  getCycleForClass,
  getEffectiveSubjectsForClass,
} from '../types/school.ts';
import {
  createNotification,
  createStudent,
  createSubject,
  deleteSubjectById,
  upsertGrade,
} from '../lib/schoolService.ts';
import { getAuthHeaders } from '../lib/firebase.ts';
import { apiFetch } from '../lib/apiClient.ts';

function csvSafeCell(value: unknown): string {
  const raw = String(value ?? '');
  const trimmedStart = raw.replace(/^[\uFEFF\s]+/, '');
  const safe = /^[=+\-@\t\r]/.test(trimmedStart) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

interface ClassRosterViewProps {
  ownerUid: string;
  actorEmail: string;
  actorName: string;
  canManageSchool?: boolean;
  school: SchoolProfile;
  classe: string;
  classroom?: Classroom;
  classrooms: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  onBack: () => void;
  onOpenBulletin: (studentId: string, trimester: 1 | 2 | 3) => void;
}

interface DraftScore {
  int1: string;
  int2: string;
  devoir: string;
  compo: string;
  appreciation: string;
}

export function ClassRosterView({
  ownerUid,
  actorEmail,
  actorName,
  canManageSchool = true,
  school,
  classe,
  classroom,
  classrooms,
  students,
  subjects,
  grades,
  onBack,
  onOpenBulletin,
}: ClassRosterViewProps) {
  const cycle = getCycleForClass(classe, classrooms);
  const theme = getClassroomTheme(classe, classroom);
  const cycleSubjects = useMemo(
    () =>
      getEffectiveSubjectsForClass(
        classe,
        subjects,
        classroom,
        grades.filter((g) => g.classe === classe)
      ),
    [classe, subjects, classroom, grades]
  );

  const [trimester, setTrimester] = useState<1 | 2 | 3>(1);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    () => cycleSubjects[0]?.id ?? ''
  );
  const [sortMode, setSortMode] = useState<'alpha' | 'rank'>('alpha');
  const [searchTerm, setSearchTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftScore>>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [notifyingStudentId, setNotifyingStudentId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showSubjectsModal, setShowSubjectsModal] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubCoef, setNewSubCoef] = useState(2);
  const [newSubTeacher, setNewSubTeacher] = useState('');

  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    summary: string;
    students: Array<{
      nom: string;
      prenoms: string;
      sexe?: string;
      age?: number | null;
      int1?: number | null;
      int2?: number | null;
      devoir?: number | null;
      compo?: number | null;
    }>;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [importingScan, setImportingScan] = useState(false);

  const activeSubject = useMemo(
    () => cycleSubjects.find((s) => s.id === selectedSubjectId) ?? cycleSubjects[0] ?? null,
    [cycleSubjects, selectedSubjectId]
  );

  // Sync selected subject when switching between cycles (e.g., Collège -> Lycée)
  useEffect(() => {
    if (cycleSubjects.length > 0 && !cycleSubjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(cycleSubjects[0].id);
    }
  }, [cycleSubjects, selectedSubjectId]);

  // Prevent stale unsaved draft notes from bleeding across trimesters, subjects, or classes
  useEffect(() => {
    setDrafts({});
    setErrorMsg(null);
  }, [classe, trimester, activeSubject?.id]);

  const classStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return students
      .filter((s) => s.classe === classe && s.status === 'actif')
      .filter((s) => {
        if (!q) return true;
        return (
          s.nom.toLowerCase().includes(q) ||
          s.prenoms.toLowerCase().includes(q) ||
          s.matricule.toLowerCase().includes(q)
        );
      });
  }, [students, classe, searchTerm]);

  const gradeByStudent = useMemo(() => {
    const map: Record<string, GradeRecord> = {};
    if (!activeSubject) return map;
    for (const g of grades) {
      if (g.subjectId === activeSubject.id && g.trimester === trimester) {
        map[g.studentId] = g;
      }
    }
    return map;
  }, [grades, activeSubject, trimester]);

  const sortedStudents = useMemo(() => {
    const list = [...classStudents];
    if (sortMode === 'alpha') {
      list.sort((a, b) => a.nom.localeCompare(b.nom) || a.prenoms.localeCompare(b.prenoms));
    } else {
      list.sort((a, b) => {
        const avgA = gradeByStudent[a.id] ? computeMoyMatiere(gradeByStudent[a.id]) ?? -1 : -1;
        const avgB = gradeByStudent[b.id] ? computeMoyMatiere(gradeByStudent[b.id]) ?? -1 : -1;
        return avgB - avgA;
      });
    }
    return list;
  }, [classStudents, sortMode, gradeByStudent]);

  const getFieldVal = (studentId: string, field: keyof DraftScore): string => {
    const draft = drafts[studentId];
    if (draft) return draft[field];
    const g = gradeByStudent[studentId];
    if (!g) return '';
    if (field === 'appreciation') return g.appreciation ?? '';
    const num = g[field];
    return num !== null && num !== undefined ? String(num) : '';
  };

  const handleDraftChange = (studentId: string, field: keyof DraftScore, value: string) => {
    const existing = drafts[studentId] ?? {
      int1: getFieldVal(studentId, 'int1'),
      int2: getFieldVal(studentId, 'int2'),
      devoir: getFieldVal(studentId, 'devoir'),
      compo: getFieldVal(studentId, 'compo'),
      appreciation: getFieldVal(studentId, 'appreciation'),
    };
    setDrafts((prev) => ({
      ...prev,
      [studentId]: { ...existing, [field]: value },
    }));
  };

  const parseScoreInput = (raw: string): number | null => {
    const clean = raw.trim().replace(',', '.');
    if (clean === '') return null;
    const n = Number(clean);
    if (Number.isNaN(n)) return null;
    return Math.min(20, Math.max(0, n));
  };

  const handleSaveRow = async (student: Student) => {
    if (!activeSubject) return;
    setSavingStudentId(student.id);
    setErrorMsg(null);
    try {
      const int1 = parseScoreInput(getFieldVal(student.id, 'int1'));
      const int2 = parseScoreInput(getFieldVal(student.id, 'int2'));
      const devoir = parseScoreInput(getFieldVal(student.id, 'devoir'));
      const compo = parseScoreInput(getFieldVal(student.id, 'compo'));
      const moy = computeMoyMatiere({ int1, int2, devoir, compo });
      const customApp = getFieldVal(student.id, 'appreciation').trim();
      const appreciation = customApp || getAutoAppreciation(moy);

      await upsertGrade(
        ownerUid,
        school.id,
        gradeByStudent[student.id],
        {
          studentId: student.id,
          classe,
          subjectId: activeSubject.id,
          subjectName: activeSubject.name,
          coef: activeSubject.coef,
          trimester,
          int1,
          int2,
          devoir,
          compo,
          appreciation,
          parentEmail: student.parentEmail,
          teacherEmails: student.teacherEmails ?? classroom?.teacherEmails ?? [],
        },
        {
          email: actorEmail,
          name: actorName,
          studentName: `${student.nom} ${student.prenoms}`,
          moyMat: moy,
        }
      );

      setDrafts((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      setStatusMsg(
        student.parentEmail
          ? `Notes enregistrées pour ${student.nom} ${student.prenoms} et notification envoyée au parent.`
          : `Notes enregistrées pour ${student.nom} ${student.prenoms}.`
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde des notes.');
    } finally {
      setSavingStudentId(null);
    }
  };

  const handleNotifyAbsence = async (student: Student) => {
    setNotifyingStudentId(student.id);
    setErrorMsg(null);
    try {
      // Targeted privacy-safe audience: ONLY the student's parent + assigned class teachers + sender
      const audience = Array.from(
        new Set(
          [
            student.parentEmail ?? '',
            ...(classroom?.teacherEmails ?? []),
            actorEmail,
          ].filter(Boolean)
        )
      );
      await createNotification(ownerUid, school.id, {
        type: 'absence',
        title: `Absence signalée · ${student.nom} ${student.prenoms} (${classe})`,
        message: `L'élève ${student.nom} ${student.prenoms} a été noté(e) absent(e) au cours de ${activeSubject?.name ?? 'classe'} ce jour.`,
        targetClasse: classe,
        studentId: student.id,
        audienceEmails: audience,
        createdByEmail: actorEmail,
        createdByName: actorName,
      });
      setStatusMsg(`Alerte d'absence envoyée pour ${student.nom} ${student.prenoms}.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'envoi de la notification.");
    } finally {
      setNotifyingStudentId(null);
    }
  };

  const handleSaveAllModified = async () => {
    const modifiedIds = Object.keys(drafts);
    if (modifiedIds.length === 0) return;
    for (const sid of modifiedIds) {
      const stu = classStudents.find((s) => s.id === sid);
      if (stu) await handleSaveRow(stu);
    }
    setStatusMsg(`${modifiedIds.length} ligne(s) sauvegardée(s) avec succès.`);
  };

  const handleExportCsv = () => {
    const headers = ['No', 'Matricule', 'Nom', 'Prenoms', 'Sexe', 'Int1', 'Int2', 'Devoir', 'MoyClasse', 'Compo', 'MoyMatiere', 'Appreciation'];
    const rows = sortedStudents.map((s, idx) => {
      const g = gradeByStudent[s.id];
      const int1 = parseScoreInput(getFieldVal(s.id, 'int1'));
      const int2 = parseScoreInput(getFieldVal(s.id, 'int2'));
      const devoir = parseScoreInput(getFieldVal(s.id, 'devoir'));
      const compo = parseScoreInput(getFieldVal(s.id, 'compo'));
      const moyCl = computeMoyClasse({ int1, int2, devoir });
      const moyMat = computeMoyMatiere({ int1, int2, devoir, compo });
      return [
        csvSafeCell(idx + 1),
        csvSafeCell(s.matricule),
        csvSafeCell(s.nom),
        csvSafeCell(s.prenoms),
        csvSafeCell(s.sexe),
        csvSafeCell(int1 ?? ''),
        csvSafeCell(int2 ?? ''),
        csvSafeCell(devoir ?? ''),
        csvSafeCell(moyCl ?? ''),
        csvSafeCell(compo ?? ''),
        csvSafeCell(moyMat ?? ''),
        csvSafeCell(g?.appreciation ?? getAutoAppreciation(moyMat)),
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Liste_${classe}_${activeSubject?.name ?? 'Notes'}_T${trimester}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim() || !canManageSchool) return;
    setErrorMsg(null);
    try {
      await createSubject(ownerUid, school.id, {
        name: newSubName,
        cycle,
        coef: newSubCoef,
        teacherName: newSubTeacher,
        memberEmails: school.memberEmails ?? [],
      });
      setNewSubName('');
      setNewSubTeacher('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'ajout de la matière.");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canManageSchool) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);

    try {
      const prepared = await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const img = new Image();
          img.onload = () => {
            try {
              const maxSide = 1600;
              const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
              const w = Math.max(1, Math.round(img.width * scale));
              const h = Math.max(1, Math.round(img.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve({
                  base64: dataUrl.split(',')[1] || '',
                  mimeType: file.type || 'image/jpeg',
                });
                return;
              }
              ctx.drawImage(img, 0, 0, w, h);
              const compressed = canvas.toDataURL('image/jpeg', 0.86);
              resolve({
                base64: compressed.split(',')[1] || '',
                mimeType: 'image/jpeg',
              });
            } catch {
              resolve({
                base64: dataUrl.split(',')[1] || '',
                mimeType: file.type || 'image/jpeg',
              });
            }
          };
          img.onerror = () => {
            resolve({
              base64: dataUrl.split(',')[1] || '',
              mimeType: file.type || 'image/jpeg',
            });
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });

      const sendScan = async (forceRefresh: boolean) => {
        const headers = await getAuthHeaders(forceRefresh);
        return apiFetch('/api/ai/analyze-sheet', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            imageBase64: prepared.base64,
            mimeType: prepared.mimeType,
            targetClasse: classe,
          }),
        });
      };

      let res = await sendScan(false);
      if (res.status === 401) {
        res = await sendScan(true);
      }

      const raw = await res.text();
      let data: { error?: string; summary?: string; students?: [] } = {};
      try {
        data = JSON.parse(raw);
      } catch {
        if (!res.ok) throw new Error(`Erreur serveur (${res.status}).`);
      }
      if (!res.ok) throw new Error(data.error || "Erreur d'analyse.");
      setScanResult({
        summary: data.summary || '',
        students: Array.isArray(data.students) ? data.students : [],
      });
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Échec de numérisation.');
    } finally {
      setScanning(false);
    }
  };

  const handleImportScannedStudents = async () => {
    if (!scanResult?.students?.length || !canManageSchool) return;
    setImportingScan(true);
    setScanError(null);
    try {
      let count = 0;
      for (const item of scanResult.students) {
        if (!item.nom) continue;
        const matricule = `SCH-26-${String(students.length + count + 1).padStart(3, '0')}`;
        const studentId = await createStudent(ownerUid, school.id, {
          matricule,
          nom: item.nom,
          prenoms: item.prenoms || 'Élève',
          sexe: item.sexe === 'F' ? 'F' : 'M',
          age: typeof item.age === 'number' && item.age >= 3 && item.age <= 30 ? item.age : 12,
          cycle,
          classe,
          teacherEmails: classroom?.teacherEmails ?? [],
        });

        if (
          activeSubject &&
          (item.int1 != null || item.int2 != null || item.devoir != null || item.compo != null)
        ) {
          await upsertGrade(ownerUid, school.id, undefined, {
            studentId,
            classe,
            subjectId: activeSubject.id,
            subjectName: activeSubject.name,
            coef: activeSubject.coef,
            trimester,
            int1: item.int1 ?? null,
            int2: item.int2 ?? null,
            devoir: item.devoir ?? null,
            compo: item.compo ?? null,
            teacherEmails: classroom?.teacherEmails ?? [],
          });
        }
        count++;
      }
      setStatusMsg(`${count} élève(s) importé(s) depuis la fiche numérisée.`);
      setShowScannerModal(false);
      setScanResult(null);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Erreur lors de l'importation.");
    } finally {
      setImportingScan(false);
    }
  };

  const modifiedCount = Object.keys(drafts).length;

  return (
    <div className="space-y-5">
      {/* Personalized Classroom Banner (especially distinct for Lycée classes) */}
      <div
        className={`no-print relative overflow-hidden rounded-2xl bg-gradient-to-r ${theme.gradientClass} text-white p-5 sm:p-6 shadow-sm`}
      >
        <div
          aria-hidden="true"
          className="absolute right-4 top-2 flex items-center gap-4 text-3xl sm:text-5xl font-bold opacity-15 select-none pointer-events-none"
        >
          {theme.symbols.map((sym, i) => (
            <span key={i}>{sym}</span>
          ))}
        </div>

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Classes
            </button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{classe}</h1>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/90 bg-white/15 px-2.5 py-0.5 rounded-lg">
                  <Sparkles className="w-3 h-3" />
                  {theme.badgeLabel}
                </span>
              </div>
              <p className="text-xs text-white/85 mt-1">
                {theme.series ? `${theme.series} · ` : `${cycle} · `}
                {theme.slogan}
                {classroom?.room ? ` · Salle ${classroom.room}` : ''}
                {classroom?.headTeacher ? ` · PP : ${classroom.headTeacher}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 relative shrink-0">
            {modifiedCount > 0 && (
              <button
                type="button"
                onClick={handleSaveAllModified}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                Tout enregistrer ({modifiedCount})
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimer PDF
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu options classe"
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-11 w-60 bg-white border border-zinc-200 rounded-xl shadow-lg py-1.5 z-30 text-xs text-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setSortMode(sortMode === 'alpha' ? 'rank' : 'alpha');
                    setMenuOpen(false);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-violet-50 flex items-center gap-2.5 text-zinc-700 font-medium"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-violet-600" />
                  {sortMode === 'alpha' ? 'Trier par Moyenne / Rang' : 'Trier par Nom (A-Z)'}
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full px-4 py-2.5 text-left hover:bg-violet-50 flex items-center gap-2.5 text-zinc-700 font-medium"
                >
                  <Download className="w-3.5 h-3.5 text-violet-600" />
                  Exporter liste (CSV / Excel)
                </button>
                {canManageSchool && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSubjectsModal(true);
                        setMenuOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-violet-50 flex items-center gap-2.5 text-zinc-700 font-medium"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-violet-600" />
                      Gérer les matières ({cycle})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowScannerModal(true);
                        setMenuOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-violet-50 flex items-center gap-2.5 text-zinc-700 font-medium"
                    >
                      <Camera className="w-3.5 h-3.5 text-violet-600" />
                      Numériser fiche papier (IA)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="no-print bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 rounded-full bg-zinc-100 border border-zinc-200/80">
            {([1, 2, 3] as const).map((t) => {
              const active = trimester === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTrimester(t)}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                    active ? 'text-violet-800' : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="roster-trimester-pill"
                      transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-white shadow-xs"
                    />
                  )}
                  <span className="relative z-10">Trimestre {t}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-zinc-600">Matière :</label>
            <select
              value={activeSubject?.id ?? ''}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 focus:border-violet-600 outline-none"
            >
              {cycleSubjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name} (Coef {sub.coef})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative w-full lg:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrer dans la classe..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-zinc-200 text-xs focus:border-violet-600 outline-none"
          />
        </div>
      </div>

      {statusMsg && (
        <div className="no-print px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {statusMsg}
          </span>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-emerald-700 hover:underline">
            Fermer
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="no-print px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {errorMsg}
          </span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-rose-700 hover:underline">
            Fermer
          </button>
        </div>
      )}

      {/* Printable Roster & Grade Sheet */}
      <div className="print-only-container bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4 bg-[#FAF9FE]">
          <div>
            <p className="text-xs font-semibold text-violet-700">{school.schoolName} · {school.academicYear}</p>
            <h2 className="text-base font-bold text-zinc-900">
              Liste & Relevé de notes — Classe de {classe} · Trimestre {trimester}
            </h2>
          </div>
          <div className="text-xs text-zinc-600 font-mono-nums">
            Matière : <strong>{activeSubject?.name ?? '—'}</strong> (Coef {activeSubject?.coef ?? 1}) · Effectif : <strong>{sortedStudents.length}</strong>
          </div>
        </div>

        {sortedStudents.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">
            Aucun élève inscrit en <strong>{classe}</strong> pour le moment. Rendez-vous dans le module <strong>Inscription</strong> ou importez une fiche photo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-bold text-zinc-600 uppercase tracking-wider">
                  <th className="py-3 px-3 text-center w-10">N°</th>
                  <th className="py-3 px-3">Nom</th>
                  <th className="py-3 px-3">Prénoms</th>
                  <th className="py-3 px-2 text-center">Sexe</th>
                  <th className="py-3 px-2 text-center">Int. 1</th>
                  <th className="py-3 px-2 text-center">Int. 2</th>
                  <th className="py-3 px-2 text-center">Devoir</th>
                  <th className="py-3 px-2 text-center bg-violet-50/50 text-violet-900">Moy. Cl.</th>
                  <th className="py-3 px-2 text-center">Compo</th>
                  <th className="py-3 px-2 text-center bg-violet-50 text-violet-900">Moy. /20</th>
                  <th className="py-3 px-3">Appréciation</th>
                  <th className="no-print py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {sortedStudents.map((student, index) => {
                  const int1 = parseScoreInput(getFieldVal(student.id, 'int1'));
                  const int2 = parseScoreInput(getFieldVal(student.id, 'int2'));
                  const devoir = parseScoreInput(getFieldVal(student.id, 'devoir'));
                  const compo = parseScoreInput(getFieldVal(student.id, 'compo'));
                  const moyCl = computeMoyClasse({ int1, int2, devoir });
                  const moyMat = computeMoyMatiere({ int1, int2, devoir, compo });
                  const isDirty = Boolean(drafts[student.id]);

                  return (
                    <tr key={student.id} className="hover:bg-violet-50/25 transition-colors">
                      <td className="py-2 px-3 text-center font-mono-nums text-zinc-400">{index + 1}</td>
                      <td className="py-2 px-3 font-bold text-zinc-900">{student.nom}</td>
                      <td className="py-2 px-3 text-zinc-700">{student.prenoms}</td>
                      <td className="py-2 px-2 text-center font-mono-nums text-zinc-600">{student.sexe}</td>

                      {(['int1', 'int2', 'devoir'] as const).map((field) => (
                        <td key={field} className="py-1.5 px-1.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            step={0.25}
                            value={getFieldVal(student.id, field)}
                            onChange={(e) => handleDraftChange(student.id, field, e.target.value)}
                            placeholder="—"
                            className="w-14 text-center py-1 px-1 rounded-lg border border-zinc-200 focus:border-violet-600 focus:bg-white bg-zinc-50/50 font-mono-nums outline-none"
                          />
                        </td>
                      ))}

                      <td className="py-2 px-2 text-center font-mono-nums font-semibold text-violet-800 bg-violet-50/30">
                        {moyCl !== null ? moyCl.toFixed(2) : '—'}
                      </td>

                      <td className="py-1.5 px-1.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={20}
                          step={0.25}
                          value={getFieldVal(student.id, 'compo')}
                          onChange={(e) => handleDraftChange(student.id, 'compo', e.target.value)}
                          placeholder="—"
                          className="w-14 text-center py-1 px-1 rounded-lg border border-zinc-200 focus:border-violet-600 focus:bg-white bg-zinc-50/50 font-mono-nums outline-none"
                        />
                      </td>

                      <td
                        className={`py-2 px-2 text-center font-mono-nums font-bold bg-violet-50/50 ${
                          moyMat === null
                            ? 'text-zinc-400'
                            : moyMat >= 10
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                        }`}
                      >
                        {moyMat !== null ? moyMat.toFixed(2) : '—'}
                      </td>

                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={getFieldVal(student.id, 'appreciation')}
                          onChange={(e) => handleDraftChange(student.id, 'appreciation', e.target.value)}
                          placeholder={getAutoAppreciation(moyMat)}
                          className="w-32 py-1 px-2 rounded-lg border border-transparent hover:border-zinc-200 focus:border-violet-600 bg-transparent focus:bg-white outline-none text-zinc-700"
                        />
                      </td>

                      <td className="no-print py-2 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveRow(student)}
                            disabled={savingStudentId === student.id}
                            title="Enregistrer les notes"
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                              isDirty
                                ? 'bg-violet-700 text-white hover:bg-violet-800'
                                : 'bg-zinc-100 text-zinc-600 hover:bg-violet-100 hover:text-violet-700'
                            }`}
                          >
                            {savingStudentId === student.id ? '...' : 'Sauver'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleNotifyAbsence(student)}
                            disabled={notifyingStudentId === student.id}
                            title="Signaler une absence et notifier le parent"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-semibold transition-colors"
                          >
                            <BellRing className="w-3 h-3" />
                            Abs
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenBulletin(student.id, trimester)}
                            title="Voir le bulletin"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-[11px] font-semibold transition-colors"
                          >
                            <FileText className="w-3 h-3" />
                            Bulletin
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Subject Manager */}
      {showSubjectsModal && (
        <div className="fixed inset-0 z-40 bg-zinc-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-zinc-200 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  Matières de {classe} ({cycle})
                </h3>
                <p className="text-[11px] text-violet-700 mt-0.5">
                  Les coefficients officiels du Togo s'appliquent automatiquement selon la classe et la série.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubjectsModal(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubject} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                required
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="Nom de la matière"
                className="sm:col-span-6 px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
              />
              <input
                type="number"
                min={1}
                max={10}
                value={newSubCoef}
                onChange={(e) => setNewSubCoef(Number(e.target.value))}
                placeholder="Coef"
                className="sm:col-span-2 px-3 py-2 rounded-xl border border-zinc-200 text-xs font-mono-nums outline-none focus:border-violet-600"
              />
              <input
                type="text"
                value={newSubTeacher}
                onChange={(e) => setNewSubTeacher(e.target.value)}
                placeholder="Professeur"
                className="sm:col-span-4 px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
              />
              <button
                type="submit"
                className="sm:col-span-12 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter la matière
              </button>
            </form>

            <div className="max-h-60 overflow-y-auto divide-y divide-zinc-100 border border-zinc-100 rounded-xl">
              {cycleSubjects.map((sub) => (
                <div key={sub.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-zinc-900">{sub.name}</span>
                    <span className="text-zinc-500"> · Coef {sub.coef}</span>
                    {sub.teacherName && <span className="text-zinc-400"> · {sub.teacherName}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setErrorMsg(null);
                      try {
                        await deleteSubjectById(sub.id);
                      } catch (err) {
                        setErrorMsg(
                          err instanceof Error ? err.message : 'Impossible de supprimer la matière.'
                        );
                      }
                    }}
                    className="p-1 text-zinc-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Photo Sheet Scanner */}
      {showScannerModal && (
        <div className="fixed inset-0 z-40 bg-zinc-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 border border-zinc-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  Numériser une fiche papier ({classe})
                </h3>
                <p className="text-xs text-zinc-500">
                  Importez une photo de liste d'élèves ou de feuille de notes manuscrite.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScannerModal(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block border-2 border-dashed border-violet-200 hover:border-violet-400 rounded-xl p-6 text-center cursor-pointer bg-violet-50/30 transition-colors">
              <Camera className="w-7 h-7 text-violet-600 mx-auto mb-2" />
              <span className="text-xs font-semibold text-violet-800 block">
                {scanning ? 'Analyse de l’image en cours...' : 'Choisir une photo (JPG / PNG)'}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={scanning}
                className="hidden"
              />
            </label>

            {scanError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {scanError}
              </div>
            )}

            {scanResult && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-700 font-medium">{scanResult.summary}</p>
                <div className="max-h-48 overflow-y-auto border border-zinc-200 rounded-xl divide-y divide-zinc-100 text-xs">
                  {scanResult.students.map((st, idx) => (
                    <div key={idx} className="px-3 py-2 flex items-center justify-between">
                      <span className="font-semibold text-zinc-900">
                        {st.nom} {st.prenoms}
                      </span>
                      <span className="font-mono-nums text-zinc-500">
                        {st.sexe || 'M'} · Compo: {st.compo ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleImportScannedStudents}
                  disabled={importingScan || scanResult.students.length === 0}
                  className="w-full py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {importingScan
                    ? 'Importation dans la base...'
                    : `Importer ${scanResult.students.length} élève(s) en ${classe}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

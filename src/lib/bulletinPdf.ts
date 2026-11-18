import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BulletinRemark,
  Classroom,
  GradeRecord,
  SchoolProfile,
  Student,
  Subject,
  computeMoyClasse,
  computeMoyMatiere,
  formatRank,
  getAutoAppreciation,
  getEffectiveSubjectsForClass,
  getMentionFromAverage,
} from '../types/school.ts';

export interface ComputedSubjectRow {
  subject: Subject;
  moyCl: number | null;
  compo: number | null;
  moyMat: number | null;
  weighted: number | null;
  rank: number;
  appreciation: string;
}

export interface ComputedStudentBulletin {
  student: Student;
  classroom?: Classroom;
  subjectRows: ComputedSubjectRow[];
  studentAvg: number | null;
  totalWeighted: number;
  totalCoef: number;
  rank: number;
  totalStudents: number;
  classAvg: number | null;
  highestAvg: number | null;
  lowestAvg: number | null;
  absences: number;
  conduite: string;
  decision: string;
  generalRemark: string;
  mention: { label: string; tone: 'emerald' | 'violet' | 'amber' | 'rose' };
}

export function computeStudentGeneralAverage(
  student: Student,
  trimester: 1 | 2 | 3,
  subjects: Subject[],
  grades: GradeRecord[],
  classrooms?: Classroom[]
): { average: number | null; totalWeighted: number; totalCoef: number } {
  const classroom = classrooms?.find((c) => c.name === student.classe);
  const studentGrades = grades.filter(
    (item) => item.studentId === student.id && item.trimester === trimester
  );
  const effectiveSubjects = getEffectiveSubjectsForClass(
    student.classe,
    subjects,
    classroom,
    studentGrades
  );
  let totalWeighted = 0;
  let totalCoef = 0;

  for (const sub of effectiveSubjects) {
    const g = studentGrades.find((item) => item.subjectId === sub.id);
    if (!g) continue;
    const moy = computeMoyMatiere(g);
    if (moy !== null) {
      totalWeighted += moy * sub.coef;
      totalCoef += sub.coef;
    }
  }

  return {
    average: totalCoef > 0 ? Number((totalWeighted / totalCoef).toFixed(2)) : null,
    totalWeighted: Number(totalWeighted.toFixed(2)),
    totalCoef,
  };
}

export function computeClassroomBulletins(params: {
  classroomName: string;
  trimester: 1 | 2 | 3;
  students: Student[];
  classrooms: Classroom[];
  subjects: Subject[];
  grades: GradeRecord[];
  remarks: BulletinRemark[];
}): ComputedStudentBulletin[] {
  const {
    classroomName,
    trimester,
    students,
    classrooms,
    subjects,
    grades,
    remarks,
  } = params;

  const classmates = [...students]
    .filter(
      (s) =>
        s.status === 'actif' &&
        (s.cycle === 'Collège' || s.cycle === 'Lycée') &&
        s.classe === classroomName
    )
    .sort((a, b) => a.nom.localeCompare(b.nom) || a.prenoms.localeCompare(b.prenoms));

  if (classmates.length === 0) return [];

  const classroom = classrooms.find((c) => c.name === classroomName);

  const generalResults = classmates.map((cm) => ({
    id: cm.id,
    ...computeStudentGeneralAverage(cm, trimester, subjects, grades, classrooms),
  }));

  const validAverages = generalResults
    .map((r) => r.average)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);

  const rankedGeneral = [...generalResults]
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));

  const classAvg =
    validAverages.length > 0
      ? Number((validAverages.reduce((a, b) => a + b, 0) / validAverages.length).toFixed(2))
      : null;
  const highestAvg = validAverages.length > 0 ? validAverages[0] : null;
  const lowestAvg = validAverages.length > 0 ? validAverages[validAverages.length - 1] : null;

  // Precompute trimester grades per student in this classroom
  const classmateIds = new Set(classmates.map((c) => c.id));
  const classTrimesterGrades = grades.filter(
    (g) => g.trimester === trimester && classmateIds.has(g.studentId)
  );

  // Subject rank lookup across the class
  const subjectRankMap = new Map<string, Map<string, number>>();

  return classmates.map((student) => {
    const studentTrimesterGrades = classTrimesterGrades.filter((g) => g.studentId === student.id);
    const effectiveSubjects = getEffectiveSubjectsForClass(
      student.classe,
      subjects,
      classroom,
      studentTrimesterGrades
    );

    const subjectRows: ComputedSubjectRow[] = effectiveSubjects.map((sub) => {
      if (!subjectRankMap.has(sub.id)) {
        const scores = classmates
          .map((cm) => {
            const cg = classTrimesterGrades.find(
              (item) => item.studentId === cm.id && item.subjectId === sub.id
            );
            return { id: cm.id, score: cg ? computeMoyMatiere(cg) : null };
          })
          .filter((x): x is { id: string; score: number } => x.score !== null)
          .sort((a, b) => b.score - a.score);

        const rankByStudent = new Map<string, number>();
        scores.forEach((item, idx) => rankByStudent.set(item.id, idx + 1));
        subjectRankMap.set(sub.id, rankByStudent);
      }

      const g = studentTrimesterGrades.find((item) => item.subjectId === sub.id);
      const moyCl = g ? computeMoyClasse(g) : null;
      const compo = g?.compo ?? null;
      const moyMat = g ? computeMoyMatiere(g) : null;
      const weighted = moyMat !== null ? Number((moyMat * sub.coef).toFixed(2)) : null;
      const rank = subjectRankMap.get(sub.id)?.get(student.id) ?? 0;

      return {
        subject: sub,
        moyCl,
        compo,
        moyMat,
        weighted,
        rank,
        appreciation: g?.appreciation || getAutoAppreciation(moyMat),
      };
    });

    const gen = generalResults.find((r) => r.id === student.id);
    const studentAvg = gen?.average ?? null;
    const rankIdx = rankedGeneral.findIndex((r) => r.id === student.id);
    const rank = rankIdx >= 0 ? rankIdx + 1 : 0;
    const mention = getMentionFromAverage(studentAvg);
    const existingRemark = remarks.find(
      (r) => r.studentId === student.id && r.trimester === trimester
    );

    return {
      student,
      classroom,
      subjectRows,
      studentAvg,
      totalWeighted: gen?.totalWeighted ?? 0,
      totalCoef: gen?.totalCoef ?? 0,
      rank,
      totalStudents: classmates.length,
      classAvg,
      highestAvg,
      lowestAvg,
      absences: existingRemark?.absences ?? 0,
      conduite: existingRemark?.conduite ?? 'Bonne',
      decision: existingRemark?.decision || mention.label,
      generalRemark: existingRemark?.generalRemark ?? '',
      mention,
    };
  });
}

function pdfText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u00a0/g, ' ');
}

function safeFileSegment(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function drawSingleBulletinPage(
  doc: jsPDF,
  school: SchoolProfile,
  trimester: 1 | 2 | 3,
  bulletin: ComputedStudentBulletin,
  pageIndex: number,
  totalPages: number
): void {
  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2;
  const { student } = bulletin;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(91, 33, 182);
  doc.text(pdfText(school.schoolName.toUpperCase()), marginX, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(95, 95, 108);
  const subHeaderParts = [
    school.motto || 'Discipline · Travail · Succès',
    school.address,
    school.phone ? `Tél : ${school.phone}` : '',
  ].filter(Boolean);
  doc.text(pdfText(subHeaderParts.join(' · ')), marginX, 20, { maxWidth: 112 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(24, 24, 27);
  doc.text(pdfText(`BULLETIN DE NOTES · TRIMESTRE ${trimester}`), pageWidth - marginX, 15, {
    align: 'right',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(95, 95, 108);
  doc.text(
    pdfText(`Année scolaire : ${school.academicYear}  |  Page ${pageIndex + 1}/${totalPages}`),
    pageWidth - marginX,
    20,
    { align: 'right' }
  );

  // Violet header border
  doc.setDrawColor(109, 40, 217);
  doc.setLineWidth(0.7);
  doc.line(marginX, 24, pageWidth - marginX, 24);

  // Student info box
  doc.setFillColor(250, 249, 254);
  doc.setDrawColor(221, 214, 254);
  doc.setLineWidth(0.35);
  doc.roundedRect(marginX, 27.5, contentWidth, 16.5, 2, 2, 'FD');

  const colW = contentWidth / 4;
  const infoCols = [
    { label: 'Nom & Prénoms', value: `${student.nom} ${student.prenoms}` },
    { label: 'Matricule', value: student.matricule },
    { label: 'Classe · Cycle', value: `${student.classe} (${student.cycle})` },
    { label: 'Sexe · Âge · Effectif', value: `${student.sexe} · ${student.age} ans · ${bulletin.totalStudents} élèves` },
  ];

  infoCols.forEach((col, idx) => {
    const cx = marginX + 3 + idx * colW;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(113, 113, 122);
    doc.text(pdfText(col.label), cx, 32.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(idx === 2 ? 91 : 24, idx === 2 ? 33 : 24, idx === 2 ? 182 : 27);
    doc.text(pdfText(col.value), cx, 38.5, { maxWidth: colW - 5 });
  });

  // Grades table
  const tableRows = bulletin.subjectRows.map((row) => [
    pdfText(row.subject.name),
    String(row.subject.coef),
    row.moyCl !== null ? row.moyCl.toFixed(2) : '-',
    row.compo !== null ? row.compo.toFixed(2) : '-',
    row.moyMat !== null ? row.moyMat.toFixed(2) : '-',
    row.weighted !== null ? row.weighted.toFixed(2) : '-',
    row.rank > 0 ? `${row.rank}e` : '-',
    pdfText(row.appreciation),
  ]);

  autoTable(doc, {
    startY: 47.5,
    margin: { left: marginX, right: marginX },
    head: [['Matière', 'Coef', 'Moy. Cl.', 'Compo', 'Moy. /20', 'Moy×Coef', 'Rang', 'Appréciation']],
    body: tableRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.2,
      cellPadding: { top: 2.1, right: 2.2, bottom: 2.1, left: 2.2 },
      lineColor: [228, 228, 231],
      lineWidth: 0.2,
      textColor: [39, 39, 42],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [91, 33, 182],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold', cellWidth: 42 },
      1: { halign: 'center', cellWidth: 13 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'center', cellWidth: 18 },
      4: { halign: 'center', fontStyle: 'bold', cellWidth: 20 },
      5: { halign: 'center', cellWidth: 21 },
      6: { halign: 'center', cellWidth: 14 },
      7: { halign: 'left' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && (data.column.index === 0 || data.column.index === 7)) {
        data.cell.styles.halign = 'left';
      }
      if (data.section === 'body' && data.column.index === 4) {
        const raw = Number(data.cell.text[0]);
        if (!Number.isNaN(raw)) {
          data.cell.styles.textColor = raw >= 10 ? [4, 120, 87] : [225, 29, 72];
        } else {
          data.cell.styles.textColor = [161, 161, 170];
        }
      }
    },
  });

  const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  let y = (lastTable?.finalY ?? 150) + 6;
  if (y > 228) {
    doc.addPage();
    y = 18;
  }

  // Two summary boxes
  const boxGap = 5;
  const boxWidth = (contentWidth - boxGap) / 2;
  const boxHeight = 42;

  // Left: Bilan Trimestriel
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(212, 212, 216);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginX, y, boxWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(24, 24, 27);
  doc.text('BILAN TRIMESTRIEL', marginX + 4, y + 6.5);

  const summaryRows = [
    ['Total Points / Total Coefs', `${bulletin.totalWeighted.toFixed(2)} / ${bulletin.totalCoef}`],
    [
      'Moyenne Générale',
      bulletin.studentAvg !== null ? `${bulletin.studentAvg.toFixed(2)} / 20` : '-',
    ],
    ['Rang dans la classe', formatRank(bulletin.rank, bulletin.totalStudents)],
    [
      `Classe : Moy ${bulletin.classAvg ?? '-'}`,
      `Max ${bulletin.highestAvg ?? '-'} · Min ${bulletin.lowestAvg ?? '-'}`,
    ],
  ];

  summaryRows.forEach(([label, val], idx) => {
    const ry = y + 14 + idx * 6.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(113, 113, 122);
    doc.text(pdfText(label), marginX + 4, ry);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(idx === 1 ? 10 : 8.5);
    if (idx === 1) doc.setTextColor(91, 33, 182);
    else doc.setTextColor(24, 24, 27);
    doc.text(pdfText(val), marginX + boxWidth - 4, ry, { align: 'right' });
  });

  // Right: Conseil de classe
  const rx = marginX + boxWidth + boxGap;
  doc.setFillColor(250, 249, 254);
  doc.setDrawColor(212, 212, 216);
  doc.roundedRect(rx, y, boxWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(24, 24, 27);
  doc.text('CONSEIL DE CLASSE', rx + 4, y + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(82, 82, 91);
  doc.text(
    pdfText(`Absences : ${bulletin.absences} h   |   Conduite : ${bulletin.conduite || 'Bonne'}`),
    rx + 4,
    y + 13.5
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(91, 33, 182);
  doc.text(pdfText(`Décision : ${bulletin.decision}`), rx + 4, y + 20.5, {
    maxWidth: boxWidth - 8,
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(63, 63, 70);
  const remarkLines = doc.splitTextToSize(
    pdfText(`Appréciation : ${bulletin.generalRemark || '-'}`),
    boxWidth - 8
  );
  doc.text(remarkLines.slice(0, 3), rx + 4, y + 27);

  // Signature Footer
  const sigY = Math.min(272, y + boxHeight + 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(63, 63, 70);
  doc.text('Visa des Parents / Tuteur', marginX, sigY);
  doc.text(pdfText(`Le Directeur · ${school.adminName}`), pageWidth - marginX, sigY, {
    align: 'right',
  });

  doc.setDrawColor(161, 161, 170);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(marginX, sigY + 13, marginX + 62, sigY + 13);
  doc.line(pageWidth - marginX - 62, sigY + 13, pageWidth - marginX, sigY + 13);
  doc.setLineDashPattern([], 0);
}

export function generateBulletinsPdf(params: {
  school: SchoolProfile;
  trimester: 1 | 2 | 3;
  bulletins: ComputedStudentBulletin[];
  filenameLabel: string;
}): string {
  const { school, trimester, bulletins, filenameLabel } = params;
  if (bulletins.length === 0) {
    throw new Error('Aucun bulletin à générer.');
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  bulletins.forEach((bulletin, index) => {
    if (index > 0) {
      doc.addPage();
    }
    drawSingleBulletinPage(doc, school, trimester, bulletin, index, bulletins.length);
  });

  const filename = `Bulletins_${safeFileSegment(filenameLabel)}_T${trimester}.pdf`;
  doc.save(filename);
  return filename;
}

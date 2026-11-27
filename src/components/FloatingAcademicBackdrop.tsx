import { ClassroomMotif } from '../types/school.ts';

interface FloatingAcademicBackdropProps {
  motif?: ClassroomMotif;
}

interface FloatingSymbol {
  text: string;
  top: string;
  left: string;
  size: string;
  delay: string;
  reverse?: boolean;
  tone: string;
}

const SYMBOLS_BY_MOTIF: Record<ClassroomMotif, FloatingSymbol[]> = {
  general: [
    { text: '∑', top: '9%', left: '6%', size: 'text-3xl', delay: '0s', tone: 'text-violet-800/25' },
    { text: 'E = mc²', top: '16%', left: '84%', size: 'text-xl font-mono-nums', delay: '1.5s', reverse: true, tone: 'text-indigo-800/25' },
    { text: 'π', top: '28%', left: '18%', size: 'text-4xl', delay: '3s', tone: 'text-purple-800/20' },
    { text: '∫ f(x)dx', top: '42%', left: '90%', size: 'text-lg font-mono-nums', delay: '2s', reverse: true, tone: 'text-violet-900/25' },
    { text: 'Δ = b² - 4ac', top: '58%', left: '4%', size: 'text-base font-mono-nums', delay: '4s', tone: 'text-indigo-800/25' },
    { text: 'λ', top: '66%', left: '78%', size: 'text-4xl', delay: '1s', reverse: true, tone: 'text-violet-800/25' },
    { text: 'Ω', top: '80%', left: '14%', size: 'text-3xl', delay: '2.5s', tone: 'text-indigo-900/25' },
    { text: 'F = m · a', top: '86%', left: '62%', size: 'text-lg font-mono-nums', delay: '0.5s', reverse: true, tone: 'text-violet-800/25' },
    { text: '√x', top: '22%', left: '52%', size: 'text-2xl', delay: '3.5s', tone: 'text-purple-700/20' },
    { text: '∞', top: '72%', left: '40%', size: 'text-3xl', delay: '4.5s', reverse: true, tone: 'text-indigo-700/20' },
  ],
  'maths-physique': [
    { text: '∫₀^∞ e⁻ˣ dx = 1', top: '10%', left: '8%', size: 'text-lg font-mono-nums', delay: '0s', tone: 'text-indigo-800/30' },
    { text: 'E = h·ν', top: '18%', left: '82%', size: 'text-2xl font-mono-nums', delay: '1s', reverse: true, tone: 'text-violet-800/30' },
    { text: '∇ × B = μ₀J', top: '36%', left: '5%', size: 'text-base font-mono-nums', delay: '2.2s', tone: 'text-sky-800/25' },
    { text: '∑ n²', top: '48%', left: '88%', size: 'text-2xl', delay: '3s', reverse: true, tone: 'text-indigo-800/30' },
    { text: 'e^(iπ) + 1 = 0', top: '68%', left: '10%', size: 'text-lg font-mono-nums', delay: '1.8s', tone: 'text-violet-900/30' },
    { text: 'F = G·m₁m₂/r²', top: '76%', left: '72%', size: 'text-base font-mono-nums', delay: '0.6s', reverse: true, tone: 'text-indigo-800/25' },
    { text: 'Ω · λ · Δ', top: '24%', left: '46%', size: 'text-2xl', delay: '3.6s', tone: 'text-blue-800/20' },
  ],
  'sciences-nat': [
    { text: 'ADN', top: '12%', left: '7%', size: 'text-2xl font-bold', delay: '0s', tone: 'text-emerald-800/25' },
    { text: 'C₆H₁₂O₆ + 6O₂', top: '20%', left: '80%', size: 'text-base font-mono-nums', delay: '1.2s', reverse: true, tone: 'text-teal-800/25' },
    { text: 'ATP → ADP + Pi', top: '44%', left: '84%', size: 'text-base font-mono-nums', delay: '2.5s', tone: 'text-emerald-800/25' },
    { text: 'pH = -log[H₃O⁺]', top: '62%', left: '6%', size: 'text-base font-mono-nums', delay: '3.1s', reverse: true, tone: 'text-violet-800/25' },
    { text: 'ΔG = ΔH - TΔS', top: '80%', left: '70%', size: 'text-lg font-mono-nums', delay: '1.7s', tone: 'text-teal-800/25' },
    { text: 'Σ', top: '30%', left: '22%', size: 'text-3xl', delay: '2.8s', tone: 'text-emerald-700/20' },
  ],
  'lettres-philo': [
    { text: 'Φ', top: '10%', left: '8%', size: 'text-4xl font-serif', delay: '0s', tone: 'text-amber-800/25' },
    { text: '« Cogito, ergo sum »', top: '18%', left: '76%', size: 'text-base italic font-serif', delay: '1.4s', reverse: true, tone: 'text-rose-800/25' },
    { text: 'Ψ', top: '42%', left: '6%', size: 'text-3xl font-serif', delay: '2.6s', tone: 'text-violet-800/25' },
    { text: 'Thèse · Antithèse', top: '56%', left: '82%', size: 'text-base italic font-serif', delay: '3.2s', reverse: true, tone: 'text-amber-900/25' },
    { text: 'Logos · Ethos · Pathos', top: '78%', left: '12%', size: 'text-base italic font-serif', delay: '1.1s', tone: 'text-rose-800/25' },
    { text: 'Λ', top: '72%', left: '74%', size: 'text-4xl font-serif', delay: '2s', reverse: true, tone: 'text-violet-800/25' },
  ],
};

export function FloatingAcademicBackdrop({ motif = 'general' }: FloatingAcademicBackdropProps) {
  const symbols = SYMBOLS_BY_MOTIF[motif] ?? SYMBOLS_BY_MOTIF.general;

  return (
    <div
      aria-hidden="true"
      className="no-print fixed inset-0 pointer-events-none overflow-hidden z-0 select-none"
    >
      {/* Atmospheric school-uniform glows */}
      <div
        className="absolute -top-32 -left-24 w-[38rem] h-[38rem] rounded-full opacity-75 transition-colors duration-700"
        style={{ background: 'radial-gradient(circle, var(--theme-glow-1) 0%, transparent 70%)' }}
      />
      <div
        className="absolute top-1/3 -right-28 w-[34rem] h-[34rem] rounded-full opacity-70 transition-colors duration-700"
        style={{ background: 'radial-gradient(circle, var(--theme-glow-2) 0%, transparent 70%)' }}
      />
      <div
        className="absolute -bottom-36 left-1/3 w-[38rem] h-[30rem] rounded-full opacity-60 transition-colors duration-700"
        style={{ background: 'radial-gradient(circle, var(--theme-glow-1) 0%, transparent 72%)' }}
      />

      {/* Subtle scientific grid line pattern */}
      <div
        className="absolute inset-0 opacity-[0.24]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(var(--theme-dot-rgb), 0.3) 1px, transparent 0)',
          backgroundSize: '30px 30px',
        }}
      />

      {/* Floating Academic Symbols */}
      {symbols.map((sym, index) => (
        <span
          key={`${motif}-${index}`}
          style={{
            top: sym.top,
            left: sym.left,
            animationDelay: sym.delay,
          }}
          className={`absolute font-semibold tracking-tight ${sym.size} ${sym.tone} ${
            sym.reverse ? 'animate-academic-float-reverse' : 'animate-academic-float'
          }`}
        >
          {sym.text}
        </span>
      ))}
    </div>
  );
}

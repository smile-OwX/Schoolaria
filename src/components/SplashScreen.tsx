import { useEffect } from 'react';
import { motion } from 'motion/react';
import { GraduationCap } from 'lucide-react';

interface SplashScreenProps {
  onFinish: () => void;
}

const FLOATING_DOTS = [
  { x: '16%', y: '22%', size: 10, delay: 0 },
  { x: '82%', y: '18%', size: 14, delay: 0.2 },
  { x: '24%', y: '72%', size: 8, delay: 0.4 },
  { x: '76%', y: '74%', size: 12, delay: 0.15 },
  { x: '52%', y: '14%', size: 7, delay: 0.3 },
  { x: '48%', y: '84%', size: 9, delay: 0.25 },
];

export function SplashScreen({ onFinish }: SplashScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onFinish, 1250);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div
      onClick={onFinish}
      className="fixed inset-0 z-50 theme-surface-header flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden"
    >
      {FLOATING_DOTS.map((dot, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: -18, scale: 0.8 }}
          animate={{ opacity: [0.25, 0.7, 0.25], y: [0, 14, 0], scale: 1 }}
          transition={{ duration: 2.2, delay: dot.delay, repeat: Infinity, ease: 'easeInOut' }}
          style={{ left: dot.x, top: dot.y, width: dot.size, height: dot.size }}
          className="absolute rounded-full bg-current opacity-25"
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: -36 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col items-center text-center px-6"
      >
        <div className="w-16 h-16 rounded-2xl theme-nav-active flex items-center justify-center shadow-xl shadow-black/20 mb-5">
          <GraduationCap className="w-8 h-8" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          School<span className="theme-header-subtext">aria</span>
        </h1>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="mt-3 flex items-center justify-center gap-2 text-sm sm:text-base font-semibold tracking-wide theme-header-subtext"
        >
          <span>par (⌐■_■) ·</span>
          <span className="inline-flex items-stretch leading-none select-none">
            <svg
              viewBox="0 0 14 22"
              className="w-3.5 h-[1.35em] theme-header-subtext shrink-0"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 12.5L3.5 12.5L6.4 20.2L11.4 1L14 1"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="border-t-2 border-current pt-[3px] pr-1 pl-[2px] tracking-wider leading-tight">
              i²©τθπ
            </span>
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="mt-8 flex items-center gap-2"
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 0.9, delay: i * 0.16, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-current opacity-80"
            />
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}

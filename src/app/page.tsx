import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-white">
      <div className="glass-card w-full max-w-4xl rounded-3xl p-10 text-center shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">AI + Real-Time Automation</p>
        <h1 className="mt-4 text-4xl font-bold md:text-6xl">Smart Crisis Response & Hospital Automation System</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg text-slate-200">
          Simulate a live hospital where patients, doctors, nurses, reception, and admin teams coordinate during normal
          care and emergencies in real time.
        </p>
        <Link href="/login" className="mt-10 inline-block rounded-full bg-emerald-400 px-10 py-4 text-lg font-semibold text-slate-900 transition hover:scale-105">
          Start System
        </Link>
      </div>
      <div className="pulse-orb left-20 top-24" />
      <div className="pulse-orb right-16 bottom-16" />
    </main>
  );
}

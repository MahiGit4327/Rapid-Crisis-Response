"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role, User } from "@/lib/types";
import { useSocketState } from "@/components/socket-provider";

const roles: Role[] = ["Patient", "Doctor", "Nurse/Staff", "Receptionist", "Admin"];

export default function LoginPage() {
  const { socket, setSession } = useSocketState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("demo123");
  const [role, setRole] = useState<Role>("Patient");
  const [error, setError] = useState("");
  const router = useRouter();

  const onLogin = () => {
    if (!socket) return;
    setError("");
    socket.emit("auth:login", { email, password, role }, (response: { ok: boolean; user?: User; message?: string }) => {
      if (!response.ok || !response.user) {
        setError(response.message || "Login failed");
        return;
      }
      setSession({ user: response.user });
      router.push("/dashboard");
    });
  };

  return (
    <main className="landing-bg flex min-h-screen items-center justify-center px-6">
      <div className="glass-card w-full max-w-lg rounded-3xl p-8 text-white">
        <h1 className="text-3xl font-bold">Hospital Role Login</h1>
        <p className="mt-2 text-slate-200">Use role-matched emails (e.g. doctor1@hospital.com)</p>
        <div className="mt-8 space-y-4">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input-ui" />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            className="input-ui"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input-ui">
            {roles.map((item) => (
              <option key={item} value={item} className="text-black">
                {item}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button onClick={onLogin} className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-slate-900 transition hover:bg-emerald-300">
            Login
          </button>
        </div>
      </div>
    </main>
  );
}

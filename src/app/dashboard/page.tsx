"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSocketState } from "@/components/socket-provider";
import type { Priority, Task, User } from "@/lib/types";

const priorityClass: Record<Priority, string> = { LOW: "border-yellow-300/40 bg-yellow-500/20", MEDIUM: "border-amber-300/40 bg-amber-500/20", CRITICAL: "border-red-500/40 bg-red-500/20" };

export default function DashboardPage() {
  const { socket, session, setSession, state, clearNotifications } = useSocketState();
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTargetId, setChatTargetId] = useState("");
  const [chatText, setChatText] = useState("");
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [markerPopup, setMarkerPopup] = useState<{ name: string; role: string; status: string; distance: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [taskType, setTaskType] = useState("Medicine");
  const [taskTime, setTaskTime] = useState("");
  const [schedulePatientId, setSchedulePatientId] = useState("");
  const [uiMessage, setUiMessage] = useState("");
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    if (!session) router.push("/login");
  }, [session, router]);

  const me = session?.user;
  const myLiveUser = state.users.find((u) => u.id === me?.id) ?? me;
  const myUserId = myLiveUser?.id ?? "";

  const others = state.users.filter((u) => u.id !== myUserId);
  const patients = state.users.filter((u) => u.role === "Patient");
  const myTasks = state.tasks.filter((t) => t.status !== "Resolved");
  const criticalAlerts = myTasks.filter((t) => t.priority === "CRITICAL");
  const activeCalls = state.activeCalls ?? [];
  const patientReports = state.patientReports ?? [];
  const allNotifications = state.notifications ?? [];
  const myIncomingCall = activeCalls.find((c) => c.doctorId === myUserId && c.status === "ringing");
  const myPatientCall = activeCalls.find((c) => c.patientId === myUserId && (c.status === "ringing" || c.status === "connected"));
  const myReport = patientReports.filter((r) => r.patientId === myUserId).at(-1);
  const myNotifications = allNotifications.filter((n) => (n.userId === null || n.userId === myUserId) && !n.clearedBy.includes(myUserId));
  const unreadCount = myNotifications.filter((n) => !n.readBy.includes(myUserId)).length;
  const contacts = state.users.filter((u) => u.id !== myUserId && (u.role === "Doctor" || u.role === "Nurse/Staff" || u.role === "Receptionist"));
  const chatMessages = state.chatMessages.filter((m) => chatTargetId && ((m.fromId === myUserId && m.toId === chatTargetId) || (m.fromId === chatTargetId && m.toId === myUserId)));

  useEffect(() => {
    if (!socket) return;
    const onTyping = ({ fromId }: { fromId: string }) => {
      setTypingFrom(fromId);
      setTimeout(() => setTypingFrom(null), 1200);
    };
    socket.on("chat:typing", onTyping);
    return () => {
      socket.off("chat:typing", onTyping);
    };
  }, [socket]);

  if (!isClient || !myLiveUser) return null;

  const formatDistance = (a: User, b: User) => {
    const m = Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y) * 10;
    return m > 999 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
  };

  const totalBeds = 120;
  const occupiedBeds = Math.min(totalBeds, patients.length * 2 + state.tasks.filter((t) => t.status !== "Resolved").length);
  const freeBeds = totalBeds - occupiedBeds;
  const receptionGraph = [
    { name: "Occupied", value: occupiedBeds },
    { name: "Free", value: freeBeds },
  ];
  const admissionFlow = [
    { label: "Hour-3", admissions: state.alerts.filter((a) => a.type === "login").length % 5 + 2 },
    { label: "Hour-2", admissions: state.alerts.filter((a) => a.type === "task").length % 5 + 3 },
    { label: "Hour-1", admissions: state.alerts.filter((a) => a.type === "emergency").length + 2 },
    { label: "Now", admissions: patients.length },
  ];
  const doctorWorkload = state.users
    .filter((u) => u.role === "Doctor")
    .map((doctor) => ({
      name: doctor.name.split(" ")[1] ?? doctor.name,
      cases: state.tasks.filter((t) => t.assignedTo === doctor.id && t.status !== "Resolved").length,
    }));
  const adminOverview = [
    { name: "Admitted", value: patients.length },
    { name: "Discharged", value: state.tasks.filter((t) => t.taskType.toLowerCase().includes("discharge") && t.status === "Resolved").length },
    { name: "Emergency", value: state.metrics.totalEmergencies },
  ];
  const latestByPatient = new Map<string, string>();
  patientReports.forEach((r) => latestByPatient.set(r.patientId, r.classification));
  const counts = { Stable: 0, Observation: 0, Critical: 0, Emergency: 0 };
  latestByPatient.forEach((value) => {
    if (value === "Stable") counts.Stable += 1;
    else if (value === "Under Observation") counts.Observation += 1;
    else if (value === "Critical") counts.Critical += 1;
    else counts.Emergency += 1;
  });
  const conditionHistory = [
    { time: "T-3", Stable: Math.max(0, counts.Stable - 1), Observation: Math.max(0, counts.Observation - 1), Critical: counts.Critical, Emergency: Math.max(0, counts.Emergency - 1) },
    { time: "T-2", Stable: counts.Stable, Observation: Math.max(0, counts.Observation - 1), Critical: counts.Critical + 1, Emergency: counts.Emergency },
    { time: "T-1", Stable: counts.Stable, Observation: counts.Observation, Critical: counts.Critical, Emergency: counts.Emergency },
    { time: "Now", Stable: counts.Stable, Observation: counts.Observation, Critical: counts.Critical, Emergency: counts.Emergency },
  ];

  const handleReportUpload = (file?: File) => {
    if (!file) return;
    setUploading(true);
    setTimeout(() => {
      socket?.emit("report:analyze", { patientId: myLiveUser.id, fileName: file.name });
      setUploading(false);
      setUiMessage("Report uploaded and AI analysis started.");
    }, 1500);
  };

  return (
    <main className={`min-h-screen px-6 py-6 text-white ${state.fireState ? "fire-mode" : "landing-bg"}`}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="glass-card flex items-center justify-between rounded-2xl p-4">
          <div>
            <h1 className="text-2xl font-bold">{myLiveUser.role} Dashboard</h1>
            <p className="text-sm text-slate-200">{myLiveUser.name} - {myLiveUser.status} - {myLiveUser.activity}</p>
          </div>
          <div className="flex gap-2">
            <ActionButton label={`Clear Notifications (${unreadCount})`} tone="ghost" onClick={clearNotifications} />
            <ActionButton label="Chat" tone="blue" onClick={() => setChatOpen(true)} />
            <ActionButton label="Logout" tone="ghost" onClick={() => { setSession(null); router.push("/login"); }} />
          </div>
        </header>
        {uiMessage && <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/20 p-2 text-sm">{uiMessage}</div>}

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {myLiveUser.role === "Patient" && (
              <div className="glass-card rounded-2xl p-5">
                <p className="mb-2 text-sm">Current Condition: {myReport?.classification ?? "Awaiting report analysis"}</p>
                <p className="mb-3 text-sm">Assigned doctor: {state.users.find((u) => u.role === "Doctor" && u.status === "Available")?.name ?? "On call team"}</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <ActionButton label="PANIC BUTTON" tone="red" onClick={() => socket?.emit("patient:panic", { patientId: myLiveUser.id })} />
                  <ActionButton label="Call Nurse" tone="yellow" onClick={() => socket?.emit("task:create", { patientId: myLiveUser.id, taskType: "Call Nurse", priority: "LOW", createdBy: myLiveUser.id })} />
                  <ActionButton label={myPatientCall ? "Calling Doctor..." : "Emergency / Call Doctor"} tone="red" loading={!!myPatientCall} onClick={() => socket?.emit("call:request", { patientId: myLiveUser.id })} />
                </div>
                <div className="mt-4 rounded-xl border border-white/20 p-3">
                  <p className="mb-2 text-sm font-semibold">Upload Medical Report (PDF)</p>
                  <input type="file" accept=".pdf" onChange={(e) => handleReportUpload(e.target.files?.[0])} />
                  {uploading && <p className="mt-2 text-xs text-amber-200">Uploading and parsing report...</p>}
                  {myReport && <p className="mt-2 text-xs">Risk Score: {myReport.riskScore} | {myReport.classification}</p>}
                </div>
              </div>
            )}

            {myLiveUser.role === "Doctor" && (
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <h2 className="text-lg font-semibold">Doctors Dashboard</h2>
                {myIncomingCall && (
                  <div className="rounded-lg border border-red-400/40 bg-red-500/20 p-3">
                    <p>Incoming Call from Room {myIncomingCall.room}</p>
                    <div className="mt-2 flex gap-2">
                      <ActionButton label="Accept" tone="green" onClick={() => socket?.emit("call:accept", { callId: myIncomingCall.id, doctorId: myLiveUser.id })} />
                      <ActionButton label="Reject" tone="red" onClick={() => socket?.emit("call:reject", { callId: myIncomingCall.id, doctorId: myLiveUser.id })} />
                    </div>
                  </div>
                )}
                <div className="flex gap-2">{["Available", "Busy", "In Operation"].map((status) => <ActionButton key={status} label={status} tone={status === "Available" ? "green" : status === "In Operation" ? "red" : "yellow"} onClick={() => socket?.emit("doctor:status", { userId: myLiveUser.id, status })} />)}</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <select className="input-ui" value={schedulePatientId} onChange={(e) => setSchedulePatientId(e.target.value)}><option value="" className="text-black">Patient</option>{patients.map((p) => <option key={p.id} value={p.id} className="text-black">{p.name}</option>)}</select>
                  <select className="input-ui" value={taskType} onChange={(e) => setTaskType(e.target.value)}><option className="text-black">Medicine</option><option className="text-black">Injection</option></select>
                  <input className="input-ui" type="datetime-local" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} />
                  <ActionButton label="Schedule" tone="blue" onClick={() => { const p = patients.find((x) => x.id === schedulePatientId); if (!p || !taskTime) return; socket?.emit("task:schedule", { doctorId: myLiveUser.id, patientId: p.id, room: p.room, taskType, time: taskTime }); }} />
                </div>
                <div className="h-60 rounded-xl border border-white/15 p-2">
                  <p className="mb-2 text-sm">Patient Condition Trend</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={conditionHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time" hide />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="Stable" stroke="#22c55e" strokeWidth={2} />
                      <Line type="monotone" dataKey="Observation" stroke="#facc15" strokeWidth={2} />
                      <Line type="monotone" dataKey="Critical" stroke="#ef4444" strokeWidth={2} />
                      <Line type="monotone" dataKey="Emergency" stroke="#f97316" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {criticalAlerts.map((task) => <TaskCard key={task.id} task={task} onAccept={() => socket?.emit("task:accept", { taskId: task.id, userId: myLiveUser.id })} onComplete={() => socket?.emit("task:complete", { taskId: task.id, userId: myLiveUser.id })} />)}
              </div>
            )}

            {(myLiveUser.role === "Nurse/Staff" || myLiveUser.role === "Receptionist") && (
              <div className="glass-card rounded-2xl p-5">
                <h2 className="text-lg font-semibold">{myLiveUser.role === "Nurse/Staff" ? "Nurses Dashboard" : "Reception Control"}</h2>
                {myTasks.map((task) => (
                  <div key={task.id} className={`mt-2 rounded-lg border p-2 ${priorityClass[task.priority]}`}>
                    <p className="text-sm">{task.taskType} - Room {task.room}</p>
                    <div className="mt-2 flex gap-2">
                      <ActionButton label="Accept" tone="green" onClick={() => socket?.emit("task:accept", { taskId: task.id, userId: myLiveUser.id })} />
                      <ActionButton label="Complete" tone="green" onClick={() => socket?.emit("task:complete", { taskId: task.id, userId: myLiveUser.id })} />
                    </div>
                  </div>
                ))}
                {myLiveUser.role === "Receptionist" && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="h-52 rounded-xl border border-white/15 p-2">
                      <p className="text-sm">Bed Occupancy</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={receptionGraph} dataKey="value" nameKey="name" outerRadius={70} fill="#60a5fa" />
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="h-52 rounded-xl border border-white/15 p-2">
                      <p className="text-sm">Admission Rate</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={admissionFlow}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="label" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="admissions" fill="#38bdf8" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}

            {myLiveUser.role === "Admin" && (
              <div className="glass-card rounded-2xl p-5">
                <h2 className="text-lg font-semibold">Admin Dashboard</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <StatCard label="Total Patients" value={String(patients.length)} tone="green" />
                  <StatCard label="Bed Availability" value="38" tone="amber" />
                  <StatCard label="Critical Cases" value={String(state.tasks.filter((t) => t.priority === "CRITICAL" && t.status !== "Resolved").length)} tone="red" />
                  <StatCard label="Live Alerts" value={String(myNotifications.length)} tone="amber" />
                </div>
                <div className="mt-3 flex gap-2">
                  <ActionButton label="Fire Alert" tone="red" onClick={() => socket?.emit("fire:alert", { floor: "Floor 2", userId: myLiveUser.id })} />
                  <ActionButton label="Clear Fire" tone="ghost" onClick={() => socket?.emit("fire:clear")} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="h-56 rounded-xl border border-white/15 p-2">
                    <p className="text-sm">Hospital Performance Overview</p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={adminOverview}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#22d3ee" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-56 rounded-xl border border-white/15 p-2">
                    <p className="text-sm">Doctor Workload Distribution</p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={doctorWorkload}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="cases" fill="#fb7185" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            <div className="glass-card rounded-2xl p-4">
              <h2 className="mb-2 text-lg font-semibold">Advanced Live Map</h2>
              <div className="relative h-[420px] rounded-2xl border border-white/20 bg-slate-900/80 overflow-hidden">
                <svg className="absolute inset-0 h-full w-full">{others.map((u) => <g key={u.id}><line x1={`${myLiveUser.location.x}%`} y1={`${myLiveUser.location.y}%`} x2={`${u.location.x}%`} y2={`${u.location.y}%`} stroke="rgba(255,255,255,0.4)" /><text x={`${(myLiveUser.location.x + u.location.x) / 2}%`} y={`${(myLiveUser.location.y + u.location.y) / 2}%`} fill="#e2e8f0" fontSize="10">{formatDistance(myLiveUser, u)}</text></g>)}</svg>
                {state.users.map((u) => <motion.button key={u.id} whileHover={{ scale: 1.1 }} onClick={() => setMarkerPopup({ name: u.name, role: u.role, status: u.status, distance: formatDistance(myLiveUser, u) })} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[10px] ${u.id === myLiveUser.id ? "animate-pulse border-red-200 bg-red-500" : "border-blue-200 bg-blue-500"}`} style={{ left: `${u.location.x}%`, top: `${u.location.y}%` }}>{u.name.split(" ")[0]}</motion.button>)}
                {markerPopup && <div className="absolute bottom-3 left-3 rounded-lg border border-white/20 bg-slate-950/90 p-3 text-xs"><p className="font-semibold">{markerPopup.name}</p><p>{markerPopup.role}</p><p>{markerPopup.status}</p><p>{markerPopup.distance}</p></div>}
              </div>
            </div>
          </div>

          <aside className="glass-card rounded-2xl p-4">
            <h3 className="text-lg font-semibold">Live Activity Board</h3>
            <div className="space-y-2 mt-2">{state.users.map((u) => <div key={u.id} className="rounded-lg border border-white/20 p-2 text-xs">{u.name} - {u.activity}</div>)}</div>
            <h3 className="mt-4 text-lg font-semibold">Notifications</h3>
            <div className="space-y-2 mt-2">{myNotifications.map((n) => <button key={n.id} onClick={() => socket?.emit("notification:read", { userId: myLiveUser.id, notificationId: n.id })} className="w-full rounded border border-white/20 p-2 text-left text-xs">{new Date(n.createdAt).toLocaleTimeString()} - {n.message} {n.readBy.includes(myLiveUser.id) ? "(read)" : "(unread)"}</button>)}</div>
          </aside>
        </section>
      </div>

      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ x: 340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 340, opacity: 0 }} className="fixed right-4 top-20 z-40 w-[360px] rounded-2xl border border-white/20 bg-slate-950/95 p-4">
            <button onClick={() => { setChatOpen(false); setChatTargetId(""); setChatText(""); }} className="absolute right-3 top-2 text-red-400 text-lg">✖</button>
            <h3 className="text-sm font-semibold">Real-Time Chat</h3>
            <select className="input-ui mt-2" value={chatTargetId} onChange={(e) => setChatTargetId(e.target.value)}><option value="" className="text-black">Select user</option>{contacts.map((u) => <option key={u.id} value={u.id} className="text-black">{u.name}</option>)}</select>
            <div className="mt-2 h-56 overflow-auto rounded border border-white/10 p-2 space-y-2">{chatMessages.map((m) => <div key={m.id} className={`rounded p-2 text-xs ${m.fromId === myLiveUser.id ? "bg-blue-500/30" : "bg-white/10"}`}>{m.text}</div>)}{typingFrom === chatTargetId && <p className="text-xs text-slate-300">typing...</p>}</div>
            <div className="mt-2 flex gap-2"><input className="input-ui" value={chatText} onChange={(e) => { setChatText(e.target.value); if (chatTargetId) socket?.emit("chat:typing", { fromId: myLiveUser.id, toId: chatTargetId }); }} /><ActionButton label="Send" tone="blue" onClick={() => { if (!chatTargetId || !chatText.trim()) return; socket?.emit("chat:send", { fromId: myLiveUser.id, toId: chatTargetId, text: chatText }); setChatText(""); }} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "red" | "amber" | "green" }) {
  const toneClass = tone === "red" ? "border-red-400/40 bg-red-500/20" : tone === "amber" ? "border-amber-300/40 bg-amber-500/20" : "border-emerald-400/40 bg-emerald-500/20";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-xs text-slate-200">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function TaskCard({ task, onAccept, onComplete }: { task: Task; onAccept: () => void; onComplete: () => void }) {
  return <div className={`rounded-lg border p-2 ${priorityClass[task.priority]}`}><p className="text-sm">{task.taskType} - {task.patientName} ({task.room})</p><div className="mt-2 flex gap-2"><ActionButton label="Accept" tone="green" onClick={onAccept} /><ActionButton label="Complete" tone="green" onClick={onComplete} /></div></div>;
}

function ActionButton({
  label,
  onClick,
  tone,
  loading,
  className,
}: {
  label: string;
  onClick: () => void;
  tone: "red" | "green" | "yellow" | "blue" | "ghost";
  loading?: boolean;
  className?: string;
}) {
  const toneClass =
    tone === "red"
      ? "bg-red-600 hover:bg-red-500"
      : tone === "green"
        ? "bg-emerald-600 hover:bg-emerald-500"
        : tone === "yellow"
          ? "bg-amber-500 hover:bg-amber-400 text-slate-900"
          : tone === "blue"
            ? "bg-blue-600 hover:bg-blue-500"
            : "bg-white/15 hover:bg-white/25";
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      disabled={loading}
      className={`relative overflow-hidden rounded-lg px-3 py-2 text-sm font-semibold transition ${toneClass} disabled:opacity-60 ${className ?? ""}`}
    >
      <span className="relative z-10">{loading ? "Loading..." : label}</span>
      <span className="pointer-events-none absolute inset-0 animate-pulse bg-white/10 opacity-0 transition hover:opacity-100" />
    </motion.button>
  );
}


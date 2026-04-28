import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const host = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname: host, port });
const handler = app.getRequestHandler();

const roleStatusDefaults = {
  Doctor: "Available",
  "Nurse/Staff": "Available",
  Receptionist: "Online",
  Admin: "Monitoring",
  Patient: "Waiting",
};

const users = [
  { id: "p-1", name: "Aarav Singh", email: "patient1@hospital.com", role: "Patient", room: "101", status: "Waiting", activity: "Recovering", location: { x: 20, y: 35 } },
  { id: "p-2", name: "Meera Das", email: "patient2@hospital.com", role: "Patient", room: "102", status: "Waiting", activity: "Observation", location: { x: 48, y: 52 } },
  { id: "d-1", name: "Dr. Mehta", email: "doctor1@hospital.com", role: "Doctor", room: "ICU", status: "Available", activity: "Reviewing cases", location: { x: 65, y: 20 } },
  { id: "d-2", name: "Dr. Patel", email: "doctor2@hospital.com", role: "Doctor", room: "OT-2", status: "Busy", activity: "Ward rounds", location: { x: 77, y: 45 } },
  { id: "n-1", name: "Nurse Riya", email: "nurse1@hospital.com", role: "Nurse/Staff", room: "Ward A", status: "Available", activity: "Checking vitals", location: { x: 35, y: 28 } },
  { id: "n-2", name: "Nurse Aman", email: "nurse2@hospital.com", role: "Nurse/Staff", room: "Ward B", status: "Available", activity: "Medicine prep", location: { x: 58, y: 68 } },
  { id: "r-1", name: "Priya Sharma", email: "reception@hospital.com", role: "Receptionist", room: "Front Desk", status: "Online", activity: "Handling admissions", location: { x: 10, y: 12 } },
  { id: "a-1", name: "Admin Raj", email: "admin@hospital.com", role: "Admin", room: "Control Room", status: "Monitoring", activity: "Monitoring hospital operations", location: { x: 88, y: 10 } },
];

/** @type {any[]} */
const tasks = [];
/** @type {any[]} */
const alerts = [];
/** @type {any[]} */
const notifications = [];
/** @type {any[]} */
const activeCalls = [];
/** @type {any[]} */
const chatMessages = [];
/** @type {any[]} */
const patientReports = [];

const metrics = {
  totalEmergencies: 0,
  totalResponseTimeMs: 0,
  responseCount: 0,
  missedTasks: 0,
};

let fireState = null;
let taskCounter = 1;
let callCounter = 1;
let chatCounter = 1;
let notifCounter = 1;
let reportCounter = 1;
const socketToUser = new Map();
const userToSockets = new Map();

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const now = () => Date.now();

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const getPublicState = () => ({
  users,
  tasks,
  alerts: alerts.slice(-40),
  notifications: notifications.slice(-120),
  patientReports,
  activeCalls,
  chatMessages: chatMessages.slice(-200),
  metrics: {
    totalEmergencies: metrics.totalEmergencies,
    averageResponseSeconds: metrics.responseCount ? Math.round(metrics.totalResponseTimeMs / metrics.responseCount / 1000) : 0,
    missedTasks: metrics.missedTasks,
  },
  fireState,
  serverTime: now(),
});

const emitToUser = (io, userId, event, payload) => {
  const sockets = userToSockets.get(userId);
  if (!sockets) return;
  for (const socketId of sockets) io.to(socketId).emit(event, payload);
};

const pushNotification = (io, { userId = null, type = "info", message }) => {
  notifications.push({
    id: `nt-${notifCounter++}`,
    userId,
    type,
    message,
    createdAt: now(),
    readBy: [],
    clearedBy: [],
  });
  if (userId) emitToUser(io, userId, "notification", { type, message });
  else io.emit("notification", { type, message });
};

const logAlert = (type, message, severity = "info") => {
  alerts.push({ id: `al-${alerts.length + 1}`, type, message, severity, createdAt: now() });
};

const broadcastState = (io) => {
  io.emit("state:update", getPublicState());
};

const pickNearestAvailableDoctor = (patient) => {
  const candidates = users.filter((u) => u.role === "Doctor" && u.status === "Available");
  candidates.sort((a, b) => distance(a.location, patient.location) - distance(b.location, patient.location));
  return candidates[0] ?? null;
};

const pickNextAvailableDoctor = (patient, excludeDoctorId) => {
  const candidates = users.filter((u) => u.role === "Doctor" && u.status === "Available" && u.id !== excludeDoctorId);
  candidates.sort((a, b) => distance(a.location, patient.location) - distance(b.location, patient.location));
  return candidates[0] ?? null;
};

const pickNextAvailableNurse = (excludeUserId) =>
  users.find((u) => u.role === "Nurse/Staff" && u.id !== excludeUserId && u.status === "Available") ||
  users.find((u) => u.role === "Nurse/Staff" && u.id !== excludeUserId) ||
  null;

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handler(req, res));
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  setInterval(() => {
    users.forEach((user) => {
      const nextX = clamp(user.location.x + (Math.random() * 8 - 4), 3, 97);
      const nextY = clamp(user.location.y + (Math.random() * 8 - 4), 3, 97);
      user.location = { x: nextX, y: nextY };
    });

    const pendingTasks = tasks.filter((t) => t.status === "Pending");
    for (const task of pendingTasks) {
      const isDueScheduled = task.category === "Scheduled" && !task.notified && now() >= task.scheduledAt;
      if (isDueScheduled) {
        task.notified = true;
        logAlert("schedule", `Time to ${task.taskType.toLowerCase()} for ${task.patientName} in Room ${task.room}`, "warning");
        if (task.assignedTo) {
          pushNotification(io, { userId: task.assignedTo, type: "warning", message: `Time to ${task.taskType.toLowerCase()} for ${task.patientName}` });
        }
      }

      const shouldEscalate = task.notified && !task.acceptedAt && now() - task.createdAt >= 120000;
      if (shouldEscalate) {
        const reassigned = pickNextAvailableNurse(task.assignedTo);
        metrics.missedTasks += 1;
        task.escalated = true;
        task.priority = "CRITICAL";
        task.assignedTo = reassigned?.id ?? task.assignedTo;
        task.highlight = "RED";
        task.createdAt = now();
        logAlert("escalation", `Task reassigned to ${reassigned?.name ?? "standby team"}`, "critical");

        if (reassigned) {
          pushNotification(io, { userId: reassigned.id, type: "critical", message: `Task reassigned to you: ${task.taskType} in Room ${task.room}` });
        }
      }
    }
    broadcastState(io);
  }, 5000);

  io.on("connection", (socket) => {
    socket.emit("state:update", getPublicState());

    socket.on("auth:login", (payload, ack) => {
      const { email, role } = payload || {};
      const user =
        users.find((u) => u.email === email && u.role === role) ||
        users.find((u) => u.role === role);

      if (!user) {
        ack?.({ ok: false, message: "Invalid credentials" });
        return;
      }

      socketToUser.set(socket.id, user.id);
      const userSockets = userToSockets.get(user.id) || new Set();
      userSockets.add(socket.id);
      userToSockets.set(user.id, userSockets);
      user.status = roleStatusDefaults[user.role];
      user.activity = user.activity || "Connected";
      ack?.({ ok: true, user });
      logAlert("login", `${user.name} logged in as ${user.role}`, "info");
      broadcastState(io);
    });

    socket.on("task:create", (payload) => {
      const patient = users.find((u) => u.id === payload.patientId);
      if (!patient) return;
      const task = {
        id: `tsk-${taskCounter++}`,
        patientId: patient.id,
        patientName: patient.name,
        room: patient.room,
        taskType: payload.taskType,
        priority: payload.priority,
        status: "Pending",
        assignedTo: payload.assignedTo || null,
        createdBy: payload.createdBy,
        createdAt: now(),
        acceptedAt: null,
        resolvedAt: null,
        category: payload.category || "Manual",
        scheduledAt: payload.scheduledAt || null,
        notified: payload.notified || false,
        escalated: false,
      };
      tasks.push(task);
      logAlert("task", `${task.taskType} created for Room ${task.room}`, payload.priority === "CRITICAL" ? "critical" : "warning");
      broadcastState(io);
    });

    socket.on("patient:panic", ({ patientId }) => {
      const patient = users.find((u) => u.id === patientId && u.role === "Patient");
      if (!patient) return;
      metrics.totalEmergencies += 1;

      const doctor = pickNearestAvailableDoctor(patient);
      const task = {
        id: `tsk-${taskCounter++}`,
        patientId: patient.id,
        patientName: patient.name,
        room: patient.room,
        taskType: "Emergency",
        priority: "CRITICAL",
        status: "Pending",
        assignedTo: doctor?.id ?? null,
        createdBy: patient.id,
        createdAt: now(),
        acceptedAt: null,
        resolvedAt: null,
        category: "Emergency",
        notified: true,
        escalated: false,
      };
      tasks.unshift(task);
      logAlert("emergency", `Critical panic from ${patient.name} in Room ${patient.room}`, "critical");

      const message = doctor
        ? `Calling nearest doctor: ${doctor.name}`
        : "Doctor unavailable. Assigning another doctor";
      pushNotification(io, { userId: patient.id, type: "critical", message });
      if (doctor) {
        pushNotification(io, { userId: doctor.id, type: "critical", message: `Emergency case in Room ${patient.room}` });
      }
      pushNotification(io, { type: "critical", message: `Emergency sent. Help is on the way (${patient.room})` });
      broadcastState(io);
    });

    socket.on("call:request", ({ patientId }) => {
      const patient = users.find((u) => u.id === patientId && u.role === "Patient");
      if (!patient) return;
      const doctor = pickNearestAvailableDoctor(patient);
      if (!doctor) {
        pushNotification(io, { userId: patient.id, type: "warning", message: "Doctor unavailable, connecting next doctor" });
        return;
      }

      const call = {
        id: `call-${callCounter++}`,
        patientId: patient.id,
        doctorId: doctor.id,
        room: patient.room,
        status: "ringing",
        createdAt: now(),
        connectedAt: null,
      };
      activeCalls.push(call);
      pushNotification(io, { userId: patient.id, type: "critical", message: `Calling ${doctor.name}...` });
      pushNotification(io, { userId: doctor.id, type: "critical", message: `Incoming Call from Room ${patient.room}` });
      logAlert("call", `${patient.name} calling ${doctor.name}`, "warning");
      broadcastState(io);
    });

    socket.on("call:accept", ({ callId, doctorId }) => {
      const call = activeCalls.find((c) => c.id === callId && c.doctorId === doctorId);
      if (!call || call.status !== "ringing") return;
      call.status = "connected";
      call.connectedAt = now();
      pushNotification(io, { userId: call.patientId, type: "info", message: "Call Connected" });
      pushNotification(io, { userId: doctorId, type: "info", message: "Call Connected" });
      broadcastState(io);
    });

    socket.on("call:reject", ({ callId, doctorId }) => {
      const call = activeCalls.find((c) => c.id === callId && c.doctorId === doctorId);
      if (!call || call.status !== "ringing") return;
      call.status = "rejected";
      const patient = users.find((u) => u.id === call.patientId);
      const nextDoctor = patient ? pickNextAvailableDoctor(patient, doctorId) : null;

      pushNotification(io, { userId: call.patientId, type: "warning", message: "Call rejected. Searching next available doctor" });

      if (patient && nextDoctor) {
        const newCall = {
          id: `call-${callCounter++}`,
          patientId: patient.id,
          doctorId: nextDoctor.id,
          room: patient.room,
          status: "ringing",
          createdAt: now(),
          connectedAt: null,
        };
        activeCalls.push(newCall);
        pushNotification(io, { userId: patient.id, type: "warning", message: "Doctor unavailable, connecting next doctor" });
        pushNotification(io, { userId: nextDoctor.id, type: "critical", message: `Incoming Call from Room ${patient.room}` });
      }
      broadcastState(io);
    });

    socket.on("task:accept", ({ taskId, userId }) => {
      const task = tasks.find((t) => t.id === taskId);
      const user = users.find((u) => u.id === userId);
      if (!task || !user) return;
      task.status = "In Progress";
      task.acceptedAt = now();
      task.assignedTo = userId;
      user.activity = `Going to Room ${task.room}`;
      user.status = "Busy";
      pushNotification(io, { userId: task.patientId, type: "info", message: "Staff is coming" });
      logAlert("task", `${user.name} accepted ${task.taskType} for Room ${task.room}`, "info");
      broadcastState(io);
    });

    socket.on("task:complete", ({ taskId, userId }) => {
      const task = tasks.find((t) => t.id === taskId);
      const user = users.find((u) => u.id === userId);
      if (!task || !user) return;
      task.status = "Resolved";
      task.resolvedAt = now();
      user.activity = "Available for next task";
      user.status = user.role === "Doctor" ? "Available" : "Available";
      if (task.acceptedAt) {
        metrics.totalResponseTimeMs += task.resolvedAt - task.acceptedAt;
        metrics.responseCount += 1;
      }
      logAlert("task", `${task.taskType} resolved in Room ${task.room}`, "info");
      broadcastState(io);
    });

    socket.on("doctor:status", ({ userId, status }) => {
      const doctor = users.find((u) => u.id === userId && u.role === "Doctor");
      if (!doctor) return;
      doctor.status = status;
      doctor.activity = status === "In Operation" ? "Performing surgery" : "Monitoring critical cases";
      logAlert("status", `${doctor.name} is now ${status}`, "info");
      if (status === "In Operation") {
        activeCalls
          .filter((call) => call.doctorId === doctor.id && call.status === "ringing")
          .forEach((call) => {
            call.status = "rejected";
            pushNotification(io, { userId: call.patientId, type: "warning", message: "Doctor in critical operation" });
          });
      }
      broadcastState(io);
    });

    socket.on("doctor:callPatient", ({ doctorId, patientId }) => {
      const doctor = users.find((u) => u.id === doctorId && u.role === "Doctor");
      const patient = users.find((u) => u.id === patientId && u.role === "Patient");
      if (!doctor || !patient) return;
      if (doctor.status === "In Operation") {
        pushNotification(io, { userId: patient.id, type: "warning", message: "Doctor unavailable. Assigning another doctor" });
        return;
      }
      pushNotification(io, { userId: patient.id, type: "info", message: `Calling popup: ${doctor.name} is calling you now` });
      logAlert("call", `${doctor.name} called ${patient.name}`, "info");
      broadcastState(io);
    });

    socket.on("task:assign", ({ taskId, assigneeId }) => {
      const task = tasks.find((t) => t.id === taskId);
      const assignee = users.find((u) => u.id === assigneeId);
      if (!task || !assignee) return;
      task.assignedTo = assignee.id;
      pushNotification(io, { userId: assignee.id, type: "warning", message: `New task assigned: ${task.taskType} in Room ${task.room}` });
      logAlert("assignment", `${task.taskType} assigned to ${assignee.name}`, "warning");
      broadcastState(io);
    });

    socket.on("task:schedule", ({ doctorId, patientId, room, taskType, time }) => {
      const doctor = users.find((u) => u.id === doctorId);
      const patient = users.find((u) => u.id === patientId);
      const nurse = users.find((u) => u.role === "Nurse/Staff" && u.status === "Available") || users.find((u) => u.role === "Nurse/Staff");
      if (!doctor || !patient) return;

      tasks.push({
        id: `tsk-${taskCounter++}`,
        patientId,
        patientName: patient.name,
        room,
        taskType,
        priority: "MEDIUM",
        status: "Pending",
        assignedTo: nurse?.id ?? null,
        createdBy: doctor.id,
        createdAt: now(),
        acceptedAt: null,
        resolvedAt: null,
        category: "Scheduled",
        scheduledAt: new Date(time).getTime(),
        notified: false,
        escalated: false,
      });
      logAlert("schedule", `${doctor.name} scheduled ${taskType} for ${patient.name}`, "info");
      broadcastState(io);
    });

    socket.on("fire:alert", ({ floor, userId }) => {
      fireState = {
        active: true,
        floor,
        message: `Fire detected in ${floor}`,
        startedAt: now(),
        route: "Use East Stairwell -> Assembly Point A",
      };
      logAlert("fire", `Fire alert activated on ${floor}`, "critical");

      users
        .filter((u) => u.role === "Nurse/Staff")
        .forEach((staff) => {
          tasks.push({
            id: `tsk-${taskCounter++}`,
            patientId: "all",
            patientName: "Evacuation Block",
            room: "Floor 2",
            taskType: "Evacuation",
            priority: "CRITICAL",
            status: "Pending",
            assignedTo: staff.id,
            createdBy: userId,
            createdAt: now(),
            acceptedAt: null,
            resolvedAt: null,
            category: "Emergency",
            notified: true,
            escalated: true,
          });
          pushNotification(io, { userId: staff.id, type: "critical", message: "Evacuation task assigned immediately" });
        });
      pushNotification(io, { type: "critical", message: fireState.message });
      broadcastState(io);
    });

    socket.on("fire:clear", () => {
      fireState = null;
      logAlert("fire", "Fire alert cleared. Resume normal operations.", "info");
      broadcastState(io);
    });

    socket.on("chat:send", ({ fromId, toId, text }) => {
      if (!text?.trim()) return;
      const message = {
        id: `chat-${chatCounter++}`,
        fromId,
        toId,
        text: text.trim(),
        createdAt: now(),
      };
      chatMessages.push(message);
      pushNotification(io, { userId: toId, type: "info", message: "New chat message" });
      broadcastState(io);
    });

    socket.on("chat:typing", ({ fromId, toId }) => {
      emitToUser(io, toId, "chat:typing", { fromId });
    });

    socket.on("notification:clear", ({ userId }) => {
      notifications.forEach((n) => {
        if (!n.clearedBy.includes(userId)) n.clearedBy.push(userId);
      });
      broadcastState(io);
    });

    socket.on("notification:read", ({ userId, notificationId }) => {
      const n = notifications.find((item) => item.id === notificationId);
      if (!n) return;
      if (!n.readBy.includes(userId)) n.readBy.push(userId);
      broadcastState(io);
    });

    socket.on("report:analyze", ({ patientId, fileName }) => {
      const patient = users.find((u) => u.id === patientId && u.role === "Patient");
      if (!patient) return;
      const data = {
        bp: `${108 + Math.floor(Math.random() * 35)}/${68 + Math.floor(Math.random() * 28)}`,
        heartRate: 62 + Math.floor(Math.random() * 56),
        spo2: 88 + Math.floor(Math.random() * 11),
        temperature: Number((97 + Math.random() * 5).toFixed(1)),
        symptoms: ["Fatigue", "Mild breathlessness", "Chest discomfort"].slice(0, 1 + Math.floor(Math.random() * 3)),
        doctorNotes: "AI extracted note: monitor cardiovascular stress and hydration closely.",
      };
      const riskScore =
        (data.heartRate > 100 ? 3 : 1) +
        (data.spo2 < 93 ? 4 : 1) +
        (data.temperature > 100.4 ? 3 : 1);
      const classification = riskScore <= 2 ? "Stable" : riskScore <= 5 ? "Under Observation" : riskScore <= 8 ? "Critical" : "Emergency";
      patientReports.push({
        id: `rep-${reportCounter++}`,
        patientId,
        fileName,
        createdAt: now(),
        data,
        riskScore,
        classification,
      });
      pushNotification(io, { userId: patientId, type: "info", message: `AI analysis complete: ${classification}` });
      pushNotification(io, { type: "warning", message: `${patient.name} report analyzed. Risk ${riskScore} (${classification})` });
      broadcastState(io);
    });

    socket.on("disconnect", () => {
      const userId = socketToUser.get(socket.id);
      socketToUser.delete(socket.id);
      if (!userId) return;
      const sockets = userToSockets.get(userId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) userToSockets.delete(userId);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${host}:${port}`);
  });
});

export type Role = "Patient" | "Doctor" | "Nurse/Staff" | "Receptionist" | "Admin";
export type Priority = "LOW" | "MEDIUM" | "CRITICAL";
export type TaskStatus = "Pending" | "In Progress" | "Resolved";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  room: string;
  status: string;
  activity: string;
  location: { x: number; y: number };
};

export type Task = {
  id: string;
  patientId: string;
  patientName: string;
  room: string;
  taskType: string;
  priority: Priority;
  status: TaskStatus;
  assignedTo: string | null;
  createdBy: string;
  createdAt: number;
  acceptedAt: number | null;
  resolvedAt: number | null;
  category: "Manual" | "Scheduled" | "Emergency";
  scheduledAt: number | null;
  notified: boolean;
  escalated: boolean;
};

export type Alert = {
  id: string;
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
  createdAt: number;
};

export type DashboardState = {
  users: User[];
  tasks: Task[];
  alerts: Alert[];
  notifications: AppNotification[];
  patientReports: PatientReport[];
  activeCalls: CallSession[];
  chatMessages: ChatMessage[];
  metrics: {
    totalEmergencies: number;
    averageResponseSeconds: number;
    missedTasks: number;
  };
  fireState: null | {
    active: boolean;
    floor: string;
    message: string;
    startedAt: number;
    route: string;
  };
  serverTime: number;
};

export type NotificationMessage = {
  type: "info" | "warning" | "critical";
  message: string;
};

export type AppNotification = {
  id: string;
  userId: string | null;
  type: "info" | "warning" | "critical";
  message: string;
  createdAt: number;
  readBy: string[];
  clearedBy: string[];
};

export type CallSession = {
  id: string;
  patientId: string;
  doctorId: string;
  room: string;
  status: "ringing" | "connected" | "rejected" | "ended";
  createdAt: number;
  connectedAt: number | null;
};

export type ChatMessage = {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: number;
};

export type PatientReport = {
  id: string;
  patientId: string;
  fileName: string;
  createdAt: number;
  data: {
    bp: string;
    heartRate: number;
    spo2: number;
    temperature: number;
    symptoms: string[];
    doctorNotes: string;
  };
  riskScore: number;
  classification: "Stable" | "Under Observation" | "Critical" | "Emergency";
};

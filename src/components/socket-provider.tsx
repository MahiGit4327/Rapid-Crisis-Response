"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { DashboardState, NotificationMessage, User } from "@/lib/types";

const initialState: DashboardState = {
  users: [],
  tasks: [],
  alerts: [],
  notifications: [],
  patientReports: [],
  activeCalls: [],
  chatMessages: [],
  metrics: { totalEmergencies: 0, averageResponseSeconds: 0, missedTasks: 0 },
  fireState: null,
  serverTime: Date.now(),
};

type Session = {
  user: User;
};

type SocketContextValue = {
  socket: Socket | null;
  state: DashboardState;
  session: Session | null;
  setSession: (session: Session | null) => void;
  notifications: NotificationMessage[]; // backward compatibility
  clearNotifications: () => void; // emits real-time clear
};

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket] = useState<Socket | null>(() => (typeof window === "undefined" ? null : io()));
  const [state, setState] = useState<DashboardState>(initialState);
  const [session, setSessionState] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("hospital-session");
    return stored ? JSON.parse(stored) : null;
  });
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);

  useEffect(() => {
    if (!socket) return;
    socket.on("state:update", (nextState: DashboardState) => setState(nextState));
    socket.on("notification", (n: NotificationMessage) => {
      setNotifications((prev) => [n, ...prev].slice(0, 8));
    });

    return () => {
      socket.disconnect();
    };
  }, [socket]);

  const setSession = (next: Session | null) => {
    setSessionState(next);
    if (!next) {
      localStorage.removeItem("hospital-session");
      return;
    }
    localStorage.setItem("hospital-session", JSON.stringify(next));
  };

  const clearNotifications = useCallback(() => {
    const userId = session?.user.id;
    if (userId) socket?.emit("notification:clear", { userId });
    setNotifications([]);
  }, [session, socket]);

  const value = useMemo(
    () => ({ socket, state, session, setSession, notifications, clearNotifications }),
    [socket, state, session, notifications, clearNotifications],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocketState() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error("useSocketState must be used within SocketProvider");
  }
  return ctx;
}

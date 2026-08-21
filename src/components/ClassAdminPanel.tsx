import { useEffect, useState } from "react";
import { fetchClassLogins } from "../lib/classLoginsRepository";
import type { ClassLogin } from "../lib/classLoginsRepository";
import {
  fetchAllAccessStatuses,
  setUserAccessStatus,
} from "../lib/classUserAccessRepository";
import type { AccessStatus } from "../lib/classUserAccessRepository";
import { CLASS_ADMIN_EMAIL } from "../lib/classAdmin";

export interface ClassAdminPanelProps {
  classSlug: string;
  adminEmail: string;
}

interface UserSummary {
  userId: string;
  email: string;
  firstLoginAt: string;
  lastLoginAt: string;
  loginCount: number;
  status: AccessStatus;
}

function summarizeUsers(
  logins: ClassLogin[],
  statuses: Map<string, AccessStatus>,
): UserSummary[] {
  const byUser = new Map<string, UserSummary>();
  for (const login of logins) {
    const existing = byUser.get(login.userId);
    if (existing === undefined) {
      byUser.set(login.userId, {
        userId: login.userId,
        email: login.email,
        firstLoginAt: login.loggedInAt,
        lastLoginAt: login.loggedInAt,
        loginCount: 1,
        status: statuses.get(login.userId) ?? "active",
      });
      continue;
    }
    existing.lastLoginAt = login.loggedInAt;
    existing.loginCount += 1;
  }
  return Array.from(byUser.values()).sort((a, b) =>
    a.email.localeCompare(b.email),
  );
}

const STATUS_LABELS: Record<AccessStatus, string> = {
  active: "Active",
  read_only: "Read-only",
  disabled: "Disabled",
};

export function ClassAdminPanel({
  classSlug,
  adminEmail,
}: ClassAdminPanelProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchClassLogins(classSlug),
      fetchAllAccessStatuses(classSlug),
    ]).then(([logins, statuses]) => {
      if (cancelled) return;
      const statusByUserId = new Map(
        statuses.map((row) => [row.userId, row.status]),
      );
      setUsers(summarizeUsers(logins, statusByUserId));
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  async function handleStatusChange(user: UserSummary, status: AccessStatus) {
    setSavingUserId(user.userId);
    const ok = await setUserAccessStatus(
      classSlug,
      user.userId,
      user.email,
      status,
      adminEmail,
    );
    setSavingUserId(null);
    if (!ok) return;
    setUsers((prev) =>
      prev.map((u) => (u.userId === user.userId ? { ...u, status } : u)),
    );
  }

  return (
    <div className="class-admin-panel">
      {isLoading && <p>Loading…</p>}
      {!isLoading && users.length === 0 && <p>Nobody has signed in yet.</p>}
      {!isLoading && users.length > 0 && (
        <table className="class-admin-panel__table">
          <thead>
            <tr>
              <th>Email</th>
              <th>First signed in</th>
              <th>Last signed in</th>
              <th>Logins</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>{user.email}</td>
                <td>{new Date(user.firstLoginAt).toLocaleString()}</td>
                <td>{new Date(user.lastLoginAt).toLocaleString()}</td>
                <td>{user.loginCount}</td>
                <td>
                  {user.email === CLASS_ADMIN_EMAIL ? (
                    "Admin"
                  ) : (
                    <select
                      aria-label={`Access for ${user.email}`}
                      value={user.status}
                      disabled={savingUserId === user.userId}
                      onChange={(event) =>
                        void handleStatusChange(
                          user,
                          event.target.value as AccessStatus,
                        )
                      }
                    >
                      {(Object.keys(STATUS_LABELS) as AccessStatus[]).map(
                        (status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

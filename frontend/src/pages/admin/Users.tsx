import { useCallback, useEffect, useState } from "react";
import {
  listUsers,
  updateUser,
  type AdminUser,
  AdminApiError,
} from "../../lib/adminApi";

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      const msg =
        err instanceof AdminApiError ? err.message : "Failed to load users";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleEnabled = useCallback(
    async (user: AdminUser) => {
      setUpdating(user.id);
      setError(null);
      try {
        await updateUser(user.id, { enabled: !user.enabled });
        await fetchUsers();
      } catch (err) {
        const msg =
          err instanceof AdminApiError
            ? err.message
            : "Failed to update user";
        setError(msg);
      } finally {
        setUpdating(null);
      }
    },
    [fetchUsers],
  );

  const handleRoleChange = useCallback(
    async (user: AdminUser, newRole: string) => {
      setUpdating(user.id);
      setError(null);
      try {
        await updateUser(user.id, { role: newRole });
        await fetchUsers();
      } catch (err) {
        const msg =
          err instanceof AdminApiError
            ? err.message
            : "Failed to update user";
        setError(msg);
      } finally {
        setUpdating(null);
      }
    },
    [fetchUsers],
  );

  if (loading) {
    return <p className="text-text-secondary">Loading users...</p>;
  }

  return (
    <div>
      <h1 className="text-text-primary mb-6 text-2xl font-bold">User Management</h1>

      {error && (
        <div
          className="mb-4 rounded bg-red-500/10 px-4 py-2 text-red-400"
          role="alert"
          data-testid="users-error"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          data-testid="users-table"
        >
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-text-secondary px-3 py-2 font-medium">Email</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Role</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Status</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Created</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-white/5"
                data-testid={`user-row-${user.id}`}
              >
                <td className="text-text-primary px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user, e.target.value)}
                    disabled={updating === user.id}
                    className="bg-surface text-text-primary rounded border border-white/10 px-2 py-1 text-sm"
                    data-testid={`role-select-${user.id}`}
                    aria-label={`Role for ${user.email}`}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      user.enabled ? "text-green-400" : "text-red-400"
                    }
                  >
                    {user.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="text-text-secondary px-3 py-2">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(user)}
                    disabled={updating === user.id}
                    className="text-accent-primary hover:text-accent-primary/80 text-sm disabled:opacity-50"
                    data-testid={`toggle-enabled-${user.id}`}
                  >
                    {user.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <p className="text-text-secondary mt-4 text-center">No users found.</p>
      )}
    </div>
  );
}

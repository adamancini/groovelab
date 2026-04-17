import { Link, Outlet, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";

const NAV_ITEMS = [
  { to: "/admin", label: "Updates" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/tracks", label: "Tracks" },
  { to: "/admin/license", label: "License" },
  { to: "/admin/support", label: "Support" },
] as const;

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h1 className="text-text-primary text-2xl font-bold">Access Denied</h1>
        <p className="text-text-secondary mt-4">
          You do not have permission to access the admin panel.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
      {/* Sidebar */}
      <nav
        className="w-48 shrink-0"
        aria-label="Admin navigation"
        data-testid="admin-sidebar"
      >
        <ul className="space-y-1" role="list">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.to === "/admin"
                ? location.pathname === "/admin"
                : location.pathname.startsWith(item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`block rounded px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-accent-primary/20 text-accent-primary font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <hr className="my-4 border-white/10" />
        <Link
          to="/"
          className="text-text-secondary hover:text-text-primary block px-3 py-2 text-sm transition-colors"
          data-testid="back-to-app"
        >
          Back to App
        </Link>
      </nav>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

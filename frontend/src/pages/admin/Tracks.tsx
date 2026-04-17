import { useCallback, useEffect, useState } from "react";
import {
  listTracks,
  deleteTrack,
  type AdminTrack,
  AdminApiError,
} from "../../lib/adminApi";

export default function Tracks() {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTracks = useCallback(async () => {
    try {
      setError(null);
      const data = await listTracks();
      setTracks(data);
    } catch (err) {
      const msg =
        err instanceof AdminApiError ? err.message : "Failed to load tracks";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  const handleDelete = useCallback(
    async (trackId: string) => {
      setDeleting(true);
      setError(null);
      try {
        await deleteTrack(trackId);
        setConfirmDelete(null);
        await fetchTracks();
      } catch (err) {
        const msg =
          err instanceof AdminApiError
            ? err.message
            : "Failed to delete track";
        setError(msg);
      } finally {
        setDeleting(false);
      }
    },
    [fetchTracks],
  );

  if (loading) {
    return <p className="text-text-secondary">Loading tracks...</p>;
  }

  return (
    <div>
      <h1 className="text-text-primary mb-6 text-2xl font-bold">
        Track Administration
      </h1>

      {error && (
        <div
          className="mb-4 rounded bg-red-500/10 px-4 py-2 text-red-400"
          role="alert"
          data-testid="tracks-error"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          data-testid="tracks-table"
        >
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-text-secondary px-3 py-2 font-medium">Name</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Creator</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Chords</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Created</th>
              <th className="text-text-secondary px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr
                key={track.id}
                className="border-b border-white/5"
                data-testid={`track-row-${track.id}`}
              >
                <td className="text-text-primary px-3 py-2">{track.name}</td>
                <td className="text-text-secondary px-3 py-2">
                  {track.user_email}
                </td>
                <td className="text-text-secondary px-3 py-2">
                  {track.chord_count}
                </td>
                <td className="text-text-secondary px-3 py-2">
                  {new Date(track.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        window.open(`/play/${track.id}`, "_blank")
                      }
                      className="text-accent-primary hover:text-accent-primary/80 text-sm"
                      data-testid={`view-track-${track.id}`}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(track.id)}
                      className="text-red-400 hover:text-red-300 text-sm"
                      data-testid={`delete-track-${track.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tracks.length === 0 && (
        <p className="text-text-secondary mt-4 text-center">No tracks found.</p>
      )}

      {/* Confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="delete-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="bg-surface mx-4 w-full max-w-md rounded-lg border border-white/10 p-6 shadow-xl">
            <h2
              id="delete-dialog-title"
              className="text-text-primary mb-2 text-lg font-bold"
            >
              Confirm Delete
            </h2>
            <p className="text-text-secondary mb-6">
              Are you sure you want to delete this track? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="text-text-secondary hover:text-text-primary rounded px-4 py-2 text-sm transition-colors"
                data-testid="cancel-delete"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="rounded bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-50"
                data-testid="confirm-delete"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

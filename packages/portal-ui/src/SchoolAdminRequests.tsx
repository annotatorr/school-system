import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

type RequestStatus = 'pending' | 'approved' | 'rejected';

type AdminRequest = {
  id: string;
  school_id: string;
  applicant_user_id: string;
  reason: string | null;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  schoolName: string;
  schoolSlug: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhotoUrl: string;
};

const messageOf = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error);

  const value = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  };
  const parts = [value.message, value.details, value.hint].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (typeof value.code === 'string' && value.code) {
    parts.push(`Code ${value.code}`);
  }
  return parts.join(' · ') || 'Supabase returned an unspecified error.';
};

const dateLabel = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export function SchoolAdminRequests() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadRequests = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: rows, error: requestError } = await supabase
        .from('school_admin_requests')
        .select(
          'id,school_id,applicant_user_id,reason,status,reviewed_by,reviewed_at,review_notes,created_at',
        )
        .order('created_at', { ascending: false });

      if (requestError) throw requestError;

      const raw = rows ?? [];
      const schoolIds = [...new Set(raw.map((r) => r.school_id))];
      const applicantIds = [...new Set(raw.map((r) => r.applicant_user_id))];

      const [schoolResult, profileResult] = await Promise.all([
        schoolIds.length
          ? supabase.from('schools').select('id,name,slug').in('id', schoolIds)
          : Promise.resolve({ data: [], error: null }),
        applicantIds.length
          ? supabase
              .from('profiles')
              .select('id,full_name,display_name,email,avatar_url')
              .in('id', applicantIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (schoolResult.error) throw schoolResult.error;
      if (profileResult.error) throw profileResult.error;

      const schoolMap = new Map(
        (schoolResult.data ?? []).map((school) => [school.id, school]),
      );
      const profileMap = new Map(
        (profileResult.data ?? []).map((profile) => [profile.id, profile]),
      );
      const photoPaths = [...new Set(
        (profileResult.data ?? []).flatMap((profile) =>
          profile.avatar_url ? [profile.avatar_url] : [],
        ),
      )];
      const photoResult = photoPaths.length
        ? await supabase.storage.from('profile-photos').createSignedUrls(photoPaths, 3600)
        : { data: [], error: null };
      const photoMap = new Map(
        (photoResult.data ?? []).flatMap((photo) =>
          photo.path && photo.signedUrl ? [[photo.path, photo.signedUrl] as const] : [],
        ),
      );

      setRequests(
        raw.map((request) => {
          const school = schoolMap.get(request.school_id);
          const applicant = profileMap.get(request.applicant_user_id);

          return {
            ...request,
            status: request.status as RequestStatus,
            schoolName: school?.name ?? 'Unknown school',
            schoolSlug: school?.slug ?? '',
            applicantName:
              applicant?.display_name ||
              applicant?.full_name ||
              'Name not provided',
            applicantEmail: applicant?.email ?? 'Email unavailable',
            applicantPhotoUrl: applicant?.avatar_url
              ? photoMap.get(applicant.avatar_url) ?? ''
              : '',
          };
        }),
      );
    } catch (e) {
      setError(`Could not load administrator requests: ${messageOf(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function reviewRequest(
    request: AdminRequest,
    decision: 'approved' | 'rejected',
  ) {
    if (!supabase) return;

    const confirmation = window.confirm(
      decision === 'approved'
        ? `Approve ${request.applicantName} as an administrator for ${request.schoolName}?`
        : `Reject the administrator request for ${request.schoolName}?`,
    );

    if (!confirmation) return;

    setSavingId(request.id);
    setError('');
    setNotice('');

    try {
      const { error: reviewError } = await supabase.rpc(
        'platform_review_school_admin_request',
        {
          p_request_id: request.id,
          p_decision: decision,
          p_notes: notes[request.id]?.trim() || null,
        },
      );

      if (reviewError) throw reviewError;

      setNotice(
        decision === 'approved'
          ? `Request approved for ${request.schoolName}.`
          : `Request rejected for ${request.schoolName}.`,
      );

      await loadRequests();
    } catch (e) {
      setError(`Could not review request: ${messageOf(e)}`);
    } finally {
      setSavingId('');
    }
  }

  const handleNoteChange = (id: string, value: string) => {
    setNotes((prev) => ({ ...prev, [id]: value }));
  };

  const visibleRequests = requests.filter(
    (request) => filter === 'all' || request.status === filter,
  );

  const pendingCount = requests.filter(
    (request) => request.status === 'pending',
  ).length;

  return (
    <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>School administrator applications</h2>
            <p>Verify the applicant and school before granting portal access.</p>
          </div>
          <button
            className="pac-button pac-button-light"
            type="button"
            onClick={() => void loadRequests()}
            disabled={loading || Boolean(savingId)}
          >
            {loading ? 'Refreshing…' : 'Refresh requests'}
          </button>
        </div>

        <div className="pac-request-metrics">
          <div className="pac-request-metric">
            <span>Total applications</span>
            <strong>{requests.length}</strong>
          </div>
          <div className="pac-request-metric pending">
            <span>Awaiting review</span>
            <strong>{pendingCount}</strong>
          </div>
        </div>

        {notice && <div className="pac-alert pac-notice" role="status">{notice}</div>}
        {error && <div className="pac-alert pac-error" role="alert">{error}</div>}

        <div className="pac-toolbar">
          <label className="pac-field pac-request-filter">
            <span>Application status</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as RequestStatus | 'all')}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All applications</option>
            </select>
          </label>
          <span className="pac-result-count">
            {visibleRequests.length} shown
          </span>
        </div>

        <div className="pac-list">
          {loading && requests.length === 0 ? (
            <div className="pac-empty">
              <span className="pac-spinner" />
              <p>Loading administrator applications…</p>
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="pac-empty">
              <div className="pac-empty-icon">♙</div>
              <strong>No applications found</strong>
              <p>No requests match this status filter.</p>
            </div>
          ) : (
            <div className="pac-table-wrap">
              <table className="pac-table pac-requests-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>School</th>
                    <th>Reason</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <div className="pac-request-person">
                          <span className="pac-request-avatar">
                            {request.applicantPhotoUrl ? (
                              <img src={request.applicantPhotoUrl} alt="" />
                            ) : (
                              request.applicantName.trim().charAt(0).toUpperCase() || 'A'
                            )}
                          </span>
                          <span>
                            <strong>{request.applicantName}</strong>
                            <span className="pac-muted">{request.applicantEmail}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong>{request.schoolName}</strong>
                        <div className="pac-muted">{request.schoolSlug ? `/${request.schoolSlug}` : ''}</div>
                      </td>
                      <td>{request.reason || <span className="pac-muted">None provided</span>}</td>
                      <td>{dateLabel(request.created_at)}</td>
                      <td>
                        <span className={`pac-pill pac-pill-${request.status}`}>
                          <span className="pac-pill-dot" />
                          {request.status}
                        </span>
                        {request.reviewed_at && (
                          <div className="pac-muted">Reviewed {dateLabel(request.reviewed_at)}</div>
                        )}
                      </td>
                      <td>
                        {request.status === 'pending' ? (
                          <div className="pac-request-review">
                            <textarea
                              className="pac-request-notes"
                              aria-label={`Review notes for ${request.applicantName}`}
                              value={notes[request.id] ?? ''}
                              onChange={(event) =>
                                handleNoteChange(request.id, event.target.value)
                              }
                              placeholder="Optional review notes"
                              rows={2}
                            />
                            <div className="pac-row-actions">
                              <button
                                className="pac-button pac-button-primary pac-button-small"
                                type="button"
                                disabled={Boolean(savingId)}
                                onClick={() => void reviewRequest(request, 'approved')}
                              >
                                {savingId === request.id ? 'Saving…' : 'Approve'}
                              </button>
                              <button
                                className="pac-button pac-button-danger pac-button-small"
                                type="button"
                                disabled={Boolean(savingId)}
                                onClick={() => void reviewRequest(request, 'rejected')}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="pac-request-history">
                            <span className="pac-muted">
                              {request.reviewed_by ? 'Reviewed by administrator' : 'Previously reviewed'}
                            </span>
                            {request.review_notes && <p>{request.review_notes}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
    </section>
  );
}

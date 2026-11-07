import PlatformOperationsDashboard from './PlatformOperationsDashboard';
import {
  PlatformAuditPage,
  PlatformPaymentsPage,
  PlatformReportsPage,
  PlatformRevenuePage,
  PlatformSettingsPage,
  PlatformSupportPage,
  PlatformUsersPage,
} from './PlatformAdminSections';
import { SchoolAdminRequests } from './SchoolAdminRequests';
import { ThemeToggle } from './ThemeToggle';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { supabase } from './supabase';

type SchoolStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'rejected'
  | 'archived';

type AdminPage =
  | 'overview'
  | 'schools'
  | 'subscriptions'
  | 'admin-requests'
  | 'revenue'
  | 'payments'
  | 'users'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'support';

type School = {
  id: string;
  name: string;
  slug: string;
  registration_number: string | null;
  school_type: string | null;
  motto: string | null;
  logo_path: string | null;
  county: string | null;
  sub_county: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: SchoolStatus;
  subscription_status: string;
  subscription_plan: string | null;
  subscription_amount_kes: number | null;
  subscription_started_at: string | null;
  subscription_ends_at: string | null;
  subscription_notes: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
};

type Overview = {
  total_schools: number;
  pending_schools: number;
  active_schools: number;
  suspended_schools: number;
  trial_subscriptions: number;
  active_subscriptions: number;
  overdue_subscriptions: number;
  cancelled_subscriptions: number;
};

const emptyOverview: Overview = {
  total_schools: 0,
  pending_schools: 0,
  active_schools: 0,
  suspended_schools: 0,
  trial_subscriptions: 0,
  active_subscriptions: 0,
  overdue_subscriptions: 0,
  cancelled_subscriptions: 0,
};

const initialSchoolForm = {
  name: '',
  slug: '',
  registration_number: '',
  school_type: '',
  county: '',
  sub_county: '',
  address: '',
  phone: '',
  email: '',
  motto: '',
};

const dateForInput = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : '';

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const displayDate = (value: string | null | undefined) => {
  if (!value) return '—';

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);

  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : undefined,
      });
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error);

  const value = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  };
  const parts = [value.message, value.details, value.hint]
    .filter((part): part is string => typeof part === 'string' && part.length > 0);
  if (typeof value.code === 'string' && value.code) parts.push(`Code ${value.code}`);
  return parts.join(' · ') || 'Supabase returned an unspecified error.';
};

const statusLabel = (status: string) =>
  status.replace(/_/g, ' ');

const formatAmount = (amount: number | null) =>
  amount == null
    ? 'Not set'
    : `KSh ${amount.toLocaleString('en-KE', {
        maximumFractionDigits: 2,
      })}`;

const schoolLogoUrl = (path: string | null) =>
  path && supabase
    ? supabase.storage.from('school-logos').getPublicUrl(path).data.publicUrl
    : '';

export function PlatformAdminControlCentre({
  onProfile = () => {},
}: {
  onProfile?: () => void;
}) {
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<AdminPage>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState(initialSchoolForm);
  const [schoolLogo, setSchoolLogo] = useState<File | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const [subscriptionStatus, setSubscriptionStatus] = useState('trial');
  const [subscriptionPlan, setSubscriptionPlan] = useState('');
  const [subscriptionAmount, setSubscriptionAmount] = useState('');
  const [subscriptionStart, setSubscriptionStart] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');
  const [subscriptionNotes, setSubscriptionNotes] = useState('');

  const selectedSchool = useMemo(
    () => schools.find((school) => school.id === selectedSchoolId) ?? null,
    [schools, selectedSchoolId],
  );

  const filteredSchools = useMemo(() => {
    const term = search.trim().toLowerCase();

    return schools.filter((school) => {
      const matchesSearch =
        !term ||
        [
          school.name,
          school.slug,
          school.registration_number,
          school.county,
          school.email,
          school.phone,
        ].some((value) => (value ?? '').toLowerCase().includes(term));

      const matchesStatus =
        statusFilter === 'all' || school.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [schools, search, statusFilter]);

  const navigateTo = (nextPage: AdminPage, filter = 'all') => {
    setPage(nextPage);

    if (nextPage === 'schools') {
      setStatusFilter(filter);
    }

    setNotice('');
    setError('');
  };

  const loadData = useCallback(async () => {
    if (!supabase) return;

    setLoading(true);
    setError('');

    try {
      const [schoolResult, overviewResult] = await Promise.all([
        supabase
          .from('schools')
          .select(
            'id,name,slug,registration_number,school_type,motto,logo_path,county,sub_county,address,phone,email,status,subscription_status,subscription_plan,subscription_amount_kes,subscription_started_at,subscription_ends_at,subscription_notes,suspended_at,suspension_reason,created_at',
          )
          .order('created_at', { ascending: false }),
        supabase.rpc('platform_admin_overview'),
      ]);

      if (schoolResult.error) throw schoolResult.error;

      setSchools((schoolResult.data ?? []) as School[]);

      if (overviewResult.error) {
        setError(
          `Could not load platform overview: ${errorMessage(overviewResult.error)}`,
        );
      } else {
        setOverview({
          ...emptyOverview,
          ...(overviewResult.data ?? {}),
        });
      }
    } catch (e) {
      setError(`Could not load platform data: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (!supabase) {
        setError(
          'Supabase is not configured. Check the portal .env file and restart Vite.',
        );
        setCheckingAccess(false);
        return;
      }

      try {
        const { data: userData, error: userError } =
          await supabase.auth.getUser();

        if (userError) throw userError;

        const user = userData.user;

        if (!user) {
          if (!cancelled) {
            setError(
              'Sign in with your Platform Admin account to continue.',
            );
            setAuthorized(false);
          }
          return;
        }

        const { data, error: adminError } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (adminError) throw adminError;

        if (!cancelled) {
          setAuthorized(Boolean(data));

          if (!data) {
            setError(
              'Access denied. This account is not registered as a Platform Admin.',
            );
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not verify Platform Admin access: ${errorMessage(e)}`,
          );
        }
      } finally {
        if (!cancelled) setCheckingAccess(false);
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authorized) void loadData();
  }, [authorized, loadData]);

  useEffect(() => {
    if (!selectedSchool) return;

    setSubscriptionStatus(selectedSchool.subscription_status || 'trial');
    setSubscriptionPlan(selectedSchool.subscription_plan || '');
    setSubscriptionAmount(
      selectedSchool.subscription_amount_kes == null
        ? ''
        : String(selectedSchool.subscription_amount_kes),
    );
    setSubscriptionStart(
      dateForInput(selectedSchool.subscription_started_at),
    );
    setSubscriptionEnd(
      dateForInput(selectedSchool.subscription_ends_at),
    );
    setSubscriptionNotes(selectedSchool.subscription_notes || '');
  }, [selectedSchool]);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const { data: schoolId, error: rpcError } = await supabase.rpc(
        'platform_register_school',
        {
          p_name: form.name.trim(),
          p_slug: slugify(form.slug),
          p_registration_number: form.registration_number.trim() || null,
          p_school_type: form.school_type || null,
          p_county: form.county.trim() || null,
          p_sub_county: form.sub_county.trim() || null,
          p_address: form.address.trim() || null,
          p_phone: form.phone.trim() || null,
          p_email: form.email.trim() || null,
        },
      );

      if (rpcError) throw rpcError;

      let brandingWarning = '';
      if (schoolId) {
        const { error: mottoError } = await supabase
          .from('schools')
          .update({ motto: form.motto.trim() || null })
          .eq('id', schoolId);

        if (mottoError) {
          brandingWarning = `School registered, but motto was not saved: ${mottoError.message}`;
        }

        if (schoolLogo) {
          const extension = schoolLogo.type === 'image/png'
            ? 'png'
            : schoolLogo.type === 'image/webp'
              ? 'webp'
              : 'jpg';
          const logoPath = `${schoolId}/logo.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from('school-logos')
            .upload(logoPath, schoolLogo, {
              upsert: true,
              contentType: schoolLogo.type,
            });

          if (uploadError) {
            brandingWarning = `School registered, but logo upload failed: ${uploadError.message}`;
          } else {
            const { error: logoError } = await supabase
              .from('schools')
              .update({ logo_path: logoPath })
              .eq('id', schoolId);
            if (logoError) {
              brandingWarning = `School registered, but logo path was not saved: ${logoError.message}`;
            }
          }
        }
      }

      setForm(initialSchoolForm);
      setSchoolLogo(null);
      setSlugManuallyEdited(false);
      setNotice(
        brandingWarning || 'School registered successfully with Pending status.',
      );
      setPage('schools');
      setStatusFilter('all');
      await loadData();
    } catch (e) {
      setError(`School registration failed: ${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function changeSchoolStatus(
    school: School,
    nextStatus: 'active' | 'suspended',
  ) {
    if (!supabase) return;

    let reason: string | null = null;

    if (nextStatus === 'suspended') {
      reason =
        window.prompt(`Why are you suspending ${school.name}?`)?.trim() ||
        null;

      if (!reason) {
        setNotice('Suspension cancelled. A reason is required.');
        return;
      }

      const confirmed = window.confirm(
        `Suspend ${school.name}?\n\nReason: ${reason}\n\nThe school's records will not be deleted.`,
      );

      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `Activate ${school.name}?\n\nThis changes its school status to Active.`,
      );

      if (!confirmed) return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const { error: rpcError } = await supabase.rpc(
        'platform_set_school_status',
        {
          p_school_id: school.id,
          p_status: nextStatus,
          p_reason: reason,
        },
      );

      if (rpcError) throw rpcError;

      setNotice(
        nextStatus === 'active'
          ? `${school.name} is now Active.`
          : `${school.name} has been suspended. Its records have not been deleted.`,
      );

      await loadData();
    } catch (e) {
      setError(`Could not change school status: ${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function uploadSchoolLogo(school: School, file: File | undefined) {
    if (!supabase || !file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP logo smaller than 2 MB.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const extension = file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'jpg';
      const logoPath = `${school.id}/logo.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('school-logos')
        .upload(logoPath, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('schools')
        .update({ logo_path: logoPath })
        .eq('id', school.id);
      if (updateError) throw updateError;

      setNotice(`Logo saved for ${school.name}.`);
      await loadData();
    } catch (uploadError) {
      setError(`Could not upload school logo: ${errorMessage(uploadError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedSchool) return;

    const amount =
      subscriptionAmount.trim() === ''
        ? null
        : Number(subscriptionAmount);

    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError('Enter a valid non-negative subscription amount.');
      return;
    }

    if (
      subscriptionStart &&
      subscriptionEnd &&
      subscriptionEnd < subscriptionStart
    ) {
      setError(
        'The subscription end date cannot be before the start date.',
      );
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const { error: rpcError } = await supabase.rpc(
        'platform_update_subscription',
        {
          p_school_id: selectedSchool.id,
          p_subscription_status: subscriptionStatus,
          p_plan: subscriptionPlan.trim() || null,
          p_amount_kes: amount,
          p_started_at: subscriptionStart || null,
          p_ends_at: subscriptionEnd || null,
          p_notes: subscriptionNotes.trim() || null,
        },
      );

      if (rpcError) throw rpcError;

      setNotice(
        `Subscription details saved for ${selectedSchool.name}. This does not record a payment.`,
      );

      await loadData();
    } catch (e) {
      setError(`Could not save subscription: ${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (checkingAccess) {
    return (
      <div className="pac-shell">
        <div className="pac-loading-card">
          <span className="pac-spinner" />
          <div>
            <strong>Verifying administrator access</strong>
            <p>Please wait while your account is checked.</p>
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="pac-shell">
        <div className="pac-access-card">
          <div className="pac-access-icon">!</div>
          <p className="pac-eyebrow">Platform security</p>
          <h1>Access unavailable</h1>
          <p className="pac-access-message">
            {error || 'Access denied.'}
          </p>
          <p className="pac-muted">
            Sign in using an authorised Platform Admin account. If you
            believe this is an error, verify the account's platform admin
            registration.
          </p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // The Overview page is the full-screen operations dashboard. It has its own
  // sidebar, so the light header and tab bar below are not rendered with it.
  if (page === 'overview') {
    return (
      <PlatformOperationsDashboard
        schools={schools}
        overview={overview}
        loading={loading}
        loadError={error}
        onRefresh={() => void loadData()}
        onNavigate={navigateTo}
        onSignOut={() => void signOut()}
        onProfile={onProfile}
      />
    );
  }

  return (
    <div className="pac-shell">
      <style>{styles}</style>

      <div className="pac-wrap">
        <header className="pac-head">
          <div className="pac-brand">
            <div className="pac-brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="25"
                height="25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-5h6v5" />
                <path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01" />
              </svg>
            </div>

            <div>
              <div className="pac-kicker">
                SCHHOL SYSTEM <span>·</span> PLATFORM OPERATIONS
              </div>
              <h1 className="pac-title">Platform Admin</h1>
              <p className="pac-subtitle">
                Your central workspace for managing schools and subscriptions.
              </p>
            </div>
          </div>

          <div className="pac-actions">
            <ThemeToggle />
            <button
              className="pac-button pac-refresh"
              onClick={() => void loadData()}
              disabled={loading || saving}
            >
              <span className={loading ? 'pac-refresh-icon spinning' : 'pac-refresh-icon'}>
                ↻
              </span>
              {loading ? 'Refreshing…' : 'Refresh data'}
            </button>
            <button
              className="pac-button pac-refresh"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="pac-status-strip">
          <span className="pac-status-dot" />
          <span>Platform administration</span>
          <span className="pac-strip-separator">/</span>
          <span>{schools.length} school records loaded</span>
          <span className="pac-strip-spacer" />
          <span className="pac-secure-label">
            <span aria-hidden="true">◆</span> Restricted workspace
          </span>
        </div>

        {error && (
          <div className="pac-alert pac-error" role="alert">
            <span className="pac-alert-symbol">!</span>
            <div>
              <strong>Something needs attention</strong>
              <p>{error}</p>
            </div>
            <button
              className="pac-dismiss"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="pac-alert pac-notice" role="status">
            <span className="pac-alert-symbol">✓</span>
            <div>
              <strong>Update</strong>
              <p>{notice}</p>
            </div>
            <button
              className="pac-dismiss"
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              ×
            </button>
          </div>
        )}

        <nav className="pac-nav" aria-label="Platform admin sections">
          <button
            className="pac-nav-button"
            onClick={() => navigateTo('overview')}
          >
            <span className="pac-nav-icon">▦</span>
            Overview
          </button>

          <button
            className={`pac-nav-button ${page === 'schools' ? 'selected' : ''}`}
            aria-current={page === 'schools' ? 'page' : undefined}
            onClick={() => navigateTo('schools')}
          >
            <span className="pac-nav-icon">▤</span>
            Schools
            <span className="pac-nav-count">{schools.length}</span>
          </button>

          <button
            className={`pac-nav-button ${page === 'admin-requests' ? 'selected' : ''}`}
            aria-current={page === 'admin-requests' ? 'page' : undefined}
            onClick={() => navigateTo('admin-requests')}
          >
            <span className="pac-nav-icon">♙</span>
            Administrator requests
          </button>

          <button
            className={`pac-nav-button ${page === 'subscriptions' ? 'selected' : ''}`}
            aria-current={page === 'subscriptions' ? 'page' : undefined}
            onClick={() => navigateTo('subscriptions')}
          >
            <span className="pac-nav-icon">◷</span>
            Subscriptions
          </button>

          <button
            className={`pac-nav-button ${page === 'revenue' ? 'selected' : ''}`}
            aria-current={page === 'revenue' ? 'page' : undefined}
            onClick={() => navigateTo('revenue')}
          >
            <span className="pac-nav-icon">◆</span>
            Revenue
          </button>

          <button
            className={`pac-nav-button ${page === 'payments' ? 'selected' : ''}`}
            aria-current={page === 'payments' ? 'page' : undefined}
            onClick={() => navigateTo('payments')}
          >
            <span className="pac-nav-icon">◈</span>
            Payments
          </button>

          <button
            className={`pac-nav-button ${page === 'users' ? 'selected' : ''}`}
            aria-current={page === 'users' ? 'page' : undefined}
            onClick={() => navigateTo('users')}
          >
            <span className="pac-nav-icon">♙</span>
            Users and roles
          </button>

          <button
            className={`pac-nav-button ${page === 'reports' ? 'selected' : ''}`}
            aria-current={page === 'reports' ? 'page' : undefined}
            onClick={() => navigateTo('reports')}
          >
            <span className="pac-nav-icon">▧</span>
            Reports
          </button>

          <button
            className={`pac-nav-button ${page === 'audit' ? 'selected' : ''}`}
            aria-current={page === 'audit' ? 'page' : undefined}
            onClick={() => navigateTo('audit')}
          >
            <span className="pac-nav-icon">▤</span>
            Audit log
          </button>

          <button
            className={`pac-nav-button ${page === 'settings' ? 'selected' : ''}`}
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => navigateTo('settings')}
          >
            <span className="pac-nav-icon">⚙</span>
            Settings
          </button>

          <button
            className={`pac-nav-button ${page === 'support' ? 'selected' : ''}`}
            aria-current={page === 'support' ? 'page' : undefined}
            onClick={() => navigateTo('support')}
          >
            <span className="pac-nav-icon">?</span>
            Support
          </button>
        </nav>

        {page === 'schools' && (
          <>
            <section className="pac-page-intro">
              <div>
                <p className="pac-eyebrow">SCHOOL DIRECTORY</p>
                <h2>Registered schools</h2>
                <p>
                  Register schools, review their current status and manage
                  their subscription records.
                </p>
              </div>
              <div className="pac-intro-count">
                <strong>{schools.length}</strong>
                <span>Total records</span>
              </div>
            </section>

            <section className="pac-panel">
              <div className="pac-section-heading">
                <div>
                  <h2>Register a school</h2>
                  <p>
                    New schools are created with Pending status. This does not
                    create a school administrator login.
                  </p>
                </div>
                <span className="pac-required-label">* Required fields</span>
              </div>

              <form onSubmit={handleRegister}>
                <div className="pac-form-grid">
                  <div className="pac-field">
                    <label htmlFor="school-name">School name *</label>
                    <input
                      id="school-name"
                      required
                      maxLength={160}
                      value={form.name}
                      placeholder="e.g. Green Valley School"
                      onChange={(e) => {
                        const name = e.target.value;
                        setForm((current) => ({
                          ...current,
                          name,
                          slug: slugManuallyEdited
                            ? current.slug
                            : slugify(name),
                        }));
                      }}
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-code">Unique school code *</label>
                    <input
                      id="school-code"
                      required
                      maxLength={100}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      title="Use lowercase letters, numbers and single hyphens."
                      value={form.slug}
                      placeholder="green-valley-school"
                      onChange={(e) => {
                        setSlugManuallyEdited(true);
                        setForm((current) => ({
                          ...current,
                          slug: slugify(e.target.value),
                        }));
                      }}
                    />
                    <span className="pac-field-help">
                      Lowercase letters, numbers and hyphens only.
                    </span>
                  </div>

                  <div className="pac-field">
                    <label htmlFor="registration-number">
                      Registration number
                    </label>
                    <input
                      id="registration-number"
                      value={form.registration_number}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          registration_number: e.target.value,
                        })
                      }
                      placeholder="Official registration reference"
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-type">School type</label>
                    <select
                      id="school-type"
                      value={form.school_type}
                      onChange={(e) =>
                        setForm({ ...form, school_type: e.target.value })
                      }
                    >
                      <option value="">Select type</option>
                      <option value="primary">Primary</option>
                      <option value="junior_secondary">Junior secondary</option>
                      <option value="secondary">Secondary</option>
                      <option value="integrated">Integrated</option>
                      <option value="college">College</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-motto">School motto</label>
                    <input
                      id="school-motto"
                      maxLength={180}
                      value={form.motto}
                      onChange={(event) =>
                        setForm({ ...form, motto: event.target.value })
                      }
                      placeholder="A short school motto"
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-logo">School logo</label>
                    <input
                      id="school-logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) =>
                        setSchoolLogo(event.target.files?.[0] ?? null)
                      }
                    />
                    <span className="pac-field-help">PNG, JPG or WebP · Maximum 2 MB</span>
                  </div>

                  <div className="pac-field">
                    <label htmlFor="county">County</label>
                    <input
                      id="county"
                      value={form.county}
                      onChange={(e) =>
                        setForm({ ...form, county: e.target.value })
                      }
                      placeholder="County"
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="sub-county">Sub-county</label>
                    <input
                      id="sub-county"
                      value={form.sub_county}
                      onChange={(e) =>
                        setForm({ ...form, sub_county: e.target.value })
                      }
                      placeholder="Sub-county"
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-phone">Phone number</label>
                    <input
                      id="school-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                      placeholder="+254..."
                    />
                  </div>

                  <div className="pac-field">
                    <label htmlFor="school-email">Email address</label>
                    <input
                      id="school-email"
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm({ ...form, email: e.target.value })
                      }
                      placeholder="school@example.com"
                    />
                  </div>

                  <div className="pac-field pac-span">
                    <label htmlFor="school-address">Physical address</label>
                    <textarea
                      id="school-address"
                      value={form.address}
                      onChange={(e) =>
                        setForm({ ...form, address: e.target.value })
                      }
                      placeholder="School location or postal address"
                    />
                  </div>
                </div>

                <div className="pac-form-footer">
                  <p>
                    <span className="pac-status-dot pac-dot-amber" />
                    Newly registered schools start as Pending.
                  </p>
                  <div className="pac-actions">
                    <button
                      className="pac-button"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setForm(initialSchoolForm);
                        setSlugManuallyEdited(false);
                      }}
                    >
                      Clear form
                    </button>
                    <button
                      className="pac-button pac-button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? 'Registering…' : '＋ Register school'}
                    </button>
                  </div>
                </div>
              </form>
            </section>

            <section className="pac-panel">
              <div className="pac-section-heading">
                <div>
                  <h2>School directory</h2>
                  <p>
                    Search records and review school status and subscription
                    details.
                  </p>
                </div>
                <span className="pac-result-count">
                  {filteredSchools.length} of {schools.length}
                </span>
              </div>

              <div className="pac-toolbar">
                <div className="pac-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="Search schools"
                    placeholder="Search name, code, county or contact…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <select
                  aria-label="Filter school status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All school statuses</option>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="rejected">Rejected</option>
                  <option value="archived">Archived</option>
                </select>

                {(search || statusFilter !== 'all') && (
                  <button
                    className="pac-button pac-button-light"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {loading ? (
                <div className="pac-empty">
                  <span className="pac-spinner" />
                  <p>Loading school records…</p>
                </div>
              ) : filteredSchools.length === 0 ? (
                <div className="pac-empty">
                  <div className="pac-empty-icon">⌕</div>
                  <strong>No matching schools</strong>
                  <p>
                    Try another search or change the status filter.
                  </p>
                </div>
              ) : (
                <div className="pac-table-wrap">
                  <table className="pac-table">
                    <thead>
                      <tr>
                        <th>School</th>
                        <th>Location</th>
                        <th>School status</th>
                        <th>Subscription</th>
                        <th>Registered</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSchools.map((school) => (
                        <tr key={school.id}>
                          <td>
                            <div className="pac-school-cell">
                              <div className="pac-school-avatar">
                                {schoolLogoUrl(school.logo_path) ? (
                                  <img src={schoolLogoUrl(school.logo_path)} alt={`${school.name} logo`} />
                                ) : (
                                  school.name.trim().charAt(0).toUpperCase() || 'S'
                                )}
                              </div>
                              <div>
                                <strong>{school.name}</strong>
                                <div className="pac-muted">{school.slug}</div>
                                <div className="pac-muted">
                                  {school.email ||
                                    school.phone ||
                                    'No contact details'}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td>
                            {[school.sub_county, school.county]
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </td>

                          <td>
                            <span
                              className={`pac-pill pac-pill-${school.status}`}
                            >
                              <span className="pac-pill-dot" />
                              {statusLabel(school.status)}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`pac-pill pac-pill-${school.subscription_status}`}
                            >
                              {statusLabel(school.subscription_status)}
                            </span>
                            <div className="pac-muted">
                              {school.subscription_plan || 'No plan set'}
                            </div>
                            <div className="pac-muted">
                              {formatAmount(school.subscription_amount_kes)}
                            </div>
                            <div className="pac-muted">
                              Renewal: {displayDate(school.subscription_ends_at)}
                            </div>
                          </td>

                          <td>{displayDate(school.created_at)}</td>

                          <td>
                            <div className="pac-row-actions">
                              <label className="pac-button pac-button-light pac-button-small pac-file-action">
                                {school.logo_path ? 'Replace logo' : 'Add logo'}
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  aria-label={`Upload logo for ${school.name}`}
                                  disabled={saving}
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    void uploadSchoolLogo(school, file);
                                  }}
                                />
                              </label>
                              {school.status !== 'active' && (
                                <button
                                  className="pac-button pac-button-small"
                                  disabled={saving}
                                  onClick={() =>
                                    void changeSchoolStatus(school, 'active')
                                  }
                                >
                                  Activate
                                </button>
                              )}

                              {school.status !== 'suspended' &&
                                school.status !== 'archived' && (
                                  <button
                                    className="pac-button pac-button-danger pac-button-small"
                                    disabled={saving}
                                    onClick={() =>
                                      void changeSchoolStatus(
                                        school,
                                        'suspended',
                                      )
                                    }
                                  >
                                    Suspend
                                  </button>
                                )}

                              <button
                                className="pac-button pac-button-light pac-button-small"
                                onClick={() => {
                                  setSelectedSchoolId(school.id);
                                  navigateTo('subscriptions');
                                }}
                              >
                                Subscription
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {page === 'admin-requests' && (
          <section className="pac-requests-section">
            <div className="pac-page-intro">
              <div>
                <p className="pac-eyebrow">ACCESS GOVERNANCE</p>
                <h2>Administrator requests</h2>
                <p>
                  Review school administrator applications through the existing
                  request-review component.
                </p>
              </div>
            </div>
            <SchoolAdminRequests />
          </section>
        )}

        {page === 'subscriptions' && (
          <>
            <section className="pac-page-intro">
              <div>
                <p className="pac-eyebrow">BILLING RECORDS</p>
                <h2>Subscription management</h2>
                <p>
                  Maintain each school's subscription plan, status, amount and
                  renewal dates.
                </p>
              </div>
            </section>

            <section className="pac-panel">
              <div className="pac-section-heading">
                <div>
                  <h2>Subscription details</h2>
                  <p>
                    Select a school to load and update its subscription record.
                  </p>
                </div>
              </div>

              <div className="pac-school-selector">
                <div className="pac-field">
                  <label htmlFor="subscription-school">Select school</label>
                  <select
                    id="subscription-school"
                    value={selectedSchoolId}
                    onChange={(e) => setSelectedSchoolId(e.target.value)}
                  >
                    <option value="">Choose a registered school</option>
                    {schools.map((school) => (
                      <option value={school.id} key={school.id}>
                        {school.name} ({school.slug})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedSchool && (
                  <div className="pac-selected-summary">
                    <div className="pac-school-avatar">
                      {schoolLogoUrl(selectedSchool.logo_path) ? (
                        <img src={schoolLogoUrl(selectedSchool.logo_path)} alt={`${selectedSchool.name} logo`} />
                      ) : (
                        selectedSchool.name.trim().charAt(0).toUpperCase() || 'S'
                      )}
                    </div>
                    <div>
                      <strong>{selectedSchool.name}</strong>
                      <div className="pac-muted">{selectedSchool.slug}</div>
                    </div>
                    <span
                      className={`pac-pill pac-pill-${selectedSchool.status}`}
                    >
                      {statusLabel(selectedSchool.status)}
                    </span>
                  </div>
                )}
              </div>

              {!selectedSchool ? (
                <div className="pac-empty">
                  <div className="pac-empty-icon">◷</div>
                  <strong>Select a school to continue</strong>
                  <p>
                    Its existing subscription details will appear here.
                  </p>
                </div>
              ) : (
                <form onSubmit={saveSubscription}>
                  <div className="pac-form-grid pac-subscription-form">
                    <div className="pac-field">
                      <label htmlFor="subscription-status">
                        Subscription status
                      </label>
                      <select
                        id="subscription-status"
                        value={subscriptionStatus}
                        onChange={(e) =>
                          setSubscriptionStatus(e.target.value)
                        }
                      >
                        <option value="trial">Trial</option>
                        <option value="active">Active</option>
                        <option value="overdue">Overdue</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div className="pac-field">
                      <label htmlFor="subscription-plan">Plan name</label>
                      <input
                        id="subscription-plan"
                        value={subscriptionPlan}
                        onChange={(e) => setSubscriptionPlan(e.target.value)}
                        placeholder="e.g. Standard annual"
                      />
                    </div>

                    <div className="pac-field">
                      <label htmlFor="subscription-amount">
                        Subscription amount (KSh)
                      </label>
                      <input
                        id="subscription-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={subscriptionAmount}
                        onChange={(e) =>
                          setSubscriptionAmount(e.target.value)
                        }
                        placeholder="0.00"
                      />
                    </div>

                    <div className="pac-field">
                      <label htmlFor="subscription-start">Start date</label>
                      <input
                        id="subscription-start"
                        type="date"
                        value={subscriptionStart}
                        onChange={(e) => setSubscriptionStart(e.target.value)}
                      />
                    </div>

                    <div className="pac-field">
                      <label htmlFor="subscription-end">
                        End / renewal date
                      </label>
                      <input
                        id="subscription-end"
                        type="date"
                        value={subscriptionEnd}
                        onChange={(e) => setSubscriptionEnd(e.target.value)}
                      />
                    </div>

                    <div className="pac-field pac-span">
                      <label htmlFor="subscription-notes">Internal notes</label>
                      <textarea
                        id="subscription-notes"
                        value={subscriptionNotes}
                        onChange={(e) => setSubscriptionNotes(e.target.value)}
                        placeholder="Record the agreed plan or renewal notes. Do not store passwords, API keys or other secrets here."
                      />
                    </div>
                  </div>

                  <div className="pac-form-footer">
                    <p>
                      <span className="pac-status-dot pac-dot-blue" />
                      Saving updates the subscription record only.
                    </p>
                    <button
                      className="pac-button pac-button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? 'Saving…' : 'Save subscription details'}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <div className="pac-info-banner">
              <span className="pac-info-icon">i</span>
              <div>
                <strong>Payment status is not verified here</strong>
                <p>
                  These controls maintain subscription records. They do not
                  initiate M-Pesa or bank payments, confirm a transaction, or
                  automatically suspend a school when a payment is overdue.
                </p>
              </div>
            </div>
          </>
        )}

        {page === 'revenue' && <PlatformRevenuePage schools={schools} />}

        {page === 'payments' && <PlatformPaymentsPage schools={schools} />}

        {page === 'users' && <PlatformUsersPage />}

        {page === 'reports' && <PlatformReportsPage schools={schools} />}

        {page === 'audit' && <PlatformAuditPage schools={schools} />}

        {page === 'settings' && <PlatformSettingsPage />}

        {page === 'support' && <PlatformSupportPage schools={schools} />}

        <footer className="pac-footer">
          <span>Schhol System · Platform Administration</span>
          <span>
            School records and subscription status are managed separately.
          </span>
        </footer>
      </div>
    </div>
  );
}

const styles = `
.pac-shell {
  min-height: 100vh;
  padding: 28px;
  background: #f4f6fb;
  color: #1b2940;
  font-family: 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-sizing: border-box;
}
.pac-shell * { box-sizing: border-box; }
.pac-wrap { width: 100%; max-width: 1480px; margin: 0 auto; }
.pac-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 20px; flex-wrap: wrap; margin-bottom: 20px;
}
.pac-brand { display: flex; align-items: center; gap: 15px; }
.pac-brand-mark {
  width: 52px; height: 52px; display: grid; place-items: center;
  color: white; background: linear-gradient(145deg,#315bd4,#2445a7);
  border-radius: 16px; box-shadow: 0 8px 18px #315bd426; flex-shrink: 0;
}
.pac-kicker {
  font-size: 10px; letter-spacing: 1.45px; font-weight: 800;
  color: #6176bf;
}
.pac-kicker span { padding: 0 4px; color: #aab4c9; }
.pac-title {
  font: 800 clamp(23px,3vw,31px)/1.2 Manrope, sans-serif;
  letter-spacing: -1px; margin: 6px 0;
}
.pac-subtitle { color: #7a879b; font-size: 13px; line-height: 1.65; margin: 0; }
.pac-refresh { min-width: 145px; }
.pac-refresh-icon { font-size: 18px; line-height: 1; }
.pac-refresh-icon.spinning { display: inline-block; animation: pac-rotate .8s linear infinite; }
@keyframes pac-rotate { to { transform: rotate(360deg); } }

.pac-status-strip {
  min-height: 43px; display: flex; align-items: center; gap: 9px;
  flex-wrap: wrap; padding: 10px 14px; margin-bottom: 18px;
  background: white; border: 1px solid #e5eaf3; border-radius: 11px;
  color: #6f7e94; font-size: 11px;
}
.pac-status-dot {
  width: 7px; height: 7px; display: inline-block; flex-shrink: 0;
  border-radius: 50%; background: #20ad78;
}
.pac-dot-amber { background: #d99b31; }
.pac-dot-blue { background: #5176dc; }
.pac-strip-separator { color: #c6cedb; }
.pac-strip-spacer { flex: 1; }
.pac-secure-label { color: #5268b4; font-weight: 700; }
.pac-secure-label span { font-size: 9px; margin-right: 4px; }

.pac-nav {
  display: flex; gap: 5px; flex-wrap: wrap; padding: 6px;
  background: white; border: 1px solid #e5eaf3; border-radius: 13px;
  margin-bottom: 25px;
}
.pac-nav-button {
  min-height: 41px; display: inline-flex; align-items: center; gap: 9px;
  padding: 10px 14px; border: 1px solid transparent; border-radius: 9px;
  background: transparent; color: #697990; font-family: inherit;
  font-size: 12px; font-weight: 700; cursor: pointer; transition: .15s ease;
}
.pac-nav-button:hover { background: #f5f7fc; color: #315bd4; }
.pac-nav-button.selected {
  color: #3155c1; background: #edf2ff; border-color: #e0e8ff;
}
.pac-nav-icon { font-size: 17px; line-height: 1; }
.pac-nav-count {
  display: inline-grid; place-items: center; min-width: 21px; height: 21px;
  padding: 0 5px; border-radius: 6px; background: #e5eafb; color: #3e5cb6;
  font-size: 10px;
}

.pac-welcome {
  display: flex; justify-content: space-between; align-items: center;
  gap: 24px; overflow: hidden; position: relative;
  min-height: 175px; padding: 29px 32px; margin-bottom: 27px;
  color: white; border-radius: 18px;
  background: linear-gradient(110deg,#1d3262 0%,#294d94 65%,#3c68b4 100%);
  box-shadow: 0 9px 26px #233c7417;
}
.pac-welcome .pac-eyebrow { color: #b6ccff; }
.pac-welcome h2 {
  font: 800 clamp(23px,3vw,30px)/1.2 Manrope,sans-serif;
  letter-spacing: -.8px; margin: 7px 0 10px;
}
.pac-welcome p:not(.pac-eyebrow) {
  color: #d4e1fa; max-width: 650px; font-size: 13px; line-height: 1.7; margin: 0;
}
.pac-welcome-art {
  position: relative; display: grid; place-items: center; flex-shrink: 0;
  width: 130px; height: 130px; color: #c8d8ff;
  border: 1px solid #ffffff30; border-radius: 50%;
  background: #ffffff0c;
}
.pac-art-circle { position: absolute; border: 1px solid #ffffff20; border-radius: 50%; }
.pac-art-circle-one { inset: -17px; }
.pac-art-circle-two { inset: -34px; }
.pac-welcome-art svg { position: relative; z-index: 1; }

.pac-eyebrow {
  margin: 0; color: #7888a2; font-size: 10px; letter-spacing: 1.35px;
  font-weight: 800;
}
.pac-section-heading {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; margin-bottom: 17px;
}
.pac-section-heading h2 {
  font: 800 16px/1.35 Manrope,sans-serif; margin: 0 0 5px;
  letter-spacing: -.3px; color: #24334c;
}
.pac-section-heading p { color: #8490a4; font-size: 12px; line-height: 1.6; margin: 0; }
.pac-inline-loading { color: #536dc0; font-size: 11px; font-weight: 700; }

.pac-grid {
  display: grid; grid-template-columns: repeat(4,minmax(0,1fr));
  gap: 14px; margin-bottom: 23px;
}
.pac-stat {
  text-align: left; min-width: 0; position: relative; overflow: hidden;
  padding: 19px; border: 1px solid #e5eaf3; border-radius: 14px;
  background: white; color: #1b2940; cursor: pointer;
  box-shadow: 0 2px 6px #1b294005; transition: transform .16s,border-color .16s,box-shadow .16s;
}
.pac-stat:hover {
  transform: translateY(-2px); border-color: #cbd7fb;
  box-shadow: 0 8px 18px #243b7010;
}
.pac-stat::before {
  content: ''; position: absolute; width: 4px; inset: 0 auto 0 0;
  background: #5375db;
}
.pac-stat-green::before { background: #26a779; }
.pac-stat-amber::before { background: #d69a35; }
.pac-stat-red::before { background: #dc6b73; }
.pac-stat-purple::before { background: #9564cb; }
.pac-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pac-stat-label { font-size: 11px; color: #75839a; font-weight: 700; }
.pac-stat-arrow { color: #a6b1c3; font-size: 16px; }
.pac-stat-value {
  font: 800 29px/1.25 Manrope,sans-serif; letter-spacing: -.7px;
  margin: 12px 0 6px; color: #25344d;
}
.pac-stat-note { color: #98a3b4; font-size: 10px; line-height: 1.5; }

.pac-panel {
  background: white; border: 1px solid #e5eaf3; border-radius: 15px;
  padding: 24px; margin-bottom: 19px; min-width: 0;
  box-shadow: 0 3px 10px #24385a04;
}
.pac-quick-panel { margin-top: 4px; }
.pac-quick-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
.pac-quick-action {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  text-align: left; padding: 15px 13px; border: 1px solid #e8edf5;
  border-radius: 12px; background: #fff; color: #25344c; cursor: pointer;
  transition: border-color .15s,background .15s;
}
.pac-quick-action:hover { border-color: #cbd7fb; background: #fafbff; }
.pac-quick-action > span:nth-child(2) { flex: 1; min-width: 0; }
.pac-quick-action strong { display: block; font-size: 11px; line-height: 1.5; }
.pac-quick-action small { display: block; color: #8793a7; font-size: 10px; line-height: 1.6; margin-top: 5px; }
.pac-quick-icon {
  display: grid; place-items: center; width: 38px; height: 38px;
  flex-shrink: 0; border-radius: 11px; font-size: 20px;
}
.pac-quick-blue { background: #edf2ff; color: #4768ce; }
.pac-quick-purple { background: #f3edff; color: #8d62c3; }
.pac-quick-green { background: #e7f8f0; color: #239c70; }
.pac-quick-arrow { color: #9ca8ba; font-size: 17px; }

.pac-info-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px; border: 1px solid #dce7fc; border-radius: 12px;
  background: #eef4ff; margin: 20px 0;
}
.pac-info-icon {
  display: grid; place-items: center; width: 27px; height: 27px;
  flex-shrink: 0; border-radius: 8px; color: #3d5fbe;
  background: #dce7ff; font-weight: 800; font-size: 13px;
}
.pac-info-banner strong { display: block; color: #344e88; font-size: 11px; line-height: 1.6; }
.pac-info-banner p { margin: 5px 0 0; color: #7183aa; font-size: 11px; line-height: 1.7; }

.pac-page-intro {
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; margin: 4px 0 23px;
}
.pac-page-intro h2 {
  font: 800 25px/1.3 Manrope,sans-serif; letter-spacing: -.6px;
  margin: 6px 0; color: #22324b;
}
.pac-page-intro > div > p:last-child {
  color: #7f8ca1; font-size: 12px; line-height: 1.7; margin: 0;
}
.pac-intro-count {
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
  padding: 12px 17px; border: 1px solid #e5eaf3; border-radius: 11px; background: white;
}
.pac-intro-count strong { font: 800 24px Manrope,sans-serif; color: #2f4fae; }
.pac-intro-count span { color: #8793a7; font-size: 10px; }
.pac-required-label { color: #8793a7; font-size: 10px; }

.pac-form-grid {
  display: grid; grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 17px; margin-top: 19px;
}
.pac-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.pac-field label { color: #4a5870; font-size: 11px; font-weight: 700; }
.pac-field input,.pac-field select,.pac-field textarea,
.pac-toolbar select,.pac-search input {
  width: 100%; min-width: 0; border: 1px solid #dce3ee; border-radius: 9px;
  padding: 11px 12px; font: inherit; font-size: 12px; color: #27364e;
  background: #fff; outline: none; transition: border-color .15s,box-shadow .15s;
}
.pac-field input,.pac-field select { min-height: 41px; }
.pac-field textarea { min-height: 94px; resize: vertical; line-height: 1.6; }
.pac-field input::placeholder,.pac-field textarea::placeholder,
.pac-search input::placeholder { color: #a1adbd; }
.pac-field input:focus,.pac-field select:focus,.pac-field textarea:focus,
.pac-toolbar select:focus,.pac-search input:focus {
  border-color: #7894ed; box-shadow: 0 0 0 3px #7894ed1c;
}
.pac-span { grid-column: 1/-1; }
.pac-field-help { color: #909db0; font-size: 10px; line-height: 1.5; }
.pac-form-footer {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; border-top: 1px solid #edf0f5;
  padding-top: 17px; margin-top: 21px;
}
.pac-form-footer > p {
  display: flex; align-items: center; gap: 8px;
  color: #8490a3; font-size: 10px; line-height: 1.5; margin: 0;
}
.pac-actions { display: flex; gap: 9px; flex-wrap: wrap; }
.pac-button {
  display: inline-flex; justify-content: center; align-items: center; gap: 8px;
  min-height: 39px; padding: 10px 14px; border: 1px solid #dce3ed;
  border-radius: 9px; background: white; color: #46546b;
  font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
  transition: background .15s,border-color .15s,transform .15s;
}
.pac-button:hover:not(:disabled) { border-color: #c2cee5; background: #f8faff; }
.pac-button:focus-visible,.pac-nav-button:focus-visible,
.pac-stat:focus-visible,.pac-quick-action:focus-visible {
  outline: 3px solid #8ba4f255; outline-offset: 2px;
}
.pac-button:disabled { opacity: .55; cursor: not-allowed; }
.pac-button-primary {
  background: #3158ca; color: white; border-color: #3158ca;
  box-shadow: 0 3px 8px #3158ca1b;
}
.pac-button-primary:hover:not(:disabled) { background: #2748ad; border-color: #2748ad; }
.pac-button-danger { color: #b03b48; border-color: #f0d4d7; background: #fffafb; }
.pac-button-danger:hover:not(:disabled) { background: #fff0f1; border-color: #e7b8be; }
.pac-button-light { background: #f7f9fc; }
.pac-button-small { min-height: 30px; padding: 7px 9px; font-size: 10px; }
.pac-file-action { position: relative; overflow: hidden; }
.pac-file-action input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.pac-refresh { min-height: 42px; }
.pac-result-count { color: #73819a; background: #f5f7fb; border: 1px solid #e8edf5; border-radius: 8px; padding: 7px 10px; font-size: 10px; font-weight: 700; }

.pac-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 19px 0; }
.pac-search {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px;
  max-width: 470px; border: 1px solid #dce3ee; border-radius: 9px;
  padding-left: 12px; background: white; color: #8492a7;
}
.pac-search:focus-within { border-color: #7894ed; box-shadow: 0 0 0 3px #7894ed1c; }
.pac-search input { border: 0; box-shadow: none!important; outline: none; padding-left: 0; }
.pac-search input:focus { border: 0; }
.pac-toolbar select { width: auto; min-width: 185px; max-width: 100%; min-height: 41px; }

.pac-table-wrap { width: 100%; overflow-x: auto; border: 1px solid #edf0f5; border-radius: 11px; }
.pac-table { width: 100%; min-width: 930px; border-collapse: separate; border-spacing: 0; }
.pac-table th,.pac-table td {
  text-align: left; vertical-align: top; padding: 14px 12px;
  border-bottom: 1px solid #edf0f5; font-size: 11px; line-height: 1.65;
}
.pac-table th {
  background: #f8faff; color: #7a879c; font-size: 9px;
  letter-spacing: .65px; text-transform: uppercase; font-weight: 800;
}
.pac-table tbody tr:last-child td { border-bottom: 0; }
.pac-table tbody tr:hover { background: #fbfcff; }
.pac-table td strong { color: #2b3a53; font-size: 11px; }
.pac-muted { color: #8995a8; font-size: 10px; line-height: 1.6; margin-top: 3px; }
.pac-school-cell { display: flex; align-items: flex-start; gap: 10px; min-width: 170px; }
.pac-school-avatar {
  display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px;
  border: 1px solid #dfe7ff; border-radius: 10px; background: #edf2ff;
  color: #3859bb; font: 800 13px Manrope,sans-serif;
}
.pac-school-avatar img { width: 100%; height: 100%; object-fit: contain; border-radius: inherit; }
.pac-pill {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  border-radius: 99px; padding: 5px 8px; background: #edf0f5;
  color: #657186; font-size: 9px; font-weight: 800; text-transform: capitalize;
}
.pac-pill-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.pac-pill-active,.pac-pill-approved { background: #e3f7eb; color: #187144; }
.pac-pill-pending,.pac-pill-trial { background: #fff4d8; color: #8a5a00; }
.pac-pill-suspended,.pac-pill-overdue,.pac-pill-cancelled,.pac-pill-rejected { background: #fde9eb; color: #a12432; }
.pac-pill-archived { background: #edf0f5; color: #697589; }
.pac-row-actions { display: flex; gap: 5px; flex-wrap: wrap; min-width: 120px; }
.pac-request-metrics { display: grid; grid-template-columns: repeat(2,minmax(140px,220px)); gap: 11px; margin: 4px 0 18px; }
.pac-request-metric { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 15px; border: 1px solid #e5eaf3; border-radius: 10px; background: #fafbfe; color: #75839a; font-size: 11px; }
.pac-request-metric strong { color: #26364e; font: 800 20px Manrope,sans-serif; }
.pac-request-metric.pending strong { color: #b37416; }
.pac-request-filter { width: min(100%,260px); }
.pac-request-filter > span { color: #73819a; font-size: 10px; font-weight: 700; }
.pac-requests-table { min-width: 1000px; }
.pac-request-person { display: flex; align-items: center; gap: 10px; min-width: 190px; }
.pac-request-person > span:last-child { display: grid; min-width: 0; }
.pac-request-avatar { display: grid; place-items: center; overflow: hidden; width: 40px; height: 40px; flex-shrink: 0; border: 1px solid #dfe7ff; border-radius: 50%; background: #edf2ff; color: #3859bb; font: 800 13px Manrope,sans-serif; }
.pac-request-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pac-request-review { display: grid; gap: 7px; min-width: 190px; }
.pac-request-notes { width: 100%; min-height: 52px; resize: vertical; border: 1px solid #dce3ee; border-radius: 7px; padding: 8px; color: #27364e; font: inherit; font-size: 11px; }
.pac-request-history p { margin: 5px 0 0; color: #526078; white-space: pre-wrap; }

.pac-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 150px; padding: 25px 15px; color: #8490a3; text-align: center;
}
.pac-empty strong { color: #485771; font-size: 12px; margin-top: 7px; }
.pac-empty p { font-size: 11px; line-height: 1.6; margin: 6px 0 0; }
.pac-empty-icon {
  display: grid; place-items: center; width: 42px; height: 42px;
  border-radius: 13px; background: #f0f3fb; color: #6c80c4; font-size: 23px;
}
.pac-spinner {
  display: inline-block; width: 21px; height: 21px; flex-shrink: 0;
  border: 2px solid #dfe6f5; border-top-color: #4569d0;
  border-radius: 50%; animation: pac-rotate .8s linear infinite;
}
.pac-loading-card {
  display: flex; align-items: center; gap: 15px; max-width: 480px;
  padding: 25px; margin: 12vh auto; border: 1px solid #e5eaf3;
  border-radius: 15px; background: white;
}
.pac-loading-card strong { font-size: 13px; }
.pac-loading-card p { color: #8390a4; font-size: 11px; margin: 6px 0 0; }
.pac-access-card {
  max-width: 510px; padding: 30px; margin: 10vh auto;
  border: 1px solid #e5eaf3; border-radius: 17px; background: white;
  box-shadow: 0 10px 35px #1e31520b;
}
.pac-access-icon {
  display: grid; place-items: center; width: 44px; height: 44px;
  border-radius: 13px; background: #fff0f0; color: #b63a45;
  font: 800 20px Manrope,sans-serif;
}
.pac-access-card h1 { font: 800 25px Manrope,sans-serif; margin: 12px 0 8px; }
.pac-access-message { color: #9e343c; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.pac-alert {
  display: flex; align-items: flex-start; gap: 11px; padding: 13px 14px;
  border: 1px solid; border-radius: 11px; margin: 13px 0 18px;
}
.pac-alert-symbol {
  display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px;
  border-radius: 8px; font-size: 12px; font-weight: 800;
}
.pac-alert strong { display: block; font-size: 11px; margin: 2px 0 4px; }
.pac-alert p { margin: 0; font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.pac-error { background: #fff5f5; border-color: #f2d3d5; color: #9f3039; }
.pac-error .pac-alert-symbol { background: #ffe3e5; }
.pac-notice { background: #effaf3; border-color: #ccebd7; color: #216c45; }
.pac-notice .pac-alert-symbol { background: #d8f3e2; }
.pac-dismiss {
  margin-left: auto; border: 0; background: transparent; color: inherit;
  font-size: 20px; cursor: pointer; line-height: 1; padding: 0 3px;
}
.pac-school-selector { display: grid; gap: 13px; max-width: 700px; margin: 19px 0 22px; }
.pac-selected-summary {
  display: flex; align-items: center; gap: 11px; flex-wrap: wrap;
  padding: 12px; border: 1px solid #e7ecf5; border-radius: 11px; background: #fafbfe;
}
.pac-selected-summary > div:nth-child(2) { flex: 1; min-width: 100px; }
.pac-selected-summary strong { font-size: 12px; color: #34445c; }
.pac-subscription-form { border-top: 1px solid #edf0f5; padding-top: 21px; }
.pac-footer {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap; border-top: 1px solid #e3e9f2;
  padding-top: 17px; margin-top: 28px; color: #9aa5b6; font-size: 9px; line-height: 1.6;
}

@media(max-width:1150px) {
  .pac-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .pac-quick-grid { grid-template-columns: 1fr; }
}
@media(max-width:760px) {
  .pac-shell { padding: 15px; }
  .pac-head { align-items: flex-start; }
  .pac-brand { align-items: flex-start; }
  .pac-brand-mark { width: 43px; height: 43px; border-radius: 13px; }
  .pac-title { font-size: 24px; }
  .pac-refresh { width: 100%; }
  .pac-nav { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
  .pac-nav-button { justify-content: flex-start; padding: 10px; }
  .pac-welcome { padding: 23px; min-height: 0; }
  .pac-welcome-art { width: 78px; height: 78px; }
  .pac-welcome-art svg { width: 53px; height: 53px; }
  .pac-art-circle-one { inset: -9px; }
  .pac-art-circle-two { inset: -18px; }
  .pac-panel { padding: 17px; }
  .pac-form-grid { grid-template-columns: 1fr; }
  .pac-span { grid-column: auto; }
  .pac-page-intro h2 { font-size: 22px; }
  .pac-form-footer { align-items: stretch; }
  .pac-form-footer .pac-actions { width: 100%; }
  .pac-form-footer .pac-actions .pac-button { flex: 1; }
  .pac-toolbar { align-items: stretch; }
  .pac-search { max-width: none; width: 100%; }
  .pac-toolbar select { width: 100%; max-width: none; }
  .pac-request-filter { width: 100%; }
  .pac-result-count { align-self: flex-start; }
}
@media(max-width:460px) {
  .pac-shell { padding: 10px; }
  .pac-brand { gap: 10px; }
  .pac-kicker { font-size: 8px; letter-spacing: .9px; }
  .pac-title { font-size: 21px; }
  .pac-subtitle { font-size: 11px; }
  .pac-grid { gap: 9px; }
  .pac-stat { padding: 14px 12px 14px 15px; }
  .pac-stat-label { font-size: 10px; }
  .pac-stat-value { font-size: 24px; }
  .pac-stat-note { font-size: 9px; }
  .pac-welcome { padding: 19px; }
  .pac-welcome-art { display: none; }
  .pac-nav-button { font-size: 10px; gap: 6px; }
  .pac-nav-icon { font-size: 14px; }
  .pac-panel { padding: 14px; }
  .pac-section-heading h2 { font-size: 15px; }
  .pac-footer { flex-direction: column; }
}
@media(prefers-reduced-motion:reduce) {
  .pac-shell *, .pac-shell *::before, .pac-shell *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
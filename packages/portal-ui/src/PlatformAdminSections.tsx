import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from './supabase';

type SchoolLite = { id: string; name: string; slug: string };

const errorText = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error);
  const value = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [value.message, value.details, value.hint]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ') || 'Supabase returned an unspecified error.';
};

const kes = (value: unknown) =>
  `KSh ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—';

const pill = (value?: string | null) =>
  `pac-pill pac-pill-${String(value || 'pending').toLowerCase().replace(/[^a-z_]/g, '')}`;

function Feedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <div className="pac-alert pac-error" role="alert">
          <span className="pac-alert-symbol">!</span>
          <div>
            <strong>Something needs attention</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="pac-alert pac-notice" role="status">
          <span className="pac-alert-symbol">✓</span>
          <div>
            <strong>Update</strong>
            <p>{notice}</p>
          </div>
        </div>
      )}
    </>
  );
}

function Intro({
  eyebrow,
  title,
  copy,
  count,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  count?: number;
}) {
  return (
    <section className="pac-page-intro">
      <div>
        <p className="pac-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {count !== undefined && (
        <div className="pac-intro-count">
          <strong>{count}</strong>
          <span>Records</span>
        </div>
      )}
    </section>
  );
}

export function PlatformRevenuePage({ schools }: { schools: SchoolLite[] }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [form, setForm] = useState({
    school_id: '',
    entry_type: 'subscription',
    amount_kes: '',
    status: 'confirmed',
    note: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const schoolName = useMemo(
    () => new Map(schools.map((school) => [school.id, school.name])),
    [schools],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [entryResult, invoiceResult] = await Promise.all([
        supabase
          .from('platform_revenue_entries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('platform_subscription_invoices')
          .select('*')
          .order('issued_at', { ascending: false })
          .limit(300),
      ]);
      if (entryResult.error) throw entryResult.error;
      if (invoiceResult.error) throw invoiceResult.error;
      setEntries(entryResult.data ?? []);
      setInvoices(invoiceResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load revenue: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmed = entries
    .filter((entry) => entry.status === 'confirmed' || entry.status === 'paid')
    .reduce((sum, entry) => sum + Number(entry.amount_kes || 0), 0);
  const pending = entries
    .filter((entry) => entry.status === 'pending')
    .reduce((sum, entry) => sum + Number(entry.amount_kes || 0), 0);
  const invoicePaid = invoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + Number(invoice.amount_kes || 0), 0);
  const invoiceUnpaid = invoices
    .filter((invoice) => ['unpaid', 'draft'].includes(invoice.status))
    .reduce((sum, invoice) => sum + Number(invoice.amount_kes || 0), 0);

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('platform_revenue_entries').insert({
        school_id: form.school_id || null,
        entry_type: form.entry_type,
        amount_kes: Number(form.amount_kes),
        status: form.status,
        note: form.note.trim() || null,
      });
      if (insertError) throw insertError;
      setForm({ ...form, amount_kes: '', note: '' });
      setNotice('Revenue entry recorded.');
      await load();
    } catch (saveError) {
      setError(`Could not record revenue: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="PLATFORM REVENUE"
        title="Maintenance and subscription revenue"
        copy="Track platform income from subscriptions, maintenance fees and adjustments."
        count={entries.length}
      />
      <Feedback error={error} notice={notice} />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Revenue summary</h2>
            <p>Confirmed revenue, pending entries and subscription invoices.</p>
          </div>
          <button className="pac-button pac-button-light" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="pac-request-metrics">
          <div className="pac-request-metric">
            <span>Confirmed entries</span>
            <strong>{kes(confirmed)}</strong>
          </div>
          <div className="pac-request-metric pending">
            <span>Pending entries</span>
            <strong>{kes(pending)}</strong>
          </div>
          <div className="pac-request-metric">
            <span>Invoices paid</span>
            <strong>{kes(invoicePaid)}</strong>
          </div>
          <div className="pac-request-metric pending">
            <span>Invoices outstanding</span>
            <strong>{kes(invoiceUnpaid)}</strong>
          </div>
        </div>

        <form onSubmit={addEntry}>
          <div className="pac-form-grid">
            <div className="pac-field">
              <label>School</label>
              <select
                value={form.school_id}
                onChange={(event) => setForm({ ...form, school_id: event.target.value })}
              >
                <option value="">Platform-wide</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pac-field">
              <label>Entry type</label>
              <select
                value={form.entry_type}
                onChange={(event) => setForm({ ...form, entry_type: event.target.value })}
              >
                <option value="subscription">Subscription</option>
                <option value="maintenance_fee">Maintenance fee</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div className="pac-field">
              <label>Amount (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.amount_kes}
                onChange={(event) => setForm({ ...form, amount_kes: event.target.value })}
              />
            </div>
            <div className="pac-field">
              <label>Status</label>
              <select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending</option>
                <option value="void">Void</option>
              </select>
            </div>
            <div className="pac-field" style={{ gridColumn: '1 / -1' }}>
              <label>Note</label>
              <input
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                placeholder="Optional reference or description"
              />
            </div>
          </div>
          <div className="pac-form-footer">
            <div className="pac-actions">
              <button className="pac-button pac-button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Record revenue'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Revenue ledger</h2>
            <p>Most recent platform revenue entries.</p>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">◷</div>
            <strong>No revenue entries yet</strong>
            <p>Recorded revenue will appear here.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>School</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{day(entry.created_at)}</td>
                    <td>{entry.school_id ? schoolName.get(entry.school_id) ?? 'School' : 'Platform'}</td>
                    <td>{String(entry.entry_type).replace(/_/g, ' ')}</td>
                    <td>
                      <strong>{kes(entry.amount_kes)}</strong>
                    </td>
                    <td>
                      <span className={pill(entry.status)}>{entry.status}</span>
                    </td>
                    <td className="pac-muted">{entry.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function PlatformPaymentsPage({ schools }: { schools: SchoolLite[] }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [form, setForm] = useState({
    school_id: '',
    plan_id: '',
    invoice_number: '',
    amount_kes: '',
    due_at: '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const schoolName = useMemo(
    () => new Map(schools.map((school) => [school.id, school.name])),
    [schools],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [invoiceResult, planResult] = await Promise.all([
        supabase
          .from('platform_subscription_invoices')
          .select('*')
          .order('issued_at', { ascending: false })
          .limit(300),
        supabase.from('platform_subscription_plans').select('*').order('price_kes'),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (planResult.error) throw planResult.error;
      setInvoices(invoiceResult.data ?? []);
      setPlans(planResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load payments: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function pickPlan(planId: string) {
    const plan = plans.find((item) => item.id === planId);
    setForm({
      ...form,
      plan_id: planId,
      amount_kes: plan ? String(plan.price_kes) : form.amount_kes,
    });
  }

  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: userData } = await supabase.auth.getUser();
      const invoiceNumber =
        form.invoice_number.trim() ||
        `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random()
          .toString(36)
          .slice(2, 7)
          .toUpperCase()}`;
      const { error: insertError } = await supabase
        .from('platform_subscription_invoices')
        .insert({
          school_id: form.school_id,
          plan_id: form.plan_id || null,
          invoice_number: invoiceNumber,
          amount_kes: Number(form.amount_kes),
          due_at: form.due_at || null,
          notes: form.notes.trim() || null,
          created_by: userData.user?.id ?? null,
          status: 'unpaid',
        });
      if (insertError) throw insertError;
      setForm({ ...form, invoice_number: '', amount_kes: '', due_at: '', notes: '' });
      setNotice(`Invoice ${invoiceNumber} created.`);
      await load();
    } catch (saveError) {
      setError(`Could not create invoice: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(invoice: any, status: string) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('platform_subscription_invoices')
        .update({
          status,
          paid_at: status === 'paid' ? new Date().toISOString() : null,
        })
        .eq('id', invoice.id);
      if (updateError) throw updateError;
      setNotice(`Invoice ${invoice.invoice_number} marked ${status}.`);
      await load();
    } catch (updateFailure) {
      setError(`Could not update invoice: ${errorText(updateFailure)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="PLATFORM PAYMENTS"
        title="Subscription invoices and payments"
        copy="Issue school invoices and reconcile platform subscription payments."
        count={invoices.length}
      />
      <Feedback error={error} notice={notice} />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Create invoice</h2>
            <p>Invoices are issued to a school and can be marked paid once funds clear.</p>
          </div>
        </div>
        <form onSubmit={createInvoice}>
          <div className="pac-form-grid">
            <div className="pac-field">
              <label>School</label>
              <select
                required
                value={form.school_id}
                onChange={(event) => setForm({ ...form, school_id: event.target.value })}
              >
                <option value="">Select school</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pac-field">
              <label>Plan</label>
              <select value={form.plan_id} onChange={(event) => pickPlan(event.target.value)}>
                <option value="">Custom amount</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {kes(plan.price_kes)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pac-field">
              <label>Invoice number</label>
              <input
                value={form.invoice_number}
                onChange={(event) => setForm({ ...form, invoice_number: event.target.value })}
                placeholder="Leave blank to auto-generate"
              />
            </div>
            <div className="pac-field">
              <label>Amount (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.amount_kes}
                onChange={(event) => setForm({ ...form, amount_kes: event.target.value })}
              />
            </div>
            <div className="pac-field">
              <label>Due date</label>
              <input
                type="date"
                value={form.due_at}
                onChange={(event) => setForm({ ...form, due_at: event.target.value })}
              />
            </div>
            <div className="pac-field">
              <label>Notes</label>
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
          </div>
          <div className="pac-form-footer">
            <div className="pac-actions">
              <button className="pac-button pac-button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Create invoice'}
              </button>
              <button className="pac-button pac-button-light" type="button" onClick={() => void load()}>
                Refresh
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Invoice register</h2>
            <p>{loading ? 'Loading invoices…' : `${invoices.length} invoice record(s)`}</p>
          </div>
        </div>
        {invoices.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">◷</div>
            <strong>No invoices yet</strong>
            <p>Create an invoice above to start tracking platform payments.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>School</th>
                  <th>Amount</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.invoice_number}</strong>
                    </td>
                    <td>{schoolName.get(invoice.school_id) ?? 'School'}</td>
                    <td>{kes(invoice.amount_kes)}</td>
                    <td>{day(invoice.issued_at)}</td>
                    <td>{day(invoice.due_at)}</td>
                    <td>
                      <span className={pill(invoice.status)}>{invoice.status}</span>
                    </td>
                    <td>
                      <div className="pac-row-actions">
                        {invoice.status !== 'paid' && (
                          <button
                            className="pac-button pac-button-small"
                            type="button"
                            disabled={saving}
                            onClick={() => void setStatus(invoice, 'paid')}
                          >
                            Mark paid
                          </button>
                        )}
                        {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
                          <button
                            className="pac-button pac-button-danger pac-button-small"
                            type="button"
                            disabled={saving}
                            onClick={() => void setStatus(invoice, 'cancelled')}
                          >
                            Cancel
                          </button>
                        )}
                        {invoice.reference && <span className="pac-muted">{invoice.reference}</span>}
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
  );
}

export function PlatformUsersPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id ?? '');
      const [profileResult, adminResult, membershipResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id,full_name,email,phone,created_at')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('platform_admins').select('user_id,created_at'),
        supabase.from('school_memberships').select('user_id,role,status,school_id'),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (adminResult.error) throw adminResult.error;
      if (membershipResult.error) throw membershipResult.error;
      setProfiles(profileResult.data ?? []);
      setAdmins(adminResult.data ?? []);
      setMemberships(membershipResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load users: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adminIds = useMemo(() => new Set(admins.map((admin) => admin.user_id)), [admins]);
  const roleMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const membership of memberships) {
      if (membership.status !== 'active') continue;
      const list = map.get(membership.user_id) ?? [];
      list.push(membership.role.replace(/_/g, ' '));
      map.set(membership.user_id, list);
    }
    return map;
  }, [memberships]);
  const filtered = profiles.filter((profile) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [profile.full_name, profile.email, profile.phone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  async function grantAdmin(profile: any) {
    if (!supabase) return;
    if (!confirm(`Grant platform administrator access to ${profile.email || profile.full_name}?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase
        .from('platform_admins')
        .insert({ user_id: profile.id });
      if (insertError) throw insertError;
      setNotice(`${profile.email || profile.full_name} is now a platform administrator.`);
      await load();
    } catch (grantError) {
      setError(`Could not grant access: ${errorText(grantError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function revokeAdmin(profile: any) {
    if (!supabase) return;
    if (profile.id === currentUserId) {
      setError('You cannot revoke your own platform administrator access.');
      return;
    }
    if (!confirm(`Revoke platform administrator access from ${profile.email || profile.full_name}?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: deleteError } = await supabase
        .from('platform_admins')
        .delete()
        .eq('user_id', profile.id);
      if (deleteError) throw deleteError;
      setNotice('Platform administrator access revoked.');
      await load();
    } catch (revokeError) {
      setError(`Could not revoke access: ${errorText(revokeError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="ACCOUNTS AND ROLES"
        title="Platform and school users"
        copy="Review registered accounts, active school roles and platform administrator access."
        count={profiles.length}
      />
      <Feedback error={error} notice={notice} />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>User directory</h2>
            <p>{loading ? 'Loading accounts…' : `${filtered.length} matching account(s)`}</p>
          </div>
          <div className="pac-toolbar">
            <label className="pac-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email or phone"
              />
            </label>
            <button className="pac-button pac-button-light" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">♙</div>
            <strong>No matching accounts</strong>
            <p>Accounts appear after users complete sign-up.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>School roles</th>
                  <th>Joined</th>
                  <th>Platform admin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((profile) => {
                  const roles = roleMap.get(profile.id) ?? [];
                  const isAdmin = adminIds.has(profile.id);
                  return (
                    <tr key={profile.id}>
                      <td>
                        <strong>{profile.full_name || 'Unnamed user'}</strong>
                        <div className="pac-muted">{profile.email || profile.phone || 'No contact'}</div>
                      </td>
                      <td className="pac-muted">
                        {roles.length ? [...new Set(roles)].join(', ') : 'No active school role'}
                      </td>
                      <td>{day(profile.created_at)}</td>
                      <td>
                        <span className={isAdmin ? 'pac-pill pac-pill-active' : 'pac-pill'}>
                          {isAdmin ? 'Platform admin' : 'Standard user'}
                        </span>
                      </td>
                      <td>
                        <div className="pac-row-actions">
                          {isAdmin ? (
                            <button
                              className="pac-button pac-button-danger pac-button-small"
                              disabled={saving}
                              onClick={() => void revokeAdmin(profile)}
                            >
                              Revoke
                            </button>
                          ) : (
                            <button
                              className="pac-button pac-button-small"
                              disabled={saving}
                              onClick={() => void grantAdmin(profile)}
                            >
                              Make admin
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function PlatformReportsPage({ schools }: { schools: SchoolLite[] }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [invoiceResult, entryResult] = await Promise.all([
        supabase.from('platform_subscription_invoices').select('*').limit(1000),
        supabase.from('platform_revenue_entries').select('*').limit(1000),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (entryResult.error) throw entryResult.error;
      setInvoices(invoiceResult.data ?? []);
      setEntries(entryResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load reports: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_kes || 0), 0);
  const totalPaid = invoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + Number(invoice.amount_kes || 0), 0);
  const schoolName = (id: string | null) =>
    id ? schools.find((school) => school.id === id)?.name ?? 'School' : 'Platform';

  function download(name: string, rows: (string | number)[][]) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Intro
        eyebrow="PLATFORM REPORTS"
        title="Revenue and subscription reports"
        copy="Export platform-wide billing and school subscription summaries."
        count={schools.length}
      />
      <Feedback error={error} notice="" />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Summary</h2>
            <p>{loading ? 'Building report…' : 'Based on all loaded invoices and revenue entries.'}</p>
          </div>
          <div className="pac-actions">
            <button
              className="pac-button pac-button-light"
              type="button"
              onClick={() =>
                download('schhol-invoices.csv', [
                  ['Invoice', 'School', 'Amount (KES)', 'Status', 'Issued', 'Due'],
                  ...invoices.map((invoice) => [
                    invoice.invoice_number,
                    schoolName(invoice.school_id),
                    Number(invoice.amount_kes || 0),
                    invoice.status,
                    invoice.issued_at ?? '',
                    invoice.due_at ?? '',
                  ]),
                ])
              }
            >
              Export invoices
            </button>
            <button
              className="pac-button pac-button-light"
              type="button"
              onClick={() =>
                download('schhol-revenue.csv', [
                  ['Date', 'School', 'Type', 'Amount (KES)', 'Status', 'Note'],
                  ...entries.map((entry) => [
                    entry.created_at ?? '',
                    schoolName(entry.school_id),
                    entry.entry_type,
                    Number(entry.amount_kes || 0),
                    entry.status,
                    entry.note ?? '',
                  ]),
                ])
              }
            >
              Export revenue
            </button>
          </div>
        </div>
        <div className="pac-request-metrics">
          <div className="pac-request-metric">
            <span>Schools</span>
            <strong>{schools.length}</strong>
          </div>
          <div className="pac-request-metric">
            <span>Total invoiced</span>
            <strong>{kes(totalInvoiced)}</strong>
          </div>
          <div className="pac-request-metric">
            <span>Total collected</span>
            <strong>{kes(totalPaid)}</strong>
          </div>
          <div className="pac-request-metric pending">
            <span>Outstanding</span>
            <strong>{kes(totalInvoiced - totalPaid)}</strong>
          </div>
        </div>
      </section>
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>School subscription report</h2>
            <p>Current plan, status and annual amount for each school.</p>
          </div>
        </div>
        <div className="pac-table-wrap">
          <table className="pac-table">
            <thead>
              <tr>
                <th>School</th>
                <th>Invoices</th>
                <th>Invoiced</th>
                <th>Paid</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((school) => {
                const rows = invoices.filter((invoice) => invoice.school_id === school.id);
                const invoiced = rows.reduce((sum, row) => sum + Number(row.amount_kes || 0), 0);
                const paid = rows
                  .filter((row) => row.status === 'paid')
                  .reduce((sum, row) => sum + Number(row.amount_kes || 0), 0);
                return (
                  <tr key={school.id}>
                    <td>
                      <strong>{school.name}</strong>
                      <div className="pac-muted">{school.slug}</div>
                    </td>
                    <td>{rows.length}</td>
                    <td>{kes(invoiced)}</td>
                    <td>{kes(paid)}</td>
                    <td>{kes(invoiced - paid)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function PlatformAuditPage({ schools }: { schools: SchoolLite[] }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(400);
      if (loadError) throw loadError;
      setLogs(data ?? []);
    } catch (loadError) {
      setError(`Could not load audit log: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const schoolName = (id: string | null) =>
    id ? schools.find((school) => school.id === id)?.name ?? 'School' : 'Platform';
  const filtered = logs.filter((log) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [log.action, log.entity_type, log.actor_user_id, schoolName(log.school_id)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  return (
    <>
      <Intro
        eyebrow="AUDIT LOG"
        title="Platform activity trail"
        copy="Review administrative actions recorded across the platform and its schools."
        count={logs.length}
      />
      <Feedback error={error} notice="" />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Recent activity</h2>
            <p>{loading ? 'Loading audit entries…' : `${filtered.length} matching entries`}</p>
          </div>
          <div className="pac-toolbar">
            <label className="pac-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search action, entity or school"
              />
            </label>
            <button className="pac-button pac-button-light" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">▤</div>
            <strong>No audit entries</strong>
            <p>Administrative actions will be recorded here.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>School</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td>{day(log.created_at)}</td>
                    <td>{schoolName(log.school_id)}</td>
                    <td>
                      <strong>{String(log.action).replace(/_/g, ' ')}</strong>
                    </td>
                    <td>{log.entity_type}</td>
                    <td className="pac-muted">
                      {log.after_data ? JSON.stringify(log.after_data).slice(0, 120) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function PlatformSettingsPage() {
  const [settings, setSettings] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [planDraft, setPlanDraft] = useState({ name: '', price_kes: '', billing_period: 'annual' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [settingResult, planResult] = await Promise.all([
        supabase.from('platform_settings').select('*').order('key'),
        supabase.from('platform_subscription_plans').select('*').order('price_kes'),
      ]);
      if (settingResult.error) throw settingResult.error;
      if (planResult.error) throw planResult.error;
      setSettings(settingResult.data ?? []);
      setPlans(planResult.data ?? []);
      setDraft(
        Object.fromEntries(
          (settingResult.data ?? []).map((setting) => [
            setting.key,
            JSON.stringify(setting.value),
          ]),
        ),
      );
    } catch (loadError) {
      setError(`Could not load settings: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSetting(key: string) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let value: unknown;
      try {
        value = JSON.parse(draft[key] ?? 'null');
      } catch {
        throw new Error('Value must be valid JSON, for example "text", true or 42.');
      }
      const { data: userData } = await supabase.auth.getUser();
      const { error: updateError } = await supabase
        .from('platform_settings')
        .update({ value, updated_by: userData.user?.id ?? null, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (updateError) throw updateError;
      setNotice(`${key} updated.`);
    } catch (saveError) {
      setError(`Could not save ${key}: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function addPlan(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('platform_subscription_plans').insert({
        name: planDraft.name.trim(),
        price_kes: Number(planDraft.price_kes || 0),
        billing_period: planDraft.billing_period,
      });
      if (insertError) throw insertError;
      setPlanDraft({ name: '', price_kes: '', billing_period: 'annual' });
      setNotice('Subscription plan created.');
      await load();
    } catch (saveError) {
      setError(`Could not create plan: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function updatePlan(plan: any, patch: Record<string, unknown>) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('platform_subscription_plans')
        .update(patch)
        .eq('id', plan.id);
      if (updateError) throw updateError;
      setNotice(`${plan.name} updated.`);
      await load();
    } catch (saveError) {
      setError(`Could not update plan: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="SYSTEM SETTINGS"
        title="Platform configuration"
        copy="Maintain platform-level settings and subscription plans."
        count={settings.length}
      />
      <Feedback error={error} notice={notice} />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Platform settings</h2>
            <p>Values are stored as JSON so text, numbers and flags are supported.</p>
          </div>
          <button className="pac-button pac-button-light" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {settings.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">⚙</div>
            <strong>No settings found</strong>
            <p>Default platform settings are seeded by the migration.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value (JSON)</th>
                  <th>Description</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.map((setting) => (
                  <tr key={setting.key}>
                    <td>
                      <strong>{setting.key}</strong>
                    </td>
                    <td>
                      <input
                        value={draft[setting.key] ?? ''}
                        onChange={(event) =>
                          setDraft({ ...draft, [setting.key]: event.target.value })
                        }
                      />
                    </td>
                    <td className="pac-muted">{setting.description || '—'}</td>
                    <td>{day(setting.updated_at)}</td>
                    <td>
                      <button
                        className="pac-button pac-button-small"
                        disabled={saving}
                        onClick={() => void saveSetting(setting.key)}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Subscription plans</h2>
            <p>Plans available when issuing school invoices.</p>
          </div>
        </div>
        <div className="pac-table-wrap">
          <table className="pac-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Price (KES)</th>
                <th>Billing</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.name}</strong>
                  </td>
                  <td>{kes(plan.price_kes)}</td>
                  <td>{plan.billing_period}</td>
                  <td>
                    <span className={plan.active ? 'pac-pill pac-pill-active' : 'pac-pill'}>
                      {plan.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="pac-row-actions">
                      <button
                        className="pac-button pac-button-small"
                        disabled={saving}
                        onClick={() => void updatePlan(plan, { active: !plan.active })}
                      >
                        {plan.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addPlan} style={{ marginTop: 18 }}>
          <div className="pac-form-grid">
            <div className="pac-field">
              <label>Plan name</label>
              <input
                required
                value={planDraft.name}
                onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })}
              />
            </div>
            <div className="pac-field">
              <label>Price (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={planDraft.price_kes}
                onChange={(event) => setPlanDraft({ ...planDraft, price_kes: event.target.value })}
              />
            </div>
            <div className="pac-field">
              <label>Billing period</label>
              <select
                value={planDraft.billing_period}
                onChange={(event) =>
                  setPlanDraft({ ...planDraft, billing_period: event.target.value })
                }
              >
                <option value="monthly">Monthly</option>
                <option value="termly">Termly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="pac-form-footer">
            <div className="pac-actions">
              <button className="pac-button pac-button-primary" type="submit" disabled={saving}>
                Add plan
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}

export function PlatformSupportPage({ schools }: { schools: SchoolLite[] }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (loadError) throw loadError;
      setTickets(data ?? []);
      setResponses(
        Object.fromEntries((data ?? []).map((ticket) => [ticket.id, ticket.response ?? ''])),
      );
    } catch (loadError) {
      setError(`Could not load support tickets: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const schoolName = (id: string | null) =>
    id ? schools.find((school) => school.id === id)?.name ?? 'School' : 'Platform';
  const visible = tickets.filter((ticket) =>
    filter === 'all' ? true : ticket.status === filter,
  );

  async function updateTicket(ticket: any, status: string) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('support_tickets')
        .update({ status, response: responses[ticket.id]?.trim() || null })
        .eq('id', ticket.id);
      if (updateError) throw updateError;
      setNotice(`Ticket "${ticket.subject}" updated to ${status.replace(/_/g, ' ')}.`);
      await load();
    } catch (saveError) {
      setError(`Could not update ticket: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="SUPPORT DESK"
        title="School support tickets"
        copy="Respond to platform and school support requests."
        count={tickets.length}
      />
      <Feedback error={error} notice={notice} />
      <section className="pac-panel">
        <div className="pac-section-heading">
          <div>
            <h2>Tickets</h2>
            <p>{loading ? 'Loading tickets…' : `${visible.length} ticket(s) in view`}</p>
          </div>
          <div className="pac-toolbar">
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
              <option value="all">All tickets</option>
            </select>
            <button className="pac-button pac-button-light" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="pac-empty">
            <div className="pac-empty-icon">?</div>
            <strong>No tickets in this view</strong>
            <p>Support requests raised by portal users will appear here.</p>
          </div>
        ) : (
          <div className="pac-table-wrap">
            <table className="pac-table" style={{ minWidth: 920 }}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>School</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.subject}</strong>
                      <div className="pac-muted">{day(ticket.created_at)}</div>
                    </td>
                    <td>{schoolName(ticket.school_id)}</td>
                    <td className="pac-muted">{ticket.message}</td>
                    <td>
                      <span className={pill(ticket.status)}>{ticket.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td>
                      <textarea
                        className="pac-request-notes"
                        value={responses[ticket.id] ?? ''}
                        onChange={(event) =>
                          setResponses({ ...responses, [ticket.id]: event.target.value })
                        }
                        placeholder="Write a response"
                      />
                    </td>
                    <td>
                      <div className="pac-row-actions">
                        <button
                          className="pac-button pac-button-small"
                          disabled={saving}
                          onClick={() => void updateTicket(ticket, 'in_progress')}
                        >
                          In progress
                        </button>
                        <button
                          className="pac-button pac-button-primary pac-button-small"
                          disabled={saving}
                          onClick={() => void updateTicket(ticket, 'resolved')}
                        >
                          Resolve
                        </button>
                        <button
                          className="pac-button pac-button-danger pac-button-small"
                          disabled={saving}
                          onClick={() => void updateTicket(ticket, 'closed')}
                        >
                          Close
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
  );
}

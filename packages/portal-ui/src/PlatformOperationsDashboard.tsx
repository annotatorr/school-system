
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell,
  Building2, CheckCircle2, ChevronDown, Clock3, CreditCard,
  Download, Gauge, GraduationCap, LayoutDashboard, LockKeyhole,
  MessageSquare, MonitorCog, RefreshCw, Search, Send, Settings2,
  ShieldCheck, Users, Wrench, XCircle
} from 'lucide-react';
import { supabase } from './supabase';

type AnnouncementAudience = 'all_active' | 'school_admins' | 'selected_schools';

type PlatformAnnouncement = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  target_school_ids: string[];
  published_at: string;
};

type ProfileRecord = {
  id: string;
  full_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
};

type MembershipRecord = {
  user_id: string;
  school_id: string;
  role: string;
  status: string;
};

function backendErrorMessage(error: unknown): string {
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
  if (typeof value.code === 'string' && value.code) {
    parts.push(`Code ${value.code}`);
  }
  return parts.join(' · ') || 'Supabase returned an unspecified error.';
}
type School = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  subscription_status?: string;
  subscription_amount_kes?: number | null;
  subscription_plan?: string | null;
  created_at?: string;
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

type DashboardProps = {
  schools: School[];
  overview: Overview;
  loading: boolean;
  loadError: string;
  onRefresh: () => void;
  onNavigate: (
    page: 'overview' | 'schools' | 'subscriptions' | 'admin-requests',
    filter?: string,
  ) => void;
  onSignOut: () => void;
  onProfile: () => void;
};

type Tab =
  | 'overview'
  | 'payments'
  | 'sessions'
  | 'performance'
  | 'notifications'
  | 'maintenance';

const nav: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'payments', label: 'Payments & revenue', icon: CreditCard },
  { id: 'sessions', label: 'Users & access', icon: ShieldCheck },
  { id: 'performance', label: 'Platform performance', icon: Gauge },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'maintenance', label: 'Maintenance mode', icon: Wrench },
];

const money = (value: number) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(value);

const dateLabel = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-KE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
};

function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
}) {
  return (
    <div className="ops-empty">
      <Icon size={25} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function MiniBars({
  values,
  labels,
}: {
  values: number[];
  labels: string[];
}) {
  const max = Math.max(...values, 1);

  return (
    <div className="ops-bars">
      {values.map((value, index) => (
        <div className="ops-bar-col" key={labels[index]}>
          <div className="ops-bar-track">
            <div
              className="ops-bar"
              style={{ height: `${Math.max(5, (value / max) * 100)}%` }}
              title={`${labels[index]}: ${value}`}
            />
          </div>
          <span>{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

function Ring({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <div
      className="ops-ring"
      style={{
        background: `conic-gradient(${color} ${percent}%, #202B36 ${percent}% 100%)`,
      }}
    >
      <div className="ops-ring-inner">
        <strong>{value}</strong>
        <span>schools</span>
      </div>
    </div>
  );
}

export default function PlatformOperationsDashboard({
  schools,
  overview,
  loading,
  loadError,
  onRefresh,
  onNavigate,
  onSignOut,
  onProfile,
}: DashboardProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('30 days');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeAudience, setNoticeAudience] = useState<AnnouncementAudience>('all_active');
  const [noticeSchoolIds, setNoticeSchoolIds] = useState<string[]>([]);
  const [announcementHistory, setAnnouncementHistory] = useState<PlatformAnnouncement[]>([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [profileRoles, setProfileRoles] = useState<Record<string, string[]>>({});
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>({});
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState('');
  const profileOffset = useRef(0);
  const [profilesHaveMore, setProfilesHaveMore] = useState(false);
  const [profileSearch, setProfileSearch] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  const filteredSchools = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schools;

    return schools.filter((school) =>
      [school.name, school.slug, school.status, school.subscription_status]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [schools, search]);

  const totalKnown = Math.max(
    overview.total_schools,
    schools.length
  );

  const loadAnnouncementHistory = useCallback(async () => {
    if (!supabase) {
      setAnnouncementError('Supabase is not configured.');
      return;
    }

    setAnnouncementLoading(true);
    const { data, error } = await supabase
      .from('platform_announcements')
      .select('id,title,body,audience,target_school_ids,published_at')
      .order('published_at', { ascending: false })
      .limit(50);

    if (error) {
      setAnnouncementError(`Could not load announcements: ${backendErrorMessage(error)}`);
    } else {
      setAnnouncementError('');
      setAnnouncementHistory((data ?? []) as PlatformAnnouncement[]);
    }
    setAnnouncementLoading(false);
  }, []);

  useEffect(() => {
    if (tab !== 'notifications') return;

    void loadAnnouncementHistory();
    if (!supabase) return;

    const channel = supabase
      .channel('platform-admin-announcement-history')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'platform_announcements' },
        () => void loadAnnouncementHistory(),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [tab, loadAnnouncementHistory]);

  async function publishAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setAnnouncementError('Supabase is not configured.');
      return;
    }
    if (!noticeTitle.trim() || !noticeMessage.trim()) {
      setAnnouncementError('Enter both an announcement title and message.');
      return;
    }
    if (noticeAudience === 'selected_schools' && noticeSchoolIds.length === 0) {
      setAnnouncementError('Select at least one school for this announcement.');
      return;
    }

    setAnnouncementSaving(true);
    setAnnouncementError('');
    setLocalNotice('');

    try {
      const { error } = await supabase.from('platform_announcements').insert({
        title: noticeTitle.trim(),
        body: noticeMessage.trim(),
        audience: noticeAudience,
        target_school_ids:
          noticeAudience === 'selected_schools' ? noticeSchoolIds : [],
      });

      if (error) throw error;

      setNoticeTitle('');
      setNoticeMessage('');
      setNoticeAudience('all_active');
      setNoticeSchoolIds([]);
      setLocalNotice('Announcement published to the selected portal audience.');
      await loadAnnouncementHistory();
    } catch (error) {
      setAnnouncementError(`Could not publish announcement: ${backendErrorMessage(error)}`);
    } finally {
      setAnnouncementSaving(false);
    }
  }

  const loadProfiles = useCallback(async (append = false) => {
    if (!supabase) {
      setProfilesError('Supabase is not configured.');
      return;
    }

    const offset = append ? profileOffset.current : 0;
    setProfilesLoading(true);
    setProfilesError('');

    try {
      const profileResult = await supabase
        .from('profiles')
        .select('id,full_name,display_name,email,phone,avatar_url')
        .order('full_name', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + 49);

      if (profileResult.error) throw profileResult.error;

      const pageProfiles = (profileResult.data ?? []) as ProfileRecord[];
      const pageUserIds = pageProfiles.map((profile) => profile.id);
      let memberships: MembershipRecord[] = [];
      let platformAdminIds = new Set<string>();

      if (pageUserIds.length > 0) {
        const [membershipResult, adminResult] = await Promise.all([
            supabase
              .from('school_memberships')
              .select('user_id,school_id,role,status')
              .in('user_id', pageUserIds),
            supabase
              .from('platform_admins')
              .select('user_id')
              .in('user_id', pageUserIds),
        ]);

        if (membershipResult.error) throw membershipResult.error;
        if (adminResult.error) throw adminResult.error;

        memberships = (membershipResult.data ?? []) as MembershipRecord[];
        platformAdminIds = new Set(
          (adminResult.data ?? []).map((admin) => admin.user_id),
        );
      }
      const schoolNames = new Map(schools.map((school) => [school.id, school.name]));
      const rolesByUser: Record<string, string[]> = {};

      for (const membership of memberships) {
        const schoolName = schoolNames.get(membership.school_id) ?? 'School';
        const label = `${membership.role.replace(/_/g, ' ')} · ${schoolName} (${membership.status})`;
        (rolesByUser[membership.user_id] ??= []).push(label);
      }
      for (const adminId of platformAdminIds) {
        (rolesByUser[adminId] ??= []).unshift('Platform administrator');
      }

      const photoPaths = [...new Set(
        pageProfiles.flatMap((profile) => profile.avatar_url ? [profile.avatar_url] : []),
      )];
      const photoResult = photoPaths.length
        ? await supabase.storage.from('profile-photos').createSignedUrls(photoPaths, 3600)
        : { data: [], error: null };
      if (photoResult.error) throw photoResult.error;
      const photoMap: Record<string, string> = {};

      for (const photo of photoResult.data ?? []) {
        if (photo.path && photo.signedUrl) photoMap[photo.path] = photo.signedUrl;
      }

      setProfiles((current) => append ? [...current, ...pageProfiles] : pageProfiles);
      setProfileRoles((current) => ({ ...current, ...rolesByUser }));
      setProfilePhotos((current) => ({ ...current, ...photoMap }));
      profileOffset.current = offset + pageProfiles.length;
      setProfilesHaveMore(pageProfiles.length === 50);
    } catch (error) {
      setProfilesError(
        error instanceof Error ? error.message : 'Could not load user profiles.',
      );
    } finally {
      setProfilesLoading(false);
    }
  }, [schools]);

  useEffect(() => {
    if (tab !== 'sessions') return;
    profileOffset.current = 0;
    setProfiles([]);
    setProfileRoles({});
    setProfilePhotos({});
    void loadProfiles();
  }, [tab, loadProfiles]);

  const filteredProfiles = profiles.filter((profile) => {
    const term = profileSearch.trim().toLowerCase();
    if (!term) return true;
    const roleText = (profileRoles[profile.id] ?? []).join(' ');
    return [
      profile.full_name,
      profile.display_name,
      profile.email,
      profile.phone,
      roleText,
    ].some((value) => value?.toLowerCase().includes(term));
  });
                {tab === 'sessions' && 'Users & access'}

  const requestMaintenance = () => {
    if (!maintenanceReason.trim()) {
      setLocalNotice('Enter a reason before requesting maintenance mode.');
      return;
    }

    setConfirmMaintenance(true);
  };

  const confirmMaintenanceRequest = () => {
    setConfirmMaintenance(false);
    setLocalNotice(
      'Maintenance request prepared, but not activated. A secured backend setting and access-control checks must be connected before this can affect the live platform.'
    );
  };

  const exportSchools = () => {
    const rows = [
      ['School', 'Slug', 'Status', 'Subscription', 'Plan', 'Created'],
      ...filteredSchools.map((s) => [
        s.name,
        s.slug ?? '',
        s.status ?? '',
        s.subscription_status ?? '',
        s.subscription_plan ?? '',
        s.created_at ?? '',
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\r\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schhol-platform-schools.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const activeTab = nav.find((item) => item.id === tab);

  return (
    <div className="ops-shell">
      <style>{`
        .ops-shell{--bg:#080d12;--panel:#101820;--panel2:#131e27;--line:#243440;--muted:#8799a8;--text:#edf4f8;--green:#a3ff5f;--cyan:#4adbe8;--red:#ff727b;--amber:#ffc76a;display:grid;grid-template-columns:228px minmax(0,1fr);min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:13px}
        .ops-shell *{box-sizing:border-box}.ops-sidebar{border-right:1px solid var(--line);padding:22px 14px;background:#0b1117;display:flex;flex-direction:column;gap:24px}
        .ops-brand{display:flex;align-items:center;gap:11px;padding:0 8px}.ops-brand-mark{width:39px;height:39px;border-radius:12px;background:var(--green);color:#10180d;display:grid;place-items:center}.ops-brand strong{display:block;letter-spacing:2px;font-size:17px}.ops-brand span{display:block;color:var(--muted);font-size:9px;letter-spacing:1.3px;margin-top:4px}
        .ops-nav-label{color:#617482;font-size:10px;letter-spacing:1.5px;padding:0 10px;margin-bottom:8px}.ops-nav{display:grid;gap:5px}.ops-nav button{width:100%;display:flex;align-items:center;gap:10px;text-align:left;background:transparent;border:1px solid transparent;border-radius:9px;padding:11px 10px;color:#9caeba;cursor:pointer;font:inherit}.ops-nav button:hover,.ops-nav button.active{background:#15231d;border-color:#294332;color:var(--green)}.ops-nav button.active{box-shadow:inset 2px 0 var(--green)}.ops-sidebar-bottom{margin-top:auto;display:grid;gap:10px}.ops-mini-status{padding:12px;border:1px solid var(--line);border-radius:10px;background:#101820}.ops-mini-status span{display:flex;align-items:center;gap:7px;color:#9cabb6;font-size:11px}.ops-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px #a3ff5f77;display:inline-block}.ops-mini-status small{display:block;color:#647785;margin-top:8px}
        .ops-main{min-width:0}.ops-topbar{min-height:70px;border-bottom:1px solid var(--line);padding:15px 25px;display:flex;align-items:center;justify-content:space-between;gap:16px;background:#0b1117}.ops-crumb{color:var(--muted);font-size:11px}.ops-crumb strong{color:var(--text);font-weight:600}.ops-top-actions{display:flex;align-items:center;gap:10px}.ops-search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:#0e161d;color:var(--muted)}.ops-search input{background:transparent;border:0;outline:0;color:var(--text);width:155px;font:inherit}.ops-icon-btn,.ops-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:8px;background:#111b23;color:var(--text);padding:9px 11px;cursor:pointer;font:inherit}.ops-button.primary{background:var(--green);border-color:var(--green);color:#11180c;font-weight:700}.ops-button:disabled{opacity:.45;cursor:not-allowed}.ops-avatar{width:33px;height:33px;border-radius:50%;display:grid;place-items:center;background:#203c42;color:var(--cyan);font-weight:700}
        .ops-content{padding:25px;max-width:1800px;margin:0 auto}.ops-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:21px}.ops-eyebrow{color:var(--green);font-size:10px;letter-spacing:1.6px;text-transform:uppercase}.ops-page-head h1{font-size:25px;letter-spacing:-.7px;margin:7px 0}.ops-page-head p{margin:0;color:var(--muted);font-size:12px;line-height:1.6}.ops-head-actions{display:flex;gap:8px;flex-wrap:wrap}
        .ops-banner{display:flex;align-items:flex-start;gap:11px;padding:12px 14px;border-radius:10px;background:#231d12;border:1px solid #51412a;color:var(--amber);margin-bottom:18px}.ops-banner p{margin:4px 0 0;color:#c3ae88;font-size:11px;line-height:1.5}.ops-error{background:#28171b;border:1px solid #61333a;color:#ffb4ba;border-radius:9px;padding:12px;margin-bottom:16px}
        .ops-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:16px}.ops-metric{border:1px solid var(--line);background:linear-gradient(140deg,#121d26,#0e151c);border-radius:12px;padding:16px;min-width:0}.ops-metric-top{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:11px;gap:6px}.ops-metric-icon{width:33px;height:33px;border-radius:9px;background:#1a2b25;color:var(--green);display:grid;place-items:center}.ops-metric strong{display:block;font-size:25px;letter-spacing:-.8px;margin:13px 0 6px}.ops-metric small{color:var(--muted);font-size:10px}.ops-metric small.good{color:var(--green)}.ops-grid-2{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(270px,1fr);gap:15px;margin-bottom:15px}.ops-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-bottom:15px}.ops-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:17px;min-width:0}.ops-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:17px}.ops-panel-head h3{font-size:13px;margin:0;font-weight:650}.ops-panel-head p{color:var(--muted);font-size:10px;margin:5px 0 0}.ops-panel-head .ops-icon-btn{padding:6px}
        .ops-chart-summary{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:13px}.ops-chart-summary strong{font-size:21px}.ops-chart-summary span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.ops-chart-area{height:170px;position:relative;border-bottom:1px solid #283741;background:repeating-linear-gradient(to bottom,transparent 0,transparent 41px,#23313a 42px)}.ops-bars{height:100%;display:flex;align-items:stretch;gap:clamp(6px,2%,20px);padding:8px 9px 0}.ops-bar-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:7px}.ops-bar-track{width:min(100%,27px);height:calc(100% - 18px);display:flex;align-items:flex-end;overflow:hidden;border-radius:5px 5px 0 0}.ops-bar{width:100%;min-height:3px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,var(--green),#438e63);opacity:.9}.ops-bar-col span{font-size:9px;color:var(--muted)}.ops-chart-foot{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:10px;margin-top:13px}
        .ops-distribution{display:flex;align-items:center;justify-content:center;gap:22px;padding:9px 0}.ops-ring{width:125px;height:125px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}.ops-ring-inner{width:91px;height:91px;border-radius:50%;background:var(--panel);display:grid;align-content:center;justify-items:center}.ops-ring-inner strong{font-size:24px}.ops-ring-inner span{font-size:9px;color:var(--muted)}.ops-legend{display:grid;gap:13px}.ops-legend div{display:grid;grid-template-columns:9px 1fr auto;align-items:center;gap:7px;font-size:10px;color:var(--muted)}.ops-legend strong{color:var(--text)}.ops-legend-dot{width:8px;height:8px;border-radius:3px}
        .ops-table-wrap{overflow:auto}.ops-table{border-collapse:collapse;width:100%;white-space:nowrap}.ops-table th{text-align:left;color:#758897;font-size:9px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;padding:10px 9px;border-bottom:1px solid var(--line)}.ops-table td{padding:12px 9px;border-bottom:1px solid #1f2c35;color:#c9d5dd;font-size:11px}.ops-table tbody tr:last-child td{border-bottom:0}.ops-table td strong{display:block;color:var(--text);font-weight:550}.ops-table td small{display:block;color:var(--muted);margin-top:4px}.ops-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border-radius:5px;font-size:9px;background:#1b2a31;color:#b5c6d0}.ops-badge.green{background:#18291d;color:var(--green)}.ops-badge.amber{background:#302719;color:var(--amber)}.ops-badge.red{background:#301d22;color:#ff9aa1}.ops-empty{min-height:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;color:#738896;padding:20px}.ops-empty strong{color:#cbd7df;font-size:12px}.ops-empty p{font-size:10px;max-width:300px;line-height:1.6;margin:0;color:var(--muted)}
        .ops-status-list{display:grid;gap:0}.ops-status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #22303a}.ops-status-row:last-child{border-bottom:0}.ops-status-name{display:flex;align-items:center;gap:9px}.ops-status-name strong{display:block;font-size:11px;font-weight:550}.ops-status-name small{display:block;color:var(--muted);font-size:9px;margin-top:4px}.ops-status-value{font-size:10px;color:var(--green);display:flex;align-items:center;gap:5px}.ops-status-value.warn{color:var(--amber)}
        .ops-form{display:grid;gap:13px}.ops-field{display:grid;gap:6px}.ops-field label{font-size:10px;color:#9eafbb}.ops-field input,.ops-field textarea,.ops-field select{width:100%;background:#0b131a;border:1px solid #2a3b47;color:var(--text);border-radius:8px;padding:11px;font:inherit;outline:none}.ops-field input:focus,.ops-field textarea:focus,.ops-field select:focus{border-color:var(--cyan)}.ops-field textarea{resize:vertical;min-height:110px;line-height:1.6}.ops-help{color:var(--muted);font-size:10px;line-height:1.6}.ops-checkbox{display:flex;align-items:flex-start;gap:9px;color:#a9bac5;font-size:11px;line-height:1.5}.ops-checkbox input{accent-color:var(--green);margin-top:2px}.ops-callout{padding:13px;border:1px solid #33434e;background:#0d151c;border-radius:9px;color:#a9bac5;font-size:11px;line-height:1.6}.ops-section-title{font-size:11px;letter-spacing:1px;color:#8396a4;margin:22px 0 10px}.ops-tabs{display:flex;gap:6px;flex-wrap:wrap}.ops-tabs button{background:#111b23;border:1px solid var(--line);border-radius:7px;color:var(--muted);padding:8px 10px;font:inherit;cursor:pointer}.ops-tabs button.active{color:var(--green);border-color:#3b6142;background:#15241b}.ops-footnote{color:#627685;font-size:10px;line-height:1.6;margin-top:15px}
        @media(max-width:1100px){.ops-shell{grid-template-columns:190px minmax(0,1fr)}.ops-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ops-grid-3{grid-template-columns:1fr 1fr}.ops-content{padding:18px}.ops-topbar{padding:14px 18px}}
        @media(max-width:760px){.ops-shell{grid-template-columns:1fr}.ops-sidebar{border-right:0;border-bottom:1px solid var(--line);padding:13px;gap:13px}.ops-brand{padding:0 4px}.ops-nav{display:flex;overflow:auto}.ops-nav-label,.ops-sidebar-bottom{display:none}.ops-nav button{white-space:nowrap;width:auto;padding:9px}.ops-nav button span{display:inline}.ops-topbar{padding:12px;flex-wrap:wrap}.ops-search input{width:100px}.ops-content{padding:13px}.ops-page-head{flex-direction:column}.ops-grid-2,.ops-grid-3{grid-template-columns:1fr}.ops-distribution{justify-content:flex-start}.ops-metric{padding:12px}.ops-metric strong{font-size:22px}}
      `}</style>

      <aside className="ops-sidebar">
        <div className="ops-brand">
          <div className="ops-brand-mark"><GraduationCap size={23} /></div>
          <div>
            <strong>SCHHOL</strong>
            <span>PLATFORM CONTROL</span>
          </div>
        </div>

        <div>
          <div className="ops-nav-label">OPERATIONS</div>
          <nav className="ops-nav">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setLocalNotice('');
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div>
          <div className="ops-nav-label">SCHOOL MANAGEMENT</div>
          <div className="ops-callout">
            <Building2 size={17} style={{ color: 'var(--cyan)' }} />
            <p style={{ margin: '9px 0 5px', color: 'var(--text)' }}>
              School administration
            </p>
            <p style={{ margin: 0 }}>
              Use your existing school directory and approval workflows for
              school-level actions.
            </p>
          </div>
          <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
            <button
              className="ops-button"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => onNavigate('schools')}
            >
              <Building2 size={14} /> Schools
            </button>
            <button
              className="ops-button"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => onNavigate('admin-requests')}
            >
              <Users size={14} /> Administrator requests
            </button>
            <button
              className="ops-button"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => onNavigate('subscriptions')}
            >
              <CreditCard size={14} /> Subscriptions
            </button>
          </div>
        </div>

        <div className="ops-sidebar-bottom">
          <div className="ops-mini-status">
            <span><i className="ops-dot" /> Dashboard interface ready</span>
            <small>Live service health requires monitoring integration.</small>
          </div>
        </div>
      </aside>

      <main className="ops-main">
        <header className="ops-topbar">
          <div className="ops-crumb">
            Platform / <strong>{activeTab?.label ?? 'Overview'}</strong>
          </div>
          <div className="ops-top-actions">
            <label className="ops-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search schools..."
                aria-label="Search schools"
              />
            </label>
            <button
              className="ops-icon-btn"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh platform data"
            >
              <RefreshCw size={15} className={loading ? 'ops-spin' : ''} />
            </button>
            <button className="ops-button" onClick={onSignOut}>
              Sign out
            </button>
            <button
              className="ops-avatar"
              type="button"
              title="Open platform administrator profile"
              aria-label="Open platform administrator profile"
              onClick={onProfile}
              style={{ border: 0, cursor: 'pointer' }}
            >
              PA
            </button>
          </div>
        </header>

        <div className="ops-content">
          <div className="ops-page-head">
            <div>
              <div className="ops-eyebrow">SYSTEM OPERATIONS / CONTROL CENTRE</div>
              <h1>
                {tab === 'overview' && 'Platform overview'}
                {tab === 'payments' && 'Payments & revenue'}
                {tab === 'sessions' && 'Login & security'}
                {tab === 'performance' && 'Platform performance'}
                {tab === 'notifications' && 'Notifications centre'}
                {tab === 'maintenance' && 'Maintenance controls'}
              </h1>
              <p>
                Monitor your school-management platform, review operations, and
                manage platform-wide communications.
              </p>
            </div>
            <div className="ops-head-actions">
              <button className="ops-button" onClick={exportSchools}>
                <Download size={14} /> Export schools
              </button>
              <button
                className="ops-button primary"
                onClick={onRefresh}
                disabled={loading}
              >
                <RefreshCw size={14} /> Refresh data
              </button>
            </div>
          </div>

          {loadError && (
            <div className="ops-error">
              <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} />
              {loadError}
            </div>
          )}

          {localNotice && (
            <div className="ops-banner">
              <AlertTriangle size={17} />
              <div>{localNotice}</div>
              <button
                className="ops-icon-btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => setLocalNotice('')}
                aria-label="Dismiss message"
              >
                <XCircle size={15} />
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <>
              <div className="ops-metrics">
                <div className="ops-metric">
                  <div className="ops-metric-top">
                    Registered schools
                    <div className="ops-metric-icon"><Building2 size={17} /></div>
                  </div>
                  <strong>{loading ? '—' : overview.total_schools}</strong>
                  <small>Across the platform</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">
                    Active schools
                    <div className="ops-metric-icon"><CheckCircle2 size={17} /></div>
                  </div>
                  <strong>{loading ? '—' : overview.active_schools}</strong>
                  <small className="good">Currently marked active</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">
                    Pending approvals
                    <div className="ops-metric-icon"><Clock3 size={17} /></div>
                  </div>
                  <strong>{loading ? '—' : overview.pending_schools}</strong>
                  <small>Schools awaiting review</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">
                    Overdue subscriptions
                    <div className="ops-metric-icon"><CreditCard size={17} /></div>
                  </div>
                  <strong>{loading ? '—' : overview.overdue_subscriptions}</strong>
                  <small>Require billing review</small>
                </div>
              </div>

              <div className="ops-grid-2">
                <Panel
                  title="School onboarding activity"
                  subtitle="Current distribution of schools returned by the active-school endpoint"
                  action={<span className="ops-badge">Live query</span>}
                >
                  <div className="ops-chart-summary">
                    <div>
                      <strong>{loading ? '—' : totalKnown}</strong>
                      <span>Known school records</span>
                    </div>
                    <span>Current snapshot</span>
                  </div>
                  <div className="ops-chart-area">
                    <MiniBars
                      labels={['Active', 'Pending', 'Suspended']}
                      values={[
                        overview.active_schools,
                        overview.pending_schools,
                        overview.suspended_schools,
                      ]}
                    />
                  </div>
                  <div className="ops-chart-foot">
                    <span>Counts from platform overview</span>
                    <span>Historical trend not connected</span>
                  </div>
                </Panel>

                <Panel
                  title="School status distribution"
                  subtitle="Breakdown from available platform overview records"
                >
                  <div className="ops-distribution">
                    <Ring
                      value={overview.active_schools}
                      total={Math.max(overview.total_schools, 1)}
                      color="#a3ff5f"
                    />
                    <div className="ops-legend">
                      <div>
                        <i className="ops-legend-dot" style={{ background: 'var(--green)' }} />
                        Active <strong>{overview.active_schools}</strong>
                      </div>
                      <div>
                        <i className="ops-legend-dot" style={{ background: 'var(--amber)' }} />
                        Pending <strong>{overview.pending_schools}</strong>
                      </div>
                      <div>
                        <i className="ops-legend-dot" style={{ background: 'var(--red)' }} />
                        Suspended <strong>{overview.suspended_schools}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="ops-footnote">
                    These are school counts, not uptime or financial metrics.
                  </div>
                </Panel>
              </div>

              <div className="ops-grid-2">
                <Panel
                  title="School directory"
                  subtitle={`${filteredSchools.length} records matching your search`}
                  action={
                    <button className="ops-icon-btn" onClick={exportSchools}>
                      <Download size={14} />
                    </button>
                  }
                >
                  {loading ? (
                    <EmptyState
                      icon={RefreshCw}
                      title="Loading school records"
                      description="Waiting for Supabase to return the directory."
                    />
                  ) : filteredSchools.length === 0 ? (
                    <EmptyState
                      icon={Building2}
                      title="No matching schools"
                      description="Try another search term, or refresh the directory."
                    />
                  ) : (
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>School</th>
                            <th>Status</th>
                            <th>Subscription</th>
                            <th>Registered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSchools.slice(0, 8).map((school) => (
                            <tr key={school.id}>
                              <td>
                                <strong>{school.name}</strong>
                                <small>{school.slug ?? school.id.slice(0, 8)}</small>
                              </td>
                              <td>
                                <span className={`ops-badge ${
                                  school.status === 'active'
                                    ? 'green'
                                    : school.status === 'suspended'
                                    ? 'red'
                                    : 'amber'
                                }`}>
                                  {school.status ?? 'Unknown'}
                                </span>
                              </td>
                              <td>{school.subscription_status ?? '—'}</td>
                              <td>{dateLabel(school.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                <Panel
                  title="Subscription health"
                  subtitle="Current subscription totals from the overview RPC"
                >
                  <div className="ops-status-list">
                    {[
                      {
                        label: 'Active subscriptions',
                        detail: 'Currently active',
                        value: overview.active_subscriptions,
                        color: 'var(--green)',
                      },
                      {
                        label: 'Trial subscriptions',
                        detail: 'Trial period',
                        value: overview.trial_subscriptions,
                        color: 'var(--cyan)',
                      },
                      {
                        label: 'Overdue subscriptions',
                        detail: 'Requires review',
                        value: overview.overdue_subscriptions,
                        color: 'var(--amber)',
                      },
                      {
                        label: 'Cancelled subscriptions',
                        detail: 'No longer active',
                        value: overview.cancelled_subscriptions,
                        color: 'var(--red)',
                      },
                    ].map((item) => (
                      <div className="ops-status-row" key={item.label}>
                        <div className="ops-status-name">
                          <i
                            className="ops-legend-dot"
                            style={{ background: item.color }}
                          />
                          <div>
                            <strong>{item.label}</strong>
                            <small>{item.detail}</small>
                          </div>
                        </div>
                        <strong>{loading ? '—' : item.value}</strong>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <div className="ops-grid-3">
                <Panel title="Payment records" subtitle="Verified financial events">
                  <EmptyState
                    icon={CreditCard}
                    title="Payment ledger not connected"
                    description="Connect the verified platform payment ledger to show receipts, transaction references, amounts, and settlement statuses."
                  />
                </Panel>
                <Panel title="Login sessions" subtitle="Authentication activity">
                  <EmptyState
                    icon={LockKeyhole}
                    title="Session history not connected"
                    description="Login events need a trusted authentication audit source. Do not expose session tokens or passwords."
                  />
                </Panel>
                <Panel title="System performance" subtitle="Live service monitoring">
                  <EmptyState
                    icon={MonitorCog}
                    title="Monitoring source not connected"
                    description="Response times, error rates, uptime, and database health need actual monitoring data."
                  />
                </Panel>
              </div>
            </>
          )}

          {tab === 'payments' && (
            <>
              <div className="ops-metrics">
                <div className="ops-metric">
                  <div className="ops-metric-top">Verified revenue <CreditCard size={17} /></div>
                  <strong>—</strong>
                  <small>Waiting for verified payment ledger</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Successful transactions <CheckCircle2 size={17} /></div>
                  <strong>—</strong>
                  <small>Confirmed payment callbacks only</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Pending transactions <Clock3 size={17} /></div>
                  <strong>—</strong>
                  <small>Pending ledger integration</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Failed transactions <AlertTriangle size={17} /></div>
                  <strong>—</strong>
                  <small>Pending ledger integration</small>
                </div>
              </div>
              <div className="ops-grid-2">
                <Panel title="Revenue trend" subtitle={`Selected period: ${range}`}>
                  <div className="ops-tabs">
                    {['7 days', '30 days', '90 days', '12 months'].map((item) => (
                      <button
                        key={item}
                        className={range === item ? 'active' : ''}
                        onClick={() => setRange(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <EmptyState
                    icon={Activity}
                    title="Revenue series unavailable"
                    description="This graph will use confirmed platform revenue entries grouped by day or month. No sample amounts are being displayed as real income."
                  />
                </Panel>
                <Panel title="Payment reconciliation" subtitle="Transaction integrity">
                  <div className="ops-status-list">
                    {[
                      ['Callback verification', 'Requires backend confirmation'],
                      ['Duplicate transaction checks', 'Required'],
                      ['Platform fee allocation', 'Ledger integration required'],
                      ['Refund and reversal tracking', 'Ledger integration required'],
                    ].map(([label, detail]) => (
                      <div className="ops-status-row" key={label}>
                        <div className="ops-status-name">
                          <ShieldCheck size={16} color="var(--cyan)" />
                          <div>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </div>
                        </div>
                        <span className="ops-badge amber">Pending</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <Panel title="Payment ledger" subtitle="Searchable transaction records">
                <EmptyState
                  icon={CreditCard}
                  title="No payment source connected to this view"
                  description="Once the platform revenue table and verified payment records are mapped, this table can show date, school, receipt number, amount, status, and transaction reference."
                />
              </Panel>
            </>
          )}

          {tab === 'sessions' && (
            <>
              <Panel
                title="User profiles"
                subtitle="Account details and private profile photos"
                action={
                  <button
                    className="ops-icon-btn"
                    type="button"
                    title="Refresh user profiles"
                    onClick={() => void loadProfiles()}
                    disabled={profilesLoading}
                  >
                    <RefreshCw size={14} />
                  </button>
                }
              >
                <label className="ops-search" style={{ marginBottom: 14, width: 'min(100%, 380px)' }}>
                  <Search size={15} />
                  <input
                    value={profileSearch}
                    onChange={(event) => setProfileSearch(event.target.value)}
                    placeholder="Search name, email, phone or role"
                    aria-label="Search user profiles"
                  />
                </label>
                {profilesError && <div className="ops-error" role="alert">{profilesError}</div>}
                {profilesLoading && profiles.length === 0 ? (
                  <EmptyState
                    icon={RefreshCw}
                    title="Loading user profiles"
                    description="Retrieving account details and signed photo URLs."
                  />
                ) : filteredProfiles.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No profiles found"
                    description="Try another search or refresh the user directory."
                  />
                ) : (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>Profile</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Portal access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProfiles.map((profile) => {
                          const name = profile.display_name || profile.full_name || 'Name not provided';
                          const initials = name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase())
                            .join('') || 'U';
                          const photoUrl = profile.avatar_url
                            ? profilePhotos[profile.avatar_url]
                            : undefined;

                          return (
                            <tr key={profile.id}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  {photoUrl ? (
                                    <img
                                      src={photoUrl}
                                      alt=""
                                      width={38}
                                      height={38}
                                      style={{ borderRadius: '50%', objectFit: 'cover' }}
                                    />
                                  ) : (
                                    <span className="ops-avatar" aria-hidden="true">{initials}</span>
                                  )}
                                  <strong>{name}</strong>
                                </div>
                              </td>
                              <td>{profile.email || '—'}</td>
                              <td>{profile.phone || '—'}</td>
                              <td>
                                {(profileRoles[profile.id]?.length
                                  ? profileRoles[profile.id]
                                  : ['No portal membership']
                                ).map((role) => <small key={role}>{role}</small>)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {profilesHaveMore && (
                  <button
                    className="ops-button"
                    type="button"
                    onClick={() => void loadProfiles(true)}
                    disabled={profilesLoading}
                    style={{ marginTop: 12 }}
                  >
                    {profilesLoading ? 'Loading…' : 'Load more profiles'}
                  </button>
                )}
              </Panel>

              <div className="ops-metrics">
                <div className="ops-metric">
                  <div className="ops-metric-top">Active sessions <Users size={17} /></div>
                  <strong>—</strong>
                  <small>Session provider required</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Successful logins <CheckCircle2 size={17} /></div>
                  <strong>—</strong>
                  <small>Selected period: {range}</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Failed logins <AlertTriangle size={17} /></div>
                  <strong>—</strong>
                  <small>Authentication event source required</small>
                </div>
                <div className="ops-metric">
                  <div className="ops-metric-top">Security alerts <ShieldCheck size={17} /></div>
                  <strong>—</strong>
                  <small>Alert rules not configured</small>
                </div>
              </div>
              <Panel title="Login and session history" subtitle="Security-conscious event monitoring">
                <EmptyState
                  icon={LockKeyhole}
                  title="Authentication audit integration required"
                  description="Connect a trusted server-side audit source for user, event type, timestamp, and safe device metadata. Never display passwords, access tokens, or session secrets."
                />
              </Panel>
              <div className="ops-grid-2" style={{ marginTop: 15 }}>
                <Panel title="Security controls" subtitle="Recommended platform safeguards">
                  <div className="ops-status-list">
                    {[
                      ['Role-based portal access', 'Keep enabled'],
                      ['School data isolation', 'Keep RLS enabled'],
                      ['Administrative action logs', 'Record changes server-side'],
                      ['Suspicious login detection', 'Requires event source'],
                    ].map(([label, detail]) => (
                      <div className="ops-status-row" key={label}>
                        <div className="ops-status-name">
                          <ShieldCheck size={16} color="var(--green)" />
                          <div>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Audit trail" subtitle="Sensitive administrative actions">
                  <EmptyState
                    icon={Activity}
                    title="Audit feed not connected"
                    description="Connect the existing server-side audit log with action, actor, school, timestamp, and outcome fields."
                  />
                </Panel>
              </div>
            </>
          )}

          {tab === 'performance' && (
            <>
              <div className="ops-banner">
                <AlertTriangle size={17} />
                <div>
                  Performance figures are intentionally blank until a monitoring
                  source is connected. The interface must not claim real uptime
                  or response times without evidence.
                </div>
              </div>
              <div className="ops-metrics">
                {[
                  ['Platform uptime', '—', 'Requires uptime monitor', Activity],
                  ['Average response time', '—', 'Requires server telemetry', Gauge],
                  ['Error rate', '—', 'Requires error monitoring', AlertTriangle],
                  ['Database latency', '—', 'Requires database metrics', MonitorCog],
                ].map(([label, value, detail, Icon]) => {
                  const MetricIcon = Icon as typeof Activity;
                  return (
                    <div className="ops-metric" key={label as string}>
                      <div className="ops-metric-top">
                        {label as string}
                        <MetricIcon size={17} />
                      </div>
                      <strong>{value as string}</strong>
                      <small>{detail as string}</small>
                    </div>
                  );
                })}
              </div>
              <div className="ops-grid-2">
                <Panel title="Response time trend" subtitle="Requires application telemetry">
                  <EmptyState
                    icon={Activity}
                    title="No performance series available"
                    description="Connect a monitoring provider or server-side metrics endpoint to populate this graph."
                  />
                </Panel>
                <Panel title="Service health" subtitle="Checks must run against real services">
                  <div className="ops-status-list">
                    {[
                      ['Public web application', 'Probe required'],
                      ['Supabase database', 'Connectivity check required'],
                      ['Authentication service', 'Probe required'],
                      ['Payment callback endpoint', 'Probe required'],
                      ['Notification delivery', 'Probe required'],
                    ].map(([label, detail]) => (
                      <div className="ops-status-row" key={label}>
                        <div className="ops-status-name">
                          <Activity size={16} color="var(--cyan)" />
                          <div>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </div>
                        </div>
                        <span className="ops-badge amber">Unknown</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          )}

          {tab === 'notifications' && (
            <div className="ops-grid-2">
              <Panel
                title="Compose platform notification"
                subtitle="Prepare a message for school administrators"
              >
                <form
                  className="ops-form"
                  onSubmit={(event) => {
                    void publishAnnouncement(event);
                  }}
                >
                  <div className="ops-field">
                    <label htmlFor="ops-notice-title">Notification title</label>
                    <input
                      id="ops-notice-title"
                      value={noticeTitle}
                      onChange={(e) => setNoticeTitle(e.target.value)}
                      placeholder="Scheduled system maintenance"
                      maxLength={120}
                    />
                  </div>
                  <div className="ops-field">
                    <label htmlFor="ops-notice-audience">Recipients</label>
                    <select
                      id="ops-notice-audience"
                      value={noticeAudience}
                      onChange={(e) =>
                        setNoticeAudience(e.target.value as AnnouncementAudience)
                      }
                    >
                      <option value="all_active">All active school members</option>
                      <option value="school_admins">School administrators</option>
                      <option value="selected_schools">Selected schools</option>
                    </select>
                  </div>
                  {noticeAudience === 'selected_schools' && (
                    <div className="ops-field">
                      <label htmlFor="ops-notice-schools">Schools</label>
                      <select
                        id="ops-notice-schools"
                        multiple
                        size={Math.min(6, Math.max(3, schools.length))}
                        value={noticeSchoolIds}
                        onChange={(event) =>
                          setNoticeSchoolIds(
                            Array.from(
                              event.currentTarget.selectedOptions,
                              (option) => option.value,
                            ),
                          )
                        }
                      >
                        {schools
                          .filter((school) => school.status === 'active')
                          .map((school) => (
                            <option key={school.id} value={school.id}>
                              {school.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  <div className="ops-field">
                    <label htmlFor="ops-notice-message">Message</label>
                    <textarea
                      id="ops-notice-message"
                      value={noticeMessage}
                      onChange={(e) => setNoticeMessage(e.target.value)}
                      placeholder="Write a clear announcement, include the time window and expected impact..."
                      maxLength={4000}
                    />
                    <div className="ops-help">
                      {noticeMessage.length}/4000 characters
                    </div>
                  </div>
                  <div className="ops-callout">
                    Publishing saves this announcement in Supabase. Recipients
                    see it in their portal inbox; email and push delivery are not
                    configured.
                  </div>
                  {announcementError && (
                    <div className="ops-error" role="alert">
                      {announcementError}
                    </div>
                  )}
                  <button
                    className="ops-button primary"
                    type="submit"
                    disabled={announcementSaving}
                  >
                    <Send size={14} />
                    {announcementSaving ? 'Publishing…' : 'Publish announcement'}
                  </button>
                </form>
              </Panel>
              <Panel
                title="Announcement history"
                subtitle="Latest announcements published to portal inboxes"
              >
                {announcementLoading ? (
                  <EmptyState
                    icon={RefreshCw}
                    title="Loading announcements"
                    description="Retrieving saved announcements from Supabase."
                  />
                ) : announcementError && announcementHistory.length === 0 ? (
                  <div className="ops-error" role="alert">{announcementError}</div>
                ) : announcementHistory.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="No announcements yet"
                    description="Published announcements will appear here and in recipient portal inboxes."
                  />
                ) : (
                  <div className="ops-status-list">
                    {announcementHistory.map((announcement) => (
                      <article className="ops-status-row" key={announcement.id}>
                        <div className="ops-status-name">
                          <Bell size={16} color="var(--cyan)" />
                          <div>
                            <strong>{announcement.title}</strong>
                            <small>{announcement.body}</small>
                            <small>
                              {announcement.audience === 'all_active'
                                ? 'All active school members'
                                : announcement.audience === 'school_admins'
                                  ? 'School administrators'
                                  : `${announcement.target_school_ids.length} selected school(s)`}
                              {' · '}
                              {new Date(announcement.published_at).toLocaleString()}
                            </small>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === 'maintenance' && (
            <div className="ops-grid-2">
              <Panel
                title="Platform maintenance controls"
                subtitle="Plan and authorize platform-wide maintenance"
              >
                <div className="ops-banner">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Maintenance mode is not connected</strong>
                    <p>
                      This screen does not change live platform access. A
                      backend flag, protected administrative action, and
                      maintenance handling in each portal are needed.
                    </p>
                  </div>
                </div>
                <form
                  className="ops-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    requestMaintenance();
                  }}
                >
                  <div className="ops-field">
                    <label htmlFor="ops-maintenance-reason">Maintenance reason</label>
                    <textarea
                      id="ops-maintenance-reason"
                      value={maintenanceReason}
                      onChange={(e) => setMaintenanceReason(e.target.value)}
                      placeholder="Describe the maintenance, expected impact, and reason..."
                      maxLength={1500}
                    />
                  </div>
                  <label className="ops-checkbox">
                    <input
                      type="checkbox"
                      checked={maintenanceEnabled}
                      onChange={(e) => setMaintenanceEnabled(e.target.checked)}
                    />
                    <span>
                      I understand that activating maintenance mode can affect
                      school access and must be authorized and communicated.
                    </span>
                  </label>
                  <button
                    className="ops-button primary"
                    type="submit"
                    disabled={!maintenanceEnabled}
                  >
                    <Wrench size={14} /> Prepare maintenance request
                  </button>
                </form>
              </Panel>

              <Panel title="Maintenance checklist" subtitle="Recommended rollout safeguards">
                <div className="ops-status-list">
                  {[
                    ['Notify school administrators', 'Publish a notice before the window'],
                    ['Set maintenance schedule', 'Use server-side start and end times'],
                    ['Protect critical data', 'Do not disable database security policies'],
                    ['Show a maintenance page', 'Handle each portal consistently'],
                    ['Preserve emergency access', 'Restrict changes to authorized operators'],
                    ['Record the audit trail', 'Store who enabled and disabled maintenance'],
                  ].map(([label, detail]) => (
                    <div className="ops-status-row" key={label}>
                      <div className="ops-status-name">
                        <CheckCircle2 size={16} color="var(--cyan)" />
                        <div>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          <div className="ops-footnote">
            SCHHOL Platform Control Centre · School data remains protected by
            Supabase Row Level Security. Financial, authentication, messaging,
            and monitoring panels must be connected to verified sources before
            they display live figures or perform platform-wide actions.
          </div>
        </div>
      </main>

      {confirmMaintenance && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#000b',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              width: 'min(100%, 430px)',
              background: '#101820',
              color: '#edf4f8',
              border: '1px solid #3c4c57',
              borderRadius: 14,
              padding: 22,
            }}
          >
            <AlertTriangle color="#ffc76a" size={25} />
            <h3 id="ops-confirm-title">Review maintenance request</h3>
            <p style={{ color: '#9cabb6', lineHeight: 1.7 }}>
              Reason: {maintenanceReason}
            </p>
            <p style={{ color: '#9cabb6', lineHeight: 1.7 }}>
              This prepares the request only. It does not disable or block any
              portal until the secure backend maintenance control is implemented.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="ops-button"
                onClick={() => setConfirmMaintenance(false)}
              >
                Cancel
              </button>
              <button
                className="ops-button primary"
                onClick={confirmMaintenanceRequest}
              >
                Confirm request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

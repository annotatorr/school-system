import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';

import { supabase, supabaseReady } from './supabase';
import {
  getCurrentPortalIdentity,
  loginSchoolPortal,
  logoutSchoolPortal,
  requestSchoolPortalAccount,
  restorePortalIdentity,
  type PortalIdentity,
  type SchoolPortalRole,
} from './portal-auth';
import { PortalProfileCompletion } from './PortalProfileCompletion';
import { PlatformAdminControlCentre } from './PlatformAdminControlCentre';
import { PortalWorkspace } from './PortalWorkspace';
import { ThemeToggle } from './ThemeToggle';
import { initThemeMode } from './theme';
import './styles.css';
import './education-background.css';
import './portal-workspace.css';
import './school-context.css';
import './theme.css';
import './student-portal.css';

initThemeMode();

type RoleKey =
  | 'platform-admin'
  | 'school-admin'
  | 'principal'
  | 'secretary'
  | 'teacher'
  | 'student'
  | 'parent';

type SchoolOption = {
  id: string;
  name: string;
  slug: string;
};

type PortalConfig = {
  key: RoleKey;
  title: string;
  subtitle: string;
  intro: string;
  overview: string;
  modules: readonly string[];
  urlHint: string;
};

type PortalStat = {
  label: string;
  value: string;
  note: string;
  Icon: any;
};

const icons = [
  LayoutDashboard,
  Users,
  BookOpen,
  ClipboardCheck,
  Wallet,
  CalendarDays,
  FileText,
  Settings,
];

const moduleCopy: Record<string, string> = {
  'school onboarding':
    'Register, review and activate schools on the platform.',
  'subscription control':
    'View subscription status and manage overdue suspension or reactivation workflows.',
  'platform revenue':
    'Track platform maintenance revenue separately from school fee collections.',
  'audit log':
    'Review recorded actions once audit events are connected.',
  'users and roles':
    'Manage authorized school accounts and role assignments.',
  'classes and subjects':
    'Set up classes, streams, subjects and teaching assignments.',
  'school settings':
    'Configure school profile, term dates and authorized settings.',
  records:
    'Search and maintain school records within assigned permissions.',
  'school performance':
    'Review school-wide academic and operational summaries.',
  'academic reports':
    'Prepare academic summaries and term reports.',
  approvals:
    'Review items awaiting leadership approval.',
  'staff oversight':
    'Review staffing and workload information.',
  admissions:
    'Review submitted applications and their documents.',
  'teacher applications':
    'Review teacher sign-ups and record approval decisions.',
  'account requests':
    'Review school-scoped student, parent, teacher and principal sign-up requests.',
  'student records':
    'Maintain verified student details and class links.',
  'fee administration':
    'Manage only the fee tasks delegated by the principal.',
  'my classes':
    'Open the classes and subjects assigned to your account.',
  attendance:
    'Record attendance for classes you are authorized to teach.',
  assignments:
    'Prepare learning tasks; AI-generated work must be reviewed before publishing.',
  'marks and results':
    'Record assessment results for assigned classes and subjects.',
  textbooks:
    'Record book issues and returns, preserving each book’s unique ID.',
  'my assignments':
    'View published assignments and submission instructions.',
  'learning materials':
    'Access learning resources shared with your class.',
  results:
    'View your own approved results.',
  'fee statement':
    'View the fee statement for your own student account.',
  'linked children':
    'View only children verified and linked to your guardian account.',
  'attendance updates':
    'Follow attendance information for linked children.',
  'fee statements':
    'View statements for verified linked children.',
  messages:
    'Read school messages intended for your account.',
};

/**
 * Checks whether a signed-in user has access to this portal.
 * Checking access does not grant permissions.
 */
async function hasPortalAccess(
  userId: string,
  role: RoleKey,
  schoolId?: string,
): Promise<boolean> {
  if (!supabase) return false;

  if (role === 'platform-admin') {
    const { data, error } = await supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(`Could not verify platform access: ${error.message}`);
    return Boolean(data);
  }

  if (role === 'student') {
    let query = supabase
      .from('students')
      .select('id,status')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data, error } = await query.limit(1);

    if (error) throw new Error(`Could not verify the student record: ${error.message}`);
    return Boolean(data?.length);
  }

  if (role === 'parent') {
    let guardianQuery = supabase
      .from('guardians')
      .select('id, school_id')
      .eq('user_id', userId);
    if (schoolId) guardianQuery = guardianQuery.eq('school_id', schoolId);
    const { data, error } = await guardianQuery.limit(5);

    if (error) throw new Error(`Could not verify the guardian record: ${error.message}`);
    if (!data?.length) return false;

    const guardianIds = data.map((guardian) => guardian.id);
    const { data: links, error: linkError } = await supabase
      .from('student_guardians')
      .select('student_id')
      .in('guardian_id', guardianIds);

    if (linkError) throw new Error(`Could not verify linked students: ${linkError.message}`);
    if (!links?.length) return false;

    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('id,status')
      .in('id', links.map((link) => link.student_id))
      .eq('status', 'active')
      .limit(1);

    if (studentError) throw new Error(`Could not verify the linked student records: ${studentError.message}`);
    return Boolean(students?.length);
  }

  const expectedRole = role.replace('-', '_');

  let membershipQuery = supabase
    .from('school_memberships')
    .select('role, status')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (schoolId) membershipQuery = membershipQuery.eq('school_id', schoolId);
  const { data, error } = await membershipQuery;

  if (error) throw new Error(`Could not verify the staff membership: ${error.message}`);
  return (
    Boolean(
      data?.some(
        (membership: { role: string; status: string }) =>
          membership.role === expectedRole,
      ),
    )
  );
}

type PortalSchool = {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_path: string | null;
  motto: string | null;
};

function getSchoolSlugFromPath(): string {
  return window.location.pathname
    .split('/')
    .filter(Boolean)[0]
    ?.toLowerCase() || '';
}

function normalizeSchoolUrl(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function schoolMatchesUrl(school: PortalSchool, requestedSlug: string): boolean {
  return (
    normalizeSchoolUrl(school.slug) === requestedSlug ||
    normalizeSchoolUrl(school.name) === requestedSlug
  );
}

/**
 * Resolve the schools this signed-in account may operate in for this portal.
 * Staff use active memberships; students use their active student record;
 * parents use verified guardian links. The backend still enforces access.
 */
async function loadPortalSchools(
  userId: string,
  role: RoleKey,
): Promise<PortalSchool[]> {
  if (!supabase) return [];
  const columns = 'id,name,slug,status,logo_path,motto';

  if (role === 'student') {
    const { data, error } = await supabase
      .from('students')
      .select(`school_id, schools(${columns})`)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    return (data ?? []).flatMap((row: any) =>
      row.schools ? [row.schools as PortalSchool] : [],
    );
  }

  if (role === 'parent') {
    const { data, error } = await supabase
      .from('guardians')
      .select('school_id, schools(' + columns + ')')
      .eq('user_id', userId);
    if (error) throw error;
    const unique = new Map<string, PortalSchool>();
    (data ?? []).forEach((row: any) => {
      if (row.schools) unique.set(row.schools.id, row.schools);
    });
    return [...unique.values()];
  }

  const expectedRole = role.replace('-', '_');
  const { data, error } = await supabase
    .from('school_memberships')
    .select(`school_id, schools(${columns})`)
    .eq('user_id', userId)
    .eq('role', expectedRole)
    .eq('status', 'active');
  if (error) throw error;
  const unique = new Map<string, PortalSchool>();
  (data ?? []).forEach((row: any) => {
    if (row.schools) unique.set(row.schools.id, row.schools);
  });
  return [...unique.values()];
}

function GenericPortalApp({
  config,
}: {
  config: PortalConfig;
}) {
  const requestedSchoolSlug = getSchoolSlugFromPath();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const [email, setEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupDateOfBirth, setSignupDateOfBirth] = useState('');
  const [relatedAdmissionNumber, setRelatedAdmissionNumber] = useState('');
  const [parentRelationship, setParentRelationship] = useState('Parent/Guardian');

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [applicationReason, setApplicationReason] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [profileSetupDone, setProfileSetupDone] = useState(false);
  const completeProfileSetup = useCallback(
    () => setProfileSetupDone(true),
    [],
  );

  const [portalSchools, setPortalSchools] = useState<PortalSchool[]>([]);
  const [activeSchoolId, setActiveSchoolId] = useState('');
  const [portalSchoolsLoading, setPortalSchoolsLoading] = useState(false);
  const [stats, setStats] = useState<PortalStat[]>(() => getStats(config.key));

  const [page, setPage] = useState('Overview');
  const [mobileNav, setMobileNav] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [preview, setPreview] = useState('');

  // Restore the current session and verify portal authorization.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let alive = true;

    if (['student', 'parent', 'teacher', 'principal'].includes(config.key)) {
      const refreshTimer = window.setInterval(() => {
        void restorePortalIdentity().catch((error: unknown) => {
          if (!alive) return;
          setNotice(
            error instanceof Error
              ? `Could not refresh your school session: ${error.message}`
              : 'Could not refresh your school session.',
          );
        });
      }, 7 * 60 * 1000);

      void restorePortalIdentity()
        .then(async (identity) => {
          if (!alive) return;
          if (!identity) {
            setSession(null);
            setLoading(false);
            return;
          }

          const roleMatches = identity.role === config.key;
          const schoolMatches =
            !requestedSchoolSlug ||
            schoolMatchesUrl(
              {
                id: identity.schoolId,
                name: identity.schoolName,
                slug: identity.schoolSlug,
                status: 'active',
                logo_path: null,
                motto: null,
              },
              requestedSchoolSlug,
            );
          const allowed =
            roleMatches &&
            schoolMatches &&
            (await hasPortalAccess(
              identity.id,
              config.key,
              identity.schoolId,
            ));

          if (!alive) return;
          if (!allowed) {
            await logoutSchoolPortal();
            setSession(null);
            setNotice(
              !roleMatches
                ? 'This account belongs to a different portal role. Sign in through the matching portal.'
                : !schoolMatches
                  ? `This account belongs to ${identity.schoolName}, not the school in this link.`
                  : config.key === 'student'
                    ? 'Your login was approved, but no active student record is linked to this account at this school. Ask the school administrator to verify the student record.'
                    : 'This account has no active school record for this portal. Ask the school administrator to verify its approved role and school link.',
            );
            setLoading(false);
            return;
          }

          setSession({
            user: {
              id: identity.id,
              email: identity.username,
              user_metadata: { full_name: identity.fullName },
            },
            portalIdentity: identity,
          });
          setProfileSetupDone(false);
          setNotice('');
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setSession(null);
          setNotice(
            error instanceof Error
              ? `Could not restore your school account: ${error.message}`
              : 'Could not restore your school account.',
          );
          setLoading(false);
        });

      return () => {
        alive = false;
        window.clearInterval(refreshTimer);
      };
    }

    const checkSession = async (currentSession: any) => {
      if (!alive) return;

      if (!currentSession) {
        setSession(null);
        setLoading(false);
        return;
      }

      try {
        const allowed = await hasPortalAccess(
          currentSession.user.id,
          config.key,
        );

        if (!alive) return;

        const schoolsForUser =
          allowed && requestedSchoolSlug && config.key !== 'platform-admin'
            ? await loadPortalSchools(currentSession.user.id, config.key)
            : [];
        const matchesSchool =
          !requestedSchoolSlug ||
          config.key === 'platform-admin' ||
          schoolsForUser.some((school) =>
            schoolMatchesUrl(school, requestedSchoolSlug),
          );

        if (!allowed || !matchesSchool) {
          setSession(null);
          setNotice(
            allowed && requestedSchoolSlug
              ? `This account is not linked to the school in this link (/${requestedSchoolSlug}). Check the school address or contact your administrator.`
              : 'This account is not authorized for this portal. Contact your school administrator.',
          );
          setLoading(false);

          if (supabase) void supabase.auth.signOut();
          return;
        }

        setSession(currentSession);
        setNotice('');
        setLoading(false);
      } catch {
        if (!alive) return;

        setSession(null);
        setNotice(
          'Could not verify portal access. Check your connection and try signing in again.',
        );
        setLoading(false);
      }
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;

      if (error) {
        setNotice(error.message);
        setLoading(false);
        return;
      }

      void checkSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      void checkSession(currentSession);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [config.key, requestedSchoolSlug]);

  // Load active schools for School Administrator applications.
  useEffect(() => {
    if (!supabase || config.key !== 'school-admin') return;

    let alive = true;

    async function loadSchools() {
      const client = supabase;
      if (!client) return;

      setSchoolsLoading(true);
      setSchools([]);
      setSelectedSchoolId('');
      setNotice('');

      try {
        const { data, error } = await client.rpc('list_active_schools');

        if (!alive) return;

        if (error) {
          console.error('Could not load schools:', error);
          setNotice(`Could not load schools: ${error.message}`);
          return;
        }

        const availableSchools = (data ?? []) as SchoolOption[];
        setSchools(availableSchools);

        if (availableSchools.length === 0) {
          setNotice('The school-list function returned no active schools.');
        }
      } catch (error: unknown) {
        if (!alive) return;

        console.error('Unexpected error loading schools:', error);
        setNotice(
          error instanceof Error
            ? `Could not load schools: ${error.message}`
            : 'An unexpected error occurred while loading schools.',
        );
      } finally {
        if (alive) setSchoolsLoading(false);
      }
    }

    void loadSchools();

    return () => {
      alive = false;
    };
  }, [config.key]);

  // Load the signed-in user's profile and private profile photo.
  useEffect(() => {
    if (!session?.user?.id || !supabase) return;

    let alive = true;

    async function loadProfile() {
      const { data, error } = await supabase!
        .from('profiles')
        .select('full_name, phone, avatar_url')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!alive || error || !data) return;

      setProfileName(data.full_name || '');
      setProfilePhone(data.phone || '');

      if (data.avatar_url) {
        const { data: imageData } = await supabase!
          .storage
          .from('profile-photos')
          .createSignedUrl(data.avatar_url, 3600);

        if (alive) {
          setAvatarUrl(imageData?.signedUrl || '');
        }
      } else {
        setAvatarUrl('');
      }
    }

    void loadProfile();

    return () => {
      alive = false;
    };
  }, [session]);

  // Load the schools this account can operate in for this role.
  useEffect(() => {
    if (!session?.user?.id || !supabase || config.key === 'platform-admin') {
      setPortalSchools([]);
      setActiveSchoolId('');
      return;
    }

    let alive = true;

    async function loadSchools() {
      setPortalSchoolsLoading(true);
      try {
        const available = await loadPortalSchools(
          session.user.id,
          config.key,
        );
        if (!alive) return;
        const scopedSchools = requestedSchoolSlug
          ? available.filter(
              (school) => schoolMatchesUrl(school, requestedSchoolSlug),
          )
          : available;
        setPortalSchools(scopedSchools);
        setActiveSchoolId((current) =>
          scopedSchools.some((school) => school.id === current)
            ? current
            : scopedSchools[0]?.id || '',
        );
      } catch (error) {
        if (!alive) return;
        setNotice(
          error instanceof Error
            ? `Could not load your school: ${error.message}`
            : 'Could not load your school.',
        );
      } finally {
        if (alive) setPortalSchoolsLoading(false);
      }
    }

    void loadSchools();

    return () => {
      alive = false;
    };
  }, [session, config.key, requestedSchoolSlug]);

  // Load real, school-scoped dashboard statistics. Each query is isolated so a
  // single unavailable table cannot break the whole overview.
  useEffect(() => {
    if (config.key === 'platform-admin') return;

    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setStats(getStats(config.key));
      return;
    }
    const client = supabase;

    let alive = true;
    const schoolId = activeSchoolId;
    const fmt = (value: number | null | undefined) =>
      value === null || value === undefined ? '—' : value.toLocaleString('en-KE');
    const kes = (value: number) =>
      `KES ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

    const countRows = async (
      table: string,
      apply?: (query: any) => any,
    ): Promise<number | null> => {
      try {
        let query = client
          .from(table)
          .select('*', { count: 'exact', head: true });
        if (apply) query = apply(query);
        const { count, error } = await query;
        return error ? null : count ?? 0;
      } catch {
        return null;
      }
    };

    const sumRows = async (
      table: string,
      column: string,
      apply: (query: any) => any,
    ): Promise<number | null> => {
      try {
        let query = client.from(table).select(column);
        query = apply(query);
        const { data, error } = await query;
        if (error) return null;
        return (data ?? []).reduce(
          (total: number, row: any) =>
            total + Number(row[column] || 0),
          0,
        );
      } catch {
        return null;
      }
    };

    async function loadStats() {
      try {
        let next: PortalStat[] | null = null;
        const role = config.key;

        if (role === 'school-admin' && schoolId) {
          const [students, staff, classes, admissions, teacherRequests] =
            await Promise.all([
              countRows('students', (q) =>
                q.eq('school_id', schoolId).eq('status', 'active'),
              ),
              countRows('school_memberships', (q) =>
                q.eq('school_id', schoolId).eq('status', 'active'),
              ),
              countRows('classes', (q) => q.eq('school_id', schoolId)),
              countRows('admission_applications', (q) =>
                q
                  .eq('school_id', schoolId)
                  .in('status', ['submitted', 'under_review', 'needs_correction']),
              ),
              countRows('teacher_applications', (q) =>
                q.eq('school_id', schoolId).eq('status', 'pending'),
              ),
            ]);
          const pending =
            admissions === null && teacherRequests === null
              ? null
              : (admissions ?? 0) + (teacherRequests ?? 0);
          next = [
            { label: 'Students', value: fmt(students), note: 'Active student records', Icon: GraduationCap },
            { label: 'Staff accounts', value: fmt(staff), note: 'Active school memberships', Icon: Users },
            { label: 'Classes', value: fmt(classes), note: 'School setup', Icon: BookOpen },
            { label: 'Pending tasks', value: fmt(pending), note: 'Admissions and teacher requests', Icon: ClipboardCheck },
          ];
        } else if (role === 'principal' && schoolId) {
          const [enrolment, absences, admissions, leave, published] =
            await Promise.all([
              countRows('students', (q) =>
                q.eq('school_id', schoolId).eq('status', 'active'),
              ),
              countRows('attendance_records', (q) =>
                q.eq('school_id', schoolId).eq('status', 'absent'),
              ),
              countRows('admission_applications', (q) =>
                q
                  .eq('school_id', schoolId)
                  .in('status', ['submitted', 'under_review', 'needs_correction']),
              ),
              countRows('staff_leave_requests', (q) =>
                q.eq('school_id', schoolId).eq('status', 'pending'),
              ),
              countRows('assignments', (q) =>
                q.eq('school_id', schoolId).eq('status', 'published'),
              ),
            ]);
          next = [
            { label: 'Enrolment', value: fmt(enrolment), note: 'Active learners', Icon: GraduationCap },
            { label: 'Absences', value: fmt(absences), note: 'Recorded absences', Icon: CalendarDays },
            {
              label: 'Approvals',
              value: fmt(
                admissions === null && leave === null
                  ? null
                  : (admissions ?? 0) + (leave ?? 0),
              ),
              note: 'Pending admissions and leave',
              Icon: ClipboardCheck,
            },
            { label: 'Published work', value: fmt(published), note: 'Published assignments', Icon: FileText },
          ];
        } else if (role === 'secretary' && schoolId) {
          const [applications, students, teacherRequests, feeCharges] =
            await Promise.all([
              countRows('admission_applications', (q) =>
                q
                  .eq('school_id', schoolId)
                  .in('status', ['submitted', 'under_review', 'needs_correction']),
              ),
              countRows('students', (q) =>
                q.eq('school_id', schoolId).eq('status', 'active'),
              ),
              countRows('teacher_applications', (q) =>
                q.eq('school_id', schoolId).eq('status', 'pending'),
              ),
              countRows('fee_charges', (q) => q.eq('school_id', schoolId)),
            ]);
          next = [
            { label: 'Applications', value: fmt(applications), note: 'Pending admissions', Icon: FileText },
            { label: 'Students', value: fmt(students), note: 'Active records', Icon: GraduationCap },
            { label: 'Teacher requests', value: fmt(teacherRequests), note: 'Pending approval', Icon: Users },
            { label: 'Fee charges', value: fmt(feeCharges), note: 'Recorded charges', Icon: Wallet },
          ];
        } else if (role === 'teacher' && schoolId) {
          const { data: assignmentRows } = await client
            .from('teacher_assignments')
            .select('class_id')
            .eq('school_id', schoolId)
            .eq('teacher_id', userId);
          const classIds = [
            ...new Set((assignmentRows ?? []).map((row: any) => row.class_id)),
          ];
          const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
          const [attendance, assignments, published] = await Promise.all([
            countRows('attendance_sessions', (q) =>
              q
                .eq('school_id', schoolId)
                .eq('recorded_by', userId)
                .gte('session_date', since),
            ),
            countRows('assignments', (q) =>
              q.eq('school_id', schoolId).eq('teacher_id', userId),
            ),
            countRows('assignments', (q) =>
              q
                .eq('school_id', schoolId)
                .eq('teacher_id', userId)
                .eq('status', 'published'),
            ),
          ]);
          const { data: myAssignments } = await client
            .from('assignments')
            .select('id')
            .eq('school_id', schoolId)
            .eq('teacher_id', userId);
          const assignmentIds = (myAssignments ?? []).map(
            (row: any) => row.id,
          );
          const graded = assignmentIds.length
            ? await countRows('assignment_submissions', (q) =>
                q
                  .eq('school_id', schoolId)
                  .in('assignment_id', assignmentIds)
                  .not('score', 'is', null),
              )
            : 0;
          next = [
            { label: 'My classes', value: fmt(classIds.length), note: 'Assigned classes', Icon: BookOpen },
            { label: 'Attendance', value: fmt(attendance), note: 'Sessions recorded in 7 days', Icon: CalendarDays },
            { label: 'Assignments', value: fmt(assignments), note: `${fmt(published)} published`, Icon: ClipboardCheck },
            { label: 'Graded work', value: fmt(graded), note: 'Scored submissions', Icon: FileText },
          ];
        } else if (role === 'student' && schoolId) {
          const { data: studentRow } = await client
            .from('students')
            .select('id,class_id')
            .eq('school_id', schoolId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
          const studentId = studentRow?.id as string | undefined;
          const classId = studentRow?.class_id as string | undefined;

          const [assignments, results, attendance] = await Promise.all([
            classId
              ? countRows('assignments', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .eq('class_id', classId)
                    .eq('status', 'published'),
                )
              : Promise.resolve(0),
            studentId
              ? countRows('assignment_submissions', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .eq('student_id', studentId)
                    .not('score', 'is', null),
                )
              : Promise.resolve(0),
            studentId
              ? countRows('attendance_records', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .eq('student_id', studentId),
                )
              : Promise.resolve(0),
          ]);

          let balance: number | null = null;
          if (studentId) {
            const { data: charges } = await client
              .from('fee_charges')
              .select('id,amount_kes')
              .eq('school_id', schoolId)
              .eq('student_id', studentId);
            const chargeRows = charges ?? [];
            const chargeIds = chargeRows.map((row: any) => row.id);
            const paid = chargeIds.length
              ? await sumRows('payment_allocations', 'amount_kes', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .in('fee_charge_id', chargeIds),
                )
              : 0;
            const billed = chargeRows.reduce(
              (total: number, row: any) =>
                total + Number(row.amount_kes || 0),
              0,
            );
            balance = paid === null ? null : billed - paid;
          }

          next = [
            { label: 'Assignments', value: fmt(assignments), note: 'Published to your class', Icon: ClipboardCheck },
            { label: 'Results', value: fmt(results), note: 'Graded submissions', Icon: FileText },
            { label: 'Attendance', value: fmt(attendance), note: 'Recorded attendance entries', Icon: CalendarDays },
            { label: 'Fee balance', value: balance === null ? 'KES —' : kes(balance), note: 'Your own statement', Icon: Wallet },
          ];
        } else if (role === 'parent' && schoolId) {
          const { data: guardians } = await client
            .from('guardians')
            .select('id')
            .eq('school_id', schoolId)
            .eq('user_id', userId);
          const guardianIds = (guardians ?? []).map((row: any) => row.id);
          const { data: links } = guardianIds.length
            ? await client
                .from('student_guardians')
                .select('student_id')
                .eq('school_id', schoolId)
                .in('guardian_id', guardianIds)
            : { data: [] as any[] };
          const linkedIds = [
            ...new Set((links ?? []).map((row: any) => row.student_id)),
          ];

          const [children, applications, absences] = await Promise.all([
            linkedIds.length
              ? countRows('students', (q) =>
                  q.in('id', linkedIds).eq('status', 'active'),
                )
              : Promise.resolve(0),
            countRows('admission_applications', (q) =>
              q
                .eq('school_id', schoolId)
                .eq('guardian_user_id', userId),
            ),
            linkedIds.length
              ? countRows('attendance_records', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .in('student_id', linkedIds)
                    .eq('status', 'absent'),
                )
              : Promise.resolve(0),
          ]);

          let balance: number | null = null;
          if (linkedIds.length) {
            const { data: charges } = await client
              .from('fee_charges')
              .select('id,amount_kes')
              .eq('school_id', schoolId)
              .in('student_id', linkedIds);
            const chargeRows = charges ?? [];
            const chargeIds = chargeRows.map((row: any) => row.id);
            const paid = chargeIds.length
              ? await sumRows('payment_allocations', 'amount_kes', (q) =>
                  q
                    .eq('school_id', schoolId)
                    .in('fee_charge_id', chargeIds),
                )
              : 0;
            const billed = chargeRows.reduce(
              (total: number, row: any) =>
                total + Number(row.amount_kes || 0),
              0,
            );
            balance = paid === null ? null : billed - paid;
          }

          next = [
            { label: 'Linked children', value: fmt(children), note: 'Verified links only', Icon: Users },
            { label: 'Applications', value: fmt(applications), note: 'Your admission applications', Icon: FileText },
            { label: 'Absences', value: fmt(absences), note: 'Recorded child absences', Icon: CalendarDays },
            { label: 'Fee balance', value: balance === null ? 'KES —' : kes(balance), note: 'Linked children only', Icon: Wallet },
          ];
        }

        if (alive && next) setStats(next);
      } catch {
        // Keep the neutral placeholders if a statistic cannot be loaded.
      }
    }

    void loadStats();

    return () => {
      alive = false;
    };
  }, [session, config.key, activeSchoolId]);

  const activeSchool =
    portalSchools.find((school) => school.id === activeSchoolId) || null;

  const displayName =
    profileName ||
    session?.user?.user_metadata?.full_name ||
    (config.key === 'parent' ? 'Parent / Guardian' : config.title);

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join('') || 'U';

  const nav = useMemo(
    () => [
      'Overview',
      ...config.modules.map((item) =>
        item.replace(/^./, (character) => character.toUpperCase()),
      ),
      'My profile',
    ],
    [config],
  );

  // Sign in and check authorization for this specific portal.
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice('');

    if (!supabase) {
      setNotice(
        'Supabase is not connected. Check the .env file and restart the portal.',
      );
      return;
    }

    setLoading(true);

    try {
      if (['student', 'parent', 'teacher', 'principal'].includes(config.key)) {
        if (!requestedSchoolSlug) {
          setNotice('Open the school-specific portal link before signing in.');
          setLoading(false);
          return;
        }

        const identity = await loginSchoolPortal({
          schoolSlug: requestedSchoolSlug,
          role: config.key as SchoolPortalRole,
          username: email.trim(),
          password,
        });
        const allowed = await hasPortalAccess(
          identity.id,
          config.key,
          identity.schoolId,
        );
        const schoolMatches = schoolMatchesUrl(
          {
            id: identity.schoolId,
            name: identity.schoolName,
            slug: identity.schoolSlug,
            status: 'active',
            logo_path: null,
            motto: null,
          },
          requestedSchoolSlug,
        );
        if (!allowed || !schoolMatches) {
          await logoutSchoolPortal();
          setNotice(!schoolMatches
            ? `This account belongs to ${identity.schoolName}, not the school in this link.`
            : config.key === 'student'
              ? 'Your login was approved, but no active student record is linked to this account at this school. Ask the school administrator to verify the student record.'
              : 'This account has no active school record for this portal. Ask the school administrator to verify its approved role and school link.');
          setLoading(false);
          return;
        }

        setSession({
          user: {
            id: identity.id,
            email: identity.username,
            user_metadata: { full_name: identity.fullName },
          },
          portalIdentity: identity,
        });
        setProfileSetupDone(false);
        setNotice(identity.welcomeNotification || '');
        setLoading(false);
        return;
      }

      let signInEmail = email.trim();

      // Students may sign in with their admission number. The lookup function
      // only returns the account email linked to that verified admission
      // number and never exposes any other student data.
      if (config.key === 'student' && !signInEmail.includes('@')) {
        const lookupFunction = requestedSchoolSlug
          ? 'resolve_student_login_for_school'
          : 'resolve_student_login';
        const lookupArguments = requestedSchoolSlug
          ? {
              p_admission_number: signInEmail,
              p_school_slug: requestedSchoolSlug,
            }
          : { p_admission_number: signInEmail };
        const { data: resolved, error: resolveError } = await supabase.rpc(
          lookupFunction,
          lookupArguments,
        );

        if (resolveError) {
          setNotice(
            'Admission-number sign-in is not available yet. Sign in with your school email address instead, or apply the latest database migration.',
          );
          setLoading(false);
          return;
        }

        if (!resolved) {
          setNotice(
            'No active student account matches that admission number. Check the number or contact your school.',
          );
          setLoading(false);
          return;
        }

        signInEmail = String(resolved);
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password,
      });

      if (error) {
        setNotice(error.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        setNotice('Sign-in did not create a session. Please try again.');
        setLoading(false);
        return;
      }

      const allowed = await hasPortalAccess(
        data.session.user.id,
        config.key,
      );

      const schoolsForUser =
        allowed && requestedSchoolSlug && config.key !== 'platform-admin'
          ? await loadPortalSchools(data.session.user.id, config.key)
          : [];
      const matchesSchool =
        !requestedSchoolSlug ||
        config.key === 'platform-admin' ||
        schoolsForUser.some((school) =>
          schoolMatchesUrl(school, requestedSchoolSlug),
        );

      if (!allowed || !matchesSchool) {
        setSession(null);
        setProfileSetupDone(false);
        setNotice(
          allowed && requestedSchoolSlug
            ? `This account is not linked to the school in this link (/${requestedSchoolSlug}). Check the school address or contact your administrator.`
            : 'This account is not authorized for this portal. Contact your platform or school administrator.',
        );
        setLoading(false);
        await supabase.auth.signOut();
        return;
      }

      setSession(data.session);
      setNotice('');
      setLoading(false);
    } catch (error: any) {
      setNotice(
        error?.message || 'Sign-in failed. Check your connection and try again.',
      );
      setLoading(false);
    }
  }

  // Submit a signup request. School Admin applications include a school ID.
  // The database must create the pending request; this function never grants roles.
  async function signup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice('');

    if (config.key === 'platform-admin') {
      setNotice(
        'Platform Administrator accounts cannot be created through public signup.',
      );
      return;
    }

    if (!supabase) {
      setNotice(
        'Connect Supabase before creating an account. Account creation is disabled in offline preview.',
      );
      return;
    }

    const schoolAccountRoles: RoleKey[] = [
      'student',
      'teacher',
      'parent',
      'principal',
    ];

    if (
      schoolAccountRoles.includes(config.key) &&
      !requestedSchoolSlug
    ) {
      setNotice(
        'Open your school-specific portal link before requesting an account (for example, /kirinyaga-university).',
      );
      return;
    }

    if (
      config.key !== 'school-admin' &&
      !schoolAccountRoles.includes(config.key)
    ) {
      setNotice('Account requests are not available for this portal.');
      return;
    }

    if (
      config.key === 'parent' &&
      (!signupPhone.trim() || !relatedAdmissionNumber.trim())
    ) {
      setNotice(
        'Parents must provide a phone number and the linked student’s admission number.',
      );
      return;
    }

    if (
      config.key === 'school-admin' &&
      !schools.some((school) => school.id === selectedSchoolId)
    ) {
      setNotice('Please select a valid school from the list.');
      return;
    }

    setSignupLoading(true);

    try {
      if (['student', 'parent', 'teacher', 'principal'].includes(config.key)) {
        await requestSchoolPortalAccount({
          schoolSlug: requestedSchoolSlug,
          role: config.key as SchoolPortalRole,
          username: signupUsername.trim(),
          password,
          fullName: name.trim(),
          phone: signupPhone.trim() || undefined,
          dateOfBirth: signupDateOfBirth || undefined,
          relatedAdmissionNumber:
            relatedAdmissionNumber.trim() || undefined,
          relationship: parentRelationship.trim() || undefined,
        });
        setNotice(
          `Your request was sent to ${requestedSchoolSlug}. After approval, sign in with the username and password you chose. Your approval notification will include your new school ID for future sign-ins.`,
        );
        return;
      }

      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            requested_portal: config.key,
            ...(schoolAccountRoles.includes(config.key)
              ? {
                  requested_school_slug: requestedSchoolSlug,
                  phone: signupPhone.trim() || null,
                  ...(config.key === 'student'
                    ? { date_of_birth: signupDateOfBirth || null }
                    : {}),
                  ...(config.key === 'parent'
                    ? {
                        related_admission_number:
                          relatedAdmissionNumber.trim(),
                        relationship: parentRelationship.trim(),
                      }
                    : {}),
                }
              : {}),
            ...(config.key === 'school-admin'
              ? {
                  requested_school_id: selectedSchoolId,
                  application_reason: applicationReason.trim(),
                }
              : {}),
          },
        },
      });

      if (error) {
        setNotice(error.message);
        return;
      }

      if (config.key === 'school-admin') {
        setNotice(
          'Your School Administrator application has been submitted. Complete email verification if requested. Portal access remains restricted until the Platform Administrator approves your application.',
        );
      } else if (schoolAccountRoles.includes(config.key)) {
        setNotice(
          `Your ${config.title.toLowerCase()} account request was sent to ${requestedSchoolSlug}. The school administrator or principal must approve it before you can sign in. The school will issue your school ID after approval.`,
        );
      } else {
        setNotice(
          'Signup submitted. Follow any email verification instructions. Access still requires the correct role and any required approval.',
        );
      }
    } catch (error: any) {
      setNotice(
        error?.message || 'Could not submit the account request.',
      );
    } finally {
      setSignupLoading(false);
    }
  }

  async function signout() {
    if (['student', 'parent', 'teacher', 'principal'].includes(config.key)) {
      await logoutSchoolPortal();
    } else if (supabase) {
      await supabase.auth.signOut();
    }

    setSession(null);
    setPage('Overview');
    setNotice('');
    setPreview('');
    setAvatarUrl('');
    setProfileName('');
    setProfilePhone('');
    setPortalSchools([]);
    setActiveSchoolId('');
  }

  async function uploadPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setNotice('Choose a JPG, PNG or WebP image.');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setNotice('Choose an image smaller than 3 MB.');
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);

    if (!supabase || !session?.user?.id) {
      setNotice(
        'Photo preview only. Sign in and connect Supabase to save this photo to your account.',
      );
      return;
    }

    setUploading(true);
    setNotice('');

    try {
      const extension =
        file.type === 'image/jpeg'
          ? 'jpg'
          : file.type === 'image/png'
            ? 'png'
            : 'webp';

      const path = `${session.user.id}/profile.${extension}`;

      const { error: uploadError } = await supabase
        .storage
        .from('profile-photos')
        .upload(path, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: path })
        .eq('id', session.user.id);

      if (profileError) throw profileError;

      const { data, error: signedUrlError } = await supabase
        .storage
        .from('profile-photos')
        .createSignedUrl(path, 3600);

      if (signedUrlError) throw signedUrlError;

      setAvatarUrl(data.signedUrl || localPreview);
      setNotice('Profile photo saved.');
    } catch (error: any) {
      setNotice(
        error?.message ||
          'Could not save profile photo. Check storage settings and permissions.',
      );
    } finally {
      setUploading(false);
    }
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!supabase || !session?.user?.id) {
      setNotice(
        'Profile changes are preview-only until you connect and sign in to Supabase.',
      );
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: profileName,
        phone: profilePhone,
      })
      .eq('id', session.user.id);

    setNotice(error ? error.message : 'Profile details saved.');
  }

  const visibleModules = config.modules;
  const pageLabel = (module: string) =>
    module.replace(/^./, (character) => character.toUpperCase());
  const supportPage = config.modules.find((module) => module === 'support');
  const notificationPage =
    config.modules.find((module) => module === 'notifications') ??
    config.modules.find((module) => module === 'school announcements') ??
    config.modules.find((module) => module === 'announcements');

  if (loading) {
    return (
      <div className="loading">
        <span className="spinner" />
        Preparing {config.title}…
      </div>
    );
  }

  if (!session) {
    return (
      <div
        className={`login-page ${config.key === 'student' ? 'student-login' : ''}`}
      >
        <div className="login-side">
          <div className="brand-mark">
            <GraduationCap size={24} />
          </div>

          <p className="eyebrow">SCHHOL SYSTEM</p>

          <h1>
            {config.title}
            <br />
            <span>Portal</span>
          </h1>

          <p className="login-lede">{config.intro}</p>

          <div className="privacy-note">
            <ShieldCheck size={18} />
            <span>
              This is a dedicated portal. Other roles’ portals are not linked
              from this page.
            </span>
          </div>

          {config.key === 'student' && (
            <div className="student-login-highlights">
              <div>
                <BookOpen size={17} />
                <span>Learn at your pace</span>
              </div>
              <div>
                <ClipboardCheck size={17} />
                <span>Keep track of your work</span>
              </div>
              <div>
                <CalendarDays size={17} />
                <span>Stay ready for class</span>
              </div>
            </div>
          )}

          <div className="login-foot">
            Secure school operations Â· Kenya
          </div>
        </div>

        <div className="login-main">
          <div className="login-theme">
            <ThemeToggle compact />
          </div>
          <div className="login-card">
            <div className="mobile-brand">
              <div className="brand-mark">
                <GraduationCap size={22} />
              </div>
              <b>Schhol System</b>
            </div>

            <p className="eyebrow">WELCOME BACK</p>
            <h2>Sign in to your portal</h2>

            <p className="muted">
              Use the account issued or approved for this portal.
            </p>

            {['student', 'parent', 'teacher', 'principal'].includes(config.key) && (
              <p className="muted small">
                Use your chosen username for your first successful sign-in.
                After that, sign in with your issued school ID.
              </p>
            )}

            {requestedSchoolSlug && config.key !== 'platform-admin' && (
              <p className="muted small">
                School link: /{requestedSchoolSlug}. Sign-in is limited to
                accounts linked to this school.
              </p>
            )}

            <form onSubmit={login} className="form-stack">
              <label>
                {['student', 'parent', 'teacher', 'principal'].includes(
                  config.key,
                )
                  ? 'Username or school ID'
                  : 'Email address'}
                <input
                  type={
                    ['student', 'parent', 'teacher', 'principal'].includes(
                      config.key,
                    ) || config.key === 'student'
                      ? 'text'
                      : 'email'
                  }
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  placeholder={
                    ['student', 'parent', 'teacher', 'principal'].includes(
                      config.key,
                    )
                      ? 'First sign-in: username · Later sign-ins: full issued school ID'
                      : 'you@example.com'
                  }
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                />
              </label>

              <button className="primary-btn" type="submit" disabled={loading}>
                Sign in <ArrowRight size={17} />
              </button>
            </form>

            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}

            <details className="signup-details">
              <summary>
                {config.key === 'school-admin'
                  ? 'Request an account'
                  : 'Request a school account'}
              </summary>

              <p className="muted small">
                {['student', 'teacher', 'parent', 'principal'].includes(
                  config.key,
                )
                  ? requestedSchoolSlug
                    ? `Request access to ${requestedSchoolSlug}. The school administrator or principal reviews each request.`
                    : 'Use your school-specific link to request an account. A school name is never selected from a public list.'
                  : 'Account creation and role approval depend on your school’s configured policy.'}
              </p>

              <form
                onSubmit={signup}
                className="form-stack"
              >
                <label>
                  Full name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </label>

                {['student', 'teacher', 'parent', 'principal'].includes(
                  config.key,
                ) && (
                  <label>
                    Phone number
                    <input
                      type="tel"
                      value={signupPhone}
                      onChange={(event) =>
                        setSignupPhone(event.target.value)
                      }
                      autoComplete="tel"
                      required={config.key === 'parent'}
                      placeholder="e.g. 07xx xxx xxx"
                    />
                  </label>
                )}

                {config.key === 'student' && (
                  <label>
                    Date of birth (optional)
                    <input
                      type="date"
                      value={signupDateOfBirth}
                      onChange={(event) =>
                        setSignupDateOfBirth(event.target.value)
                      }
                    />
                  </label>
                )}

                {config.key === 'parent' && (
                  <>
                    <label>
                      Student admission number
                      <input
                        value={relatedAdmissionNumber}
                        onChange={(event) =>
                          setRelatedAdmissionNumber(event.target.value)
                        }
                        required
                        placeholder="Enter your child's school admission number"
                      />
                    </label>
                    <label>
                      Relationship to student
                      <input
                        value={parentRelationship}
                        onChange={(event) =>
                          setParentRelationship(event.target.value)
                        }
                        required
                      />
                    </label>
                  </>
                )}

                {config.key === 'school-admin' && (
                  <>
                    <label>
                      School you want to administer
                      <select
                        value={selectedSchoolId}
                        onChange={(e) => setSelectedSchoolId(e.target.value)}
                        required
                      >
                        <option value="">Select a school</option>
                        {schools.map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Reason for your application (optional)
                      <textarea
                        value={applicationReason}
                        onChange={(e) => setApplicationReason(e.target.value)}
                        rows={3}
                        placeholder="Explain your connection to this school."
                      />
                    </label>

                    {schools.length === 0 && (
                      <p className="muted small">
                        No schools are available to select. The school list
                        may still be loading, or database permissions may
                        need to be configured.
                      </p>
                    )}
                  </>
                )}

                {['student', 'parent', 'teacher', 'principal'].includes(
                  config.key,
                ) ? (
                  <label>
                    Choose a username
                    <input
                      value={signupUsername}
                      onChange={(event) =>
                        setSignupUsername(event.target.value)
                      }
                      autoComplete="username"
                      minLength={3}
                      maxLength={80}
                      required
                      placeholder="Create a username for your first sign-in"
                    />
                  </label>
                ) : (
                  <label>
                    Email address
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </label>
                )}

                <label>
                  Create password
                  <input
                    type="password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>

                <button
                  className="secondary-btn"
                  type="submit"
                  disabled={
                    signupLoading ||
                    (config.key === 'school-admin' && schools.length === 0) ||
                    (['student', 'teacher', 'parent', 'principal'].includes(
                      config.key,
                    ) &&
                      !requestedSchoolSlug) ||
                    ![
                      'school-admin',
                      'student',
                      'teacher',
                      'parent',
                      'principal',
                    ].includes(config.key)
                  }
                >
                  {signupLoading
                    ? 'Submitting…'
                    : 'Submit account request'}
                </button>
              </form>
            </details>

            <p className="muted tiny">
              {['student', 'parent', 'teacher', 'principal'].includes(config.key)
                ? 'School sign-in requires the local auth API and server credentials. Start it with npm run dev:portal-auth.'
                : supabaseReady
                  ? 'Secure sign-in service configured.'
                  : 'Setup preview Â· Connect Supabase to enable real sign-in.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const portalIdentity = session.portalIdentity as PortalIdentity | undefined;
  if (
    portalIdentity &&
    ['student', 'parent', 'teacher', 'principal'].includes(config.key) &&
    !profileSetupDone
  ) {
    return (
      <PortalProfileCompletion
        identity={portalIdentity}
        onComplete={completeProfileSetup}
      />
    );
  }

  // Render the Platform Admin dashboard only after the shared session
  // restoration/sign-in flow has verified platform-admin access.
  if (config.key === 'platform-admin') {
    return <PlatformAdminControlCentre />;
  }

  return (
    <div className={`app-frame ${config.key === 'student' ? 'student-portal' : ''}`}>
      <aside className={`sidebar ${mobileNav ? 'show' : ''}`}>
        <div className="side-brand">
          <div className="brand-mark">
            <GraduationCap size={22} />
          </div>

          <div>
            <b>Schhol System</b>
            <span>{config.title} Portal</span>
          </div>

          <button
            className="icon-btn close-nav"
            onClick={() => setMobileNav(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="portal-chip">
          <span className="live-dot" />
          {config.title}
          <small>Dedicated portal</small>
        </div>

        {portalSchoolsLoading && (
          <div className="school-switcher loading">
            <LoaderCircle className="spin" size={15} />
            <span>Loading school...</span>
          </div>
        )}

        {portalSchools.length > 1 && (
          <label className="school-switcher">
            <span>Active school</span>
            <select
              value={activeSchoolId}
              onChange={(event) => {
                setActiveSchoolId(event.target.value);
                setPage('Overview');
              }}
            >
              {portalSchools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {activeSchool?.status && activeSchool.status !== 'active' && (
          <div className="school-suspended" role="alert">
            <ShieldCheck size={16} />
            <span>
              {activeSchool.name} is currently {activeSchool.status}. Records
              are read-only until the platform reactivates the school.
            </span>
          </div>
        )}

        <div className="nav-caption">WORKSPACE</div>

        <nav>
          {nav.map((item, i) => {
            const Icon =
              item === 'My profile'
                ? UserRound
                : icons[i % icons.length];

            return (
              <button
                key={item}
                className={`nav-item ${page === item ? 'active' : ''}`}
                onClick={() => {
                  setPage(item);
                  setMobileNav(false);
                }}
              >
                <Icon size={18} />
                <span>{item}</span>
                {item === 'Overview' && (
                  <span className="nav-active-dot" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="secure-card">
            <ShieldCheck size={18} />
            <div>
              <b>Role-restricted access</b>
              <span>Only authorized records should appear here.</span>
            </div>
          </div>

          <div className="sidebar-theme">
            <div className="nav-caption">APPEARANCE</div>
            <ThemeToggle />
          </div>

          <button className="nav-item signout" onClick={signout}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon-btn mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>

            <div>
              <div className="breadcrumb">
                {config.title} <span>/</span> {page}
              </div>
              <h1>{page === 'Overview' ? config.overview : page}</h1>
            </div>
          </div>

          <div className="top-actions">
            <button
              className="icon-btn"
              aria-label="Help"
              title={supportPage ? 'Open support' : 'Support is not enabled for this portal'}
              onClick={() => {
                if (supportPage) setPage(pageLabel(supportPage));
              }}
              disabled={!supportPage}
            >
              <CircleHelp size={19} />
            </button>

            <button
              className="icon-btn notification-btn"
              aria-label="Notifications"
              title={
                notificationPage
                  ? 'Open notifications'
                  : 'Notifications are not enabled for this portal'
              }
              onClick={() => {
                if (notificationPage) setPage(pageLabel(notificationPage));
              }}
              disabled={!notificationPage}
            >
              <Bell size={19} />
            </button>

            <button
              className="account-button"
              onClick={() => setPage('My profile')}
            >
              <Avatar
                url={preview || avatarUrl}
                initials={initials}
              />
              <span>
                <b>{displayName}</b>
                <small>{config.title}</small>
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <div className="page-body">
          {page === 'My profile' ? (
            <section className="profile-layout">
              <div className="page-heading">
                <p className="eyebrow">ACCOUNT SETTINGS</p>
                <h2>My profile</h2>
                <p className="muted">
                  Manage your personal details and profile photo.
                </p>
              </div>

              <div className="profile-card">
                <div className="profile-cover">
                  <div className="cover-orb orb-one" />
                  <div className="cover-orb orb-two" />
                </div>

                <div className="profile-inner">
                  <div className="profile-photo-wrap">
                    <Avatar
                      url={preview || avatarUrl}
                      initials={initials}
                      large
                    />

                    <label
                      className="photo-upload"
                      title="Upload profile photo"
                    >
                      <Camera size={16} />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={uploadPhoto}
                        aria-label="Upload profile photo"
                      />
                    </label>
                  </div>

                  <div className="profile-heading">
                    <h3>{displayName}</h3>
                    <p>{session.user.email}</p>
                    <span className="role-pill">{config.title}</span>
                  </div>

                  <form
                    className="profile-form"
                    onSubmit={saveProfile}
                  >
                    <label>
                      Full name
                      <input
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Your full name"
                      />
                    </label>

                    <label>
                      Email address
                      <input
                        value={session.user.email || ''}
                        disabled
                      />
                    </label>

                    <label>
                      Phone number
                      <input
                        value={profilePhone}
                        onChange={(e) => setProfilePhone(e.target.value)}
                        placeholder="e.g. 07xx xxx xxx"
                      />
                    </label>

                    <div className="photo-help">
                      <Camera size={16} />
                      <span>
                        Profile photo Â· JPG, PNG or WebP Â· Maximum 3 MB
                      </span>
                      {uploading && (
                        <LoaderCircle className="spin" size={16} />
                      )}
                    </div>

                    <button
                      className="primary-btn save-btn"
                      type="submit"
                    >
                      Save profile
                    </button>
                  </form>

                  {notice && (
                    <div className="notice" role="status">
                      {notice}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : page !== 'Overview' ? (
            <>
              {notice && (
                <div className="notice" role="status">
                  {notice}
                </div>
              )}
              <PortalWorkspace
                role={config.key}
                page={page}
                school={activeSchool}
                schools={portalSchools}
                onSchoolChange={setActiveSchoolId}
                onNavigate={setPage}
              />
            </>
          ) : (
            <>
              <section className="welcome-row">
                <div>
                  {config.key === 'student' ? (
                    <>
                      <p className="eyebrow">YOUR LEARNING SPACE</p>
                      <h2>
                        Welcome back, {displayName.split(' ')[0]}!
                      </h2>
                      <p className="muted">
                        Your next great idea starts here. Pick up where you left
                        off and keep moving forward.
                      </p>
                      {activeSchool && (
                        <div className="student-school-label">
                          <GraduationCap size={16} />
                          <span>{activeSchool.name}</span>
                        </div>
                      )}
                      <div className="student-hero-actions">
                        <button
                          className="student-hero-primary"
                          type="button"
                          onClick={() => setPage('My assignments')}
                        >
                          <BookOpen size={16} />
                          My assignments
                          <ArrowRight size={15} />
                        </button>
                        <button
                          className="student-hero-secondary"
                          type="button"
                          onClick={() => setPage('Timetable')}
                        >
                          <CalendarDays size={16} />
                          View timetable
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="eyebrow">YOUR WORKSPACE</p>
                      <h2>
                        {config.key === 'parent'
                          ? 'Your family, in one place'
                          : `Welcome to your ${config.title.toLowerCase()} portal`}
                      </h2>
                      <p className="muted">{config.intro}</p>
                    </>
                  )}
                </div>

                <div className="welcome-avatar">
                  <Avatar
                    url={avatarUrl}
                    initials={initials}
                    large
                  />
                </div>
              </section>

              <section className="stats-grid">
                {(stats.length ? stats : getStats(config.key)).map((stat, i) => (
                  <div className="stat-card" key={stat.label}>
                    <div className={`stat-icon tone-${i}`}>
                      <stat.Icon size={20} />
                    </div>
                    <div className="stat-label">{stat.label}</div>
                    <div className="stat-value">{stat.value}</div>
                    <div className="stat-note">{stat.note}</div>
                  </div>
                ))}
              </section>

              <section className="section-head">
                <div>
                  <h3>Quick access</h3>
                  <p className="muted">Tools available in your portal</p>
                </div>
                <span className="section-count">
                  {visibleModules.length} areas
                </span>
              </section>

              <section className="module-grid">
                {visibleModules.map((module, i) => {
                  const Icon = icons[(i + 1) % icons.length];
                  const title = module.replace(/^./, (c) =>
                    c.toUpperCase(),
                  );

                  return (
                    <button
                      className="module-card"
                      key={module}
                      onClick={() => setPage(title)}
                    >
                      <div className={`module-icon tone-${i % 4}`}>
                        <Icon size={20} />
                      </div>

                      <div className="module-copy">
                        <h4>{title}</h4>
                        <p>
                          {moduleCopy[module] ||
                            'Open this area to manage authorized information for your account.'}
                        </p>
                      </div>

                      <ArrowRight
                        className="module-arrow"
                        size={17}
                      />
                    </button>
                  );
                })}
              </section>

              <section className="notice-panel">
                <div className="notice-symbol">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <b>Privacy and access</b>
                  <p>
                    Your portal is a separate website experience. Data access
                    must also be enforced by the backend; hiding a menu alone
                    is not security.
                  </p>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="app-footer">
          <span>Â© 2026 Schhol System</span>
          <span>
            <i className="live-dot" />
            {supabaseReady
              ? 'Connected configuration'
              : 'Setup preview'}
          </span>
          <span>{config.title} Portal</span>
        </footer>
      </main>
    </div>
  );
}

function Avatar({
  url,
  initials,
  large = false,
}: {
  url?: string;
  initials: string;
  large?: boolean;
}) {
  return (
    <span className={`avatar ${large ? 'avatar-large' : ''}`}>
      {url ? (
        <img src={url} alt="Profile" />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

function getStats(role: RoleKey) {
  const base: Record<
    RoleKey,
    {
      label: string;
      value: string;
      note: string;
      Icon: any;
    }[]
  > = {
    'platform-admin': [
      {
        label: 'Schools',
        value: '—',
        note: 'Connect platform data',
        Icon: GraduationCap,
      },
      {
        label: 'Active subscriptions',
        value: '—',
        note: 'Awaiting live records',
        Icon: CheckCircle2,
      },
      {
        label: 'Maintenance revenue',
        value: 'KES —',
        note: 'Separate from school fees',
        Icon: Wallet,
      },
      {
        label: 'Review queue',
        value: '—',
        note: 'Needs backend connection',
        Icon: Activity,
      },
    ],
    'school-admin': [
      {
        label: 'Students',
        value: '—',
        note: 'School-scoped records',
        Icon: GraduationCap,
      },
      {
        label: 'Staff accounts',
        value: '—',
        note: 'Authorized users only',
        Icon: Users,
      },
      {
        label: 'Classes',
        value: '—',
        note: 'School setup',
        Icon: BookOpen,
      },
      {
        label: 'Pending tasks',
        value: '—',
        note: 'Connect live data',
        Icon: ClipboardCheck,
      },
    ],
    principal: [
      {
        label: 'Enrolment',
        value: '—',
        note: 'School overview',
        Icon: GraduationCap,
      },
      {
        label: 'Attendance',
        value: '—',
        note: 'Current term',
        Icon: CalendarDays,
      },
      {
        label: 'Approvals',
        value: '—',
        note: 'Pending review',
        Icon: ClipboardCheck,
      },
      {
        label: 'Reports',
        value: '—',
        note: 'Academic summaries',
        Icon: FileText,
      },
    ],
    secretary: [
      {
        label: 'Applications',
        value: '—',
        note: 'Admissions queue',
        Icon: FileText,
      },
      {
        label: 'Students',
        value: '—',
        note: 'Verified records',
        Icon: GraduationCap,
      },
      {
        label: 'Teacher requests',
        value: '—',
        note: 'Pending approval',
        Icon: Users,
      },
      {
        label: 'Fee tasks',
        value: '—',
        note: 'Assigned permissions',
        Icon: Wallet,
      },
    ],
    teacher: [
      {
        label: 'My classes',
        value: '—',
        note: 'Assigned classes only',
        Icon: BookOpen,
      },
      {
        label: 'Attendance',
        value: '—',
        note: 'This week',
        Icon: CalendarDays,
      },
      {
        label: 'Assignments',
        value: '—',
        note: 'Drafts and published',
        Icon: ClipboardCheck,
      },
      {
        label: 'Results',
        value: '—',
        note: 'Assigned subjects',
        Icon: FileText,
      },
    ],
    student: [
      {
        label: 'Assignments',
        value: '—',
        note: 'Published to you',
        Icon: ClipboardCheck,
      },
      {
        label: 'Results',
        value: '—',
        note: 'Approved results',
        Icon: FileText,
      },
      {
        label: 'Attendance',
        value: '—',
        note: 'Your record',
        Icon: CalendarDays,
      },
      {
        label: 'Fee balance',
        value: 'KES —',
        note: 'Your own statement',
        Icon: Wallet,
      },
    ],
    parent: [
      {
        label: 'Linked children',
        value: '—',
        note: 'Verified links only',
        Icon: Users,
      },
      {
        label: 'Applications',
        value: '—',
        note: 'Family applications',
        Icon: FileText,
      },
      {
        label: 'Attendance',
        value: '—',
        note: 'Child updates',
        Icon: CalendarDays,
      },
      {
        label: 'Fee statements',
        value: '—',
        note: 'Linked children only',
        Icon: Wallet,
      },
    ],
  };

  return base[role];
}

// Keep authentication and authorization in the existing portal flow.
export function PortalApp({ config }: { config: PortalConfig }) {
  return <GenericPortalApp config={config} />;
}

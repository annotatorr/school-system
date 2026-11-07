import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, BookOpen, Pencil, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { supabase } from './supabase';
import type { RoleKey } from './portal-types';

type ModuleRow = {
  id: string;
  title: string;
  detail: string;
  documents?: {
    documentType: string;
    filename: string;
    storagePath: string;
  }[];
  status?: string;
  date?: string;
  kind?: 'admission' | 'teacher-application' | 'account-request' | 'assignment';
};

type SchoolClass = {
  id: string;
  name: string;
  level: string | null;
  stream: string | null;
};

type SchoolSubject = {
  id: string;
  name: string;
  code: string | null;
};

type SchoolDetails = {
  name: string;
  motto: string;
  school_type: string;
  county: string;
  phone: string;
  email: string;
  address: string;
  logo_path: string | null;
};

type AttendanceStudent = {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  admission_number: string;
};

const emptySchool: SchoolDetails = {
  name: '',
  motto: '',
  school_type: '',
  county: '',
  phone: '',
  email: '',
  address: '',
  logo_path: null,
};

const messageOf = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts = [record.message, record.details, record.hint].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );
    if (parts.length) return parts.join(' · ');
  }
  return String(error);
};

const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

function displayStatus(value?: string) {
  return value?.replace(/_/g, ' ') || '';
}

export function PortalModulePage({
  role,
  page,
  schoolId,
  userId,
  userName,
  selectedStudentId,
}: {
  role: RoleKey;
  page: string;
  schoolId: string;
  userId: string;
  userName: string;
  selectedStudentId?: string;
}) {
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<SchoolSubject[]>([]);
  const [school, setSchool] = useState<SchoolDetails>(emptySchool);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [documentLinks, setDocumentLinks] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [classForm, setClassForm] = useState({ name: '', level: '', stream: '' });
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' });
  const [editingClassId, setEditingClassId] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState('');
  const [assignmentForm, setAssignmentForm] = useState({
    title: '',
    classId: '',
    subjectId: '',
    instructions: '',
  });
  const [admissionForm, setAdmissionForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    reason: '',
  });
  const [schoolLogo, setSchoolLogo] = useState<File | null>(null);
  const [attendanceClasses, setAttendanceClasses] = useState<SchoolClass[]>([]);
  const [attendanceClassId, setAttendanceClassId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
  });
  const [attendanceRoster, setAttendanceRoster] = useState<AttendanceStudent[]>([]);
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<string, string>>({});
  const [submissionDrafts, setSubmissionDrafts] = useState<Record<string, string>>({});
  const moduleName = page.toLowerCase();

  const loadModule = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    if (!schoolId) {
      setError('This account is not linked to an active school. Contact your administrator.');
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setRows([]);
    setClasses([]);
    setSubjects([]);
    setAttendanceClasses([]);

    try {
      if (moduleName === 'school settings') {
        const { data, error: schoolError } = await supabase
          .from('schools')
          .select('name,motto,school_type,county,phone,email,address,logo_path')
          .eq('id', schoolId)
          .maybeSingle();
        if (schoolError) throw schoolError;
        if (!data) throw new Error('School details were not found.');
        setSchool({
          name: data.name || '',
          motto: data.motto || '',
          school_type: data.school_type || '',
          county: data.county || '',
          phone: data.phone || '',
          email: data.email || '',
          address: data.address || '',
          logo_path: data.logo_path,
        });
      } else if (moduleName === 'classes and subjects') {
        const [classResult, subjectResult] = await Promise.all([
          supabase
            .from('classes')
            .select('id,name,level,stream')
            .eq('school_id', schoolId)
            .order('name'),
          supabase
            .from('subjects')
            .select('id,name,code')
            .eq('school_id', schoolId)
            .order('name'),
        ]);
        if (classResult.error) throw classResult.error;
        if (subjectResult.error) throw subjectResult.error;
        setClasses((classResult.data ?? []) as SchoolClass[]);
        setSubjects((subjectResult.data ?? []) as SchoolSubject[]);
      } else if (moduleName === 'users and roles' || moduleName === 'staff oversight') {
        const { data: memberships, error: membershipError } = await supabase
          .from('school_memberships')
          .select('user_id,role,status,created_at')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false });
        if (membershipError) throw membershipError;
        const ids = [...new Set((memberships ?? []).map((item) => item.user_id))];
        const { data: profiles, error: profileError } = ids.length
          ? await supabase.from('profiles').select('id,full_name,email,phone').in('id', ids)
          : { data: [], error: null };
        if (profileError) throw profileError;
        const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
        setRows((memberships ?? []).map((membership) => {
          const profile = profileMap.get(membership.user_id);
          return {
            id: membership.user_id,
            title: profile?.full_name || 'Name not provided',
            detail: [profile?.email, profile?.phone].filter(Boolean).join(' · ') || 'No contact details',
            status: `${membership.role} · ${membership.status}`,
            date: membership.created_at,
          };
        }));
      } else if (moduleName === 'account requests') {
        const { data, error: requestsError } = await supabase
          .from('school_account_requests')
          .select('id,user_id,requested_role,applicant_name,applicant_username,applicant_email,applicant_phone,request_data,status,created_at,generated_identifier')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false });
        if (requestsError) throw requestsError;
        const requestUserIds = [...new Set((data ?? []).map((request) => request.user_id))];
        const [documentResult, profileResult] = requestUserIds.length
          ? await Promise.all([
              supabase
                .from('portal_account_documents')
                .select('user_id,document_type,original_filename,storage_path')
                .eq('school_id', schoolId)
                .in('user_id', requestUserIds),
              supabase
                .from('portal_account_profiles')
                .select('user_id,phone,date_of_birth,guardian_name,guardian_phone,emergency_contact_name,emergency_contact_phone')
                .eq('school_id', schoolId)
                .in('user_id', requestUserIds),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
            ];
        const { data: documents, error: documentsError } = documentResult;
        if (documentsError) throw documentsError;
        const { data: accountProfiles, error: profilesError } = profileResult;
        if (profilesError) throw profilesError;
        const documentsByUser = new Map<string, NonNullable<ModuleRow['documents']>>();
        for (const document of documents ?? []) {
          const userDocuments = documentsByUser.get(document.user_id) || [];
          userDocuments.push({
            documentType: document.document_type,
            filename: document.original_filename,
            storagePath: document.storage_path,
          });
          documentsByUser.set(document.user_id, userDocuments);
        }
        const profilesByUser = new Map(
          (accountProfiles ?? []).map((profile) => [profile.user_id, profile]),
        );
        setRows((data ?? []).map((request) => {
          const requestData = request.request_data as {
            related_admission_number?: string;
            relationship?: string;
          };
          const parentDetails = request.requested_role === 'parent'
            ? [
                requestData.related_admission_number
                  ? `Student ${requestData.related_admission_number}`
                  : '',
                requestData.relationship || '',
              ].filter(Boolean).join(' · ')
            : '';
          const accountProfile = profilesByUser.get(request.user_id);
          const profileDetails = accountProfile
            ? [
                accountProfile.phone,
                accountProfile.date_of_birth
                  ? `DOB ${accountProfile.date_of_birth}`
                  : '',
                accountProfile.guardian_name
                  ? `Guardian ${accountProfile.guardian_name} ${accountProfile.guardian_phone || ''}`
                  : '',
                accountProfile.emergency_contact_name
                  ? `Emergency ${accountProfile.emergency_contact_name} ${accountProfile.emergency_contact_phone}`
                  : '',
              ].filter(Boolean).join(' · ')
            : '';
          return {
            id: request.id,
            title: `${request.applicant_name} · ${request.requested_role}`,
            detail: [
              request.applicant_username,
              request.applicant_email,
              request.applicant_phone || '',
              parentDetails,
              profileDetails,
              request.generated_identifier || '',
            ].filter(Boolean).join(' · '),
            status: request.status,
            date: request.created_at,
            kind: 'account-request',
            documents: documentsByUser.get(request.user_id) || [],
          };
        }));
      } else if (moduleName === 'admissions' || moduleName === 'approvals') {
        const query = supabase
          .from('admission_applications')
          .select('id,student_first_name,student_middle_name,student_last_name,status,created_at,application_reference,review_notes,guardian_user_id')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false });
        const { data, error: admissionError } = role === 'parent'
          ? await query.eq('guardian_user_id', userId)
          : await query;
        if (admissionError) throw admissionError;
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: [item.student_first_name, item.student_middle_name, item.student_last_name]
            .filter(Boolean).join(' '),
          detail: item.review_notes || `Reference ${item.application_reference}`,
          status: item.status,
          date: item.created_at,
          kind: 'admission',
        })));
      } else if (moduleName === 'teacher applications') {
        const { data, error: applicationError } = await supabase
          .from('teacher_applications')
          .select('id,user_id,status,decision_notes,created_at,qualifications')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false });
        if (applicationError) throw applicationError;
        const ids = [...new Set((data ?? []).map((item) => item.user_id))];
        const { data: profiles, error: profileError } = ids.length
          ? await supabase.from('profiles').select('id,full_name,email').in('id', ids)
          : { data: [], error: null };
        if (profileError) throw profileError;
        const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: profileMap.get(item.user_id)?.full_name || 'Teacher applicant',
          detail: item.decision_notes || profileMap.get(item.user_id)?.email || 'No additional details',
          status: item.status,
          date: item.created_at,
          kind: 'teacher-application',
        })));
      } else if (moduleName.includes('fee')) {
        const { data, error: feeError } = await supabase
          .from('fee_charges')
          .select('id,student_id,term_name,academic_year,amount_kes,due_date,notes')
          .eq('school_id', schoolId)
          .order('due_date', { ascending: true });
        if (feeError) throw feeError;
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: `${item.term_name} · ${item.academic_year}`,
          detail: `KSh ${Number(item.amount_kes).toLocaleString('en-KE')} · Student ${item.student_id.slice(0, 8)}${item.notes ? ` · ${item.notes}` : ''}`,
          date: item.due_date,
        })));
      } else if (moduleName.includes('attendance')) {
        if (role === 'teacher') {
          const { data: assignments, error: assignmentError } = await supabase
            .from('teacher_assignments')
            .select('class_id')
            .eq('school_id', schoolId)
            .eq('teacher_id', userId);
          if (assignmentError) throw assignmentError;
          const classIds = [...new Set((assignments ?? []).map((item) => item.class_id))];
          const { data: assignedClasses, error: classError } = classIds.length
            ? await supabase.from('classes').select('id,name,level,stream').in('id', classIds).order('name')
            : { data: [], error: null };
          if (classError) throw classError;
          setAttendanceClasses((assignedClasses ?? []) as SchoolClass[]);
          if (!attendanceClassId && assignedClasses?.length) {
            setAttendanceClassId(assignedClasses[0].id);
          }
        }
        let attendanceQuery = supabase
          .from('attendance_records')
          .select('id,student_id,status,reason,updated_at')
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false })
          .limit(100);
        if ((role === 'parent' || role === 'student') && selectedStudentId) {
          attendanceQuery = attendanceQuery.eq('student_id', selectedStudentId);
        }
        const { data, error: attendanceError } = await attendanceQuery;
        if (attendanceError) throw attendanceError;
        const attendanceRows = data ?? [];
        const studentIds = [...new Set(attendanceRows.map((item) => item.student_id))];
        const { data: attendeeRows, error: attendeeError } = studentIds.length
          ? await supabase
              .from('students')
              .select('id,first_name,middle_name,last_name,admission_number')
              .in('id', studentIds)
          : { data: [], error: null };
        if (attendeeError) throw attendeeError;
        const attendeeMap = new Map((attendeeRows ?? []).map((item) => [item.id, item]));
        setRows(attendanceRows.map((item) => {
          const attendee = attendeeMap.get(item.student_id);
          const name = attendee
            ? [attendee.first_name, attendee.middle_name, attendee.last_name].filter(Boolean).join(' ')
            : `Student ${item.student_id.slice(0, 8)}`;
          return {
            id: item.id,
            title: name,
            detail: `${attendee?.admission_number ?? ''}${item.reason ? ` · ${item.reason}` : ''}`,
            status: item.status,
            date: item.updated_at,
          };
        }));
      } else if (moduleName === 'my classes') {
        const { data: assignmentRows, error: assignmentError } = await supabase
          .from('teacher_assignments')
          .select('id,class_id,subject_id,academic_year')
          .eq('school_id', schoolId)
          .eq('teacher_id', userId);
        if (assignmentError) throw assignmentError;
        const classIds = [...new Set((assignmentRows ?? []).map((item) => item.class_id))];
        const subjectIds = [...new Set((assignmentRows ?? []).map((item) => item.subject_id))];
        const [classResult, subjectResult] = await Promise.all([
          classIds.length
            ? supabase.from('classes').select('id,name,level,stream').in('id', classIds)
            : Promise.resolve({ data: [], error: null }),
          subjectIds.length
            ? supabase.from('subjects').select('id,name,code').in('id', subjectIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (classResult.error) throw classResult.error;
        if (subjectResult.error) throw subjectResult.error;
        const classMap = new Map((classResult.data ?? []).map((item) => [item.id, item]));
        const subjectMap = new Map((subjectResult.data ?? []).map((item) => [item.id, item]));
        setRows((assignmentRows ?? []).map((item) => ({
          id: item.id,
          title: classMap.get(item.class_id)?.name || 'Assigned class',
          detail: `${subjectMap.get(item.subject_id)?.name || 'Subject'} · ${item.academic_year}`,
        })));
      } else if (moduleName === 'results' || moduleName === 'marks and results') {
        const { data, error: submissionError } = await supabase
          .from('assignment_submissions')
          .select('id,assignment_id,student_id,score,feedback,reviewed_at')
          .eq('school_id', schoolId)
          .order('reviewed_at', { ascending: false })
          .limit(100);
        if (submissionError) throw submissionError;
        const assignmentIds = [...new Set((data ?? []).map((item) => item.assignment_id))];
        const { data: assignmentRows, error: titleError } = assignmentIds.length
          ? await supabase.from('assignments').select('id,title').in('id', assignmentIds)
          : { data: [], error: null };
        if (titleError) throw titleError;
        const titleMap = new Map((assignmentRows ?? []).map((item) => [item.id, item.title]));
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: titleMap.get(item.assignment_id) || 'Assignment result',
          detail: `${role === 'teacher' ? `Student ${item.student_id.slice(0, 8)} · ` : ''}${item.score == null ? 'Not graded' : `Score ${item.score}`}${item.feedback ? ` · ${item.feedback}` : ''}`,
          date: item.reviewed_at,
        })));
      } else if (moduleName.includes('assignment') || moduleName.includes('learning material') || moduleName.includes('academic report')) {
        const { data, error: assignmentError } = await supabase
          .from('assignments')
          .select('id,title,instructions,status,due_at,published_at')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (assignmentError) throw assignmentError;
        let submittedIds = new Set<string>();
        if (role === 'student') {
          const { data: student, error: studentError } = await supabase
            .from('students')
            .select('id')
            .eq('school_id', schoolId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
          if (studentError) throw studentError;
          if (student) {
            const { data: submissions, error: submissionsError } = await supabase
              .from('assignment_submissions')
              .select('assignment_id')
              .eq('school_id', schoolId)
              .eq('student_id', student.id);
            if (submissionsError) throw submissionsError;
            submittedIds = new Set((submissions ?? []).map((item) => item.assignment_id));
          }
        }
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          detail: item.instructions || 'No instructions provided.',
          status: role === 'student' && submittedIds.has(item.id) ? 'submitted' : item.status,
          date: item.due_at || item.published_at,
          kind: 'assignment',
        })));
      } else if (moduleName.includes('class') || moduleName === 'school performance' || moduleName === 'student records' || moduleName === 'records' || moduleName === 'linked children') {
        let studentQuery = supabase
          .from('students')
          .select('id,admission_number,first_name,middle_name,last_name,status,school_id')
          .eq('school_id', schoolId)
          .order('last_name');
        if (role === 'student') studentQuery = studentQuery.eq('user_id', userId);
        if (role === 'parent') {
          const { data: guardians, error: guardianError } = await supabase
            .from('guardians')
            .select('id')
            .eq('school_id', schoolId)
            .eq('user_id', userId);
          if (guardianError) throw guardianError;
          const guardianIds = (guardians ?? []).map((guardian) => guardian.id);
          const { data: links, error: linkError } = guardianIds.length
            ? await supabase
                .from('student_guardians')
                .select('student_id')
                .eq('school_id', schoolId)
                .in('guardian_id', guardianIds)
            : { data: [], error: null };
          if (linkError) throw linkError;
          const linkedIds = [...new Set((links ?? []).map((link) => link.student_id))];
          studentQuery = linkedIds.length
            ? studentQuery.in('id', linkedIds)
            : studentQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        }
        if (role === 'teacher') {
          const { data: assignments, error: assignmentError } = await supabase
            .from('teacher_assignments')
            .select('class_id')
            .eq('school_id', schoolId)
            .eq('teacher_id', userId);
          if (assignmentError) throw assignmentError;
          const classIds = [...new Set((assignments ?? []).map((item) => item.class_id))];
          studentQuery = classIds.length
            ? studentQuery.in('class_id', classIds)
            : studentQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        }
        const { data, error: studentError } = await studentQuery;
        if (studentError) throw studentError;
        setRows((data ?? []).map((item) => ({
          id: item.id,
          title: [item.first_name, item.middle_name, item.last_name].filter(Boolean).join(' '),
          detail: `Admission ${item.admission_number}`,
          status: item.status,
        })));
      } else if (moduleName.includes('textbook')) {
        let bookQuery = supabase
          .from('textbook_issues')
          .select('id,student_id,textbook_id,status,issued_at,due_date,notes')
          .eq('school_id', schoolId)
          .order('issued_at', { ascending: false })
          .limit(100);
        if ((role === 'parent' || role === 'student') && selectedStudentId) {
          bookQuery = bookQuery.eq('student_id', selectedStudentId);
        }
        const { data, error: bookError } = await bookQuery;
        if (bookError) throw bookError;
        const issueRows = data ?? [];
        const bookIds = [...new Set(issueRows.map((item) => item.textbook_id))];
        const borrowerIds = [...new Set(issueRows.map((item) => item.student_id))];
        const [{ data: bookRows, error: catalogueError }, { data: borrowerRows, error: borrowerError }] =
          await Promise.all([
            bookIds.length
              ? supabase.from('textbooks').select('id,title,book_number').in('id', bookIds)
              : Promise.resolve({ data: [], error: null }),
            borrowerIds.length
              ? supabase
                  .from('students')
                  .select('id,first_name,middle_name,last_name,admission_number')
                  .in('id', borrowerIds)
              : Promise.resolve({ data: [], error: null }),
          ]);
        if (catalogueError) throw catalogueError;
        if (borrowerError) throw borrowerError;
        const bookMap = new Map((bookRows ?? []).map((item) => [item.id, item]));
        const borrowerMap = new Map((borrowerRows ?? []).map((item) => [item.id, item]));
        setRows(issueRows.map((item) => {
          const book = bookMap.get(item.textbook_id);
          const borrower = borrowerMap.get(item.student_id);
          const borrowerName = borrower
            ? [borrower.first_name, borrower.middle_name, borrower.last_name].filter(Boolean).join(' ')
            : `Student ${item.student_id.slice(0, 8)}`;
          return {
            id: item.id,
            title: book ? `${book.title} · ${book.book_number}` : `Book ${item.textbook_id.slice(0, 8)}`,
            detail: `${borrowerName}${item.notes ? ` · ${item.notes}` : ''}`,
            status: item.status,
            date: item.due_date || item.issued_at,
          };
        }));
      } else {
        setRows([]);
      }
    } catch (loadError) {
      const errorMessage = messageOf(loadError);
      if (
        moduleName === 'account requests' &&
        errorMessage.includes('school_account_requests')
      ) {
        setError(
          'Account requests are not installed in the connected Supabase database. Apply supabase/migrations/202611060003_school_account_signup_approval.sql in the Supabase SQL Editor, then refresh this page.',
        );
      } else if (
        moduleName === 'account requests' &&
        errorMessage.includes('portal_account_documents')
      ) {
        setError(
          'Private account documents are not installed in the connected Supabase database. Apply supabase/migrations/202611060006_school_portal_profile_documents.sql, then refresh this page.',
        );
      } else {
        setError(`Could not load ${page.toLowerCase()}: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }, [attendanceClassId, moduleName, page, role, schoolId, selectedStudentId, userId]);

  useEffect(() => {
    void loadModule();
  }, [loadModule]);

  async function loadAttendanceRoster() {
    if (!supabase || !schoolId || !attendanceClassId) return;
    setLoading(true);
    setError('');
    try {
      const [studentResult, sessionResult] = await Promise.all([
        supabase
          .from('students')
          .select('id,first_name,middle_name,last_name,admission_number')
          .eq('school_id', schoolId)
          .eq('class_id', attendanceClassId)
          .eq('status', 'active')
          .order('last_name'),
        supabase
          .from('attendance_sessions')
          .select('id')
          .eq('school_id', schoolId)
          .eq('class_id', attendanceClassId)
          .eq('session_date', attendanceDate)
          .eq('session_label', 'Daily')
          .maybeSingle(),
      ]);
      if (studentResult.error) throw studentResult.error;
      if (sessionResult.error) throw sessionResult.error;

      const roster = (studentResult.data ?? []) as AttendanceStudent[];
      setAttendanceRoster(roster);
      if (!sessionResult.data) {
        setAttendanceStatuses(Object.fromEntries(roster.map((student) => [student.id, 'present'])));
        return;
      }

      const { data: savedRecords, error: recordError } = await supabase
        .from('attendance_records')
        .select('student_id,status')
        .eq('school_id', schoolId)
        .eq('session_id', sessionResult.data.id);
      if (recordError) throw recordError;
      const saved = new Map((savedRecords ?? []).map((record) => [record.student_id, record.status]));
      setAttendanceStatuses(Object.fromEntries(
        roster.map((student) => [student.id, saved.get(student.id) || 'present']),
      ));
    } catch (loadError) {
      setError(`Could not load class attendance: ${messageOf(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId || !attendanceClassId || attendanceRoster.length === 0) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let { data: attendanceSession, error: sessionError } = await supabase
        .from('attendance_sessions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('class_id', attendanceClassId)
        .eq('session_date', attendanceDate)
        .eq('session_label', 'Daily')
        .maybeSingle();
      if (sessionError) throw sessionError;

      if (!attendanceSession) {
        const insertResult = await supabase
          .from('attendance_sessions')
          .insert({
            school_id: schoolId,
            class_id: attendanceClassId,
            session_date: attendanceDate,
            session_label: 'Daily',
            recorded_by: userId,
          })
          .select('id')
          .single();
        if (insertResult.error) throw insertResult.error;
        attendanceSession = insertResult.data;
      }

      const { error: recordError } = await supabase
        .from('attendance_records')
        .upsert(
          attendanceRoster.map((student) => ({
            school_id: schoolId,
            session_id: attendanceSession.id,
            student_id: student.id,
            status: attendanceStatuses[student.id] || 'present',
            updated_by: userId,
          })),
          { onConflict: 'session_id,student_id' },
        );
      if (recordError) throw recordError;
      setNotice('Attendance saved.');
      await loadAttendanceRoster();
    } catch (saveError) {
      setError(`Could not save attendance: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function addClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        school_id: schoolId,
        name: classForm.name.trim(),
        level: classForm.level.trim() || null,
        stream: classForm.stream.trim() || null,
      };
      const query = editingClassId
        ? supabase.from('classes').update(payload).eq('id', editingClassId).eq('school_id', schoolId)
        : supabase.from('classes').insert(payload);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setClassForm({ name: '', level: '', stream: '' });
      setEditingClassId('');
      setNotice(editingClassId ? 'Class updated.' : 'Class created.');
      await loadModule();
    } catch (saveError) {
      setError(`Could not save class: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeClass(id: string) {
    if (!supabase || !schoolId || !window.confirm('Delete this class? This only works when nothing else references it.')) return;
    setSaving(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('classes')
        .delete()
        .eq('id', id)
        .eq('school_id', schoolId);
      if (deleteError) throw deleteError;
      if (editingClassId === id) {
        setEditingClassId('');
        setClassForm({ name: '', level: '', stream: '' });
      }
      setNotice('Class deleted.');
      await loadModule();
    } catch (deleteError) {
      setError(`Could not delete class: ${messageOf(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        school_id: schoolId,
        name: subjectForm.name.trim(),
        code: subjectForm.code.trim() || null,
      };
      const query = editingSubjectId
        ? supabase.from('subjects').update(payload).eq('id', editingSubjectId).eq('school_id', schoolId)
        : supabase.from('subjects').insert(payload);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setSubjectForm({ name: '', code: '' });
      setEditingSubjectId('');
      setNotice(editingSubjectId ? 'Subject updated.' : 'Subject created.');
      await loadModule();
    } catch (saveError) {
      setError(`Could not save subject: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeSubject(id: string) {
    if (!supabase || !schoolId || !window.confirm('Delete this subject? This only works when nothing else references it.')) return;
    setSaving(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('subjects')
        .delete()
        .eq('id', id)
        .eq('school_id', schoolId);
      if (deleteError) throw deleteError;
      if (editingSubjectId === id) {
        setEditingSubjectId('');
        setSubjectForm({ name: '', code: '' });
      }
      setNotice('Subject deleted.');
      await loadModule();
    } catch (deleteError) {
      setError(`Could not delete subject: ${messageOf(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveSchoolSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId) return;
    setSaving(true);
    setError('');
    try {
      let logoPath = school.logo_path;
      let logoWarning = '';
      if (schoolLogo) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(schoolLogo.type) || schoolLogo.size > 2 * 1024 * 1024) {
          throw new Error('Choose a JPG, PNG or WebP logo smaller than 2 MB.');
        }
        const extension = schoolLogo.type === 'image/png' ? 'png' : schoolLogo.type === 'image/webp' ? 'webp' : 'jpg';
        try {
          const nextLogoPath = `${schoolId}/logo.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from('school-logos')
            .upload(nextLogoPath, schoolLogo, { upsert: true, contentType: schoolLogo.type });
          if (uploadError) throw uploadError;
          logoPath = nextLogoPath;
        } catch (uploadFailure) {
          logoWarning = `The logo could not be uploaded: ${messageOf(uploadFailure)}`;
        }
      }

      const { error: updateError } = await supabase.rpc('update_school_branding', {
        p_school_id: schoolId,
        p_name: school.name.trim(),
        p_motto: school.motto.trim() || null,
        p_school_type: school.school_type.trim() || null,
        p_county: school.county.trim() || null,
        p_phone: school.phone.trim() || null,
        p_email: school.email.trim() || null,
        p_address: school.address.trim() || null,
        p_logo_path: logoPath,
      });
      if (updateError) throw updateError;
      setSchool({ ...school, logo_path: logoPath });
      if (!logoWarning) setSchoolLogo(null);
      setNotice(logoWarning ? `School profile saved. ${logoWarning}` : 'School profile saved.');
    } catch (saveError) {
      setError(`Could not save school profile: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId || !assignmentForm.classId) return;
    setSaving(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('assignments').insert({
        school_id: schoolId,
        teacher_id: userId,
        class_id: assignmentForm.classId,
        subject_id: assignmentForm.subjectId || null,
        title: assignmentForm.title.trim(),
        instructions: assignmentForm.instructions.trim() || null,
        status: 'draft',
      });
      if (insertError) throw insertError;
      setAssignmentForm({ title: '', classId: '', subjectId: '', instructions: '' });
      setNotice('Assignment saved as a draft.');
      await loadModule();
    } catch (saveError) {
      setError(`Could not create assignment: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function publishAssignment(row: ModuleRow) {
    if (!supabase || !schoolId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: publishError } = await supabase
        .from('assignments')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('school_id', schoolId);
      if (publishError) throw publishError;
      setNotice('Assignment published to the class.');
      await loadModule();
    } catch (publishFailure) {
      setError(`Could not publish assignment: ${messageOf(publishFailure)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignment(assignmentId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId) return;
    const submissionText = submissionDrafts[assignmentId]?.trim();
    if (!submissionText) {
      setError('Write your response before submitting.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('id')
        .eq('school_id', schoolId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student) throw new Error('No active student record is linked to this account.');

      const { error: insertError } = await supabase.from('assignment_submissions').insert({
        school_id: schoolId,
        assignment_id: assignmentId,
        student_id: student.id,
        submission_text: submissionText,
        submitted_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;

      setSubmissionDrafts((current) => ({ ...current, [assignmentId]: '' }));
      setNotice('Assignment response submitted.');
      await loadModule();
    } catch (submitError) {
      setError(`Could not submit assignment: ${messageOf(submitError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitAdmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId) return;
    setSaving(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('admission_applications').insert({
        school_id: schoolId,
        application_reference: crypto.randomUUID(),
        guardian_user_id: userId,
        submitted_by_name: userName,
        student_first_name: admissionForm.firstName.trim(),
        student_middle_name: admissionForm.middleName.trim() || null,
        student_last_name: admissionForm.lastName.trim(),
        date_of_birth: admissionForm.dateOfBirth || null,
        submitted_by_phone: admissionForm.phone.trim(),
        form_data: { guardian_reason: admissionForm.reason.trim() || null },
      });
      if (insertError) throw insertError;
      setAdmissionForm({ firstName: '', middleName: '', lastName: '', dateOfBirth: '', phone: '', reason: '' });
      setNotice('Admission application submitted.');
      await loadModule();
    } catch (saveError) {
      setError(`Could not submit application: ${messageOf(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function createReview(
    row: ModuleRow,
    decision: 'approved' | 'rejected' | 'approve' | 'reject',
  ) {
    if (!supabase || !row.kind) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (row.kind === 'account-request') {
        const { data, error: reviewError } = await supabase.rpc(
          'review_school_account_request',
          {
            p_request_id: row.id,
            p_decision:
              decision === 'approved' || decision === 'approve'
                ? 'approved'
                : 'rejected',
            p_notes: reviewNotes[row.id]?.trim() || null,
          },
        );
        if (reviewError) throw reviewError;
        setNotice(
          decision === 'approved' || decision === 'approve'
            ? `Account approved. Issued school ID: ${String(data)}`
            : 'Account request rejected.',
        );
        await loadModule();
        return;
      }

      const functionName = row.kind === 'admission' ? 'admission-review' : 'teacher-application-review';
      const body = row.kind === 'admission'
        ? {
            application_id: row.id,
            decision: decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : decision,
            notes: reviewNotes[row.id]?.trim() || null,
          }
        : {
            application_id: row.id,
            decision: decision === 'approved' || decision === 'approve' ? 'approved' : 'rejected',
            notes: reviewNotes[row.id]?.trim() || null,
          };
      const { error: functionError } = await supabase.functions.invoke(functionName, { body });
      if (functionError) throw functionError;
      setNotice('Review saved.');
      await loadModule();
    } catch (reviewError) {
      setError(`Could not save review: ${messageOf(reviewError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function openPortalDocument(storagePath: string) {
    if (!supabase) return;
    const { data, error: signedUrlError } = await supabase.storage
      .from('school-private-documents')
      .createSignedUrl(storagePath, 120);
    if (signedUrlError) {
      setError(`Could not open the uploaded document: ${messageOf(signedUrlError)}`);
      return;
    }
    setDocumentLinks((current) => ({
      ...current,
      [storagePath]: data.signedUrl,
    }));
  }

  const isParentAdmissions = role === 'parent' && moduleName === 'admissions';
  const canReview = (
    (moduleName === 'admissions' || moduleName === 'approvals')
      && (role === 'secretary' || role === 'principal' || role === 'school-admin')
  ) || (moduleName === 'teacher applications' && role === 'secretary')
    || (moduleName === 'account requests' && (role === 'principal' || role === 'school-admin'));
  const showClassSetup = role === 'school-admin' && moduleName === 'classes and subjects';
  const showSchoolSettings = role === 'school-admin' && moduleName === 'school settings';
  const showAssignmentComposer = role === 'teacher' && moduleName === 'assignments';

  useEffect(() => {
    if (!showAssignmentComposer || !supabase || !schoolId) return;
    let alive = true;
    void Promise.all([
      supabase.from('classes').select('id,name,level,stream').eq('school_id', schoolId).order('name'),
      supabase.from('subjects').select('id,name,code').eq('school_id', schoolId).order('name'),
    ]).then(([classResult, subjectResult]) => {
      if (!alive) return;
      if (classResult.error || subjectResult.error) {
        setError(`Could not load class options: ${messageOf(classResult.error || subjectResult.error)}`);
        return;
      }
      setClasses((classResult.data ?? []) as SchoolClass[]);
      setSubjects((subjectResult.data ?? []) as SchoolSubject[]);
    });
    return () => { alive = false; };
  }, [schoolId, showAssignmentComposer]);

  const schoolLogoUrl = school.logo_path && supabase
    ? supabase.storage.from('school-logos').getPublicUrl(school.logo_path).data.publicUrl
    : '';

  return (
    <section className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{school.name || 'SCHOOL WORKSPACE'}</p>
          <h2>{page}</h2>
          <p className="muted">{school.motto || 'School records for your authorized role.'}</p>
        </div>
        <button className="icon-btn" type="button" onClick={() => void loadModule()} disabled={loading} title="Refresh records" aria-label="Refresh records">
          <RefreshCw size={17} />
        </button>
      </header>

      {error && <div className="notice error" role="alert"><AlertTriangle size={16} />{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      {showSchoolSettings && (
        <form className="workspace-form" onSubmit={saveSchoolSettings}>
          {schoolLogoUrl && <img className="workspace-school-logo" src={schoolLogoUrl} alt={`${school.name} logo`} />}
          <label>School name<input required maxLength={160} value={school.name} onChange={(event) => setSchool({ ...school, name: event.target.value })} /></label>
          <label>Motto<input maxLength={180} value={school.motto} onChange={(event) => setSchool({ ...school, motto: event.target.value })} /></label>
          <label>School type<input value={school.school_type} onChange={(event) => setSchool({ ...school, school_type: event.target.value })} /></label>
          <label>County<input value={school.county} onChange={(event) => setSchool({ ...school, county: event.target.value })} /></label>
          <label>Phone<input type="tel" value={school.phone} onChange={(event) => setSchool({ ...school, phone: event.target.value })} /></label>
          <label>Email<input type="email" value={school.email} onChange={(event) => setSchool({ ...school, email: event.target.value })} /></label>
          <label className="workspace-form-wide">Address<textarea value={school.address} onChange={(event) => setSchool({ ...school, address: event.target.value })} /></label>
          <label className="workspace-form-wide">School logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setSchoolLogo(event.target.files?.[0] ?? null)} /></label>
          <button className="primary-btn" type="submit" disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save school profile'}</button>
        </form>
      )}

      {showClassSetup && (
        <div className="workspace-form-grid">
          <form className="workspace-form" onSubmit={addClass}>
            <h3><BookOpen size={18} /> {editingClassId ? 'Edit class' : 'Add class'}</h3>
            <label>Class name<input required value={classForm.name} onChange={(event) => setClassForm({ ...classForm, name: event.target.value })} placeholder="e.g. Grade 4" /></label>
            <label>Level<input value={classForm.level} onChange={(event) => setClassForm({ ...classForm, level: event.target.value })} /></label>
            <label>Stream<input value={classForm.stream} onChange={(event) => setClassForm({ ...classForm, stream: event.target.value })} /></label>
            <div className="workspace-form-actions">
              <button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : editingClassId ? 'Update class' : 'Add class'}</button>
              {editingClassId && (
                <button className="secondary-btn" type="button" onClick={() => { setEditingClassId(''); setClassForm({ name: '', level: '', stream: '' }); }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          <form className="workspace-form" onSubmit={addSubject}>
            <h3><BookOpen size={18} /> {editingSubjectId ? 'Edit subject' : 'Add subject'}</h3>
            <label>Subject name<input required value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} /></label>
            <label>Code<input value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value })} /></label>
            <div className="workspace-form-actions">
              <button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : editingSubjectId ? 'Update subject' : 'Add subject'}</button>
              {editingSubjectId && (
                <button className="secondary-btn" type="button" onClick={() => { setEditingSubjectId(''); setSubjectForm({ name: '', code: '' }); }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="workspace-form workspace-list">
            <h3>Classes <span>{classes.length}</span></h3>
            {classes.map((item) => (
              <div className="workspace-list-row" key={item.id}>
                <strong>{item.name}</strong>
                <span>{[item.level, item.stream].filter(Boolean).join(' · ') || 'No level/stream'}</span>
                <span className="row-actions">
                  <button className="link-button" type="button" onClick={() => { setEditingClassId(item.id); setClassForm({ name: item.name, level: item.level ?? '', stream: item.stream ?? '' }); }} aria-label={`Edit ${item.name}`}><Pencil size={14} /></button>
                  <button className="link-button danger" type="button" onClick={() => void removeClass(item.id)} aria-label={`Delete ${item.name}`}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {classes.length === 0 && <p className="muted">No classes yet.</p>}
          </div>
          <div className="workspace-form workspace-list">
            <h3>Subjects <span>{subjects.length}</span></h3>
            {subjects.map((item) => (
              <div className="workspace-list-row" key={item.id}>
                <strong>{item.name}</strong>
                <span>{item.code || 'No code'}</span>
                <span className="row-actions">
                  <button className="link-button" type="button" onClick={() => { setEditingSubjectId(item.id); setSubjectForm({ name: item.name, code: item.code ?? '' }); }} aria-label={`Edit ${item.name}`}><Pencil size={14} /></button>
                  <button className="link-button danger" type="button" onClick={() => void removeSubject(item.id)} aria-label={`Delete ${item.name}`}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {subjects.length === 0 && <p className="muted">No subjects yet.</p>}
          </div>
        </div>
      )}

      {showAssignmentComposer && (
        <form className="workspace-form" onSubmit={createAssignment}>
          <h3>Create assignment draft</h3>
          <label>Title<input required value={assignmentForm.title} onChange={(event) => setAssignmentForm({ ...assignmentForm, title: event.target.value })} /></label>
          <label>Class<select required value={assignmentForm.classId} onChange={(event) => setAssignmentForm({ ...assignmentForm, classId: event.target.value })}><option value="">Choose class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>Subject<select value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm({ ...assignmentForm, subjectId: event.target.value })}><option value="">No subject selected</option>{subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="workspace-form-wide">Instructions<textarea value={assignmentForm.instructions} onChange={(event) => setAssignmentForm({ ...assignmentForm, instructions: event.target.value })} /></label>
          <button className="primary-btn" type="submit" disabled={saving || classes.length === 0}><Save size={16} />{saving ? 'Saving…' : 'Save draft'}</button>
        </form>
      )}

      {role === 'teacher' && moduleName.includes('attendance') && (
        <form className="workspace-form" onSubmit={saveAttendance}>
          <h3>Record class attendance</h3>
          <div className="workspace-form-grid">
            <label>
              Assigned class
              <select
                required
                value={attendanceClassId}
                onChange={(event) => setAttendanceClassId(event.target.value)}
              >
                <option value="">Choose class</option>
                {attendanceClasses.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                required
                type="date"
                value={attendanceDate}
                onChange={(event) => setAttendanceDate(event.target.value)}
              />
            </label>
          </div>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => void loadAttendanceRoster()}
            disabled={!attendanceClassId || loading}
          >
            Load roster
          </button>
          {attendanceRoster.length > 0 && (
            <div className="attendance-roster">
              {attendanceRoster.map((student) => (
                <label className="attendance-roster-row" key={student.id}>
                  <span>
                    <strong>{[student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')}</strong>
                    <small>{student.admission_number}</small>
                  </span>
                  <select
                    aria-label={`Attendance for ${student.first_name} ${student.last_name}`}
                    value={attendanceStatuses[student.id] || 'present'}
                    onChange={(event) =>
                      setAttendanceStatuses({
                        ...attendanceStatuses,
                        [student.id]: event.target.value,
                      })
                    }
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="late">Late</option>
                    <option value="excused">Excused</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          <button
            className="primary-btn"
            type="submit"
            disabled={saving || attendanceRoster.length === 0}
          >
            <Save size={16} />{saving ? 'Saving…' : 'Save attendance'}
          </button>
        </form>
      )}

      {isParentAdmissions && (
        <form className="workspace-form" onSubmit={submitAdmission}>
          <h3>Start an admission application</h3>
          <div className="workspace-form-grid">
            <label>Student first name<input required value={admissionForm.firstName} onChange={(event) => setAdmissionForm({ ...admissionForm, firstName: event.target.value })} /></label>
            <label>Middle name<input value={admissionForm.middleName} onChange={(event) => setAdmissionForm({ ...admissionForm, middleName: event.target.value })} /></label>
            <label>Last name<input required value={admissionForm.lastName} onChange={(event) => setAdmissionForm({ ...admissionForm, lastName: event.target.value })} /></label>
            <label>Date of birth<input type="date" value={admissionForm.dateOfBirth} onChange={(event) => setAdmissionForm({ ...admissionForm, dateOfBirth: event.target.value })} /></label>
            <label>Guardian phone<input required type="tel" value={admissionForm.phone} onChange={(event) => setAdmissionForm({ ...admissionForm, phone: event.target.value })} /></label>
            <label className="workspace-form-wide">Note to the school<textarea value={admissionForm.reason} onChange={(event) => setAdmissionForm({ ...admissionForm, reason: event.target.value })} /></label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}><Send size={16} />{saving ? 'Submitting…' : 'Submit application'}</button>
        </form>
      )}

      {loading ? (
        <div className="workspace-empty"><span className="spinner" /><p>Loading {page.toLowerCase()}…</p></div>
      ) : error ? null : rows.length === 0 ? (
        <div className="workspace-empty"><BookOpen size={24} /><strong>No records yet</strong><p>Records will appear here when they are created for this school.</p></div>
      ) : (
        <div className="workspace-records">
          {rows.map((row) => (
            <article className="workspace-record" key={row.id}>
              <div className="workspace-record-main">
                <strong>{row.title || 'Untitled record'}</strong>
                <p>{row.detail}</p>
                {row.date && <small>{dateLabel(row.date)}</small>}
                {row.documents && row.documents.length > 0 && (
                  <div className="workspace-document-links">
                    {row.documents.map((document) => (
                      documentLinks[document.storagePath] ? (
                        <a
                          key={document.storagePath}
                          className="link-button"
                          href={documentLinks[document.storagePath]}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open {document.documentType.replace(/_/g, ' ')}: {document.filename}
                        </a>
                      ) : (
                        <button
                          key={document.storagePath}
                          className="link-button"
                          type="button"
                          onClick={() => void openPortalDocument(document.storagePath)}
                        >
                          Prepare {document.documentType.replace(/_/g, ' ')}: {document.filename}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
              {row.status && <span className={`workspace-status status-${row.status.replace(/[^a-z_]/g, '')}`}>{displayStatus(row.status)}</span>}
              {role === 'student' && row.kind === 'assignment' && row.status !== 'submitted' && (
                <form className="workspace-student-submit" onSubmit={(event) => void submitAssignment(row.id, event)}>
                  <textarea
                    required
                    aria-label={`Response for ${row.title}`}
                    placeholder="Write your response"
                    value={submissionDrafts[row.id] ?? ''}
                    onChange={(event) => setSubmissionDrafts({ ...submissionDrafts, [row.id]: event.target.value })}
                  />
                  <button className="secondary-btn" type="submit" disabled={saving}>
                    {saving ? 'Submitting…' : 'Submit response'}
                  </button>
                </form>
              )}
              {role === 'teacher' && row.kind === 'assignment' && row.status === 'draft' && (
                <div className="workspace-review">
                  <button
                    className="secondary-btn"
                    type="button"
                    disabled={saving}
                    onClick={() => void publishAssignment(row)}
                  >
                    Publish assignment
                  </button>
                </div>
              )}
              {canReview && row.kind && row.status === 'pending' && (
                <div className="workspace-review">
                  <textarea aria-label={`Review notes for ${row.title}`} placeholder="Optional review note" value={reviewNotes[row.id] ?? ''} onChange={(event) => setReviewNotes({ ...reviewNotes, [row.id]: event.target.value })} />
                  <button className="secondary-btn" type="button" disabled={saving} onClick={() => void createReview(row, 'approved')}>Approve</button>
                  <button className="secondary-btn danger" type="button" disabled={saving} onClick={() => void createReview(row, 'rejected')}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
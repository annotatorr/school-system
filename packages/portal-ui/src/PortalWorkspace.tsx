import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from './supabase';
import { PortalModulePage } from './PortalModulePage';
import type { RoleKey } from './portal-types';
import './portal-workspace.css';

type SchoolLite = {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_path: string | null;
  motto: string | null;
};

type Option = { id: string; label: string };

type Lookup = {
  classes: Option[];
  subjects: Option[];
  students: Option[];
  members: Option[];
  years: Option[];
  terms: Option[];
  examTypes: Option[];
};

type Field = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'datetime-local' | 'time' | 'select' | 'checkbox';
  required?: boolean;
  options?: Option[];
  optionKey?: keyof Lookup;
  placeholder?: string;
  step?: string;
  defaultValue?: string | number | boolean;
};

type Column = {
  key: string;
  label: string;
  type?: 'date' | 'datetime' | 'bool' | 'money' | 'status' | 'lookup';
  lookup?: keyof Lookup;
};

type Spec = {
  table: string;
  description: string;
  columns: Column[];
  fields: Field[];
  writeRoles: RoleKey[];
  studentScoped?: boolean;
  userField?: string;
  orderBy?: string;
  orderAsc?: boolean;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const emptyLookup: Lookup = {
  classes: [],
  subjects: [],
  students: [],
  members: [],
  years: [],
  terms: [],
  examTypes: [],
};

const money = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

const dateTimeLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const studentName = (student: any) =>
  [student?.first_name, student?.middle_name, student?.last_name]
    .filter(Boolean)
    .join(' ') || 'Student';

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

const SPECS: Record<string, Spec> = {
  'academic-years-and-terms': {
    table: 'academic_years',
    description: 'Academic years used by timetables, assessments and report cards.',
    columns: [
      { key: 'name', label: 'Academic year' },
      { key: 'starts_on', label: 'Starts', type: 'date' },
      { key: 'ends_on', label: 'Ends', type: 'date' },
      { key: 'is_current', label: 'Current', type: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Academic year name', required: true, placeholder: 'e.g. 2026' },
      { name: 'starts_on', label: 'Starts on', type: 'date' },
      { name: 'ends_on', label: 'Ends on', type: 'date' },
      { name: 'is_current', label: 'Mark as current', type: 'checkbox' },
    ],
    writeRoles: ['school-admin', 'principal'],
    orderBy: 'name',
  },
  'exam-types-and-grading': {
    table: 'exam_types',
    description: 'Assessment types and their weighting in term aggregates.',
    columns: [
      { key: 'name', label: 'Exam type' },
      { key: 'weight', label: 'Weight %' },
    ],
    fields: [
      { name: 'name', label: 'Exam type', required: true },
      { name: 'weight', label: 'Weight (%)', type: 'number', required: true, step: '0.01', defaultValue: 100 },
    ],
    writeRoles: ['school-admin', 'principal'],
    orderBy: 'name',
    orderAsc: true,
  },
  'fee-structure': {
    table: 'fee_items',
    description: 'Fee items available when charging students.',
    columns: [
      { key: 'name', label: 'Fee item' },
      { key: 'category', label: 'Category', type: 'status' },
      { key: 'description', label: 'Description' },
      { key: 'active', label: 'Active', type: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Fee item name', required: true },
      {
        name: 'category',
        label: 'Category',
        type: 'select',
        defaultValue: 'tuition',
        options: ['tuition', 'transport', 'meals', 'activity', 'other'].map((value) => ({
          id: value,
          label: value.replace(/^./, (c) => c.toUpperCase()),
        })),
      },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
    ],
    writeRoles: ['school-admin', 'principal'],
    orderBy: 'name',
    orderAsc: true,
  },
  guardians: {
    table: 'guardians',
    description: 'Guardian contacts recorded for this school.',
    columns: [
      { key: 'full_name', label: 'Guardian' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'relationship', label: 'Relationship' },
    ],
    fields: [
      { name: 'full_name', label: 'Full name', required: true },
      { name: 'phone', label: 'Phone', required: true },
      { name: 'email', label: 'Email' },
      { name: 'relationship', label: 'Relationship', placeholder: 'e.g. Mother' },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'full_name',
    orderAsc: true,
  },
  transport: {
    table: 'transport_routes',
    description: 'School transport routes and their fees.',
    columns: [
      { key: 'name', label: 'Route' },
      { key: 'description', label: 'Description' },
      { key: 'fee_kes', label: 'Fee', type: 'money' },
      { key: 'active', label: 'Active', type: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Route name', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'fee_kes', label: 'Fee (KES)', type: 'number', step: '0.01', defaultValue: 0 },
      { name: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'name',
    orderAsc: true,
  },
  meals: {
    table: 'meal_programmes',
    description: 'Meal programmes offered by the school.',
    columns: [
      { key: 'name', label: 'Programme' },
      { key: 'fee_kes', label: 'Fee', type: 'money' },
      { key: 'active', label: 'Active', type: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Programme name', required: true },
      { name: 'fee_kes', label: 'Fee (KES)', type: 'number', step: '0.01', defaultValue: 0 },
      { name: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'name',
    orderAsc: true,
  },
  documents: {
    table: 'school_documents',
    description: 'School documents and records held by the office.',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'document_type', label: 'Type', type: 'status' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'created_at', label: 'Added', type: 'date' },
    ],
    fields: [
      { name: 'title', label: 'Document title', required: true },
      { name: 'document_type', label: 'Document type', placeholder: 'e.g. transcript' },
      { name: 'content', label: 'Notes / content', type: 'textarea' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'active',
        options: ['draft', 'active', 'archived'].map((value) => ({ id: value, label: value })),
      },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'created_at',
  },
  'lesson-plans': {
    table: 'lesson_plans',
    description: 'Prepare and share lesson plans for your assigned classes.',
    columns: [
      { key: 'topic', label: 'Topic' },
      { key: 'class_id', label: 'Class', type: 'lookup', lookup: 'classes' },
      { key: 'subject_id', label: 'Subject', type: 'lookup', lookup: 'subjects' },
      { key: 'lesson_date', label: 'Lesson date', type: 'date' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { name: 'topic', label: 'Topic', required: true },
      { name: 'subtopic', label: 'Subtopic' },
      { name: 'class_id', label: 'Class', type: 'select', optionKey: 'classes' },
      { name: 'subject_id', label: 'Subject', type: 'select', optionKey: 'subjects' },
      { name: 'lesson_date', label: 'Lesson date', type: 'date' },
      { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', defaultValue: 40 },
      { name: 'objectives', label: 'Objectives', type: 'textarea' },
      { name: 'resources', label: 'Resources', type: 'textarea' },
      { name: 'methods', label: 'Methods', type: 'textarea' },
      { name: 'activities', label: 'Activities', type: 'textarea' },
      { name: 'assessment_methods', label: 'Assessment methods', type: 'textarea' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'draft',
        options: ['draft', 'shared', 'archived'].map((value) => ({ id: value, label: value })),
      },
    ],
    writeRoles: ['teacher', 'principal'],
    userField: 'teacher_id',
    orderBy: 'lesson_date',
  },
  textbooks: {
    table: 'textbooks',
    description: 'Book catalogue with unique book numbers.',
    columns: [
      { key: 'book_number', label: 'Book number' },
      { key: 'title', label: 'Title' },
      { key: 'author', label: 'Author' },
      { key: 'class_level', label: 'Class level' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { name: 'book_number', label: 'Unique book number', required: true },
      { name: 'title', label: 'Title', required: true },
      { name: 'author', label: 'Author' },
      { name: 'class_level', label: 'Class level' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'available',
        options: ['available', 'issued', 'lost', 'damaged', 'retired'].map((value) => ({
          id: value,
          label: value,
        })),
      },
    ],
    writeRoles: ['school-admin', 'secretary', 'teacher', 'principal'],
    orderBy: 'book_number',
    orderAsc: true,
  },
  'events-and-announcements': {
    table: 'school_events',
    description: 'School calendar events visible to the selected audience.',
    columns: [
      { key: 'title', label: 'Event' },
      { key: 'starts_at', label: 'Starts', type: 'datetime' },
      { key: 'ends_at', label: 'Ends', type: 'datetime' },
      { key: 'location', label: 'Location' },
    ],
    fields: [
      { name: 'title', label: 'Event title', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'starts_at', label: 'Starts at', type: 'datetime-local', required: true },
      { name: 'ends_at', label: 'Ends at', type: 'datetime-local' },
      { name: 'location', label: 'Location' },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'starts_at',
  },
  'discipline-and-welfare': {
    table: 'discipline_incidents',
    description: 'Recorded discipline incidents and the action taken.',
    columns: [
      { key: 'student_id', label: 'Student', type: 'lookup', lookup: 'students' },
      { key: 'category', label: 'Category' },
      { key: 'severity', label: 'Severity', type: 'status' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'created_at', label: 'Reported', type: 'date' },
    ],
    fields: [
      { name: 'student_id', label: 'Student', type: 'select', optionKey: 'students', required: true },
      { name: 'category', label: 'Category', required: true },
      {
        name: 'severity',
        label: 'Severity',
        type: 'select',
        defaultValue: 'minor',
        options: ['minor', 'moderate', 'major', 'critical'].map((value) => ({
          id: value,
          label: value,
        })),
      },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'action_taken', label: 'Action taken', type: 'textarea' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'open',
        options: ['open', 'under_review', 'resolved', 'closed'].map((value) => ({
          id: value,
          label: value.replace(/_/g, ' '),
        })),
      },
    ],
    writeRoles: ['principal', 'school-admin', 'teacher'],
    orderBy: 'created_at',
  },
  inventory: {
    table: 'inventory_items',
    description: 'School inventory and stock levels.',
    columns: [
      { key: 'name', label: 'Item' },
      { key: 'category', label: 'Category' },
      { key: 'quantity_on_hand', label: 'On hand' },
      { key: 'reorder_level', label: 'Reorder level' },
      { key: 'unit', label: 'Unit' },
    ],
    fields: [
      { name: 'name', label: 'Item name', required: true },
      { name: 'category', label: 'Category' },
      { name: 'quantity_on_hand', label: 'Quantity on hand', type: 'number', step: '0.01', defaultValue: 0 },
      { name: 'reorder_level', label: 'Reorder level', type: 'number', step: '0.01', defaultValue: 0 },
      { name: 'unit', label: 'Unit', placeholder: 'e.g. box' },
      { name: 'location', label: 'Location' },
    ],
    writeRoles: ['school-admin', 'secretary', 'principal'],
    orderBy: 'name',
    orderAsc: true,
  },
};

type CommonProps = {
  role: RoleKey;
  slug: string;
  page: string;
  school: SchoolLite;
  userId: string;
  studentId: string;
  linkedStudentIds: string[];
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  lookup: Lookup;
  onNavigate: (page: string) => void;
};

function PanelShell({
  title,
  description,
  onRefresh,
  loading,
  children,
}: {
  title: string;
  description: string;
  onRefresh?: () => void;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">SCHOOL WORKSPACE</p>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
        {onRefresh && (
          <button
            className="icon-btn"
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh records"
            aria-label="Refresh records"
          >
            <RefreshCw size={17} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function FamilyChildSelector({
  role,
  linkedStudentIds,
  selectedStudentId,
  onSelectStudent,
  lookup,
}: Pick<
  CommonProps,
  'role' | 'linkedStudentIds' | 'selectedStudentId' | 'onSelectStudent' | 'lookup'
>) {
  if (role !== 'parent' || linkedStudentIds.length === 0) return null;
  const selected = linkedStudentIds.includes(selectedStudentId)
    ? selectedStudentId
    : linkedStudentIds[0];
  const selectedLabel =
    lookup.students.find((student) => student.id === selected)?.label ?? 'Linked child';
  return (
    <div className="family-child-bar">
      {linkedStudentIds.length > 1 ? (
        <label>
          Viewing child
          <select value={selected} onChange={(event) => onSelectStudent(event.target.value)}>
            {linkedStudentIds.map((studentId) => (
              <option key={studentId} value={studentId}>
                {lookup.students.find((student) => student.id === studentId)?.label ??
                  'Linked child'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          Viewing child: <strong>{selectedLabel}</strong>
        </p>
      )}
    </div>
  );
}

function EmptyState({ title, copy, icon }: { title: string; copy: string; icon?: ReactNode }) {
  return (
    <div className="workspace-empty">
      {icon ?? <BookOpen size={24} />}
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function StatusPill({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <span className={`workspace-status status-${String(value).replace(/[^a-z_]/gi, '')}`}>
      {String(value).replace(/_/g, ' ')}
    </span>
  );
}

function FieldInput({
  field,
  value,
  lookup,
  onChange,
}: {
  field: Field;
  value: any;
  lookup: Lookup;
  onChange: (value: any) => void;
}) {
  const options =
    field.optionKey && field.optionKey in lookup ? lookup[field.optionKey] : field.options ?? [];

  if (field.type === 'textarea') {
    return (
      <textarea
        required={field.required}
        value={value ?? ''}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <select
        required={field.required}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select {field.label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  return (
    <input
      type={field.type ?? 'text'}
      required={field.required}
      step={field.step}
      value={value ?? ''}
      placeholder={field.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function valueLabel(value: any, column: Column, lookup: Lookup): ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'bool') return value ? 'Yes' : 'No';
  if (column.type === 'money') return money(value);
  if (column.type === 'date') return dateLabel(value);
  if (column.type === 'datetime') return dateTimeLabel(value);
  if (column.type === 'lookup' && column.lookup) {
    return (
      lookup[column.lookup].find((option) => option.id === value)?.label ??
      String(value).slice(0, 8)
    );
  }
  return String(value);
}

function GenericPanel({ spec, ...props }: CommonProps & { spec: Spec }) {
  const { role, school, userId, studentId, linkedStudentIds, lookup } = props;
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<Record<string, any>>({});
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = spec.writeRoles.includes(role);
  const linkedKey = linkedStudentIds.join(',');

  const blankForm = useCallback(
    () =>
      Object.fromEntries(
        spec.fields.map((field) => [field.name, field.defaultValue ?? '']),
      ) as Record<string, any>,
    [spec],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query = supabase.from(spec.table).select('*').eq('school_id', school.id);
      if (spec.studentScoped) {
        if (role === 'student') query = query.eq('student_id', studentId);
        if (role === 'parent') {
          query = linkedStudentIds.length
            ? query.in('student_id', linkedStudentIds)
            : query.eq('student_id', '00000000-0000-0000-0000-000000000000');
        }
      }
      const { data, error: queryError } = await query
        .order(spec.orderBy ?? 'created_at', { ascending: spec.orderAsc ?? false })
        .limit(250);
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load records: ${errorText(loadError)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [linkedKey, role, school.id, spec, studentId]);

  useEffect(() => {
    setForm(blankForm());
    setEditingId('');
  }, [blankForm]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !canWrite) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload: Record<string, any> = { ...form };
      if (!editingId) payload.school_id = school.id;
      if (spec.userField && !editingId) payload[spec.userField] = userId;
      if (spec.studentScoped && role === 'student' && !editingId) {
        payload.student_id = studentId;
      }
      Object.keys(payload).forEach((key) => {
        if (payload[key] === '') payload[key] = null;
      });
      const result = editingId
        ? await supabase.from(spec.table).update(payload).eq('id', editingId)
        : await supabase.from(spec.table).insert(payload);
      if (result.error) throw result.error;
      setNotice(editingId ? 'Record updated.' : 'Record saved.');
      setForm(blankForm());
      setEditingId('');
      await load();
    } catch (saveError) {
      setError(`Could not save record: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!supabase || !canWrite) return;
    if (!window.confirm('Delete this record permanently?')) return;
    setSaving(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from(spec.table)
        .delete()
        .eq('id', id);
      if (deleteError) throw deleteError;
      setNotice('Record deleted.');
      await load();
    } catch (deleteError) {
      setError(`Could not delete record: ${errorText(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: any) {
    setEditingId(row.id);
    setForm(
      Object.fromEntries(
        spec.fields.map((field) => [field.name, row[field.name] ?? '']),
      ),
    );
  }

  return (
    <PanelShell
      title={props.page}
      description={spec.description}
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {canWrite && (
        <form className="workspace-form" onSubmit={save}>
          <h3>{editingId ? 'Edit record' : 'Add record'}</h3>
          <div className="workspace-form-grid">
            {spec.fields.map((field) => (
              <label
                key={field.name}
                className={field.type === 'textarea' ? 'workspace-form-wide' : undefined}
              >
                {field.label}
                <FieldInput
                  field={field}
                  value={form[field.name]}
                  lookup={lookup}
                  onChange={(value) => setForm((current) => ({ ...current, [field.name]: value }))}
                />
              </label>
            ))}
          </div>
          <div className="workspace-form-actions">
            <button className="primary-btn" type="submit" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving…' : editingId ? 'Update record' : 'Save record'}
            </button>
            {editingId && (
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  setEditingId('');
                  setForm(blankForm());
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <div className="workspace-empty">
          <span className="spinner" />
          <p>Loading records…</p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No records yet"
          copy="Records created for this school will appear here."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {spec.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                {canWrite && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {spec.columns.map((column) => (
                    <td key={column.key}>
                      {column.type === 'status' ? (
                        <StatusPill value={row[column.key]} />
                      ) : (
                        valueLabel(row[column.key], column, lookup)
                      )}
                    </td>
                  ))}
                  {canWrite && (
                    <td className="row-actions">
                      <button className="link-button" type="button" onClick={() => beginEdit(row)}>
                        Edit
                      </button>
                      <button
                        className="link-button danger"
                        type="button"
                        onClick={() => void remove(row.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function MaterialsPanel(props: CommonProps) {
  const { role, school, userId, lookup } = props;
  const canWrite = role === 'teacher' || role === 'school-admin' || role === 'principal';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    classId: '',
    subjectId: '',
    externalUrl: '',
    type: 'notes',
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('learning_materials')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false });
      if (queryError) throw queryError;
      setRows(
        role === 'student'
          ? (data ?? []).filter((item) => item.published)
          : data ?? [],
      );
    } catch (loadError) {
      setError(`Could not load learning materials: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [role, school.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let filePath: string | null = null;
      if (file) {
        if (file.size > 20 * 1024 * 1024) {
          throw new Error('Choose a file smaller than 20 MB.');
        }
        filePath = `${school.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('learning-materials')
          .upload(filePath, file, { contentType: file.type });
        if (uploadError) throw uploadError;
      }
      const { error: insertError } = await supabase.from('learning_materials').insert({
        school_id: school.id,
        teacher_id: userId,
        class_id: form.classId || null,
        subject_id: form.subjectId || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        external_url: form.externalUrl.trim() || null,
        file_path: filePath,
        resource_type: form.type,
        published: true,
      });
      if (insertError) throw insertError;
      setForm({
        title: '',
        description: '',
        classId: '',
        subjectId: '',
        externalUrl: '',
        type: 'notes',
      });
      setFile(null);
      setNotice('Learning material published.');
      await load();
    } catch (saveError) {
      setError(`Could not publish material: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function download(row: any) {
    if (!supabase) return;
    if (row.external_url) {
      window.open(row.external_url, '_blank', 'noopener');
      return;
    }
    if (!row.file_path) return;
    const { data, error: urlError } = await supabase.storage
      .from('learning-materials')
      .createSignedUrl(row.file_path, 3600);
    if (urlError) {
      setError(errorText(urlError));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <PanelShell
      title="Learning materials"
      description="Resources shared with classes. Students only see published materials."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {canWrite && (
        <form className="workspace-form" onSubmit={save}>
          <h3>Publish learning material</h3>
          <div className="workspace-form-grid">
            <label>
              Title
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Class
              <select
                value={form.classId}
                onChange={(event) => setForm({ ...form, classId: event.target.value })}
              >
                <option value="">All classes</option>
                {lookup.classes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <select
                value={form.subjectId}
                onChange={(event) => setForm({ ...form, subjectId: event.target.value })}
              >
                <option value="">No subject</option>
                {lookup.subjects.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
              >
                {['notes', 'document', 'presentation', 'video', 'link', 'other'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="workspace-form-wide">
              External link (optional)
              <input
                type="url"
                value={form.externalUrl}
                onChange={(event) => setForm({ ...form, externalUrl: event.target.value })}
                placeholder="https://..."
              />
            </label>
            <label className="workspace-form-wide">
              Upload file (optional)
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="workspace-form-wide">
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Upload size={16} />
            {saving ? 'Publishing…' : 'Publish material'}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No learning materials"
          copy="Published resources will appear here."
          icon={<BookOpen size={24} />}
        />
      ) : (
        <div className="workspace-records">
          {rows.map((row) => (
            <article className="workspace-record" key={row.id}>
              <div className="workspace-record-main">
                <strong>{row.title}</strong>
                <p>{row.description || 'No description.'}</p>
                <small>
                  {row.resource_type} · {dateLabel(row.created_at)}
                </small>
              </div>
              <StatusPill value={row.published ? 'published' : 'draft'} />
              <button className="secondary-btn" type="button" onClick={() => void download(row)}>
                <Download size={15} />
                Open
              </button>
            </article>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function TimetablePanel(props: CommonProps) {
  const { role, school, userId, selectedStudentId, studentId, lookup } = props;
  const canWrite = ['school-admin', 'principal', 'secretary'].includes(role);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    classId: '',
    subjectId: '',
    teacherId: '',
    day: '1',
    start: '08:00',
    end: '08:40',
    room: '',
  });

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query: any = supabase
        .from('timetable_slots')
        .select('*, classes(name), subjects(name), profiles(full_name)')
        .eq('school_id', school.id)
        .order('day_of_week')
        .order('start_time');

      if (role === 'teacher') {
        query = query.eq('teacher_id', userId);
      } else if (role === 'student' || role === 'parent') {
        const learnerId = role === 'parent' ? selectedStudentId : studentId;
        if (!learnerId) {
          setRows([]);
          setLoading(false);
          return;
        }
        const { data: learner, error: learnerError } = await supabase
          .from('students')
          .select('class_id')
          .eq('id', learnerId)
          .maybeSingle();
        if (learnerError) throw learnerError;
        if (!learner?.class_id) {
          setRows([]);
          setLoading(false);
          return;
        }
        query = query.eq('class_id', learner.class_id);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load timetable: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [role, school.id, selectedStudentId, studentId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !form.classId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('create_timetable_slot', {
        p_school_id: school.id,
        p_class_id: form.classId,
        p_subject_id: form.subjectId || null,
        p_teacher_id: form.teacherId || null,
        p_day_of_week: Number(form.day),
        p_start_time: form.start,
        p_end_time: form.end,
        p_room: form.room.trim() || null,
        p_term_id: null,
        p_academic_year_id: null,
      });
      if (rpcError) throw rpcError;
      setNotice('Timetable slot added.');
      await load();
    } catch (saveError) {
      setError(`Could not add timetable slot: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!supabase) return;
    if (!window.confirm('Remove this timetable slot?')) return;
    setSaving(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('timetable_slots')
        .delete()
        .eq('id', id);
      if (deleteError) throw deleteError;
      setNotice('Slot removed.');
      await load();
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title="Timetable"
      description="Weekly class timetable, including subject, teacher, room and time."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <FamilyChildSelector {...props} />

      {canWrite && (
        <form className="workspace-form" onSubmit={save}>
          <h3>Add timetable slot</h3>
          <div className="workspace-form-grid">
            <label>
              Class
              <select
                required
                value={form.classId}
                onChange={(event) => setForm({ ...form, classId: event.target.value })}
              >
                <option value="">Choose class</option>
                {lookup.classes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <select
                value={form.subjectId}
                onChange={(event) => setForm({ ...form, subjectId: event.target.value })}
              >
                <option value="">No subject</option>
                {lookup.subjects.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Teacher
              <select
                value={form.teacherId}
                onChange={(event) => setForm({ ...form, teacherId: event.target.value })}
              >
                <option value="">No teacher</option>
                {lookup.members.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Day
              <select value={form.day} onChange={(event) => setForm({ ...form, day: event.target.value })}>
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Starts
              <input
                type="time"
                required
                value={form.start}
                onChange={(event) => setForm({ ...form, start: event.target.value })}
              />
            </label>
            <label>
              Ends
              <input
                type="time"
                required
                value={form.end}
                onChange={(event) => setForm({ ...form, end: event.target.value })}
              />
            </label>
            <label>
              Room
              <input
                value={form.room}
                onChange={(event) => setForm({ ...form, room: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Plus size={16} />
            {saving ? 'Saving…' : 'Add slot'}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No timetable slots"
          copy="Timetable slots will appear here once they are added."
          icon={<CalendarDays size={24} />}
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Teacher</th>
                <th>Room</th>
                {canWrite && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{DAYS[Number(row.day_of_week)] ?? row.day_of_week}</td>
                  <td>
                    {String(row.start_time).slice(0, 5)} – {String(row.end_time).slice(0, 5)}
                  </td>
                  <td>{row.classes?.name || '—'}</td>
                  <td>{row.subjects?.name || '—'}</td>
                  <td>{row.profiles?.full_name || '—'}</td>
                  <td>{row.room || '—'}</td>
                  {canWrite && (
                    <td className="row-actions">
                      <button
                        className="link-button danger"
                        type="button"
                        onClick={() => void remove(row.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function ReportsPanel(props: CommonProps) {
  const { role, school, studentId, linkedStudentIds, selectedStudentId } = props;
  const canGenerate = role === 'principal' || role === 'school-admin';
  const isLearner = role === 'student' || role === 'parent';
  const [rows, setRows] = useState<any[]>([]);
  const [terms, setTerms] = useState<Option[]>([]);
  const [termId, setTermId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('report_cards')
        .select('*, students(first_name,middle_name,last_name,admission_number), terms(name)')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false });
      if (isLearner) {
        query = query.eq('status', 'published');
        if (role === 'student') query = query.eq('student_id', studentId);
        if (role === 'parent') {
          const childId = selectedStudentId || linkedStudentIds[0];
          query = childId
            ? query.eq('student_id', childId)
            : query.eq('student_id', '00000000-0000-0000-0000-000000000000');
        }
      }
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setRows(data ?? []);
      const { data: termRows } = await supabase
        .from('terms')
        .select('id,name,academic_year_id')
        .eq('school_id', school.id)
        .order('name');
      setTerms((termRows ?? []).map((term) => ({ id: term.id, label: term.name })));
    } catch (loadError) {
      setError(`Could not load report cards: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [isLearner, linkedStudentIds.join(','), role, school.id, selectedStudentId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !termId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('generate_report_cards', {
        p_school_id: school.id,
        p_term_id: termId,
      });
      if (rpcError) throw rpcError;
      setNotice(`Report cards generated for ${data ?? 0} student(s).`);
      await load();
    } catch (generateError) {
      setError(`Could not generate report cards: ${errorText(generateError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function publishCard(row: any) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('report_cards')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('school_id', school.id);
      if (updateError) throw updateError;
      setNotice('Report card published to the learner and guardians.');
      await load();
    } catch (publishError) {
      setError(`Could not publish report card: ${errorText(publishError)}`);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const lines = [
      'Student,Admission,Term,Average,Grade,Position,Status',
      ...rows.map((row) =>
        [
          studentName(row.students ?? {}),
          row.students?.admission_number ?? '',
          row.terms?.name ?? '',
          row.average_marks ?? '',
          row.grade ?? '',
          row.class_position ?? '',
          row.status,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-cards-${school.slug}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PanelShell
      title="Report cards"
      description={
        isLearner
          ? 'Published term report cards for the linked student account.'
          : 'Generate report cards from published assessment results.'
      }
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <FamilyChildSelector {...props} />

      {canGenerate && (
        <form className="workspace-form" onSubmit={generate}>
          <h3>Generate report cards</h3>
          <div className="workspace-form-grid">
            <label>
              Term
              <select required value={termId} onChange={(event) => setTermId(event.target.value)}>
                <option value="">Choose term</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <FileText size={16} />
            {saving ? 'Generating…' : 'Generate report cards'}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No report cards"
          copy="Report cards will appear here once they are generated and published."
          icon={<FileText size={24} />}
        />
      ) : (
        <>
          <div className="workspace-form-actions">
            <button className="secondary-btn" type="button" onClick={exportCsv}>
              <Download size={16} />
              Export CSV
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Term</th>
                  <th>Average</th>
                  <th>Grade</th>
                  <th>Position</th>
                  <th>Status</th>
                  {canGenerate && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{studentName(row.students ?? {})}</td>
                    <td>{row.terms?.name || '—'}</td>
                    <td>{row.average_marks ?? '—'}</td>
                    <td>{row.grade || '—'}</td>
                    <td>{row.class_position ?? '—'}</td>
                    <td>
                      <StatusPill value={row.status} />
                    </td>
                    {canGenerate && (
                      <td>
                        {row.status !== 'published' && (
                          <button
                            className="secondary-btn"
                            type="button"
                            disabled={saving}
                            onClick={() => void publishCard(row)}
                          >
                            <Send size={14} /> Publish
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PanelShell>
  );
}

function NotificationsPanel(props: CommonProps) {
  const { role, school, userId } = props;
  const canSend = ['school-admin', 'principal', 'secretary'].includes(role);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', category: 'general' });

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!canSend) query = query.eq('user_id', userId);
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load notifications: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [canSend, school.id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('send_school_notification', {
        p_school_id: school.id,
        p_title: form.title.trim(),
        p_body: form.body.trim() || null,
        p_audience: form.audience,
        p_category: form.category,
      });
      if (rpcError) throw rpcError;
      setForm({ title: '', body: '', audience: 'all', category: 'general' });
      setNotice(`Notification sent to ${data ?? 0} recipient(s).`);
      await load();
    } catch (sendError) {
      setError(`Could not send notification: ${errorText(sendError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function markRead(row: any) {
    if (!supabase || row.read_at) return;
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', userId);
    if (updateError) setError(errorText(updateError));
    else await load();
  }

  return (
    <PanelShell
      title="Notifications"
      description="School notices delivered to authorized accounts."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {canSend && (
        <form className="workspace-form" onSubmit={send}>
          <h3>Send school notification</h3>
          <div className="workspace-form-grid">
            <label>
              Title
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Audience
              <select
                value={form.audience}
                onChange={(event) => setForm({ ...form, audience: event.target.value })}
              >
                <option value="all">Everyone</option>
                <option value="staff">Staff</option>
                <option value="teachers">Teachers</option>
                <option value="students">Students</option>
                <option value="parents">Parents</option>
              </select>
            </label>
            <label>
              Category
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </label>
            <label className="workspace-form-wide">
              Message
              <textarea
                required
                value={form.body}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Send size={16} />
            {saving ? 'Sending…' : 'Send notification'}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No notifications"
          copy="Notifications for this account will appear here."
          icon={<Bell size={24} />}
        />
      ) : (
        <div className="workspace-records">
          {rows.map((row) => (
            <article className={`workspace-record ${row.read_at ? '' : 'unread'}`} key={row.id}>
              <div className="workspace-record-main">
                <strong>{row.title}</strong>
                <p>{row.body || 'No message body.'}</p>
                <small>
                  {row.category} · {dateTimeLabel(row.created_at)}
                </small>
              </div>
              {!row.read_at && (
                <button className="secondary-btn" type="button" onClick={() => void markRead(row)}>
                  Mark read
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function MessagesPanel(props: CommonProps) {
  const { role, school, userId } = props;
  const [messages, setMessages] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [messageResult, notificationResult] = await Promise.all([
        supabase
          .from('school_messages')
          .select('*')
          .eq('school_id', school.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('notifications')
          .select('*')
          .eq('school_id', school.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (messageResult.error) throw messageResult.error;
      if (notificationResult.error) throw notificationResult.error;
      setMessages(messageResult.data ?? []);
      setNotifications(notificationResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load messages: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [school.id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PanelShell
      title="Messages"
      description={`School messages and personal notifications for this ${role} account.`}
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      <h3 className="section-subtitle">School messages</h3>
      {messages.length === 0 ? (
        <p className="muted">No school messages yet.</p>
      ) : (
        <div className="workspace-records">
          {messages.map((message) => (
            <article className="workspace-record" key={message.id}>
              <div className="workspace-record-main">
                <strong>{message.title || 'School message'}</strong>
                <p>{message.body}</p>
                <small>{dateTimeLabel(message.sent_at || message.created_at)}</small>
              </div>
              <StatusPill value={message.channel} />
            </article>
          ))}
        </div>
      )}
      <h3 className="section-subtitle">Your notifications</h3>
      {notifications.length === 0 ? (
        <p className="muted">No personal notifications yet.</p>
      ) : (
        <div className="workspace-records">
          {notifications.map((notification) => (
            <article className="workspace-record" key={notification.id}>
              <div className="workspace-record-main">
                <strong>{notification.title}</strong>
                <p>{notification.body || 'No message body.'}</p>
                <small>{dateTimeLabel(notification.created_at)}</small>
              </div>
              {!notification.read_at && <StatusPill value="unread" />}
            </article>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SupportPanel(props: CommonProps) {
  const { school, userId } = props;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ subject: '', message: '' });

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('school_id', school.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load support tickets: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [school.id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('support_tickets').insert({
        school_id: school.id,
        user_id: userId,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      if (insertError) throw insertError;
      setForm({ subject: '', message: '' });
      setNotice('Support ticket submitted.');
      await load();
    } catch (sendError) {
      setError(`Could not submit ticket: ${errorText(sendError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title="Support"
      description="Contact the platform team and follow your support tickets."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <form className="workspace-form" onSubmit={send}>
        <h3>Open a support ticket</h3>
        <label>
          Subject
          <input
            required
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
          />
        </label>
        <label>
          Message
          <textarea
            required
            rows={4}
            value={form.message}
            onChange={(event) => setForm({ ...form, message: event.target.value })}
          />
        </label>
        <button className="primary-btn" type="submit" disabled={saving}>
          <Send size={16} />
          {saving ? 'Submitting…' : 'Submit ticket'}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="muted">No support tickets yet.</p>
      ) : (
        <div className="workspace-records">
          {rows.map((row) => (
            <article className="workspace-record" key={row.id}>
              <div className="workspace-record-main">
                <strong>{row.subject}</strong>
                <p>{row.response || row.message}</p>
                <small>{dateTimeLabel(row.created_at)}</small>
              </div>
              <StatusPill value={row.status} />
            </article>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function PerformancePanel(props: CommonProps) {
  const { school, lookup } = props;
  const [counts, setCounts] = useState({
    students: 0,
    staff: 0,
    classes: 0,
    assessments: 0,
    outstanding: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [studentResult, staffResult, classResult, assessmentResult, chargeResult, paymentResult] =
        await Promise.all([
          supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', school.id).eq('status', 'active'),
          supabase.from('school_memberships').select('id', { count: 'exact', head: true }).eq('school_id', school.id).eq('status', 'active'),
          supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
          supabase.from('assessments').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
          supabase.from('fee_charges').select('amount_kes').eq('school_id', school.id),
          supabase.from('payment_intents').select('amount_kes').eq('school_id', school.id).eq('status', 'succeeded'),
        ]);
      if (studentResult.error) throw studentResult.error;
      if (staffResult.error) throw staffResult.error;
      if (classResult.error) throw classResult.error;
      if (assessmentResult.error) throw assessmentResult.error;
      if (chargeResult.error) throw chargeResult.error;
      if (paymentResult.error) throw paymentResult.error;
      const charged = (chargeResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_kes || 0), 0);
      const paid = (paymentResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_kes || 0), 0);
      setCounts({
        students: studentResult.count ?? 0,
        staff: staffResult.count ?? 0,
        classes: classResult.count ?? 0,
        assessments: assessmentResult.count ?? 0,
        outstanding: Math.max(0, charged - paid),
      });
    } catch (loadError) {
      setError(`Could not load school performance: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [school.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PanelShell
      title={props.page}
      description="Live school-wide academic and operational summary with authorized report access."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      <div className="stats-grid compact">
        {[
          { label: 'Active students', value: counts.students, icon: <Users size={20} /> },
          { label: 'Active staff', value: counts.staff, icon: <Users size={20} /> },
          { label: 'Classes', value: counts.classes, icon: <BookOpen size={20} /> },
          { label: 'Assessments', value: counts.assessments, icon: <FileText size={20} /> },
          { label: 'Outstanding fees', value: money(counts.outstanding), icon: <Wallet size={20} /> },
        ].map((stat, index) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-icon tone-${index % 4}`}>{stat.icon}</div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>
      <div className="workspace-form workspace-list">
        <h3>Quick links</h3>
        {[
          ['Academic reports', 'Report cards'],
          ['Approvals', 'Approvals'],
          ['Timetable', 'Timetable'],
          ['Discipline and welfare', 'Discipline and welfare'],
          ['Fee administration', 'Fee administration'],
        ].map(([label, target]) => (
          <button
            className="workspace-list-row as-button"
            type="button"
            key={target}
            onClick={() => props.onNavigate(target)}
          >
            <strong>{label}</strong>
            <span>Open workspace</span>
          </button>
        ))}
        <p className="muted small">
          {lookup.students.length} active student record(s) available to this account.
        </p>
      </div>
    </PanelShell>
  );
}

const ASSESSMENT_TYPES = [
  { id: 'cat', label: 'CAT' },
  { id: 'exam', label: 'Exam' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'project', label: 'Project' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'practical', label: 'Practical' },
];

const blankAssessment = {
  title: '',
  class_id: '',
  subject_id: '',
  exam_type_id: '',
  term_id: '',
  academic_year_id: '',
  assessment_type: 'cat',
  max_marks: '100',
  weight: '100',
  assessment_date: '',
  instructions: '',
};

function ResultsPanel(props: CommonProps) {
  const {
    role,
    school,
    userId,
    studentId,
    linkedStudentIds,
    selectedStudentId,
    lookup,
  } = props;
  const canWrite = ['teacher', 'school-admin', 'principal', 'secretary'].includes(role);
  const canPublish = ['school-admin', 'principal'].includes(role);
  const isFamily = role === 'student' || role === 'parent';
  const [assessments, setAssessments] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [marks, setMarks] = useState<Record<string, { marks: string; remarks: string }>>({});
  const [form, setForm] = useState<Record<string, string>>(blankAssessment);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = assessments.find((item) => item.id === selectedId) ?? null;

  const loadAssessments = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query: any = supabase
        .from('assessments')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (isFamily) {
        const ids =
          role === 'parent'
            ? selectedStudentId
              ? [selectedStudentId]
              : linkedStudentIds.slice(0, 1)
            : studentId
              ? [studentId]
              : [];
        if (!ids.length) {
          setAssessments([]);
          setLoading(false);
          return;
        }
        const { data: resultRows, error: resultError } = await supabase
          .from('assessment_results')
          .select('assessment_id')
          .in('student_id', ids);
        if (resultError) throw resultError;
        const assessmentIds = [...new Set((resultRows ?? []).map((row) => row.assessment_id))];
        if (!assessmentIds.length) {
          setAssessments([]);
          setLoading(false);
          return;
        }
        query = query.in('id', assessmentIds).eq('status', 'published');
      }
      const { data, error: loadError } = await query;
      if (loadError) throw loadError;
      setAssessments(data ?? []);
      if ((data ?? []).length) {
        setSelectedId((current) =>
          (data ?? []).some((item: any) => item.id === current)
            ? current
            : (data ?? []).find((item: any) => item.status === 'published')?.id ?? data[0].id,
        );
      }
    } catch (loadError) {
      setError(`Could not load assessments: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [isFamily, linkedStudentIds.join(','), role, school.id, selectedStudentId, studentId]);

  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments]);

  const loadDetail = useCallback(async () => {
    if (!supabase || !selected) {
      setResults([]);
      setRoster([]);
      return;
    }
    setError('');
    try {
      const [{ data: resultRows, error: resultError }, { data: students, error: studentError }] =
        await Promise.all([
          supabase.from('assessment_results').select('*').eq('assessment_id', selected.id),
          supabase
            .from('students')
            .select('id,first_name,middle_name,last_name,admission_number')
            .eq('school_id', school.id)
            .eq('class_id', selected.class_id)
            .eq('status', 'active')
            .order('last_name'),
        ]);
      if (resultError) throw resultError;
      if (studentError) throw studentError;
      setResults(resultRows ?? []);
      setRoster(students ?? []);
      const next: Record<string, { marks: string; remarks: string }> = {};
      for (const student of students ?? []) {
        const existing = (resultRows ?? []).find((row) => row.student_id === student.id);
        next[student.id] = {
          marks: existing?.marks != null ? String(existing.marks) : '',
          remarks: existing?.remarks ?? '',
        };
      }
      setMarks(next);
    } catch (loadError) {
      setError(`Could not load results: ${errorText(loadError)}`);
    }
  }, [school.id, selected]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const visibleAssessments = assessments;

  const familyResults = useMemo(() => {
    const ids =
      role === 'parent'
        ? new Set(
            selectedStudentId ? [selectedStudentId] : linkedStudentIds.slice(0, 1),
          )
        : new Set(studentId ? [studentId] : []);
    return results.filter((result) => ids.has(result.student_id));
  }, [linkedStudentIds, results, role, selectedStudentId, studentId]);

  async function createAssessment(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: insertError } = await supabase
        .from('assessments')
        .insert({
          school_id: school.id,
          class_id: form.class_id,
          subject_id: form.subject_id || null,
          exam_type_id: form.exam_type_id || null,
          term_id: form.term_id || null,
          academic_year_id: form.academic_year_id || null,
          teacher_id: role === 'teacher' ? userId : null,
          title: form.title.trim(),
          assessment_type: form.assessment_type,
          max_marks: Number(form.max_marks || 100),
          weight: Number(form.weight || 100),
          assessment_date: form.assessment_date || null,
          instructions: form.instructions || null,
          status: 'draft',
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      setForm(blankAssessment);
      setShowForm(false);
      setNotice('Assessment created. Enter marks below, then publish when ready.');
      await loadAssessments();
      if (data?.id) setSelectedId(data.id);
    } catch (saveError) {
      setError(`Could not create assessment: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveMarks() {
    if (!supabase || !selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const rows = roster
        .map((student) => ({ student, value: marks[student.id] }))
        .filter(({ value }) => value && value.marks !== '')
        .map(({ student, value }) => ({
          school_id: school.id,
          assessment_id: selected.id,
          student_id: student.id,
          marks: Number(value.marks),
          remarks: value.remarks || null,
          entered_by: userId,
        }));
      if (!rows.length) throw new Error('Enter at least one mark before saving.');
      const { error: upsertError } = await supabase
        .from('assessment_results')
        .upsert(rows, { onConflict: 'assessment_id,student_id' });
      if (upsertError) throw upsertError;
      setNotice(`${rows.length} result(s) saved.`);
      await loadDetail();
    } catch (saveError) {
      setError(`Could not save results: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!supabase || !selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: publishError } = await supabase.rpc('publish_assessment_results', {
        p_assessment_id: selected.id,
      });
      if (publishError) throw publishError;
      setNotice('Results published. Students and guardians can now see them.');
      await loadAssessments();
    } catch (publishError) {
      setError(`Could not publish results: ${errorText(publishError)}`);
    } finally {
      setSaving(false);
    }
  }

  const subjectName = (id: string) => lookup.subjects.find((item) => item.id === id)?.label ?? '—';
  const className = (id: string) => lookup.classes.find((item) => item.id === id)?.label ?? '—';

  return (
    <PanelShell
      title={props.page}
      description="Record, review and publish assessment marks for the school."
      onRefresh={() => void loadAssessments()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <FamilyChildSelector {...props} />

      {canWrite && (
        <div className="workspace-toolbar">
          <button className="btn primary" type="button" onClick={() => setShowForm((open) => !open)}>
            <Plus size={16} />
            {showForm ? 'Close form' : 'New assessment'}
          </button>
        </div>
      )}

      {showForm && canWrite && (
        <form className="workspace-form" onSubmit={createAssessment}>
          <h3>New assessment</h3>
          <div className="workspace-grid">
            <label className="field">
              <span>Title</span>
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Class</span>
              <select
                required
                value={form.class_id}
                onChange={(event) => setForm({ ...form, class_id: event.target.value })}
              >
                <option value="">Select class</option>
                {lookup.classes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Subject</span>
              <select
                value={form.subject_id}
                onChange={(event) => setForm({ ...form, subject_id: event.target.value })}
              >
                <option value="">Select subject</option>
                {lookup.subjects.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Exam type</span>
              <select
                value={form.exam_type_id}
                onChange={(event) => setForm({ ...form, exam_type_id: event.target.value })}
              >
                <option value="">Select exam type</option>
                {lookup.examTypes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Term</span>
              <select
                value={form.term_id}
                onChange={(event) => setForm({ ...form, term_id: event.target.value })}
              >
                <option value="">Select term</option>
                {lookup.terms.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Academic year</span>
              <select
                value={form.academic_year_id}
                onChange={(event) => setForm({ ...form, academic_year_id: event.target.value })}
              >
                <option value="">Select year</option>
                {lookup.years.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={form.assessment_type}
                onChange={(event) => setForm({ ...form, assessment_type: event.target.value })}
              >
                {ASSESSMENT_TYPES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Max marks</span>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={form.max_marks}
                onChange={(event) => setForm({ ...form, max_marks: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Weight (%)</span>
              <input
                type="number"
                min="1"
                max="100"
                step="0.01"
                value={form.weight}
                onChange={(event) => setForm({ ...form, weight: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Assessment date</span>
              <input
                type="date"
                value={form.assessment_date}
                onChange={(event) => setForm({ ...form, assessment_date: event.target.value })}
              />
            </label>
            <label className="field wide">
              <span>Instructions</span>
              <textarea
                rows={2}
                value={form.instructions}
                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              />
            </label>
          </div>
          <button className="btn primary" type="submit" disabled={saving}>
            <Save size={16} />
            {saving ? 'Creating…' : 'Create assessment'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="workspace-empty">
          <LoaderCircle className="spin" size={24} />
          <p>Loading assessments…</p>
        </div>
      ) : visibleAssessments.length === 0 ? (
        <EmptyState
          title={isFamily ? 'No published results yet' : 'No assessments yet'}
          copy={
            isFamily
              ? 'Results appear here once your school publishes them.'
              : 'Create an assessment to start recording marks.'
          }
        />
      ) : (
        <>
          <div className="workspace-form">
            <label className="field">
              <span>Assessment</span>
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {visibleAssessments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {className(item.class_id)} · {item.status}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <div className="workspace-meta">
                <span>{className(selected.class_id)}</span>
                <span>{subjectName(selected.subject_id)}</span>
                <span>{selected.assessment_type.toUpperCase()}</span>
                <span>Max {selected.max_marks}</span>
                <StatusPill value={selected.status} />
              </div>
            )}
          </div>

          {selected && isFamily && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Marks</th>
                    <th>Grade</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {familyResults.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No results recorded for this assessment yet.</td>
                    </tr>
                  ) : (
                    familyResults.map((result) => {
                      const student = roster.find((item) => item.id === result.student_id);
                      return (
                        <tr key={result.id}>
                          <td>{student ? studentName(student) : 'Student'}</td>
                          <td>
                            {result.marks} / {selected.max_marks}
                          </td>
                          <td>{result.grade ?? '—'}</td>
                          <td>{result.remarks ?? '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {selected && canWrite && (
            <>
              <div className="workspace-toolbar">
                <button className="btn primary" type="button" disabled={saving} onClick={() => void saveMarks()}>
                  <Save size={16} />
                  {saving ? 'Saving…' : 'Save marks'}
                </button>
                {canPublish && selected.status !== 'published' && (
                  <button className="btn" type="button" disabled={saving} onClick={() => void publish()}>
                    <Send size={16} />
                    Publish results
                  </button>
                )}
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Admission no.</th>
                      <th>Student</th>
                      <th>Marks (max {selected.max_marks})</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.length === 0 ? (
                      <tr>
                        <td colSpan={4}>No active students in this class.</td>
                      </tr>
                    ) : (
                      roster.map((student) => (
                        <tr key={student.id}>
                          <td>{student.admission_number}</td>
                          <td>{studentName(student)}</td>
                          <td>
                            <input
                              className="table-input"
                              type="number"
                              min="0"
                              max={selected.max_marks}
                              step="0.01"
                              value={marks[student.id]?.marks ?? ''}
                              disabled={selected.status === 'published'}
                              onChange={(event) =>
                                setMarks({
                                  ...marks,
                                  [student.id]: {
                                    marks: event.target.value,
                                    remarks: marks[student.id]?.remarks ?? '',
                                  },
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="table-input"
                              type="text"
                              value={marks[student.id]?.remarks ?? ''}
                              disabled={selected.status === 'published'}
                              onChange={(event) =>
                                setMarks({
                                  ...marks,
                                  [student.id]: {
                                    marks: marks[student.id]?.marks ?? '',
                                    remarks: event.target.value,
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PanelShell>
  );
}

function FeesPanel(props: CommonProps) {
  const {
    role,
    school,
    userId,
    studentId,
    linkedStudentIds,
    selectedStudentId,
    lookup,
  } = props;
  const canManage = ['school-admin', 'principal', 'secretary'].includes(role);
  const familyIds =
    role === 'parent'
      ? selectedStudentId
        ? [selectedStudentId]
        : linkedStudentIds.slice(0, 1)
      : role === 'student' && studentId
        ? [studentId]
        : [];
  const isFamily = familyIds.length > 0;
  const [charges, setCharges] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [feeItems, setFeeItems] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [claimForm, setClaimForm] = useState({
    student_id: '',
    provider: 'bank',
    reference: '',
    amount_kes: '',
    paid_on: '',
    notes: '',
  });
  const [chargeForm, setChargeForm] = useState({
    student_id: '',
    fee_item_id: '',
    term_name: '',
    academic_year: String(new Date().getFullYear()),
    amount_kes: '',
    due_date: '',
    notes: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    student_id: '',
    amount_kes: '',
    method: 'cash',
    reference: '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const familyKey = familyIds.join(',');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let chargeQuery: any = supabase
        .from('fee_charges')
        .select('*')
        .eq('school_id', school.id)
        .order('due_date', { ascending: true });
      let receiptQuery: any = supabase
        .from('receipts')
        .select('*')
        .eq('school_id', school.id)
        .order('issued_at', { ascending: false })
        .limit(300);
      if (isFamily) {
        chargeQuery = chargeQuery.in('student_id', familyIds);
        receiptQuery = receiptQuery.in('student_id', familyIds);
      }
      const submissionQuery: any = isFamily
        ? supabase
            .from('payment_verification_queue')
            .select('*')
            .eq('school_id', school.id)
            .in('student_id', familyIds)
            .order('created_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null });
      const [chargeResult, receiptResult, allocationResult, itemResult, submissionResult] =
        await Promise.all([
          chargeQuery,
          receiptQuery,
          supabase
            .from('payment_allocations')
            .select('fee_charge_id,amount_kes')
            .eq('school_id', school.id),
          supabase
            .from('fee_items')
            .select('id,name')
            .eq('school_id', school.id)
            .eq('active', true)
            .order('name'),
          submissionQuery,
        ]);
      if (chargeResult.error) throw chargeResult.error;
      if (receiptResult.error) throw receiptResult.error;
      if (allocationResult.error) throw allocationResult.error;
      if (itemResult.error) throw itemResult.error;
      if (submissionResult.error) throw submissionResult.error;
      setCharges(chargeResult.data ?? []);
      setReceipts(receiptResult.data ?? []);
      setAllocations(allocationResult.data ?? []);
      setFeeItems(itemResult.data ?? []);
      setSubmissions(submissionResult.data ?? []);
    } catch (loadError) {
      setError(`Could not load fee records: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [familyKey, isFamily, school.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const paidByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const allocation of allocations) {
      map.set(
        allocation.fee_charge_id,
        (map.get(allocation.fee_charge_id) ?? 0) + Number(allocation.amount_kes || 0),
      );
    }
    return map;
  }, [allocations]);

  const totals = useMemo(() => {
    const billed = charges.reduce((sum, charge) => sum + Number(charge.amount_kes || 0), 0);
    const paid = charges.reduce(
      (sum, charge) => sum + (paidByCharge.get(charge.id) ?? 0),
      0,
    );
    return { billed, paid, balance: billed - paid };
  }, [charges, paidByCharge]);

  const studentLabel = (id: string) =>
    lookup.students.find((student) => student.id === id)?.label ?? `Student ${id.slice(0, 8)}`;
  const itemLabel = (id: string | null) =>
    feeItems.find((item) => item.id === id)?.name ?? 'General fee';

  async function addCharge(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('fee_charges').insert({
        school_id: school.id,
        student_id: chargeForm.student_id,
        fee_item_id: chargeForm.fee_item_id || null,
        term_name: chargeForm.term_name.trim(),
        academic_year: Number(chargeForm.academic_year),
        amount_kes: Number(chargeForm.amount_kes),
        due_date: chargeForm.due_date || null,
        notes: chargeForm.notes.trim() || null,
        created_by: userId,
      });
      if (insertError) throw insertError;
      setChargeForm({
        ...chargeForm,
        student_id: '',
        amount_kes: '',
        due_date: '',
        notes: '',
      });
      setNotice('Fee charge added.');
      await load();
    } catch (saveError) {
      setError(`Could not add fee charge: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('record_manual_payment', {
        p_school_id: school.id,
        p_student_id: paymentForm.student_id,
        p_amount: Number(paymentForm.amount_kes),
        p_method: paymentForm.method,
        p_reference: paymentForm.reference.trim() || null,
        p_notes: paymentForm.notes.trim() || null,
      });
      if (rpcError) throw rpcError;
      setPaymentForm({ ...paymentForm, student_id: '', amount_kes: '', reference: '', notes: '' });
      setNotice('Payment recorded and allocated to the student ledger.');
      await load();
    } catch (saveError) {
      setError(`Could not record payment: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitPaymentClaim(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const student = claimForm.student_id || selectedStudentId || familyIds[0];
    if (!student) {
      setError('Select a linked child before submitting a payment.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('payment_verification_queue').insert({
        school_id: school.id,
        student_id: student,
        provider: claimForm.provider,
        reference: claimForm.reference.trim(),
        amount_kes: Number(claimForm.amount_kes),
        paid_on: claimForm.paid_on || null,
        notes: claimForm.notes.trim() || null,
        submitted_by: userId,
      });
      if (insertError) throw insertError;
      setClaimForm({
        ...claimForm,
        reference: '',
        amount_kes: '',
        paid_on: '',
        notes: '',
      });
      setNotice('Payment submitted for school verification.');
      await load();
    } catch (saveError) {
      setError(`Could not submit payment: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title={props.page}
      description={
        isFamily
          ? 'Your fee charges, payments and receipts.'
          : 'Raise fee charges, record payments and reconcile student balances.'
      }
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <div className="stats-grid compact">
        {[
          { label: 'Billed', value: money(totals.billed) },
          { label: 'Paid', value: money(totals.paid) },
          { label: 'Balance', value: money(totals.balance) },
          { label: 'Receipts', value: String(receipts.length) },
        ].map((stat, index) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-icon tone-${index % 4}`}>
              <Wallet size={20} />
            </div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <FamilyChildSelector {...props} />

      {isFamily && (
        <form className="workspace-form" onSubmit={submitPaymentClaim}>
          <h3>
            <Wallet size={18} /> Submit a payment for verification
          </h3>
          <p className="muted small">
            Use this for bank transfers or payments made outside the school office. A receipt is
            issued after the school verifies the reference.
          </p>
          <div className="workspace-form-grid">
            {linkedStudentIds.length > 1 && (
              <label>
                Child
                <select
                  value={claimForm.student_id || selectedStudentId}
                  onChange={(event) =>
                    setClaimForm({ ...claimForm, student_id: event.target.value })
                  }
                >
                  {linkedStudentIds.map((studentId) => (
                    <option key={studentId} value={studentId}>
                      {studentLabel(studentId)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Payment method
              <select
                value={claimForm.provider}
                onChange={(event) => setClaimForm({ ...claimForm, provider: event.target.value })}
              >
                <option value="bank">Bank transfer</option>
                <option value="manual">Cash / deposit</option>
              </select>
            </label>
            <label>
              Reference
              <input
                required
                value={claimForm.reference}
                onChange={(event) => setClaimForm({ ...claimForm, reference: event.target.value })}
                placeholder="Bank or receipt reference"
              />
            </label>
            <label>
              Amount (KES)
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={claimForm.amount_kes}
                onChange={(event) =>
                  setClaimForm({ ...claimForm, amount_kes: event.target.value })
                }
              />
            </label>
            <label>
              Paid on
              <input
                type="date"
                value={claimForm.paid_on}
                onChange={(event) => setClaimForm({ ...claimForm, paid_on: event.target.value })}
              />
            </label>
            <label className="workspace-form-wide">
              Notes
              <textarea
                value={claimForm.notes}
                onChange={(event) => setClaimForm({ ...claimForm, notes: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Send size={16} />
            {saving ? 'Submitting...' : 'Submit payment'}
          </button>
        </form>
      )}

      {isFamily && submissions.length > 0 && (
        <div className="workspace-form">
          <h3>Submitted payment references</h3>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td>{submission.reference}</td>
                    <td>{submission.provider}</td>
                    <td>{money(Number(submission.amount_kes || 0))}</td>
                    <td>
                      <StatusPill value={submission.status} />
                    </td>
                    <td>{dateLabel(submission.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManage && (
        <div className="workspace-form-grid">
          <form className="workspace-form" onSubmit={addCharge}>
            <h3>
              <Plus size={16} /> Raise fee charge
            </h3>
            <label>
              Student
              <select
                required
                value={chargeForm.student_id}
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, student_id: event.target.value })
                }
              >
                <option value="">Select student</option>
                {lookup.students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fee item
              <select
                value={chargeForm.fee_item_id}
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, fee_item_id: event.target.value })
                }
              >
                <option value="">General fee</option>
                {feeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Term
              <input
                required
                value={chargeForm.term_name}
                placeholder="e.g. Term 1"
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, term_name: event.target.value })
                }
              />
            </label>
            <label>
              Academic year
              <input
                type="number"
                required
                value={chargeForm.academic_year}
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, academic_year: event.target.value })
                }
              />
            </label>
            <label>
              Amount (KES)
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={chargeForm.amount_kes}
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, amount_kes: event.target.value })
                }
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={chargeForm.due_date}
                onChange={(event) =>
                  setChargeForm({ ...chargeForm, due_date: event.target.value })
                }
              />
            </label>
            <label className="workspace-form-wide">
              Notes
              <textarea
                rows={2}
                value={chargeForm.notes}
                onChange={(event) => setChargeForm({ ...chargeForm, notes: event.target.value })}
              />
            </label>
            <button className="primary-btn" type="submit" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving…' : 'Add charge'}
            </button>
          </form>

          <form className="workspace-form" onSubmit={recordPayment}>
            <h3>
              <Wallet size={16} /> Record payment
            </h3>
            <label>
              Student
              <select
                required
                value={paymentForm.student_id}
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, student_id: event.target.value })
                }
              >
                <option value="">Select student</option>
                {lookup.students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (KES)
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={paymentForm.amount_kes}
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, amount_kes: event.target.value })
                }
              />
            </label>
            <label>
              Method
              <select
                value={paymentForm.method}
                onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="manual">Other manual</option>
              </select>
            </label>
            <label>
              Reference
              <input
                value={paymentForm.reference}
                placeholder="Receipt or transaction reference"
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, reference: event.target.value })
                }
              />
            </label>
            <label className="workspace-form-wide">
              Notes
              <textarea
                rows={2}
                value={paymentForm.notes}
                onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })}
              />
            </label>
            <button className="primary-btn" type="submit" disabled={saving}>
              <Wallet size={16} />
              {saving ? 'Saving…' : 'Record payment'}
            </button>
          </form>
        </div>
      )}

      <div className="workspace-form workspace-list">
        <h3>Fee charges</h3>
        {charges.length === 0 ? (
          <p className="muted small">No fee charges recorded yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Fee</th>
                  <th>Term</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((charge) => {
                  const paid = paidByCharge.get(charge.id) ?? 0;
                  const balance = Number(charge.amount_kes || 0) - paid;
                  return (
                    <tr key={charge.id}>
                      <td>{studentLabel(charge.student_id)}</td>
                      <td>{itemLabel(charge.fee_item_id)}</td>
                      <td>
                        {charge.term_name} · {charge.academic_year}
                      </td>
                      <td>{money(charge.amount_kes)}</td>
                      <td>{money(paid)}</td>
                      <td>
                        <span
                          className={`workspace-status ${
                            balance <= 0 ? 'status-active' : 'status-pending'
                          }`}
                        >
                          {money(balance)}
                        </span>
                      </td>
                      <td>{dateLabel(charge.due_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="workspace-form workspace-list">
        <h3>Receipts</h3>
        {receipts.length === 0 ? (
          <p className="muted small">No payments have been recorded yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Student</th>
                  <th>Amount</th>
                  <th>Issued</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{receipt.receipt_number}</td>
                    <td>{studentLabel(receipt.student_id)}</td>
                    <td>{money(receipt.amount_kes)}</td>
                    <td>{dateTimeLabel(receipt.issued_at)}</td>
                    <td>{receipt.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

const SCHOOL_ROLES = [
  { id: 'school_admin', label: 'School admin' },
  { id: 'principal', label: 'Principal' },
  { id: 'secretary', label: 'Secretary' },
  { id: 'teacher', label: 'Teacher' },
  { id: 'student', label: 'Student' },
  { id: 'parent', label: 'Parent' },
];

type MembershipRow = {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  full_name: string;
  email: string;
};

type TeacherAssignmentRow = {
  id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  academic_year: number;
};

function StaffPanel(props: CommonProps) {
  const { role, school, lookup } = props;
  const canManage = role === 'school-admin' || role === 'principal';
  const [members, setMembers] = useState<MembershipRow[]>([]);
  const [edits, setEdits] = useState<Record<string, { role: string; status: string }>>({});
  const [assignments, setAssignments] = useState<TeacherAssignmentRow[]>([]);
  const [assignmentForm, setAssignmentForm] = useState({
    teacher_id: '',
    class_id: '',
    subject_id: '',
    academic_year: String(new Date().getFullYear()),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [membershipResult, assignmentResult] = await Promise.all([
        supabase
          .from('school_memberships')
          .select('id,user_id,role,status,created_at')
          .eq('school_id', school.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('teacher_assignments')
          .select('id,teacher_id,class_id,subject_id,academic_year')
          .eq('school_id', school.id)
          .order('academic_year', { ascending: false }),
      ]);
      if (membershipResult.error) throw membershipResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      const rows = membershipResult.data ?? [];
      const userIds = [...new Set(rows.map((row) => row.user_id))];
      const { data: profiles, error: profileError } = userIds.length
        ? await supabase.from('profiles').select('id,full_name,email').in('id', userIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const enriched = rows.map((row) => ({
        ...row,
        full_name: profileMap.get(row.user_id)?.full_name || 'Name not provided',
        email: profileMap.get(row.user_id)?.email || 'No email',
      })) as MembershipRow[];
      setMembers(enriched);
      setEdits(
        Object.fromEntries(enriched.map((member) => [member.id, { role: member.role, status: member.status }])),
      );
      setAssignments((assignmentResult.data ?? []) as TeacherAssignmentRow[]);
    } catch (loadError) {
      setError(`Could not load staff records: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [school.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const teachers = members.filter(
    (member) => edits[member.id]?.role === 'teacher' && edits[member.id]?.status === 'active',
  );
  const className = (id: string) => lookup.classes.find((item) => item.id === id)?.label ?? 'Class';
  const subjectName = (id: string) =>
    lookup.subjects.find((item) => item.id === id)?.label ?? 'Subject';

  async function saveMember(member: MembershipRow) {
    if (!supabase) return;
    const edit = edits[member.id];
    if (!edit) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('school_memberships')
        .update({ role: edit.role, status: edit.status })
        .eq('id', member.id)
        .eq('school_id', school.id);
      if (updateError) throw updateError;
      setNotice(`${member.full_name}'s access was updated.`);
    } catch (saveError) {
      setError(`Could not update staff access: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(member: MembershipRow) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: deleteError } = await supabase
        .from('school_memberships')
        .delete()
        .eq('id', member.id)
        .eq('school_id', school.id);
      if (deleteError) throw deleteError;
      setNotice(`${member.full_name} was removed from this school.`);
      await load();
    } catch (deleteFailure) {
      setError(`Could not remove staff access: ${errorText(deleteFailure)}`);
    } finally {
      setSaving(false);
    }
  }

  async function addAssignment(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('teacher_assignments').insert({
        school_id: school.id,
        teacher_id: assignmentForm.teacher_id,
        class_id: assignmentForm.class_id,
        subject_id: assignmentForm.subject_id,
        academic_year: Number(assignmentForm.academic_year),
      });
      if (insertError) throw insertError;
      setAssignmentForm({ ...assignmentForm, class_id: '', subject_id: '' });
      setNotice('Teacher assignment added.');
      await load();
    } catch (saveError) {
      setError(`Could not assign teacher: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(assignmentId: string) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('teacher_assignments')
        .delete()
        .eq('id', assignmentId)
        .eq('school_id', school.id);
      if (deleteError) throw deleteError;
      setNotice('Teacher assignment removed.');
      await load();
    } catch (deleteFailure) {
      setError(`Could not remove assignment: ${errorText(deleteFailure)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title={props.page}
      description={
        canManage
          ? 'Manage staff access, roles and teacher class/subject assignments.'
          : 'Staff directory and teaching assignments.'
      }
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <div className="workspace-form workspace-list">
        <h3>
          <Users size={18} /> Staff and portal users <span>{members.length}</span>
        </h3>
        {members.length === 0 ? (
          <p className="muted small">No staff accounts are linked to this school yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const edit = edits[member.id] ?? { role: member.role, status: member.status };
                  return (
                    <tr key={member.id}>
                      <td>{member.full_name}</td>
                      <td>{member.email}</td>
                      <td>
                        {canManage ? (
                          <select
                            value={edit.role}
                            onChange={(event) =>
                              setEdits({
                                ...edits,
                                [member.id]: { ...edit, role: event.target.value },
                              })
                            }
                          >
                            {SCHOOL_ROLES.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          edit.role.replace(/_/g, ' ')
                        )}
                      </td>
                      <td>
                        {canManage ? (
                          <select
                            value={edit.status}
                            onChange={(event) =>
                              setEdits({
                                ...edits,
                                [member.id]: { ...edit, status: event.target.value },
                              })
                            }
                          >
                            {['pending', 'active', 'suspended', 'rejected'].map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`workspace-status status-${member.status}`}>
                            {member.status}
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <div className="inline-actions">
                            <button
                              className="secondary-btn"
                              type="button"
                              disabled={saving}
                              onClick={() => void saveMember(member)}
                            >
                              <Save size={14} /> Save
                            </button>
                            <button
                              className="secondary-btn danger"
                              type="button"
                              disabled={saving}
                              onClick={() => void removeMember(member)}
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="workspace-form workspace-list">
        <h3>
          <BookOpen size={18} /> Teacher class and subject assignments
        </h3>
        {canManage && (
          <form className="workspace-form" onSubmit={addAssignment}>
            <div className="workspace-form-grid">
              <label>
                Teacher
                <select
                  required
                  value={assignmentForm.teacher_id}
                  onChange={(event) =>
                    setAssignmentForm({ ...assignmentForm, teacher_id: event.target.value })
                  }
                >
                  <option value="">Select teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.user_id}>
                      {teacher.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Class
                <select
                  required
                  value={assignmentForm.class_id}
                  onChange={(event) =>
                    setAssignmentForm({ ...assignmentForm, class_id: event.target.value })
                  }
                >
                  <option value="">Select class</option>
                  {lookup.classes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Subject
                <select
                  required
                  value={assignmentForm.subject_id}
                  onChange={(event) =>
                    setAssignmentForm({ ...assignmentForm, subject_id: event.target.value })
                  }
                >
                  <option value="">Select subject</option>
                  {lookup.subjects.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Academic year
                <input
                  type="number"
                  required
                  value={assignmentForm.academic_year}
                  onChange={(event) =>
                    setAssignmentForm({ ...assignmentForm, academic_year: event.target.value })
                  }
                />
              </label>
            </div>
            <button className="primary-btn" type="submit" disabled={saving}>
              <Plus size={16} /> Assign teacher
            </button>
          </form>
        )}
        {assignments.length === 0 ? (
          <p className="muted small">No teacher assignments recorded yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Class</th>
                  <th>Subject</th>
                  <th>Year</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      {members.find((member) => member.user_id === assignment.teacher_id)?.full_name ??
                        'Teacher'}
                    </td>
                    <td>{className(assignment.class_id)}</td>
                    <td>{subjectName(assignment.subject_id)}</td>
                    <td>{assignment.academic_year}</td>
                    {canManage && (
                      <td>
                        <button
                          className="icon-btn"
                          type="button"
                          title="Remove assignment"
                          aria-label="Remove assignment"
                          disabled={saving}
                          onClick={() => void removeAssignment(assignment.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

type LeaveRequestRow = {
  id: string;
  staff_user_id: string;
  leave_type: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

type SubstitutionRow = {
  id: string;
  absent_staff_id: string;
  substitute_staff_id: string | null;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  created_at: string;
};

type StaffOption = { id: string; label: string; role: string };

function LeavePanel(props: CommonProps) {
  const { role, school, userId, lookup } = props;
  const canApprove = role === 'school-admin' || role === 'principal';
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [substitutions, setSubstitutions] = useState<SubstitutionRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [form, setForm] = useState({
    leave_type: 'annual',
    starts_on: '',
    ends_on: '',
    reason: '',
  });
  const [coverForm, setCoverForm] = useState({
    absent_staff_id: '',
    substitute_staff_id: '',
    starts_on: '',
    ends_on: '',
    reason: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let requestQuery = supabase
        .from('staff_leave_requests')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false });
      if (!canApprove) requestQuery = requestQuery.eq('staff_user_id', userId);

      const substitutionQuery = canApprove
        ? supabase
            .from('staff_substitutions')
            .select('*')
            .eq('school_id', school.id)
            .order('starts_on', { ascending: false })
        : supabase
            .from('staff_substitutions')
            .select('*')
            .eq('school_id', school.id)
            .or(`absent_staff_id.eq.${userId},substitute_staff_id.eq.${userId}`)
            .order('starts_on', { ascending: false });

      const membershipQuery = canApprove
        ? supabase
            .from('school_memberships')
            .select('user_id,role')
            .eq('school_id', school.id)
            .eq('status', 'active')
            .in('role', ['school_admin', 'principal', 'secretary', 'teacher'])
        : Promise.resolve({ data: [], error: null });

      const [requestResult, substitutionResult, membershipResult] = await Promise.all([
        requestQuery,
        substitutionQuery,
        membershipQuery,
      ]);
      if (requestResult.error) throw requestResult.error;
      if (substitutionResult.error) throw substitutionResult.error;
      if (membershipResult.error) throw membershipResult.error;

      setRequests((requestResult.data ?? []) as LeaveRequestRow[]);
      setSubstitutions((substitutionResult.data ?? []) as SubstitutionRow[]);
      setStaff(
        ((membershipResult.data ?? []) as { user_id: string; role: string }[])
          .map((membership) => ({
            id: membership.user_id,
            role: membership.role,
            label:
              lookup.members.find((member) => member.id === membership.user_id)?.label ??
              'Staff member',
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      );
    } catch (loadError) {
      setError(`Could not load leave records: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [canApprove, lookup.members, school.id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const personName = (id: string) =>
    lookup.members.find((member) => member.id === id)?.label ?? 'Staff member';

  async function requestLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('staff_leave_requests').insert({
        school_id: school.id,
        staff_user_id: userId,
        leave_type: form.leave_type,
        starts_on: form.starts_on,
        ends_on: form.ends_on,
        reason: form.reason.trim() || null,
        status: 'pending',
      });
      if (insertError) throw insertError;
      setForm({ leave_type: form.leave_type, starts_on: '', ends_on: '', reason: '' });
      setNotice('Leave request submitted for approval.');
      await load();
    } catch (saveError) {
      setError(`Could not submit leave request: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function decideLeave(request: LeaveRequestRow, status: 'approved' | 'rejected') {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('staff_leave_requests')
        .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
        .eq('id', request.id)
        .eq('school_id', school.id);
      if (updateError) throw updateError;
      setNotice(`Leave request ${status}.`);
      await load();
    } catch (saveError) {
      setError(`Could not update leave request: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function cancelLeave(request: LeaveRequestRow) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('staff_leave_requests')
        .update({ status: 'cancelled', decided_by: userId, decided_at: new Date().toISOString() })
        .eq('id', request.id)
        .eq('school_id', school.id);
      if (updateError) throw updateError;
      setNotice('Leave request cancelled.');
      await load();
    } catch (saveError) {
      setError(`Could not cancel leave request: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function addSubstitution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('staff_substitutions').insert({
        school_id: school.id,
        absent_staff_id: coverForm.absent_staff_id,
        substitute_staff_id: coverForm.substitute_staff_id || null,
        starts_on: coverForm.starts_on,
        ends_on: coverForm.ends_on,
        reason: coverForm.reason.trim() || null,
        created_by: userId,
      });
      if (insertError) throw insertError;
      setCoverForm({
        absent_staff_id: '',
        substitute_staff_id: '',
        starts_on: '',
        ends_on: '',
        reason: '',
      });
      setNotice('Substitution cover recorded.');
      await load();
    } catch (saveError) {
      setError(`Could not record substitution: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeSubstitution(substitution: SubstitutionRow) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: deleteError } = await supabase
        .from('staff_substitutions')
        .delete()
        .eq('id', substitution.id)
        .eq('school_id', school.id);
      if (deleteError) throw deleteError;
      setNotice('Substitution removed.');
      await load();
    } catch (deleteError) {
      setError(`Could not remove substitution: ${errorText(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title={props.page}
      description={
        canApprove
          ? 'Review staff leave requests and arrange teaching cover.'
          : 'Request leave and view your approved cover arrangements.'
      }
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <form className="workspace-form" onSubmit={requestLeave}>
        <h3>
          <CalendarDays size={18} /> Request leave
        </h3>
        <div className="workspace-form-grid">
          <label>
            Leave type
            <select
              value={form.leave_type}
              onChange={(event) => setForm({ ...form, leave_type: event.target.value })}
            >
              {['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'other'].map(
                (type) => (
                  <option key={type} value={type}>
                    {type.replace(/^./, (letter) => letter.toUpperCase())}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Starts on
            <input
              type="date"
              required
              value={form.starts_on}
              onChange={(event) => setForm({ ...form, starts_on: event.target.value })}
            />
          </label>
          <label>
            Ends on
            <input
              type="date"
              required
              min={form.starts_on || undefined}
              value={form.ends_on}
              onChange={(event) => setForm({ ...form, ends_on: event.target.value })}
            />
          </label>
          <label className="workspace-form-wide">
            Reason
            <textarea
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              placeholder="Brief reason for the request"
            />
          </label>
        </div>
        <button className="primary-btn" type="submit" disabled={saving}>
          <Send size={16} /> {saving ? 'Submitting...' : 'Submit request'}
        </button>
      </form>

      <div className="workspace-form workspace-list">
        <h3>
          <Users size={18} /> Leave requests <span>{requests.length}</span>
        </h3>
        {requests.length === 0 ? (
          <p className="muted small">No leave requests recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{personName(request.staff_user_id)}</td>
                    <td>{request.leave_type}</td>
                    <td>
                      {dateLabel(request.starts_on)} to {dateLabel(request.ends_on)}
                    </td>
                    <td>{request.reason || '—'}</td>
                    <td>
                      <StatusPill value={request.status} />
                    </td>
                    <td>{dateLabel(request.created_at)}</td>
                    <td>
                      <div className="inline-actions">
                        {canApprove && request.status === 'pending' && (
                          <>
                            <button
                              className="secondary-btn"
                              type="button"
                              disabled={saving}
                              onClick={() => void decideLeave(request, 'approved')}
                            >
                              Approve
                            </button>
                            <button
                              className="secondary-btn"
                              type="button"
                              disabled={saving}
                              onClick={() => void decideLeave(request, 'rejected')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {request.status === 'approved' && canApprove && (
                          <button
                            className="secondary-btn"
                            type="button"
                            onClick={() =>
                              setCoverForm({
                                absent_staff_id: request.staff_user_id,
                                substitute_staff_id: '',
                                starts_on: request.starts_on,
                                ends_on: request.ends_on,
                                reason: `Cover for ${request.leave_type} leave`,
                              })
                            }
                          >
                            Arrange cover
                          </button>
                        )}
                        {request.status === 'pending' && request.staff_user_id === userId && (
                          <button
                            className="secondary-btn"
                            type="button"
                            disabled={saving}
                            onClick={() => void cancelLeave(request)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canApprove && (
        <form className="workspace-form" onSubmit={addSubstitution}>
          <h3>
            <Users size={18} /> Teaching cover
          </h3>
          <div className="workspace-form-grid">
            <label>
              Staff on leave
              <select
                required
                value={coverForm.absent_staff_id}
                onChange={(event) =>
                  setCoverForm({ ...coverForm, absent_staff_id: event.target.value })
                }
              >
                <option value="">Select staff member</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label} · {member.role.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Substitute
              <select
                value={coverForm.substitute_staff_id}
                onChange={(event) =>
                  setCoverForm({ ...coverForm, substitute_staff_id: event.target.value })
                }
              >
                <option value="">Not assigned yet</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label} · {member.role.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Starts on
              <input
                type="date"
                required
                value={coverForm.starts_on}
                onChange={(event) => setCoverForm({ ...coverForm, starts_on: event.target.value })}
              />
            </label>
            <label>
              Ends on
              <input
                type="date"
                required
                min={coverForm.starts_on || undefined}
                value={coverForm.ends_on}
                onChange={(event) => setCoverForm({ ...coverForm, ends_on: event.target.value })}
              />
            </label>
            <label className="workspace-form-wide">
              Notes
              <textarea
                value={coverForm.reason}
                onChange={(event) => setCoverForm({ ...coverForm, reason: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Plus size={16} /> Record cover
          </button>
        </form>
      )}

      <div className="workspace-form workspace-list">
        <h3>
          <CalendarDays size={18} /> Cover arrangements <span>{substitutions.length}</span>
        </h3>
        {substitutions.length === 0 ? (
          <p className="muted small">No substitution cover recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff on leave</th>
                  <th>Substitute</th>
                  <th>Dates</th>
                  <th>Notes</th>
                  {canApprove && <th />}
                </tr>
              </thead>
              <tbody>
                {substitutions.map((substitution) => (
                  <tr key={substitution.id}>
                    <td>{personName(substitution.absent_staff_id)}</td>
                    <td>
                      {substitution.substitute_staff_id
                        ? personName(substitution.substitute_staff_id)
                        : 'Not assigned'}
                    </td>
                    <td>
                      {dateLabel(substitution.starts_on)} to {dateLabel(substitution.ends_on)}
                    </td>
                    <td>{substitution.reason || '—'}</td>
                    {canApprove && (
                      <td>
                        <button
                          className="icon-btn"
                          type="button"
                          title="Remove cover"
                          aria-label="Remove cover"
                          disabled={saving}
                          onClick={() => void removeSubstitution(substitution)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function PaymentVerificationPanel(props: CommonProps) {
  const { role, school, userId, lookup } = props;
  const canManage = ['school-admin', 'principal', 'secretary'].includes(role);
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('awaiting_verification');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      let query: any = supabase
        .from('payment_verification_queue')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!canManage) query = query.eq('submitted_by', userId);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load payment submissions: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [canManage, school.id, statusFilter, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const awaiting = rows.filter((row) => row.status === 'awaiting_verification');
  const awaitingAmount = awaiting.reduce((sum, row) => sum + Number(row.amount_kes || 0), 0);
  const studentName = (studentId: string) =>
    lookup.students.find((student) => student.id === studentId)?.label ??
    `Student ${studentId.slice(0, 8)}`;

  async function verify(row: any) {
    if (!supabase) return;
    if (
      !window.confirm(
        `Verify ${money(Number(row.amount_kes || 0))} from ${studentName(row.student_id)}? This will post a receipt and allocate it to outstanding fees.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('verify_payment_submission', {
        p_queue_id: row.id,
      });
      if (rpcError) throw rpcError;
      setNotice('Payment verified, receipt issued and allocated to the student ledger.');
      await load();
    } catch (saveError) {
      setError(`Could not verify payment: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function reject(row: any) {
    if (!supabase) return;
    const reason = window.prompt('Reason for rejecting this payment reference:');
    if (reason === null) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('payment_verification_queue')
        .update({
          status: 'rejected',
          verified_by: userId,
          verified_at: new Date().toISOString(),
          notes: [row.notes, reason.trim() ? `Rejected: ${reason.trim()}` : 'Rejected by school']
            .filter(Boolean)
            .join('\n'),
        })
        .eq('id', row.id)
        .eq('school_id', school.id)
        .eq('status', 'awaiting_verification');
      if (updateError) throw updateError;
      setNotice('Payment reference rejected.');
      await load();
    } catch (saveError) {
      setError(`Could not reject payment: ${errorText(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelShell
      title={props.page}
      description="Review bank, M-Pesa and manual payment references before posting receipts."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <div className="stats-grid compact">
        <div className="stat-card">
          <div className="stat-icon tone-0">
            <Wallet size={20} />
          </div>
          <div className="stat-label">Awaiting verification</div>
          <div className="stat-value">{awaiting.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon tone-1">
            <Wallet size={20} />
          </div>
          <div className="stat-label">Value awaiting review</div>
          <div className="stat-value">{money(awaitingAmount)}</div>
        </div>
      </div>

      <div className="workspace-toolbar">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="awaiting_verification">Awaiting verification</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="all">All submissions</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No payment submissions"
          copy="Payment references submitted by parents or staff will appear here for verification."
          icon={<Wallet size={24} />}
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Paid on</th>
                <th>Status</th>
                <th>Submitted</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{studentName(row.student_id)}</td>
                  <td>{row.provider}</td>
                  <td>{row.reference}</td>
                  <td>{money(Number(row.amount_kes || 0))}</td>
                  <td>{dateLabel(row.paid_on)}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td>{dateLabel(row.created_at)}</td>
                  {canManage && (
                    <td>
                      {row.status === 'awaiting_verification' && (
                        <div className="workspace-form-actions">
                          <button
                            className="primary-btn"
                            type="button"
                            disabled={saving}
                            onClick={() => void verify(row)}
                          >
                            <CheckCircle2 size={14} /> Verify
                          </button>
                          <button
                            className="secondary-btn"
                            type="button"
                            disabled={saving}
                            onClick={() => void reject(row)}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

function AuditPanel(props: CommonProps) {
  const { school, lookup } = props;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('audit_logs')
        .select('id,actor_user_id,action,entity_type,entity_id,created_at,after_data')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false })
        .limit(250);
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (loadError) {
      setError(`Could not load audit history: ${errorText(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [school.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const actorName = (userId: string | null) =>
    (userId && lookup.members.find((member) => member.id === userId)?.label) || 'System';

  return (
    <PanelShell
      title={props.page}
      description="Immutable record of important actions in this school."
      onRefresh={() => void load()}
      loading={loading}
    >
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No audit records"
          copy="Authorized actions will be recorded here automatically."
          icon={<FileText size={24} />}
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{dateTimeLabel(row.created_at)}</td>
                  <td>{actorName(row.actor_user_id)}</td>
                  <td>{row.action.replace(/_/g, ' ')}</td>
                  <td>
                    {row.entity_type}
                    {row.entity_id ? ` · ${String(row.entity_id).slice(0, 8)}` : ''}
                  </td>
                  <td>
                    {row.after_data && Object.keys(row.after_data).length
                      ? Object.entries(row.after_data)
                          .slice(0, 3)
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

const DELEGATED_PAGES = new Set([
  'school-settings',
  'school-profile',
  'classes-and-subjects',
  'classes-and-streams',
  'classes',
  'subjects',
  'attendance-monitoring',
  'records',
  'student-records',
  'students',
  'my-students',
  'my-class',
  'linked-children',
  'admissions',
  'admission-applications',
  'approvals',
  'teacher-applications',
  'attendance',
  'attendance-updates',
  'assignments',
  'my-assignments',
  'textbooks',
  'library',
  'books-issued',
  'my-classes',
]);

export function PortalWorkspace({
  role,
  page,
  school,
  onNavigate,
}: {
  role: RoleKey;
  page: string;
  school: SchoolLite | null;
  schools?: SchoolLite[];
  onSchoolChange?: (schoolId: string) => void;
  onNavigate: (page: string) => void;
}) {
  const slug = page
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const [userId, setUserId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [linkedStudentIds, setLinkedStudentIds] = useState<string[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [lookup, setLookup] = useState<Lookup>(emptyLookup);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function resolveUser() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (alive) setUserId(data.user?.id ?? '');
    }
    void resolveUser();
    return () => {
      alive = false;
    };
  }, []);

  const reloadLookup = useCallback(async () => {
    if (!supabase || !school) return;
    setLoading(true);
    setError('');
    try {
      const [classResult, subjectResult, yearResult, termResult, examResult] = await Promise.all([
        supabase.from('classes').select('id,name').eq('school_id', school.id).order('name'),
        supabase.from('subjects').select('id,name').eq('school_id', school.id).order('name'),
        supabase.from('academic_years').select('id,name').eq('school_id', school.id).order('name'),
        supabase.from('terms').select('id,name').eq('school_id', school.id).order('name'),
        supabase.from('exam_types').select('id,name').eq('school_id', school.id).order('name'),
      ]);

      let studentRows: any[] = [];
      if (role === 'student') {
        const { data } = await supabase
          .from('students')
          .select('id,first_name,middle_name,last_name,admission_number')
          .eq('school_id', school.id)
          .eq('user_id', userId)
          .eq('status', 'active');
        studentRows = data ?? [];
      } else if (role === 'parent') {
        const { data: guardians } = await supabase
          .from('guardians')
          .select('id')
          .eq('school_id', school.id)
          .eq('user_id', userId);
        const guardianIds = (guardians ?? []).map((guardian) => guardian.id);
        if (guardianIds.length) {
          const { data: links } = await supabase
            .from('student_guardians')
            .select('student_id')
            .eq('school_id', school.id)
            .in('guardian_id', guardianIds);
          const ids = [...new Set((links ?? []).map((link) => link.student_id))];
          const { data } = ids.length
            ? await supabase
                .from('students')
                .select('id,first_name,middle_name,last_name,admission_number')
                .in('id', ids)
                .eq('status', 'active')
            : { data: [] };
          studentRows = data ?? [];
        }
      } else {
        const { data } = await supabase
          .from('students')
          .select('id,first_name,middle_name,last_name,admission_number')
          .eq('school_id', school.id)
          .eq('status', 'active')
          .order('last_name')
          .limit(500);
        studentRows = data ?? [];
      }

      const { data: memberships } = await supabase
        .from('school_memberships')
        .select('user_id,role')
        .eq('school_id', school.id)
        .eq('status', 'active');
      const memberIds = [...new Set((memberships ?? []).map((item) => item.user_id))];
      const { data: profiles } = memberIds.length
        ? await supabase.from('profiles').select('id,full_name,email').in('id', memberIds)
        : { data: [] };
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

      setLookup({
        classes: (classResult.data ?? []).map((item) => ({ id: item.id, label: item.name })),
        subjects: (subjectResult.data ?? []).map((item) => ({ id: item.id, label: item.name })),
        years: (yearResult.data ?? []).map((item) => ({ id: item.id, label: item.name })),
        terms: (termResult.data ?? []).map((item) => ({ id: item.id, label: item.name })),
        examTypes: (examResult.data ?? []).map((item) => ({ id: item.id, label: item.name })),
        students: studentRows.map((student) => ({
          id: student.id,
          label: `${studentName(student)} · ${student.admission_number}`,
        })),
        members: (memberships ?? []).map((membership) => ({
          id: membership.user_id,
          label:
            (profileMap.get(membership.user_id) as any)?.full_name ||
            `${membership.role.replace(/_/g, ' ')} account`,
        })),
      });

      if (role === 'student') {
        setStudentId(studentRows[0]?.id ?? '');
      }
      if (role === 'parent') {
        const ids = studentRows.map((student) => student.id);
        setLinkedStudentIds(ids);
        setSelectedStudentId((current) => (ids.includes(current) ? current : ids[0] ?? ''));
      }
    } catch (lookupError) {
      setError(`Could not load workspace data: ${errorText(lookupError)}`);
    } finally {
      setLoading(false);
    }
  }, [role, school, userId]);

  useEffect(() => {
    if (!userId) return;
    void reloadLookup();
  }, [reloadLookup, userId]);

  const common = useMemo(
    () => ({
      role,
      slug,
      page,
      school: school ?? {
        id: '',
        name: '',
        slug: '',
        status: '',
        logo_path: null,
        motto: null,
      },
      userId,
      studentId,
      linkedStudentIds,
      selectedStudentId,
      onSelectStudent: setSelectedStudentId,
      lookup,
      onNavigate,
    }),
    [
      linkedStudentIds,
      lookup,
      onNavigate,
      page,
      role,
      school,
      selectedStudentId,
      slug,
      studentId,
      userId,
    ],
  );

  if (!school) {
    return (
      <PanelShell title={page} description="No active school is linked to this account.">
        <EmptyState
          title="School not linked"
          copy="Ask your school administrator to verify your account."
        />
      </PanelShell>
    );
  }

  if (loading || !userId) {
    return (
      <PanelShell title={page} description="Loading your authorized workspace…">
        <div className="workspace-empty">
          <LoaderCircle className="spin" size={24} />
          <p>Loading…</p>
        </div>
      </PanelShell>
    );
  }

  if (error) {
    return (
      <PanelShell title={page} description="The workspace could not finish loading.">
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      </PanelShell>
    );
  }

  if (DELEGATED_PAGES.has(slug)) {
    const pageAliases: Record<string, string> = {
      'school-settings': 'School settings',
      'school-profile': 'School settings',
      'classes-and-subjects': 'Classes and subjects',
      'classes-and-streams': 'Classes and subjects',
      classes: 'Classes and subjects',
      subjects: 'Classes and subjects',
      'attendance-monitoring': 'Attendance',
      records: 'Student records',
      'student-records': 'Student records',
      students: 'Student records',
      'my-students': 'Student records',
      'my-class': 'Student records',
      'linked-children': 'Linked children',
      'admission-applications': 'Admissions',
      'my-classes': 'My classes',
      'my-assignments': 'My assignments',
      'attendance-updates': 'Attendance updates',
      library: 'Textbooks',
      'books-issued': 'Textbooks',
    };
    const modulePage = pageAliases[slug] ?? page;
    return (
      <>
        <FamilyChildSelector {...common} />
        <PortalModulePage
          role={role}
          page={modulePage}
          schoolId={school.id}
          userId={userId}
          userName={lookup.members.find((member) => member.id === userId)?.label || 'User'}
          selectedStudentId={role === 'parent' ? selectedStudentId : studentId}
        />
      </>
    );
  }

  switch (slug) {
    case 'learning-materials':
      return <MaterialsPanel {...common} />;
    case 'timetable':
    case 'timetables':
    case 'timetable-oversight':
      return <TimetablePanel {...common} />;
    case 'academic-reports':
    case 'report-cards':
      return <ReportsPanel {...common} />;
    case 'marks-and-results':
    case 'results':
    case 'results-review':
    case 'examination-results':
    case 'examinations':
    case 'examinations-and-results':
    case 'cats-and-assessments':
    case 'academic-performance':
    case 'student-progress':
      return <ResultsPanel {...common} />;
    case 'fee-administration':
    case 'fee-statements':
    case 'fee-statement':
    case 'fee-overview':
    case 'school-fees':
    case 'receipts':
      return <FeesPanel {...common} />;
    case 'payments':
      return ['school-admin', 'principal', 'secretary'].includes(role) ? (
        <PaymentVerificationPanel {...common} />
      ) : (
        <FeesPanel {...common} />
      );
    case 'users-and-roles':
    case 'staff-oversight':
    case 'staff':
    case 'teachers-and-staff':
    case 'teacher-assignments':
      return <StaffPanel {...common} />;
    case 'staff-leave':
    case 'leave-requests':
    case 'leave-and-substitutions':
    case 'substitute-arrangements':
      return <LeavePanel {...common} />;
    case 'notifications':
    case 'announcements':
    case 'school-announcements':
      return <NotificationsPanel {...common} />;
    case 'messages':
    case 'parent-communication':
    case 'messages-and-communication':
      return <MessagesPanel {...common} />;
    case 'support':
      return <SupportPanel {...common} />;
    case 'school-performance':
    case 'reports':
      return <PerformancePanel {...common} />;
    case 'audit-history':
      return <AuditPanel {...common} />;
    case 'school-calendar':
    case 'events-and-calendar':
      return <GenericPanel {...common} spec={SPECS['events-and-announcements']} />;
    case 'parents-and-guardians':
      return <GenericPanel {...common} spec={SPECS.guardians} />;
    case 'documents':
    case 'documents-and-certificates':
      return <GenericPanel {...common} spec={SPECS.documents} />;
    default:
      break;
  }

  const spec = SPECS[slug];
  if (spec) return <GenericPanel {...common} spec={spec} />;

  return (
    <PanelShell title={page} description="This workspace area is available in your portal.">
      <EmptyState
        title="Nothing to show yet"
        copy="Records for this area will appear once they are created for the school."
      />
    </PanelShell>
  );
}

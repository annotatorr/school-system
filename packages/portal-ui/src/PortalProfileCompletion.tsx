import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, GraduationCap, LoaderCircle, Upload } from 'lucide-react';
import { supabase } from './supabase';
import type { PortalIdentity } from './portal-auth';
import './portal-profile-completion.css';

type DocumentType =
  | 'birth_certificate'
  | 'invitation_letter'
  | 'supporting_document';

type SavedDocument = {
  document_type: DocumentType;
  original_filename: string;
};

type Props = {
  identity: PortalIdentity;
  onComplete: () => void;
};

const roleLabels = {
  student: 'student',
  parent: 'parent / guardian',
  teacher: 'teacher',
  principal: 'principal',
};

function isSecondarySchool(schoolType?: string | null): boolean {
  const type = (schoolType || '').toLowerCase();
  return type.includes('secondary') || type.includes('high');
}

export function PortalProfileCompletion({ identity, onComplete }: Props) {
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({});
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const invitationRequired =
    identity.role === 'student' && isSecondarySchool(identity.schoolType);

  const requiredDocuments = useMemo(() => {
    if (identity.role !== 'student') return [];
    return invitationRequired
      ? (['birth_certificate', 'invitation_letter'] as DocumentType[])
      : (['birth_certificate'] as DocumentType[]);
  }, [identity.role, invitationRequired]);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      if (!supabase) {
        setNotice('The school database is not connected.');
        setLoading(false);
        return;
      }

      const [profileResult, documentsResult, accountResult] = await Promise.all([
        supabase
          .from('portal_account_profiles')
          .select(
            'phone,date_of_birth,guardian_name,guardian_phone,emergency_contact_name,emergency_contact_phone,national_id,is_complete',
          )
          .eq('user_id', identity.id)
          .maybeSingle(),
        supabase
          .from('portal_account_documents')
          .select('document_type,original_filename')
          .eq('user_id', identity.id),
        supabase
          .from('profiles')
          .select('phone')
          .eq('id', identity.id)
          .maybeSingle(),
      ]);

      if (!active) return;
      const loadError =
        profileResult.error || documentsResult.error || accountResult.error;
      if (loadError) {
        setNotice(`Could not load your profile requirements: ${loadError.message}`);
        setLoading(false);
        return;
      }

      const profile = profileResult.data;
      if (profile) {
        setPhone(profile.phone || '');
        setDateOfBirth(profile.date_of_birth || '');
        setGuardianName(profile.guardian_name || '');
        setGuardianPhone(profile.guardian_phone || '');
        setEmergencyName(profile.emergency_contact_name || '');
        setEmergencyPhone(profile.emergency_contact_phone || '');
        setNationalId(profile.national_id || '');
      } else {
        setPhone(accountResult.data?.phone || '');
      }
      const documents = (documentsResult.data || []) as SavedDocument[];
      setSavedDocuments(documents);
      const completeFields = Boolean(
        profile?.is_complete &&
          profile.phone &&
          profile.emergency_contact_name &&
          profile.emergency_contact_phone &&
          (identity.role !== 'student' ||
            (profile.date_of_birth && profile.guardian_name && profile.guardian_phone)),
      );
      const completeDocuments = requiredDocuments.every((type) =>
        documents.some((document) => document.document_type === type),
      );
      if (completeFields && completeDocuments) {
        onComplete();
        return;
      }
      setLoading(false);
    }

    void loadProfile().catch((error: unknown) => {
      if (!active) return;
      setNotice(
        error instanceof Error
          ? `Could not load your profile requirements: ${error.message}`
          : 'Could not load your profile requirements.',
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [identity.id, identity.role, onComplete, requiredDocuments]);

  function chooseFile(type: DocumentType, file?: File) {
    setFiles((current) => ({ ...current, [type]: file }));
    setNotice('');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    if (!supabase) {
      setNotice('The school database is not connected.');
      return;
    }

    for (const type of requiredDocuments) {
      if (!files[type] && !savedDocuments.some((document) => document.document_type === type)) {
        setNotice('Upload all required documents before continuing.');
        return;
      }
    }
    if (identity.role === 'student' && !dateOfBirth) {
      setNotice('Enter your date of birth to complete your student profile.');
      return;
    }
    if (identity.role === 'student' && (!guardianName.trim() || !guardianPhone.trim())) {
      setNotice('Enter a guardian name and phone number.');
      return;
    }
    if (!phone.trim() || !emergencyName.trim() || !emergencyPhone.trim()) {
      setNotice('Enter your phone number and an emergency contact name and phone number.');
      return;
    }

    const pendingFiles = Object.entries(files) as [DocumentType, File][];
    for (const [, file] of pendingFiles) {
      if (
        file.size > 5 * 1024 * 1024 ||
        !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)
      ) {
        setNotice('Documents must be PDF, JPG or PNG files no larger than 5 MB.');
        return;
      }
    }

    setSaving(true);
    try {
      for (const [type, file] of pendingFiles) {
        const path = `portal-documents/${identity.schoolId}/${identity.id}/${type}/document`;
        const { error: uploadError } = await supabase.storage
          .from('school-private-documents')
          .upload(path, file, {
            upsert: true,
            contentType: file.type,
          });
        if (uploadError) throw uploadError;

        const { error: documentError } = await supabase
          .from('portal_account_documents')
          .upsert(
            {
              user_id: identity.id,
              school_id: identity.schoolId,
              role: identity.role,
              document_type: type,
              storage_path: path,
              original_filename: file.name,
              mime_type: file.type,
              file_size: file.size,
            },
            { onConflict: 'user_id,document_type' },
          );
        if (documentError) throw documentError;
      }

      const { error } = await supabase
        .from('portal_account_profiles')
        .upsert(
          {
            user_id: identity.id,
            school_id: identity.schoolId,
            role: identity.role,
            phone: phone.trim(),
            date_of_birth: dateOfBirth || null,
            guardian_name: guardianName.trim() || null,
            guardian_phone: guardianPhone.trim() || null,
            emergency_contact_name: emergencyName.trim(),
            emergency_contact_phone: emergencyPhone.trim(),
            national_id: nationalId.trim() || null,
            is_complete: true,
          },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
      onComplete();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Could not save your profile: ${error.message}`
          : 'Could not save your profile. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="portal-profile-loading">
        <LoaderCircle className="spin" size={20} />
        Preparing your school profile…
      </div>
    );
  }

  const documentLabel: Record<DocumentType, string> = {
    birth_certificate: 'Birth certificate',
    invitation_letter: 'School invitation letter',
    supporting_document: 'Supporting document (optional)',
  };
  const documentsToShow: DocumentType[] =
    identity.role === 'student'
      ? requiredDocuments
      : ['supporting_document'];

  return (
    <main className="portal-profile-page">
      <section className="portal-profile-panel">
        <div className="portal-profile-icon">
          <GraduationCap size={24} />
        </div>
        <p className="eyebrow">WELCOME TO {identity.schoolName.toUpperCase()}</p>
        <h1>Complete your profile</h1>
        <p className="muted">
          Add the details your school needs for your {roleLabels[identity.role]} account.
          Required documents are stored privately and can be reviewed by your school
          administrator.
        </p>

        <form className="portal-profile-form" onSubmit={saveProfile}>
          <label>
            Phone number
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              required
            />
          </label>

          {identity.role === 'student' && (
            <>
              <label>
                Date of birth
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                  required
                />
              </label>
              <label>
                Parent or guardian full name
                <input
                  value={guardianName}
                  onChange={(event) => setGuardianName(event.target.value)}
                  required
                />
              </label>
              <label>
                Parent or guardian phone number
                <input
                  type="tel"
                  value={guardianPhone}
                  onChange={(event) => setGuardianPhone(event.target.value)}
                  required
                />
              </label>
            </>
          )}

          <fieldset>
            <legend>Emergency contact</legend>
            <label>
              Contact full name
              <input
                value={emergencyName}
                onChange={(event) => setEmergencyName(event.target.value)}
                required
              />
            </label>
            <label>
              Contact phone number
              <input
                type="tel"
                value={emergencyPhone}
                onChange={(event) => setEmergencyPhone(event.target.value)}
                required
              />
            </label>
          </fieldset>

          {identity.role !== 'student' && (
            <label>
              National ID number (optional)
              <input
                value={nationalId}
                onChange={(event) => setNationalId(event.target.value)}
              />
            </label>
          )}

          <div className="portal-document-fields">
            <h2>Documents</h2>
            {documentsToShow.map((type) => {
              const saved = savedDocuments.find(
                (document) => document.document_type === type,
              );
              const required = requiredDocuments.includes(type);
              return (
                <label key={type} className="portal-document-field">
                  <span>
                    <FileText size={17} />
                    {documentLabel[type]}
                    {required ? ' *' : ''}
                  </span>
                  {saved && !files[type] && (
                    <small>Already uploaded: {saved.original_filename}</small>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    required={required && !saved}
                    onChange={(event) =>
                      chooseFile(type, event.target.files?.[0])
                    }
                  />
                </label>
              );
            })}
            <small>PDF, JPG or PNG · Maximum 5 MB per document</small>
          </div>

          {notice && (
            <div className="notice" role="alert">
              {notice}
            </div>
          )}

          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
            Save and continue
          </button>
        </form>
      </section>
    </main>
  );
}
